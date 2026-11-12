import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { bloquearLoteDestino } from '../src/animales/mover.js';
import { fijarReloj } from '../src/reloj.js';
import {
  app,
  crearAnimalDirecto,
  crearBajaDirecta,
  crearUsuario,
  limpiarBase,
  prepararVaca,
  verificarInvariantes,
} from './ayudas.js';

// Spec 005, mover de lote a mano: PATCH /api/animales/:id/lote. Cubre RF-9 a RF-12, RF-14, RF-18 y RF-19.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
const mover = (agente: ReturnType<typeof request.agent>, id: string, cuerpo: object) =>
  agente.patch(`/api/animales/${id}/lote`).send(cuerpo);
const crearLote = (tambo: string, nombre: string) => prisma.lote.create({ data: { establecimientoId: tambo, nombre } });
const vacaDe = (id: string) => prisma.animal.findUniqueOrThrow({ where: { id } });
const historial = () => prisma.cambioAnimal.findMany({ orderBy: { creadoEn: 'asc' } });

describe('permisos (RF-19)', () => {
  it('sin sesión 401 y veterinario 403, también con JSON roto, datos inválidos y animal ajeno o inexistente', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    const lote = await crearLote(tambo, 'Enfermería');
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const otro = await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test' });

    await request(app).patch(`/api/animales/${vaca.id}/lote`).send({ loteId: lote.id }).expect(401);
    await request(app).patch(`/api/animales/${vaca.id}/lote`).set('Content-Type', 'application/json').send('{roto').expect(401);
    await mover(vet, vaca.id, { loteId: lote.id }).expect(403);
    await mover(vet, vaca.id, { estado: 'SECA' }).expect(403);
    await vet.patch(`/api/animales/${vaca.id}/lote`).set('Content-Type', 'application/json').send('{roto').expect(403);
    await mover(vet, otro.vaca.id, { loteId: lote.id }).expect(403);
    await mover(vet, ID_INEXISTENTE, { loteId: lote.id }).expect(403);
    await mover(vet, 'no-es-un-uuid', { loteId: lote.id }).expect(403);
    expect((await vacaDe(vaca.id)).loteId).toBeNull();
    expect(await prisma.cambioAnimal.count()).toBe(0);
  });

  it('el encargado también mueve', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    const lote = await crearLote(tambo, 'Enfermería');
    const enc = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');
    await mover(enc, vaca.id, { loteId: lote.id }).expect(200);
    expect((await vacaDe(vaca.id)).loteId).toBe(lote.id);
  });
});

describe('mover a un lote y a "sin lote" (RF-9, RF-10, RF-14)', () => {
  it('a un lote: no cambia el estado, devuelve la ficha y guarda una fila con los nombres', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca({ estado: 'SECA' });
    const lote = await crearLote(tambo, 'Enfermería');
    const res = await mover(agente, vaca.id, { loteId: lote.id }).expect(200);
    expect(res.body).toMatchObject({ id: vaca.id, estado: 'SECA', lote: { id: lote.id, nombre: 'Enfermería' } });
    expect(await vacaDe(vaca.id)).toMatchObject({ estado: 'SECA', loteId: lote.id });
    const filas = await historial();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      animalId: vaca.id,
      campo: 'LOTE',
      valorAnterior: null,
      valorNuevo: 'Enfermería',
      usuarioId,
      usuarioNombre: 'Dueño',
    });
  });

  it('de un lote a otro: antes y después con el nombre de cada uno', async () => {
    const t = await prepararVaca();
    const a = await crearLote(t.tambo, 'Lote A');
    const b = await crearLote(t.tambo, 'Lote B');
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { loteId: a.id } });
    await mover(t.agente, t.vaca.id, { loteId: b.id }).expect(200);
    expect((await historial())[0]).toMatchObject({ valorAnterior: 'Lote A', valorNuevo: 'Lote B' });
  });

  it('a "sin lote" (null): lo deja sin lote y el historial guarda el lote anterior', async () => {
    const t = await prepararVaca();
    const a = await crearLote(t.tambo, 'Lote A');
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { loteId: a.id } });
    const res = await mover(t.agente, t.vaca.id, { loteId: null }).expect(200);
    expect(res.body.lote).toBeNull();
    expect((await historial())[0]).toMatchObject({ valorAnterior: 'Lote A', valorNuevo: null });
  });

  it('el mismo lote o "sin lote" estando sin lote: 400 y no guarda nada', async () => {
    const t = await prepararVaca();
    const a = await crearLote(t.tambo, 'Lote A');
    await mover(t.agente, t.vaca.id, { loteId: null }).expect(400);
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { loteId: a.id } });
    const res = await mover(t.agente, t.vaca.id, { loteId: a.id }).expect(400);
    expect(res.body.error).toBe('El animal ya está en ese lote');
    expect(await prisma.cambioAnimal.count()).toBe(0);
  });

  it('cuerpo sin lote, vacío o con otro campo: 400; establecimientoId se ignora', async () => {
    const t = await prepararVaca();
    const a = await crearLote(t.tambo, 'Lote A');
    const sinLote = await mover(t.agente, t.vaca.id, {}).expect(400);
    expect(sinLote.body.error).toMatch(/lote/i);
    await mover(t.agente, t.vaca.id, { estado: 'SECA' }).expect(400);
    const otro = await mover(t.agente, t.vaca.id, { loteId: a.id, numero: '9' }).expect(400);
    expect(otro.body.error).toBe('El dato «numero» no se puede editar');
    await mover(t.agente, t.vaca.id, { loteId: 123 }).expect(400);
    await mover(t.agente, t.vaca.id, [a.id]).expect(400);
    expect(await prisma.cambioAnimal.count()).toBe(0);
    // establecimientoId de otro tambo no cambia nada.
    await mover(t.agente, t.vaca.id, { loteId: a.id, establecimientoId: ID_INEXISTENTE }).expect(200);
    expect((await vacaDe(t.vaca.id)).loteId).toBe(a.id);
  });
});

describe('404 idéntico y aislamiento (RF-11, RF-18)', () => {
  it('lote ajeno, inexistente y mal formado dan el mismo 404', async () => {
    const t = await prepararVaca();
    const otro = await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test' });
    const ajeno = await crearLote(otro.tambo, 'De otro');
    const rs = [
      await mover(t.agente, t.vaca.id, { loteId: ajeno.id }),
      await mover(t.agente, t.vaca.id, { loteId: ID_INEXISTENTE }),
      await mover(t.agente, t.vaca.id, { loteId: 'no-es-un-uuid' }),
    ];
    for (const r of rs) expect(r.status).toBe(404);
    expect(new Set(rs.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect((await vacaDe(t.vaca.id)).loteId).toBeNull();
    expect(await prisma.cambioAnimal.count()).toBe(0);
  });

  it('animal ajeno, inexistente, mal formado y de baja dan el mismo 404; el ajeno no se toca', async () => {
    const t = await prepararVaca();
    const lote = await crearLote(t.tambo, 'Lote A');
    const otro = await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test' });
    const baja = await crearBajaDirecta(t.tambo, 'B1');
    const rs = [
      await mover(t.agente, otro.vaca.id, { loteId: lote.id }),
      await mover(t.agente, ID_INEXISTENTE, { loteId: lote.id }),
      await mover(t.agente, 'no-es-un-uuid', { loteId: lote.id }),
      await mover(t.agente, baja.id, { loteId: lote.id }),
    ];
    for (const r of rs) expect(r.status).toBe(404);
    expect(new Set(rs.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect((await vacaDe(otro.vaca.id)).loteId).toBeNull();
    expect(await prisma.cambioAnimal.count()).toBe(0);
  });

  it('el dueño de otro tambo tampoco puede mover un animal ajeno a su propio lote', async () => {
    const t = await prepararVaca();
    const otro = await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test' });
    const mio = await crearLote(t.tambo, 'Mío');
    await mover(otro.agente, otro.vaca.id, { loteId: mio.id }).expect(404); // lote ajeno
    await mover(t.agente, otro.vaca.id, { loteId: mio.id }).expect(404); // animal ajeno
  });
});

describe('orden de rechazos', () => {
  it('formato 400 antes que 404 de animal; 404 antes que "ya sin lote" 400', async () => {
    const t = await prepararVaca();
    await mover(t.agente, ID_INEXISTENTE, { estado: 'SECA' }).expect(400);
    await mover(t.agente, ID_INEXISTENTE, { loteId: null }).expect(404);
  });
});

describe('RF-12: el lote manual dura hasta el próximo evento', () => {
  it('un secado posterior toma el lote manual como lote previo y mueve al destino de "seca"', async () => {
    const t = await prepararVaca();
    const manual = await crearLote(t.tambo, 'Enfermería');
    const secas = await prisma.lote.findFirstOrThrow({ where: { establecimientoId: t.tambo, nombre: 'Secas' } });
    await mover(t.agente, t.vaca.id, { loteId: manual.id }).expect(200);
    expect((await vacaDe(t.vaca.id)).loteId).toBe(manual.id); // se respeta
    const secado = await t.agente.post(`/api/animales/${t.vaca.id}/secados`).send({ fecha: '2026-11-05' }).expect(201);
    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'SECA', loteId: secas.id });
    expect(await prisma.secado.findUniqueOrThrow({ where: { eventoId: secado.body.evento.id } })).toMatchObject({
      loteAnteriorId: manual.id,
      tuvoLoteAnterior: true,
    });
    expect(await verificarInvariantes({ estadoVaca: true })).toEqual([]);
  });
});

describe('RF-11: el lote desaparece entre la lectura y el guardado (cliente simulado)', () => {
  // Simula la parte de `tx` que usa la función: el bloqueo FOR SHARE del lote.
  const txSimulado = (lotesQueExisten: string[]) =>
    ({
      $queryRaw: async (_s: TemplateStringsArray, ...valores: unknown[]) =>
        lotesQueExisten.includes(String(valores[0])) ? [{ id: valores[0], nombre: 'X' }] : [],
    }) as never;

  it('lote que existe: devuelve su id y nombre', async () => {
    expect(await bloquearLoteDestino(txSimulado(['L1']), 'E1', 'L1')).toEqual({ id: 'L1', nombre: 'X' });
  });

  it('lote que ya no existe: 409 "El lote destino ya no existe, volvé a intentar"', async () => {
    await expect(bloquearLoteDestino(txSimulado([]), 'E1', 'L1')).rejects.toMatchObject({
      status: 409,
      message: 'El lote destino ya no existe, volvé a intentar',
    });
  });
});

describe('invariantes', () => {
  it('tras mover, ningún invariante se rompe', async () => {
    const t = await prepararVaca();
    const a = await crearLote(t.tambo, 'Lote A');
    await crearAnimalDirecto(t.tambo, '202');
    await mover(t.agente, t.vaca.id, { loteId: a.id }).expect(200);
    expect(await verificarInvariantes()).toEqual([]);
  });
});
