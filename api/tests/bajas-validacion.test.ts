import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { validarFechaBaja } from '../src/bajas/validacion.js';
import { crearBajaRegistradaDirecta, crearServicioDirecto, limpiarBase, prepararVaca } from './ayudas.js';

// Spec 006: validación de lo que se manda para dar de baja (RF-2, RF-3) y para revertir (RF-10).
// Todo rechazo es 400 con un mensaje en español y sin guardar nada.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z')); // hoy en Argentina = 11/11/2026
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const OK = { motivo: 'venta', fecha: '2026-11-10' };
const url = (id: string) => `/api/animales/${id}/baja`;

describe('validarFechaBaja (función pura)', () => {
  const ctx = { hoy: '2026-11-11', nacimiento: '2024-03-10', ultimoEvento: '2026-05-01' };
  it('acepta hoy, el día del último evento y una fecha intermedia', () => {
    expect(validarFechaBaja('2026-11-11', ctx)).toBeNull();
    expect(validarFechaBaja('2026-05-01', ctx)).toBeNull();
    expect(validarFechaBaja('2026-08-01', ctx)).toBeNull();
  });
  it('rechaza futura, 1999, anterior al nacimiento y anterior al último evento, con las fechas como dd/mm/aaaa', () => {
    expect(validarFechaBaja('2026-11-12', ctx)).toMatch(/futura/);
    expect(validarFechaBaja('1999-12-31', { ...ctx, nacimiento: null, ultimoEvento: null })).toMatch(/01\/01\/2000/);
    expect(validarFechaBaja('2024-03-09', ctx)).toMatch(/nacimiento.*10\/03\/2024/);
    expect(validarFechaBaja('2026-04-30', ctx)).toMatch(/último evento.*01\/05\/2026/);
  });
  it('sin nacimiento ni eventos solo mira hoy y el año 2000', () => {
    expect(validarFechaBaja('2000-01-01', { hoy: '2026-11-11', nacimiento: null, ultimoEvento: null })).toBeNull();
  });
});

describe('motivo (RF-2)', () => {
  it.each([
    ['ausente', undefined],
    ['"VENTA" en mayúsculas', 'VENTA'],
    ['con espacio adelante', ' venta'],
    ['vacío', ''],
    ['null', null],
    ['un número', 1],
    ['"parto anulado"', 'parto anulado'],
    ['"parto_anulado"', 'parto_anulado'],
    ['una lista', ['venta']],
  ])('%s: 400 y no guarda nada', async (_nombre, motivo) => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ ...OK, motivo }).expect(400);
    expect(res.body.error).toBeTruthy();
    expect(JSON.stringify(res.body.detalles)).toContain('"campo":"motivo"');
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('EN_ORDENE');
    expect(await prisma.evento.count()).toBe(0);
  });

  it.each(['venta', 'muerte'])('"%s" exacto: 201', async (motivo) => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ ...OK, motivo }).expect(201);
    expect(res.body.motivo).toBe(motivo);
  });
});

describe('fecha (RF-2)', () => {
  it.each([
    ['ausente', undefined],
    ['null', null],
    ['un número', 20261110],
    ['2026-02-30 (no existe)', '2026-02-30'],
    ['formato dd/mm/aaaa', '10/11/2026'],
    ['texto cualquiera', 'ayer'],
  ])('%s: 400', async (_nombre, fecha) => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ ...OK, fecha }).expect(400);
    expect(JSON.stringify(res.body.detalles)).toContain('"campo":"fecha"');
    expect(await prisma.evento.count()).toBe(0);
  });
});

describe('observaciones (RF-2)', () => {
  it('200 caracteres: 201 y se guardan; 201 caracteres: 400', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).send({ ...OK, observaciones: 'x'.repeat(201) }).expect(400);
    expect(await prisma.evento.count()).toBe(0);
    const res = await agente.post(url(vaca.id)).send({ ...OK, observaciones: 'x'.repeat(200) }).expect(201);
    expect(res.body.observaciones).toHaveLength(200);
  });

  it('se recortan los extremos; con 200 caracteres y espacios a los lados se acepta', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ ...OK, observaciones: `  ${'y'.repeat(200)}  ` }).expect(201);
    expect(res.body.observaciones).toBe('y'.repeat(200));
  });

  it.each([
    ['ausentes', undefined],
    ['null', null],
    ['vacías', ''],
    ['solo espacios', '   \t '],
  ])('%s: "sin observaciones" (null)', async (_nombre, observaciones) => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ ...OK, observaciones }).expect(201);
    expect(res.body.observaciones).toBeNull();
    const baja = await prisma.baja.findFirstOrThrow({ where: { animalId: vaca.id } });
    expect(baja.observaciones).toBeNull();
  });

  it.each([['un número', 5], ['un booleano', true], ['una lista', ['a']]])('%s: 400', async (_nombre, observaciones) => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ ...OK, observaciones }).expect(400);
    expect(JSON.stringify(res.body.detalles)).toContain('"campo":"observaciones"');
    expect(await prisma.evento.count()).toBe(0);
  });
});

describe('cuerpo', () => {
  it('sin cuerpo o con un cuerpo que no es un objeto: 400', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).expect(400);
    await agente.post(url(vaca.id)).send([]).expect(400);
  });

  it('un establecimientoId del cuerpo se ignora: la baja es del tambo de la sesión', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    await agente.post(url(vaca.id)).send({ ...OK, establecimientoId: crypto.randomUUID() }).expect(201);
    expect((await prisma.baja.findFirstOrThrow({ where: { animalId: vaca.id } })).establecimientoId).toBe(tambo);
  });

  it('el 400 del cuerpo va antes que el 404: animal inexistente o con id mal formado y cuerpo inválido da 400', async () => {
    const { agente } = await prepararVaca();
    await agente.post(url(crypto.randomUUID())).send({ fecha: OK.fecha }).expect(400);
    await agente.post(url('no-es-un-id')).send({ fecha: OK.fecha }).expect(400);
  });
});

describe('fechas límite (RF-3)', () => {
  it('hoy se acepta, mañana da 400 con el motivo', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-12' }).expect(400);
    expect(res.body.detalles[0].mensaje).toMatch(/futura/);
    expect(JSON.stringify(res.body.detalles)).toContain('"campo":"fecha"');
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-11' }).expect(201);
  });

  it('a las 22:00 de Argentina (ya es otro día en UTC) "hoy" sigue siendo el día argentino', async () => {
    fijarReloj(new Date('2026-11-12T01:00:00Z')); // 22:00 del 11/11 en Argentina
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-12' }).expect(400);
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-11' }).expect(201);
  });

  it('31/12/1999 da 400 y 01/01/2000 se acepta', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ ...OK, fecha: '1999-12-31' }).expect(400);
    expect(res.body.detalles[0].mensaje).toMatch(/01\/01\/2000/);
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2000-01-01' }).expect(201);
  });

  it('anterior al nacimiento: 400 con la fecha de nacimiento; el mismo día se acepta', async () => {
    const { agente, vaca } = await prepararVaca({ fechaNacimiento: '2025-06-15' });
    const res = await agente.post(url(vaca.id)).send({ ...OK, fecha: '2025-06-14' }).expect(400);
    expect(res.body.detalles[0].mensaje).toContain('15/06/2025');
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2025-06-15' }).expect(201);
  });

  it('anterior al último evento no anulado: 400 con su fecha; igual se acepta', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-09-01' });
    const res = await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-08-31' }).expect(400);
    expect(res.body.detalles[0].mensaje).toContain('01/09/2026');
    expect(await prisma.baja.count()).toBe(0);
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-09-01' }).expect(201);
  });

  it('un evento anulado no cuenta para la fecha mínima', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    await crearServicioDirecto({
      establecimientoId: tambo,
      animalId: vaca.id,
      registradoPorId: usuarioId,
      fecha: '2026-10-01',
      anulacion: { porId: usuarioId, motivo: 'error' },
    });
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-09-15' }).expect(201);
  });

  it('una baja anterior ya revertida no cuenta: la segunda baja se valida contra los demás eventos', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    await crearBajaRegistradaDirecta({
      establecimientoId: tambo,
      animalId: vaca.id,
      registradoPorId: usuarioId,
      fecha: '2026-11-05',
      anulacion: { porId: usuarioId, motivo: 'se cargó mal' },
    });
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-01' }).expect(201);
  });

  it('la fecha de una madre no se compara con la de nacimiento de sus crías', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    await prisma.animal.create({
      data: { establecimientoId: tambo, numero: 'C1', sexo: 'HEMBRA', estado: 'RECIEN_NACIDO', madreId: vaca.id, fechaNacimiento: new Date('2026-11-10T00:00:00Z') },
    });
    await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-09-01' }).expect(201);
  });
});

describe('motivoReversion (RF-10)', () => {
  async function conBaja() {
    const t = await prepararVaca();
    await t.agente.post(url(t.vaca.id)).send(OK).expect(201);
    return t;
  }
  const rev = (id: string) => `/api/animales/${id}/revertir-baja`;

  it.each([
    ['ausente', undefined],
    ['null', null],
    ['vacío', ''],
    ['solo espacios', '    '],
    ['un número', 7],
    ['201 caracteres', 'z'.repeat(201)],
  ])('%s: 400 y la baja sigue vigente', async (_nombre, motivoReversion) => {
    const { agente, vaca } = await conBaja();
    const res = await agente.post(rev(vaca.id)).send({ motivoReversion }).expect(400);
    expect(JSON.stringify(res.body.detalles)).toContain('"campo":"motivoReversion"');
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('BAJA');
    expect(await prisma.baja.count({ where: { vigente: true } })).toBe(1);
  });

  it('200 caracteres con espacios a los lados: 200 y se recorta', async () => {
    const { agente, vaca } = await conBaja();
    await agente.post(rev(vaca.id)).send({ motivoReversion: ` ${'m'.repeat(200)} ` }).expect(200);
    const ev = await prisma.evento.findFirstOrThrow({ where: { animalId: vaca.id, tipo: 'BAJA' } });
    expect(ev.motivoAnulacion).toBe('m'.repeat(200));
  });

  it('el campo "motivo" de la baja no vale como motivo de la reversión', async () => {
    const { agente, vaca } = await conBaja();
    await agente.post(rev(vaca.id)).send({ motivo: 'se cargó mal' }).expect(400);
  });
});
