import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { app, crearAnimalDirecto, crearBajaRegistradaDirecta, crearProduccionDirecta, crearUsuario, limpiarBase, prepararVaca } from './ayudas.js';

// Spec 008: POST /api/animales/:id/produccion (RF-1 a RF-8, RF-26, RF-27, RF-34).
// El reloj se fija en las 12:00 de Argentina del 11/11/2026.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';
const OK = { fecha: '2026-11-11', turno: 'manana', litros: '12.5' };
const url = (id: string) => `/api/animales/${id}/produccion`;

describe('cargar litros (RF-1, RF-8)', () => {
  it('el dueño carga: 201 con el registro, quién lo cargó y "Sin lote"', async () => {
    const { agente, tambo, vaca, usuarioId } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send(OK).expect(201);
    expect(res.body).toMatchObject({
      animalId: vaca.id,
      fecha: '2026-11-11',
      turno: 'manana',
      litros: 12.5,
      loteNombre: null,
      registradoPor: 'Dueño',
      anulado: null,
    });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    const fila = await prisma.produccion.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(fila).toMatchObject({ establecimientoId: tambo, animalId: vaca.id, turno: 'MANANA', litrosDecimas: 125, registradoPorId: usuarioId, loteId: null, loteNombre: null });
  });

  it('el encargado también carga', async () => {
    const { agente, vaca } = await prepararVaca();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const res = await encargado.post(url(vaca.id)).send({ ...OK, turno: 'tarde' }).expect(201);
    expect(res.body).toMatchObject({ turno: 'tarde', registradoPor: 'Usuario ENCARGADO' });
  });

  it('acepta litros como número JSON y como texto, 0 y 99,9', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-01', litros: 5 }).expect(201);
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-02', litros: 0 }).expect(201);
    const res = await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-03', litros: '99.9' }).expect(201);
    expect(res.body.litros).toBe(99.9);
    const guardados = await prisma.produccion.findMany({ orderBy: { fecha: 'asc' } });
    expect(guardados.map((g) => g.litrosDecimas)).toEqual([50, 0, 999]);
  });

  it('guarda el lote que tenía la vaca con su nombre (RF-8)', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Lote A' } });
    await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: lote.id } });
    const res = await agente.post(url(vaca.id)).send(OK).expect(201);
    expect(res.body.loteNombre).toBe('Lote A');
    expect(await prisma.produccion.findUniqueOrThrow({ where: { id: res.body.id } })).toMatchObject({ loteId: lote.id, loteNombre: 'Lote A' });
  });

  it('el lote del registro no cambia si la vaca se mueve, ni si el lote se renombra o se elimina', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Lote A' } });
    await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: lote.id } });
    const { body } = await agente.post(url(vaca.id)).send(OK).expect(201);

    await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: null } });
    await prisma.lote.update({ where: { id: lote.id }, data: { nombre: 'Renombrado' } });
    expect(await prisma.produccion.findUniqueOrThrow({ where: { id: body.id } })).toMatchObject({ loteId: lote.id, loteNombre: 'Lote A' });
    await prisma.lote.delete({ where: { id: lote.id } });
    expect(await prisma.produccion.findUniqueOrThrow({ where: { id: body.id } })).toMatchObject({ loteNombre: 'Lote A' });
  });

  it('las respuestas no incluyen hashes ni el id ni el email de ningún usuario', async () => {
    const { agente, vaca, usuarioId } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send(OK).expect(201);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toMatch(/passwordHash|tokenHash|dueno@prueba\.test/);
    expect(texto).not.toContain(usuarioId);
  });
});

describe('datos inválidos: 400 (RF-3, RF-4)', () => {
  it.each([
    ['litros con dos decimales', { litros: '5.00' }, /un solo decimal/],
    ['litros con coma', { litros: '5,0' }, /número/],
    ['litros negativos', { litros: -1 }, /negativos/],
    ['litros de 100', { litros: 100 }, /99,9/],
    ['litros de 99,95', { litros: 99.95 }, /un solo decimal/],
    ['litros ausentes', { litros: undefined }, /obligatorios/],
    ['litros con notación científica', { litros: '1e1' }, /número/],
    ['fecha inexistente', { fecha: '2026-02-31' }, /fecha/i],
    ['fecha futura', { fecha: '2026-11-12' }, /futura/],
    ['fecha anterior al 2000', { fecha: '1999-12-31' }, /2000/],
    ['turno inválido', { turno: 'noche' }, /turno/i],
    ['id que no es UUID', { id: 'no-es-uuid' }, /identificador|id/i],
  ])('%s', async (_nombre, cambio, mensaje) => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ ...OK, ...cambio }).expect(400);
    const texto = JSON.stringify(res.body);
    expect(texto).toMatch(mensaje);
    expect(await prisma.produccion.count()).toBe(0);
  });

  it('una fecha futura se mide con la hora de Argentina: a las 22:00 ART de hoy, hoy se acepta y mañana no', async () => {
    fijarReloj(new Date('2026-11-12T01:00:00Z')); // 22:00 ART del 11, ya es 12 en UTC
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-12' }).expect(400);
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-11' }).expect(201);
  });

  it('una fecha anterior al nacimiento de la vaca se acepta (decisión 10)', async () => {
    const { agente, vaca } = await prepararVaca({ fechaNacimiento: '2024-01-01' });
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2023-12-31' }).expect(201);
    expect(vaca.id).toBeDefined();
  });

  it('el JSON mal formado da 400 para un dueño', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).set('Content-Type', 'application/json').send('{roto').expect(400);
  });
});

describe('qué animales reciben carga (RF-5)', () => {
  it('inexistente, de otro tambo, con id mal formado o de baja: el mismo 404', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const deBaja = await crearAnimalDirecto(a.tambo, 'BAJA1');
    await crearBajaRegistradaDirecta({ establecimientoId: a.tambo, animalId: deBaja.id, registradoPorId: a.usuarioId, fecha: '2026-11-01' });

    const mensajes = new Set<string>();
    for (const id of [ID_INEXISTENTE, b.vaca.id, 'no-es-uuid', deBaja.id]) {
      const res = await a.agente.post(url(id)).send(OK).expect(404);
      mensajes.add(res.body.error);
    }
    expect(mensajes.size).toBe(1);
    expect(await prisma.produccion.count()).toBe(0);
  });

  it('un animal de baja por "parto anulado" también da 404', async () => {
    const { agente, tambo } = await prepararVaca();
    const cria = await crearAnimalDirecto(tambo, 'C1', { estado: 'BAJA', motivoBaja: 'PARTO_ANULADO' });
    await agente.post(url(cria.id)).send(OK).expect(404);
  });

  it.each([
    ['un macho', { sexo: 'MACHO', estado: 'RECIEN_NACIDO' }, /macho/],
    ['una vaquillona', { estado: 'VAQUILLONA' }, /vaquillona/],
    ['una vaca seca', { estado: 'SECA' }, /seca/],
    ['una recién nacida', { estado: 'RECIEN_NACIDO' }, /recién nacida/],
  ] as const)('%s: 409 con el motivo y sin guardar nada', async (_nombre, opciones, motivo) => {
    const { agente, vaca } = await prepararVaca(opciones);
    const res = await agente.post(url(vaca.id)).send(OK).expect(409);
    expect(res.body.error).toMatch(/Solo se carga producción de vacas en ordeñe/);
    expect(res.body.error).toMatch(motivo);
    expect(await prisma.produccion.count()).toBe(0);
  });
});

describe('un solo registro vigente por ordeño (RF-6, RF-11)', () => {
  it('la segunda carga del mismo ordeño da 409 y dice que hay que anular; otro turno u otra fecha se acepta', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).send(OK).expect(201);
    const res = await agente.post(url(vaca.id)).send({ ...OK, litros: '7.0' }).expect(409);
    expect(res.body.error).toMatch(/anul/i);
    expect(await prisma.produccion.count()).toBe(1);
    await agente.post(url(vaca.id)).send({ ...OK, turno: 'tarde' }).expect(201);
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-10' }).expect(201);
  });

  it('tras anular el registro se puede cargar otro para ese ordeño', async () => {
    const { agente, vaca } = await prepararVaca();
    const { body } = await agente.post(url(vaca.id)).send(OK).expect(201);
    await agente.post(`${url(vaca.id)}/${body.id}/anular`).send({ motivo: 'Error de tipeo' }).expect(200);
    await agente.post(url(vaca.id)).send({ ...OK, litros: '21.5' }).expect(201);
    expect(await prisma.produccion.count()).toBe(2);
  });

  it('un registro de otra vaca del mismo ordeño no estorba', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    const otra = await crearAnimalDirecto(tambo, '102');
    await agente.post(url(vaca.id)).send(OK).expect(201);
    await agente.post(url(otra.id)).send(OK).expect(201);
  });
});

describe('el id del cliente: idempotencia (RF-34)', () => {
  it('la misma carga repetida con el mismo id: 201 igual y un solo registro', async () => {
    const { agente, vaca } = await prepararVaca();
    const id = crypto.randomUUID();
    const primera = await agente.post(url(vaca.id)).send({ ...OK, id }).expect(201);
    const segunda = await agente.post(url(vaca.id)).send({ ...OK, id }).expect(201);
    expect(primera.body.id).toBe(id);
    expect(segunda.body).toEqual(primera.body);
    expect(await prisma.produccion.count()).toBe(1);
  });

  it('se resuelve antes que el estado de la vaca y que el duplicado', async () => {
    const { agente, vaca } = await prepararVaca();
    const id = crypto.randomUUID();
    await agente.post(url(vaca.id)).send({ ...OK, id }).expect(201);
    await prisma.animal.update({ where: { id: vaca.id }, data: { estado: 'SECA' } });
    await agente.post(url(vaca.id)).send({ ...OK, id }).expect(201); // la vaca ya está seca: igual 201
    expect(await prisma.produccion.count()).toBe(1);
  });

  it('el mismo id con otros datos: 409', async () => {
    const { agente, vaca } = await prepararVaca();
    const id = crypto.randomUUID();
    await agente.post(url(vaca.id)).send({ ...OK, id }).expect(201);
    for (const cambio of [{ litros: '13.0' }, { turno: 'tarde' }, { fecha: '2026-11-10' }]) {
      await agente.post(url(vaca.id)).send({ ...OK, ...cambio, id }).expect(409);
    }
    expect(await prisma.produccion.count()).toBe(1);
  });

  it('el mismo id con otra vaca: 409', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    const otra = await crearAnimalDirecto(tambo, '102');
    const id = crypto.randomUUID();
    await agente.post(url(vaca.id)).send({ ...OK, id }).expect(201);
    await agente.post(url(otra.id)).send({ ...OK, id }).expect(409);
  });

  it('el mismo id de otro tambo: 409 genérico que no revela de quién es', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const id = crypto.randomUUID();
    await a.agente.post(url(a.vaca.id)).send({ ...OK, id }).expect(201);
    const res = await b.agente.post(url(b.vaca.id)).send({ ...OK, id }).expect(409);
    expect(res.body.error).not.toMatch(/Tambo A|101/);
    // El de A sigue intacto y B no guardó nada.
    expect(await prisma.produccion.count({ where: { establecimientoId: b.tambo } })).toBe(0);
    expect(await prisma.produccion.count({ where: { establecimientoId: a.tambo } })).toBe(1);
  });

  it('un id repetido de un registro anulado devuelve ese registro (no crea otro)', async () => {
    const { agente, vaca } = await prepararVaca();
    const id = crypto.randomUUID();
    await agente.post(url(vaca.id)).send({ ...OK, id }).expect(201);
    await agente.post(`${url(vaca.id)}/${id}/anular`).send({ motivo: 'Error' }).expect(200);
    const res = await agente.post(url(vaca.id)).send({ ...OK, id }).expect(201);
    expect(res.body.anulado).toMatchObject({ motivo: 'Error' });
    expect(await prisma.produccion.count()).toBe(1);
  });
});

describe('permisos y orden de controles (RF-26, RF-27)', () => {
  it('el veterinario recibe 403 con el mensaje exacto, también con JSON roto', async () => {
    const { agente, vaca } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const res = await vet.post(url(vaca.id)).send(OK).expect(403);
    expect(res.body.error).toBe('Esta acción la tiene que hacer un dueño o encargado');
    await vet.post(url(vaca.id)).set('Content-Type', 'application/json').send('{roto').expect(403);
    expect(await prisma.produccion.count()).toBe(0);
  });

  it('sin sesión: 401, también con JSON roto', async () => {
    const { vaca } = await prepararVaca();
    await request(app).post(url(vaca.id)).send(OK).expect(401);
    await request(app).post(url(vaca.id)).set('Content-Type', 'application/json').send('{roto').expect(401);
  });

  it('el orden es 400 antes que 404 y 404 antes que 409', async () => {
    const { agente, vaca } = await prepararVaca({ estado: 'SECA' });
    // datos inválidos sobre un animal inexistente: 400
    await agente.post(url(ID_INEXISTENTE)).send({ ...OK, litros: 'x' }).expect(400);
    // datos válidos sobre un animal inexistente: 404
    await agente.post(url(ID_INEXISTENTE)).send(OK).expect(404);
    // datos válidos sobre una vaca seca: 409 por estado
    await agente.post(url(vaca.id)).send(OK).expect(409);
  });

  it('el 409 por estado va antes que el 409 por duplicado', async () => {
    const { agente, tambo, vaca, usuarioId } = await prepararVaca({ estado: 'SECA' });
    await crearProduccionDirecta({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-11-11' });
    const res = await agente.post(url(vaca.id)).send(OK).expect(409);
    expect(res.body.error).toMatch(/seca/);
  });

  it('ignora un establecimientoId enviado en el cuerpo', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const res = await a.agente.post(url(a.vaca.id)).send({ ...OK, establecimientoId: b.tambo }).expect(201);
    expect(await prisma.produccion.findUniqueOrThrow({ where: { id: res.body.id } })).toMatchObject({ establecimientoId: a.tambo });
    // y mandando el tambo propio con la vaca ajena tampoco sirve
    await a.agente.post(url(b.vaca.id)).send({ ...OK, establecimientoId: a.tambo }).expect(404);
    expect(await prisma.produccion.count({ where: { establecimientoId: b.tambo } })).toBe(0);
  });

  it('aislamiento: un tambo no puede cargar a la vaca de otro (404) y la base queda intacta', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    await b.agente.post(url(a.vaca.id)).send(OK).expect(404);
    expect(await prisma.produccion.count()).toBe(0);
  });
});
