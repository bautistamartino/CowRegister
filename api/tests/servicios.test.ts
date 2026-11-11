import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import {
  app,
  crearAnimalDirecto,
  crearSemenDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
  registrarTambo,
} from './ayudas.js';

// Tests de POST /api/animales/:id/servicios: RF-7 a RF-11, RF-18, RF-22 (orden), RF-27 y RF-28.

beforeEach(() => {
  // "Hoy" en Argentina = 11/11/2026, así las fechas de los tests no dependen del día real.
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';

type Agente = ReturnType<typeof request.agent>;
const url = (animalId: string) => `/api/animales/${animalId}/servicios`;
const situacionDe = async (agente: Agente, animalId: string) =>
  (await agente.get(`/api/animales/${animalId}/eventos`).expect(200)).body.situacion;

describe('registrar un servicio (RF-7)', () => {
  it.each(['VAQUILLONA', 'EN_ORDENE', 'SECA'] as const)('sobre una hembra %s: 201, "servida", sin cambiar estado ni lote', async (estado) => {
    const { agente, tambo, vaca } = await prepararVaca({ estado });
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Lote X' } });
    await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: lote.id } });
    const semen = await crearSemenDirecto(tambo, 'Toro 1');

    const res = await agente
      .post(url(vaca.id))
      .send({ fecha: '2026-11-01', tipo: 'INSEMINACION', semenId: semen.id })
      .expect(201);
    expect(res.body).toMatchObject({
      tipo: 'SERVICIO',
      fecha: '2026-11-01',
      anulacion: null,
      servicio: { tipoServicio: 'INSEMINACION', semen: { id: semen.id, nombre: 'Toro 1' } },
    });
    expect((await situacionDe(agente, vaca.id)).estado).toBe('SERVIDA');

    const despues = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(despues.estado).toBe(estado);
    expect(despues.loteId).toBe(lote.id);
  });

  it('sin semen o toro ("No especificado"): se acepta, con la clave ausente, null o vacía', async () => {
    const { agente, vaca } = await prepararVaca();
    const a = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'MONTA_NATURAL' }).expect(201);
    expect(a.body.servicio).toEqual({ tipoServicio: 'MONTA_NATURAL', semen: null });
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-02', tipo: 'INSEMINACION', semenId: null }).expect(201);
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-03', tipo: 'INSEMINACION', semenId: '' }).expect(201);
  });

  it('guarda quién lo registró y la fecha de hoy se acepta', async () => {
    const { agente, vaca, usuarioId } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-11', tipo: 'INSEMINACION' }).expect(201);
    const evento = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(evento.registradoPorId).toBe(usuarioId);
    expect(evento.anuladoEn).toBeNull();
  });

  it('dos servicios del mismo día quedan en orden de registro, con momentos distintos', async () => {
    const { agente, vaca } = await prepararVaca();
    const a = await agente.post(url(vaca.id)).send({ fecha: '2026-10-05', tipo: 'INSEMINACION' }).expect(201);
    const b = await agente.post(url(vaca.id)).send({ fecha: '2026-10-05', tipo: 'MONTA_NATURAL' }).expect(201);
    const eventos = await prisma.evento.findMany({ where: { animalId: vaca.id }, orderBy: { creadoEn: 'asc' } });
    expect(eventos.map((e) => e.id)).toEqual([a.body.id, b.body.id]);
    expect(eventos[0]!.creadoEn.getTime()).toBeLessThan(eventos[1]!.creadoEn.getTime());
  });

  it('el momento de registro es estrictamente creciente aun con eventos "del futuro" ya cargados', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    // Un evento cargado con un momento de registro adelantado (reloj del servidor atrasado).
    await crearServicioDirecto({
      establecimientoId: tambo,
      animalId: vaca.id,
      registradoPorId: usuarioId,
      fecha: '2026-10-01',
      creadoEn: new Date(Date.now() + 60_000),
    });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-02', tipo: 'INSEMINACION' }).expect(201);
    const nuevo = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(nuevo.creadoEn.getTime()).toBeGreaterThan(Date.now() + 59_000);
  });
});

describe('datos inválidos (RF-8)', () => {
  it.each([
    ['sin fecha', { tipo: 'INSEMINACION' }, /fecha/i],
    ['sin tipo', { fecha: '2026-10-01' }, /tipo/i],
    ['tipo inválido', { fecha: '2026-10-01', tipo: 'OTRO' }, /tipo/i],
    ['fecha con hora', { fecha: '2026-10-01T10:00', tipo: 'INSEMINACION' }, /AAAA-MM-DD/],
    ['fecha dd/mm/aaaa', { fecha: '01/10/2026', tipo: 'INSEMINACION' }, /AAAA-MM-DD/],
    ['fecha inexistente', { fecha: '2026-02-30', tipo: 'INSEMINACION' }, /AAAA-MM-DD/],
    ['fecha que no es texto', { fecha: 20261001, tipo: 'INSEMINACION' }, /fecha/i],
  ])('%s: 400 en español', async (_caso, cuerpo, mensaje) => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send(cuerpo).expect(400);
    expect(JSON.stringify(res.body)).toMatch(mensaje);
    expect(await prisma.evento.count()).toBe(0);
  });

  it('sin cuerpo: 400', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).expect(400);
  });
});

describe('semen o toro (RF-9)', () => {
  it('inexistente, de otro tambo y mal formado: 400 con el mismo mensaje', async () => {
    const { agente, vaca } = await prepararVaca();
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    const ajeno = await crearSemenDirecto(otro.perfil.establecimiento.id, 'Toro ajeno');

    const mensajes = new Set<string>();
    for (const semenId of [ID_INEXISTENTE, ajeno.id]) {
      const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION', semenId }).expect(400);
      mensajes.add(res.body.error + JSON.stringify(res.body.detalles));
    }
    expect(mensajes.size).toBe(1); // sin revelar si existe en otro tambo
    const mal = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION', semenId: 'abc' }).expect(400);
    expect(JSON.stringify(mal.body)).toMatch(/semen|toro/i);
    expect(await prisma.evento.count()).toBe(0);
  });

  it('desactivado: 409; reactivado vuelve a aceptarse', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    const semen = await crearSemenDirecto(tambo, 'Toro 1', { activo: false });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION', semenId: semen.id }).expect(409);
    expect(res.body.error).toMatch(/desactivad/i);
    await agente.patch(`/api/semen/${semen.id}`).send({ activo: true }).expect(200);
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION', semenId: semen.id }).expect(201);
  });

  it('un servicio ya cargado sigue mostrando una entrada que se desactivó después', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    const semen = await crearSemenDirecto(tambo, 'Toro 1');
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION', semenId: semen.id }).expect(201);
    await agente.patch(`/api/semen/${semen.id}`).send({ activo: false, nombre: 'Toro 1 bis' }).expect(200);
    const lista = (await agente.get(`/api/animales/${vaca.id}/eventos`).expect(200)).body.eventos;
    expect(lista[0].servicio.semen).toEqual({ id: semen.id, nombre: 'Toro 1 bis' });
  });
});

describe('animales que no admiten el evento (RF-10)', () => {
  it('macho: 409 con el motivo', async () => {
    const { agente, vaca } = await prepararVaca({ sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION' }).expect(409);
    expect(res.body.error).toMatch(/macho/i);
  });

  it('recién nacida: 409 con el motivo', async () => {
    const { agente, vaca } = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION' }).expect(409);
    expect(res.body.error).toMatch(/recién nacida/i);
    expect(await prisma.evento.count()).toBe(0);
  });
});

describe('servicio sobre una preñada (RF-11)', () => {
  it('con una preñez vigente: 409 que pide un tacto "vacía"', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearServicioDirecto({ ...base, fecha: '2026-08-01' });
    await crearTactoDirecto({ ...base, fecha: '2026-09-01', resultado: 'PRENADA' });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION' }).expect(409);
    expect(res.body.error).toMatch(/preñez vigente/i);
    expect(res.body.error).toMatch(/vacía/i);
    expect(await prisma.evento.count({ where: { tipo: 'SERVICIO' } })).toBe(1);
  });

  it('sobre una servida o con tacto "vacía" se acepta', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearServicioDirecto({ ...base, fecha: '2026-08-01' });
    await agente.post(url(vaca.id)).send({ fecha: '2026-08-20', tipo: 'INSEMINACION' }).expect(201); // servida
    await crearTactoDirecto({ ...base, fecha: '2026-09-01', resultado: 'VACIA' });
    await agente.post(url(vaca.id)).send({ fecha: '2026-09-15', tipo: 'MONTA_NATURAL' }).expect(201); // vacía
  });

  it('si el tacto "preñada" está anulado, el servicio se acepta', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearTactoDirecto({
      ...base,
      fecha: '2026-09-01',
      resultado: 'PRENADA',
      fechaProbableIndicada: '2027-05-01',
      anulacion: { porId: usuarioId, motivo: 'Error de carga' },
    });
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION' }).expect(201);
  });
});

describe('reglas de fecha contra el animal (RF-18)', () => {
  it('futura (con el reloj fijo): 400; mañana de Argentina aunque en UTC ya sea hoy', async () => {
    const { agente, vaca } = await prepararVaca();
    // 22:00 del 11/11 en Argentina = 01:00 UTC del 12/11
    fijarReloj(new Date('2026-11-12T01:00:00Z'));
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-12', tipo: 'INSEMINACION' }).expect(400);
    expect(res.body.error + JSON.stringify(res.body.detalles)).toMatch(/futura/);
    await agente.post(url(vaca.id)).send({ fecha: '2026-11-11', tipo: 'INSEMINACION' }).expect(201);
  });

  it('anterior al 01/01/2000: 400', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ fecha: '1999-12-31', tipo: 'INSEMINACION' }).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/2000/);
  });

  it('anterior al nacimiento: 400; igual al nacimiento se acepta', async () => {
    const { agente, vaca } = await prepararVaca({ fechaNacimiento: '2025-03-10' });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2025-03-09', tipo: 'INSEMINACION' }).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/nacimiento/);
    await agente.post(url(vaca.id)).send({ fecha: '2025-03-10', tipo: 'INSEMINACION' }).expect(201);
  });

  it('evento olvidado entre dos ya cargados: 400; igual fecha que el último, se acepta', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearServicioDirecto({ ...base, fecha: '2026-08-01' });
    await crearServicioDirecto({ ...base, fecha: '2026-10-01' });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-09-01', tipo: 'INSEMINACION' }).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/último evento/);
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION' }).expect(201);
  });

  it('un evento anulado no cuenta como "último evento"', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearServicioDirecto({ ...base, fecha: '2026-08-01' });
    await crearServicioDirecto({ ...base, fecha: '2026-10-01', anulacion: { porId: usuarioId, motivo: 'Error' } });
    await agente.post(url(vaca.id)).send({ fecha: '2026-09-01', tipo: 'INSEMINACION' }).expect(201);
  });
});

describe('orden de controles y aislamiento (RF-27, RF-28)', () => {
  it('sin sesión: 401, también con JSON roto', async () => {
    const { vaca } = await prepararVaca();
    await request(app).post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION' }).expect(401);
    await request(app).post(url(vaca.id)).set('Content-Type', 'application/json').send('{roto').expect(401);
  });

  it('cuerpo inválido con animal inexistente: 400 (el cuerpo gana sobre la búsqueda)', async () => {
    const { agente } = await prepararVaca();
    await agente.post(url(ID_INEXISTENTE)).send({ tipo: 'INSEMINACION' }).expect(400);
    await agente.post(url('no-es-un-uuid')).send({}).expect(400);
  });

  it('animal inexistente, mal formado, de otro tambo o de baja: el mismo 404', async () => {
    const { agente } = await prepararVaca();
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    const ajeno = await crearAnimalDirecto(otro.perfil.establecimiento.id, '900');
    const propia = await crearAnimalDirecto((await prisma.establecimiento.findFirstOrThrow({ where: { nombre: 'Tambo de prueba' } })).id, '777', { estado: 'BAJA' });
    const cuerpo = { fecha: '2026-10-01', tipo: 'INSEMINACION' };

    const respuestas = [];
    for (const id of [ID_INEXISTENTE, 'no-es-un-uuid', ajeno.id, propia.id]) {
      const res = await agente.post(url(id)).send(cuerpo).expect(404);
      respuestas.push(res.body);
    }
    expect(new Set(respuestas.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(await prisma.evento.count()).toBe(0);
  });

  it('un establecimientoId en el cuerpo se ignora: el evento queda en el tambo de la sesión', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    const res = await agente
      .post(url(vaca.id))
      .send({ fecha: '2026-10-01', tipo: 'INSEMINACION', establecimientoId: otro.perfil.establecimiento.id })
      .expect(201);
    const evento = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(evento.establecimientoId).toBe(tambo);
  });

  it('un tambo no puede registrar sobre un animal de otro, aunque conozca el id', async () => {
    const dueno1 = await prepararVaca();
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    await otro.agente.post(url(dueno1.vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION' }).expect(404);
    expect(await prisma.evento.count()).toBe(0);
  });
});

describe('permisos por rol (RF-28)', () => {
  it.each(['ENCARGADO', 'VETERINARIO'] as const)('el %s puede registrar un servicio', async (rol) => {
    const { agente, vaca } = await prepararVaca();
    const agenteRol = await crearUsuario(agente, rol, `${rol.toLowerCase()}@prueba.test`);
    await agenteRol.post(url(vaca.id)).send({ fecha: '2026-10-01', tipo: 'INSEMINACION' }).expect(201);
  });
});
