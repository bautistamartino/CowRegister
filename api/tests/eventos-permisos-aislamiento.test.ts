import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { app, crearSemenDirecto, crearUsuario, limpiarBase, prepararVaca } from './ayudas.js';

// Spec 010, RF-10 y RF-11: permisos por rol y aislamiento entre tambos de las rutas que cambian
// (cinco cargas, cuatro anulaciones y la copia local con el semen).

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

type Tipo = 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO' | 'BAJA';
const CARGAS: Record<Tipo, { ruta: string; cuerpo: Record<string, unknown>; todos: boolean }> = {
  SERVICIO: { ruta: 'servicios', cuerpo: { fecha: '2026-11-01', tipo: 'INSEMINACION' }, todos: true },
  TACTO: { ruta: 'tactos', cuerpo: { fecha: '2026-11-01', resultado: 'VACIA' }, todos: true },
  PARTO: { ruta: 'partos', cuerpo: { fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: 'c1' }] }, todos: false },
  SECADO: { ruta: 'secados', cuerpo: { fecha: '2026-11-01' }, todos: false },
  BAJA: { ruta: 'baja', cuerpo: { motivo: 'venta', fecha: '2026-11-01' }, todos: false },
};
const TIPOS = Object.keys(CARGAS) as Tipo[];
const ANULABLES = ['servicios', 'tactos', 'partos', 'secados'] as const;
const idDe = (tipo: Tipo, body: any) => (tipo === 'PARTO' || tipo === 'SECADO' ? body.evento.id : body.id);

describe('permisos por rol en el servidor (RF-10)', () => {
  it.each(['PARTO', 'SECADO', 'BAJA'] as const)('%s: el veterinario recibe 403, también reenviando un id existente y con JSON roto', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const c = CARGAS[tipo];
    const id = randomUUID();
    await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(201);

    await vet.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(403); // reenvío de un id existente
    await vet.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id: randomUUID() }).expect(403);
    await vet.post(`/api/animales/${vaca.id}/${c.ruta}`).set('Content-Type', 'application/json').send('{roto').expect(403);
    expect(await prisma.evento.count({ where: { animalId: vaca.id } })).toBe(1);
  });

  it.each(['SERVICIO', 'TACTO'] as const)('%s: los tres roles pueden cargar', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const c = CARGAS[tipo];
    for (const a of [agente, encargado, vet]) {
      await a.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id: randomUUID() }).expect(201);
    }
  });

  it('el encargado puede cargar parto, secado y baja', async () => {
    for (const tipo of ['PARTO', 'SECADO', 'BAJA'] as const) {
      const { agente, vaca } = await prepararVaca({ numero: tipo, nombreTambo: `T${tipo}`, email: `${tipo}@prueba.test` });
      const encargado = await crearUsuario(agente, 'ENCARGADO', `enc-${tipo}@prueba.test`);
      await encargado.post(`/api/animales/${vaca.id}/${CARGAS[tipo].ruta}`).send({ ...CARGAS[tipo].cuerpo, id: randomUUID() }).expect(201);
    }
  });

  it.each(['partos', 'secados'] as const)('anular un %s: el veterinario recibe 403, también con JSON roto y sobre un evento ya anulado', async (ruta) => {
    const { agente, vaca } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const tipo = ruta === 'partos' ? 'PARTO' : 'SECADO';
    const creado = await agente.post(`/api/animales/${vaca.id}/${ruta}`).send(CARGAS[tipo].cuerpo).expect(201);
    const id = creado.body.evento.id;
    await vet.post(`/api/${ruta}/${id}/anular`).send({ motivo: 'x' }).expect(403);
    await vet.post(`/api/${ruta}/${id}/anular`).set('Content-Type', 'application/json').send('{roto').expect(403);
    await agente.post(`/api/${ruta}/${id}/anular`).send({ motivo: 'Error' }).expect(200);
    await vet.post(`/api/${ruta}/${id}/anular`).send({ motivo: 'Error' }).expect(403); // la repetición tampoco se salta el permiso
  });

  it.each(['servicios', 'tactos'] as const)('anular un %s: los tres roles pueden', async (ruta) => {
    const { agente, vaca } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const tipo = ruta === 'servicios' ? 'SERVICIO' : 'TACTO';
    const id = (await agente.post(`/api/animales/${vaca.id}/${ruta}`).send(CARGAS[tipo].cuerpo).expect(201)).body.id;
    await vet.post(`/api/${ruta}/${id}/anular`).send({ motivo: 'Error' }).expect(200);
    // La repetición por otro rol del mismo tambo es 409 (otro usuario), no 403.
    await encargado.post(`/api/${ruta}/${id}/anular`).send({ motivo: 'Error' }).expect(409);
  });

  it('sin sesión es 401 en todas las rutas, también con JSON roto', async () => {
    const id = randomUUID();
    for (const tipo of TIPOS) {
      await request(app).post(`/api/animales/${id}/${CARGAS[tipo].ruta}`).send({ ...CARGAS[tipo].cuerpo, id }).expect(401);
      await request(app).post(`/api/animales/${id}/${CARGAS[tipo].ruta}`).set('Content-Type', 'application/json').send('{roto').expect(401);
    }
    for (const ruta of ANULABLES) await request(app).post(`/api/${ruta}/${id}/anular`).send({ motivo: 'x' }).expect(401);
    await request(app).get('/api/copia-local').expect(401);
  });
});

describe('aislamiento entre dos tambos (RF-11)', () => {
  it.each(TIPOS)('%s: el animal de otro tambo da el mismo 404 que un animal inexistente o mal formado, y no se crea nada', async (tipo) => {
    const a = await prepararVaca({ numero: 'A1', nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ numero: 'B1', nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const c = CARGAS[tipo];
    const ajeno = await a.agente.post(`/api/animales/${b.vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id: randomUUID() }).expect(404);
    const inexistente = await a.agente.post(`/api/animales/${randomUUID()}/${c.ruta}`).send({ ...c.cuerpo, id: randomUUID() }).expect(404);
    const malFormado = await a.agente.post(`/api/animales/no-es-un-id/${c.ruta}`).send({ ...c.cuerpo, id: randomUUID() }).expect(404);
    expect(ajeno.body).toEqual(inexistente.body);
    expect(malFormado.body).toEqual(inexistente.body);
    expect(await prisma.evento.count({ where: { establecimientoId: b.tambo } })).toBe(0);
    const intacto = await prisma.animal.findUniqueOrThrow({ where: { id: b.vaca.id } });
    expect(intacto.estado).toBe('EN_ORDENE');
  });

  it.each(TIPOS)('%s: un establecimientoId del cuerpo se ignora (el evento queda en el tambo de la sesión)', async (tipo) => {
    const a = await prepararVaca({ numero: 'A1', nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ numero: 'B1', nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const c = CARGAS[tipo];
    const id = randomUUID();
    await a.agente.post(`/api/animales/${a.vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id, establecimientoId: b.tambo }).expect(201);
    const guardado = await prisma.evento.findUniqueOrThrow({ where: { id } });
    expect(guardado.establecimientoId).toBe(a.tambo);
    expect(await prisma.evento.count({ where: { establecimientoId: b.tambo } })).toBe(0);
  });

  it.each(ANULABLES)('anular un evento de otro tambo (%s) da el mismo 404 que uno inexistente o mal formado', async (ruta) => {
    const a = await prepararVaca({ numero: 'A1', nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ numero: 'B1', nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const tipo: Tipo = ruta === 'servicios' ? 'SERVICIO' : ruta === 'tactos' ? 'TACTO' : ruta === 'partos' ? 'PARTO' : 'SECADO';
    const id = idDe(tipo, (await b.agente.post(`/api/animales/${b.vaca.id}/${ruta}`).send(CARGAS[tipo].cuerpo).expect(201)).body);

    const ajeno = await a.agente.post(`/api/${ruta}/${id}/anular`).send({ motivo: 'Intento' }).expect(404);
    const inexistente = await a.agente.post(`/api/${ruta}/${randomUUID()}/anular`).send({ motivo: 'Intento' }).expect(404);
    const malFormado = await a.agente.post(`/api/${ruta}/xyz/anular`).send({ motivo: 'Intento' }).expect(404);
    expect(ajeno.body).toEqual(inexistente.body);
    expect(malFormado.body).toEqual(inexistente.body);
    expect((await prisma.evento.findUniqueOrThrow({ where: { id } })).anuladoEn).toBeNull();

    // Y si el evento ya estaba anulado en el otro tambo, la repetición tampoco lo revela.
    await b.agente.post(`/api/${ruta}/${id}/anular`).send({ motivo: 'Intento' }).expect(200);
    const repetida = await a.agente.post(`/api/${ruta}/${id}/anular`).send({ motivo: 'Intento' }).expect(404);
    expect(repetida.body).toEqual(inexistente.body);
  });

  it('un semen de otro tambo se trata como inexistente', async () => {
    const a = await prepararVaca({ numero: 'A1', nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ numero: 'B1', nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const ajeno = await crearSemenDirecto(b.tambo, 'Toro de B');
    const cuerpo = { fecha: '2026-11-01', tipo: 'INSEMINACION' };
    const conAjeno = await a.agente.post(`/api/animales/${a.vaca.id}/servicios`).send({ ...cuerpo, semenId: ajeno.id, id: randomUUID() }).expect(400);
    const conInexistente = await a.agente.post(`/api/animales/${a.vaca.id}/servicios`).send({ ...cuerpo, semenId: randomUUID(), id: randomUUID() }).expect(400);
    expect(conAjeno.body).toEqual(conInexistente.body);
  });

  it('las respuestas no traen hashes ni datos de otros tambos', async () => {
    const a = await prepararVaca({ numero: 'A1', nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ numero: 'B1', nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const respuestas: unknown[] = [];
    for (const tipo of TIPOS) {
      const id = randomUUID();
      const r = await a.agente.post(`/api/animales/${a.vaca.id}/${CARGAS[tipo].ruta}`).send({ ...CARGAS[tipo].cuerpo, id }).expect(201);
      respuestas.push(r.body);
      // El reenvío también (200), aunque con la vaca de baja ya no haga falta: se pide dos veces.
      respuestas.push((await a.agente.post(`/api/animales/${a.vaca.id}/${CARGAS[tipo].ruta}`).send({ ...CARGAS[tipo].cuerpo, id }).expect(200)).body);
      if (tipo === 'BAJA') break;
    }
    const texto = JSON.stringify(respuestas);
    for (const prohibido of ['passwordHash', 'tokenHash', 'argon2', 'a@prueba.test', b.tambo, b.usuarioId, b.vaca.id, 'B1']) {
      expect(texto).not.toContain(prohibido);
    }
  });

  it('la copia local trae el semen activo del tambo de la sesión y nunca el del otro', async () => {
    const a = await prepararVaca({ numero: 'A1', nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ numero: 'B1', nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const deA = await crearSemenDirecto(a.tambo, 'Toro de A', { raza: 'Holando' });
    await crearSemenDirecto(b.tambo, 'Toro secreto de B', { raza: 'Jersey' });

    const copiaA = (await a.agente.get(`/api/copia-local?establecimientoId=${b.tambo}`).expect(200)).body;
    expect(copiaA.semen).toEqual([{ id: deA.id, nombre: 'Toro de A', raza: 'Holando' }]);
    const textoA = JSON.stringify(copiaA);
    expect(textoA).not.toContain('Toro secreto de B');
    expect(textoA).not.toContain('Jersey');
    expect(textoA).not.toContain('passwordHash');
    const copiaB = (await b.agente.get('/api/copia-local').expect(200)).body;
    expect(JSON.stringify(copiaB)).not.toContain('Toro de A');
  });

  it('el veterinario del tambo A no puede cargar ni anular partos, secados o bajas del tambo B (403 antes que 404)', async () => {
    const a = await prepararVaca({ numero: 'A1', nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ numero: 'B1', nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const vetA = await crearUsuario(a.agente, 'VETERINARIO', 'vet-a@prueba.test');
    for (const tipo of ['PARTO', 'SECADO', 'BAJA'] as const) {
      await vetA.post(`/api/animales/${b.vaca.id}/${CARGAS[tipo].ruta}`).send(CARGAS[tipo].cuerpo).expect(403);
    }
    expect(await prisma.evento.count({ where: { establecimientoId: b.tambo } })).toBe(0);
  });
});
