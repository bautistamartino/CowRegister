import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { app, crearSemenDirecto, crearUsuario, limpiarBase, registrarTambo } from './ayudas.js';

// Tests de la API del catálogo de semen y toros (/api/semen): RF-1 a RF-6, RF-27 y RF-28.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

type SemenRespuesta = { id: string; nombre: string; raza: string | null; activo: boolean };

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';
const MENSAJE_REPETIDO = 'Ya existe un semen o toro con ese nombre';

type Agente = ReturnType<typeof request.agent>;

async function listar(agente: Agente) {
  const res = await agente.get('/api/semen').expect(200);
  return res.body as SemenRespuesta[];
}

describe('GET /api/semen (RF-1)', () => {
  it('sin sesión responde 401', async () => {
    await request(app).get('/api/semen').expect(401);
  });

  it('un tambo nuevo no tiene entradas', async () => {
    const { agente } = await registrarTambo();
    expect(await listar(agente)).toEqual([]);
  });

  it('lista activas y desactivadas, ordenadas sin distinguir mayúsculas, con raza o null', async () => {
    const { agente, perfil } = await registrarTambo();
    const tambo = perfil.establecimiento.id;
    await crearSemenDirecto(tambo, 'zeta', { raza: 'Holando' });
    await crearSemenDirecto(tambo, 'Beta', { activo: false });
    // En orden ASCII la minúscula "alfa" iría al final; sin distinguir mayúsculas va primero.
    await crearSemenDirecto(tambo, 'alfa');

    const lista = await listar(agente);
    expect(lista.map((s) => s.nombre)).toEqual(['alfa', 'Beta', 'zeta']);
    expect(lista[0]).toEqual({ id: expect.any(String), nombre: 'alfa', raza: null, activo: true });
    expect(lista[1]?.activo).toBe(false);
    expect(lista[2]?.raza).toBe('Holando');
  });

  it('los tres roles lo ven', async () => {
    const { agente, perfil } = await registrarTambo();
    await crearSemenDirecto(perfil.establecimiento.id, 'Toro 1');
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    for (const a of [agente, encargado, vet]) expect(await listar(a)).toHaveLength(1);
  });

  it('no incluye datos de otro tambo (RF-27)', async () => {
    const a = await registrarTambo('A', 'a@prueba.test');
    const b = await registrarTambo('B', 'b@prueba.test');
    await crearSemenDirecto(a.perfil.establecimiento.id, 'Toro de A');
    expect(await listar(b.agente)).toEqual([]);
  });
});

describe('POST /api/semen (RF-2, RF-3, RF-4)', () => {
  it('dueño y encargado crean con y sin raza: 201 y queda activa en su tambo', async () => {
    const { agente, perfil } = await registrarTambo();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');

    const r1 = await agente.post('/api/semen').send({ nombre: 'Holando Toro 1234', raza: 'Holando' }).expect(201);
    expect(r1.body).toEqual({ id: expect.any(String), nombre: 'Holando Toro 1234', raza: 'Holando', activo: true });
    const r2 = await encargado.post('/api/semen').send({ nombre: 'Toro 2' }).expect(201);
    expect(r2.body.raza).toBeNull();

    const guardada = await prisma.semenToro.findUniqueOrThrow({ where: { id: r1.body.id } });
    expect(guardada.establecimientoId).toBe(perfil.establecimiento.id);
  });

  it('normaliza el nombre: extremos, espacios y tabulaciones internas', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/semen').send({ nombre: '  Toro \t  Uno  ' }).expect(201);
    expect(res.body.nombre).toBe('Toro Uno');
  });

  it('rechaza un nombre vacío, ausente o que no es texto (400 en español)', async () => {
    const { agente } = await registrarTambo();
    for (const cuerpo of [{ nombre: '' }, { nombre: '   \t ' }, {}, { nombre: 5 }]) {
      const res = await agente.post('/api/semen').send(cuerpo).expect(400);
      expect(res.body.error).toBeTruthy();
    }
    const res = await agente.post('/api/semen').send({ nombre: '  ' }).expect(400);
    expect(JSON.stringify(res.body)).toContain('El nombre del semen o toro es obligatorio');
  });

  it('acepta 50 caracteres (con ñ) y rechaza 51', async () => {
    const { agente } = await registrarTambo();
    await agente.post('/api/semen').send({ nombre: 'ñ'.repeat(50) }).expect(201);
    const res = await agente.post('/api/semen').send({ nombre: 'ñ'.repeat(51) }).expect(400);
    expect(JSON.stringify(res.body)).toContain('50 caracteres');
  });

  it('la raza: de 50 se acepta, de 51 se rechaza, vacía o de solo espacios queda null', async () => {
    const { agente } = await registrarTambo();
    await agente.post('/api/semen').send({ nombre: 'T1', raza: 'x'.repeat(50) }).expect(201);
    await agente.post('/api/semen').send({ nombre: 'T2', raza: 'x'.repeat(51) }).expect(400);
    const vacia = await agente.post('/api/semen').send({ nombre: 'T3', raza: '   ' }).expect(201);
    expect(vacia.body.raza).toBeNull();
    const nula = await agente.post('/api/semen').send({ nombre: 'T4', raza: null }).expect(201);
    expect(nula.body.raza).toBeNull();
    const conEspacios = await agente.post('/api/semen').send({ nombre: 'T5', raza: '  Jersey  ' }).expect(201);
    expect(conEspacios.body.raza).toBe('Jersey');
  });

  it('409 con el mensaje si el nombre ya existe sin distinguir mayúsculas ni espacios', async () => {
    const { agente } = await registrarTambo();
    await agente.post('/api/semen').send({ nombre: 'Toro 1' }).expect(201);
    const res = await agente.post('/api/semen').send({ nombre: 'toro   1' }).expect(409);
    expect(res.body.error).toBe(MENSAJE_REPETIDO);
  });

  it('409 también contra una entrada desactivada', async () => {
    const { agente, perfil } = await registrarTambo();
    await crearSemenDirecto(perfil.establecimiento.id, 'Toro 1', { activo: false });
    const res = await agente.post('/api/semen').send({ nombre: 'TORO 1' }).expect(409);
    expect(res.body.error).toBe(MENSAJE_REPETIDO);
  });

  it('dos altas simultáneas del mismo nombre dejan una sola', async () => {
    const { agente } = await registrarTambo();
    const [r1, r2] = await Promise.all([
      agente.post('/api/semen').send({ nombre: 'Toro Carrera' }),
      agente.post('/api/semen').send({ nombre: 'toro carrera' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await prisma.semenToro.count()).toBe(1);
  });

  it('dos tambos pueden tener el mismo nombre', async () => {
    const a = await registrarTambo('A', 'a@prueba.test');
    const b = await registrarTambo('B', 'b@prueba.test');
    await a.agente.post('/api/semen').send({ nombre: 'Toro 1' }).expect(201);
    await b.agente.post('/api/semen').send({ nombre: 'Toro 1' }).expect(201);
  });

  it('ignora un establecimientoId enviado por el cliente (RF-27)', async () => {
    const a = await registrarTambo('A', 'a@prueba.test');
    const b = await registrarTambo('B', 'b@prueba.test');
    const res = await a.agente
      .post('/api/semen')
      .send({ nombre: 'Toro 1', establecimientoId: b.perfil.establecimiento.id })
      .expect(201);
    const guardada = await prisma.semenToro.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(guardada.establecimientoId).toBe(a.perfil.establecimiento.id);
    expect(await listar(b.agente)).toEqual([]);
  });
});

describe('PATCH /api/semen/:id (RF-5, RF-6)', () => {
  it('edita nombre y raza, también de una desactivada', async () => {
    const { agente, perfil } = await registrarTambo();
    const e = await crearSemenDirecto(perfil.establecimiento.id, 'Toro 1', { activo: false });
    const res = await agente.patch(`/api/semen/${e.id}`).send({ nombre: ' Toro 99 ', raza: 'Jersey' }).expect(200);
    expect(res.body).toEqual({ id: e.id, nombre: 'Toro 99', raza: 'Jersey', activo: false });
  });

  it('raza vacía o null la borra', async () => {
    const { agente, perfil } = await registrarTambo();
    const e = await crearSemenDirecto(perfil.establecimiento.id, 'Toro 1', { raza: 'Holando' });
    const r1 = await agente.patch(`/api/semen/${e.id}`).send({ raza: '' }).expect(200);
    expect(r1.body.raza).toBeNull();
    await agente.patch(`/api/semen/${e.id}`).send({ raza: 'Jersey' }).expect(200);
    const r2 = await agente.patch(`/api/semen/${e.id}`).send({ raza: null }).expect(200);
    expect(r2.body.raza).toBeNull();
  });

  it('renombrar a su propio nombre o cambiar solo las mayúsculas da 200', async () => {
    const { agente, perfil } = await registrarTambo();
    const e = await crearSemenDirecto(perfil.establecimiento.id, 'Toro 1');
    await agente.patch(`/api/semen/${e.id}`).send({ nombre: 'Toro 1' }).expect(200);
    const res = await agente.patch(`/api/semen/${e.id}`).send({ nombre: 'TORO 1' }).expect(200);
    expect(res.body.nombre).toBe('TORO 1');
  });

  it('409 si el nombre ya lo tiene otra entrada (también desactivada)', async () => {
    const { agente, perfil } = await registrarTambo();
    await crearSemenDirecto(perfil.establecimiento.id, 'Toro 1', { activo: false });
    const otra = await crearSemenDirecto(perfil.establecimiento.id, 'Toro 2');
    const res = await agente.patch(`/api/semen/${otra.id}`).send({ nombre: 'toro 1' }).expect(409);
    expect(res.body.error).toBe(MENSAJE_REPETIDO);
  });

  it('desactiva y reactiva con activo', async () => {
    const { agente, perfil } = await registrarTambo();
    const e = await crearSemenDirecto(perfil.establecimiento.id, 'Toro 1');
    const off = await agente.patch(`/api/semen/${e.id}`).send({ activo: false }).expect(200);
    expect(off.body.activo).toBe(false);
    expect((await listar(agente))[0]?.activo).toBe(false); // sigue en la lista
    const on = await agente.patch(`/api/semen/${e.id}`).send({ activo: true }).expect(200);
    expect(on.body.activo).toBe(true);
  });

  it('rechaza un cuerpo sin ningún campo, o con datos inválidos (400)', async () => {
    const { agente, perfil } = await registrarTambo();
    const e = await crearSemenDirecto(perfil.establecimiento.id, 'Toro 1');
    await agente.patch(`/api/semen/${e.id}`).send({}).expect(400);
    await agente.patch(`/api/semen/${e.id}`).send({ nombre: '' }).expect(400);
    await agente.patch(`/api/semen/${e.id}`).send({ nombre: 'x'.repeat(51) }).expect(400);
    await agente.patch(`/api/semen/${e.id}`).send({ raza: 'x'.repeat(51) }).expect(400);
    await agente.patch(`/api/semen/${e.id}`).send({ activo: 'si' }).expect(400);
  });

  it('inexistente, mal formada o de otro tambo: el mismo 404 (RF-27)', async () => {
    const a = await registrarTambo('A', 'a@prueba.test');
    const b = await registrarTambo('B', 'b@prueba.test');
    const deB = await crearSemenDirecto(b.perfil.establecimiento.id, 'Toro de B');
    const respuestas = [];
    for (const id of [ID_INEXISTENTE, 'no-es-un-uuid', deB.id]) {
      respuestas.push(await a.agente.patch(`/api/semen/${id}`).send({ nombre: 'Nuevo' }).expect(404));
    }
    expect(new Set(respuestas.map((r) => JSON.stringify(r.body))).size).toBe(1);
    // La de B no cambió.
    expect((await prisma.semenToro.findUniqueOrThrow({ where: { id: deB.id } })).nombre).toBe('Toro de B');
  });

  it('ignora un establecimientoId en el cuerpo', async () => {
    const a = await registrarTambo('A', 'a@prueba.test');
    const b = await registrarTambo('B', 'b@prueba.test');
    const e = await crearSemenDirecto(a.perfil.establecimiento.id, 'Toro 1');
    await a.agente.patch(`/api/semen/${e.id}`).send({ raza: 'Jersey', establecimientoId: b.perfil.establecimiento.id }).expect(200);
    expect((await prisma.semenToro.findUniqueOrThrow({ where: { id: e.id } })).establecimientoId).toBe(
      a.perfil.establecimiento.id,
    );
  });
});

describe('Permisos y sesión (RF-28)', () => {
  it('el veterinario ve el catálogo (200) y recibe 403 al crear, editar y desactivar', async () => {
    const { agente, perfil } = await registrarTambo();
    const e = await crearSemenDirecto(perfil.establecimiento.id, 'Toro 1');
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    await vet.get('/api/semen').expect(200);
    await vet.post('/api/semen').send({ nombre: 'Toro 2' }).expect(403);
    await vet.patch(`/api/semen/${e.id}`).send({ nombre: 'Otro' }).expect(403);
    await vet.patch(`/api/semen/${e.id}`).send({ activo: false }).expect(403);
    expect((await prisma.semenToro.findUniqueOrThrow({ where: { id: e.id } })).activo).toBe(true);
  });

  it('el veterinario recibe 403 también con datos inválidos y con una entrada ajena o inexistente', async () => {
    const a = await registrarTambo('A', 'a@prueba.test');
    const b = await registrarTambo('B', 'b@prueba.test');
    const deB = await crearSemenDirecto(b.perfil.establecimiento.id, 'Toro de B');
    const vet = await crearUsuario(a.agente, 'VETERINARIO', 'vet@prueba.test');
    await vet.post('/api/semen').send({ nombre: '' }).expect(403);
    await vet.post('/api/semen').send({}).expect(403);
    await vet.patch(`/api/semen/${deB.id}`).send({ nombre: 'x' }).expect(403);
    await vet.patch(`/api/semen/${ID_INEXISTENTE}`).send({ nombre: 'x' }).expect(403);
    await vet.patch('/api/semen/no-es-un-uuid').send({}).expect(403);
  });

  it('el veterinario recibe 403 (y sin sesión 401) aunque el JSON venga roto', async () => {
    const { agente } = await registrarTambo();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    await vet.post('/api/semen').set('Content-Type', 'application/json').send('{"nombre": ').expect(403);
    await vet.patch(`/api/semen/${ID_INEXISTENTE}`).set('Content-Type', 'application/json').send('{roto').expect(403);

    await request(app).post('/api/semen').set('Content-Type', 'application/json').send('{"nombre": ').expect(401);
    await request(app).patch(`/api/semen/${ID_INEXISTENTE}`).set('Content-Type', 'application/json').send('{roto').expect(401);
  });

  it('sin sesión: 401 en todas las rutas', async () => {
    await request(app).get('/api/semen').expect(401);
    await request(app).post('/api/semen').send({ nombre: 'Toro' }).expect(401);
    await request(app).patch(`/api/semen/${ID_INEXISTENTE}`).send({ nombre: 'Toro' }).expect(401);
  });

  it('con sesión, un JSON roto da 400 (dueño)', async () => {
    const { agente } = await registrarTambo();
    await agente.post('/api/semen').set('Content-Type', 'application/json').send('{"nombre": ').expect(400);
  });
});
