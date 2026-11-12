import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { fijarTopes } from '../src/topes.js';
import { app, crearAnimalDirecto, crearBajaRegistradaDirecta, crearProduccionDirecta, crearUsuario, limpiarBase, prepararVaca } from './ayudas.js';

// Spec 008: GET /api/animales/:id/produccion y GET /api/bajas/:id/produccion
// (RF-7, RF-12 a RF-16, RF-26, RF-27, RF-30, RF-33). Reloj: 12:00 ART del 11/11/2026.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => {
  fijarReloj(null);
  fijarTopes(null);
});
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';
const url = (id: string) => `/api/animales/${id}/produccion`;
const urlBaja = (id: string) => `/api/bajas/${id}/produccion`;

type Base = Awaited<ReturnType<typeof prepararVaca>>;
// Atajo para sembrar registros de la vaca de la base.
const sembrar = (base: Base, datos: Omit<Parameters<typeof crearProduccionDirecta>[0], 'establecimientoId' | 'animalId' | 'registradoPorId'>) =>
  crearProduccionDirecta({ establecimientoId: base.tambo, animalId: base.vaca.id, registradoPorId: base.usuarioId, ...datos });

describe('lista de registros (RF-12, RF-14)', () => {
  it('vacía: sin registros, total 0, "—" y sin último registro', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.get(url(vaca.id)).expect(200);
    expect(res.body).toMatchObject({ registros: [], total: 0, truncado: false, promedio30Dias: null, ultimoRegistro: null });
  });

  it('del más reciente al más antiguo por fecha y turno: la tarde antes que la mañana', async () => {
    const base = await prepararVaca();
    await sembrar(base, { fecha: '2026-11-09', turno: 'TARDE', litros: 1 });
    await sembrar(base, { fecha: '2026-11-10', turno: 'MANANA', litros: 2 });
    await sembrar(base, { fecha: '2026-11-10', turno: 'TARDE', litros: 3 });
    await sembrar(base, { fecha: '2026-11-11', turno: 'MANANA', litros: 4 });
    await sembrar(base, { fecha: '2026-11-09', turno: 'MANANA', litros: 5 });
    const res = await base.agente.get(url(base.vaca.id)).expect(200);
    expect(res.body.registros.map((r: any) => [r.fecha, r.turno, r.litros])).toEqual([
      ['2026-11-11', 'manana', 4],
      ['2026-11-10', 'tarde', 3],
      ['2026-11-10', 'manana', 2],
      ['2026-11-09', 'tarde', 1],
      ['2026-11-09', 'manana', 5],
    ]);
    expect(res.body.total).toBe(5);
  });

  it('cada registro trae fecha, turno, litros, quién lo cargó y el lote; los anulados, quién, cuándo y motivo', async () => {
    const base = await prepararVaca();
    await sembrar(base, { fecha: '2026-11-10', turno: 'MANANA', litros: 12.5, loteId: crypto.randomUUID(), loteNombre: 'Lote A' });
    await sembrar(base, {
      fecha: '2026-11-10',
      turno: 'TARDE',
      litros: 25,
      anulacion: { porId: base.usuarioId, motivo: 'Error de tipeo', en: new Date('2026-11-10T20:00:00Z') },
    });
    const { registros } = (await base.agente.get(url(base.vaca.id)).expect(200)).body;
    const [anulado, vigente] = registros;
    expect(vigente).toMatchObject({ fecha: '2026-11-10', turno: 'manana', litros: 12.5, registradoPor: 'Dueño', loteNombre: 'Lote A', anulado: null });
    expect(anulado).toMatchObject({ litros: 25, anulado: { por: 'Dueño', motivo: 'Error de tipeo' } });
    expect(anulado.anulado.en).toBe('2026-11-10T20:00:00.000Z');
  });

  it('con más registros que el tope: los más recientes, el total y el aviso (tope de 200 inyectable)', async () => {
    const base = await prepararVaca();
    fijarTopes({ produccionFicha: 3 });
    for (let d = 1; d <= 5; d++) await sembrar(base, { fecha: `2026-11-0${d}`, litros: d });
    const res = await base.agente.get(url(base.vaca.id)).expect(200);
    expect(res.body).toMatchObject({ total: 5, mostrados: 3, truncado: true, tope: 3 });
    expect(res.body.registros.map((r: any) => r.fecha)).toEqual(['2026-11-05', '2026-11-04', '2026-11-03']);
  });

  it('el tope por defecto es 200', async () => {
    const { agente, vaca } = await prepararVaca();
    expect((await agente.get(url(vaca.id)).expect(200)).body.tope).toBe(200);
  });
});

describe('último registro (RF-7)', () => {
  it('el más reciente por fecha y turno entre los no anulados', async () => {
    const base = await prepararVaca();
    await sembrar(base, { fecha: '2026-11-10', turno: 'MANANA', litros: 1 });
    await sembrar(base, { fecha: '2026-11-10', turno: 'TARDE', litros: 2 });
    await sembrar(base, { fecha: '2026-11-11', turno: 'MANANA', litros: 3, anulacion: { porId: base.usuarioId, motivo: 'x' } });
    const res = await base.agente.get(url(base.vaca.id)).expect(200);
    expect(res.body.ultimoRegistro).toEqual({ fecha: '2026-11-10', turno: 'tarde', litros: 2 });
  });

  it('no depende del tope de la lista', async () => {
    const base = await prepararVaca();
    fijarTopes({ produccionFicha: 1 });
    await sembrar(base, { fecha: '2026-11-09', litros: 7 });
    await sembrar(base, { fecha: '2026-11-10', litros: 8, anulacion: { porId: base.usuarioId, motivo: 'x' } });
    const res = await base.agente.get(url(base.vaca.id)).expect(200);
    expect(res.body.registros).toHaveLength(1);
    expect(res.body.registros[0].anulado).not.toBeNull(); // la lista muestra el anulado
    expect(res.body.ultimoRegistro).toEqual({ fecha: '2026-11-09', turno: 'manana', litros: 7 });
  });
});

describe('promedio de los últimos 30 días (RF-13)', () => {
  it('suma los turnos del día (un vaca-día), cuenta la ventana de hoy y 29 días atrás y deja afuera los anulados', async () => {
    const base = await prepararVaca();
    // Ventana: 2026-10-13 a 2026-11-11.
    await sembrar(base, { fecha: '2026-10-12', litros: 90 }); // afuera
    await sembrar(base, { fecha: '2026-10-13', turno: 'MANANA', litros: 10 }); // adentro (borde)
    await sembrar(base, { fecha: '2026-10-13', turno: 'TARDE', litros: 6 }); // mismo día: un vaca-día de 16
    await sembrar(base, { fecha: '2026-11-11', litros: 8 }); // adentro (hoy)
    await sembrar(base, { fecha: '2026-11-05', litros: 50, anulacion: { porId: base.usuarioId, motivo: 'x' } }); // anulado
    const res = await base.agente.get(url(base.vaca.id)).expect(200);
    expect(res.body.promedio30Dias).toBe(12); // (16 + 8) / 2
  });

  it('redondea con un decimal exacto, medio punto hacia arriba', async () => {
    const base = await prepararVaca();
    await sembrar(base, { fecha: '2026-11-10', litros: 12.2 });
    await sembrar(base, { fecha: '2026-11-11', litros: 12.3 });
    expect((await base.agente.get(url(base.vaca.id)).expect(200)).body.promedio30Dias).toBe(12.3); // 12,25
  });

  it('el 0 es un valor: el promedio de un registro de 0 litros es 0 y no "—"', async () => {
    const base = await prepararVaca();
    await sembrar(base, { fecha: '2026-11-10', litros: 0 });
    expect((await base.agente.get(url(base.vaca.id)).expect(200)).body.promedio30Dias).toBe(0);
  });

  it('sin registros en la ventana (solo viejos o solo anulados): null', async () => {
    const base = await prepararVaca();
    await sembrar(base, { fecha: '2026-10-12', litros: 10 });
    await sembrar(base, { fecha: '2026-11-10', litros: 10, anulacion: { porId: base.usuarioId, motivo: 'x' } });
    expect((await base.agente.get(url(base.vaca.id)).expect(200)).body.promedio30Dias).toBeNull();
  });

  it('usa el hoy argentino: a las 22:00 ART (ya es el día siguiente en UTC) la ventana termina en el día de Argentina', async () => {
    fijarReloj(new Date('2026-11-12T01:00:00Z'));
    const base = await prepararVaca();
    await sembrar(base, { fecha: '2026-10-13', litros: 10 }); // hoy ART = 11/11: 13/10 es el borde y entra
    await sembrar(base, { fecha: '2026-10-12', litros: 90 }); // afuera
    expect((await base.agente.get(url(base.vaca.id)).expect(200)).body.promedio30Dias).toBe(10);
  });
});

describe('sugerencia de fecha y turno (RF-30)', () => {
  it.each([
    ['2026-11-11T16:59:00Z', '2026-11-11', 'manana'], // 13:59 ART
    ['2026-11-11T17:00:00Z', '2026-11-11', 'tarde'], // 14:00 ART
    ['2026-11-12T01:00:00Z', '2026-11-11', 'tarde'], // 22:00 ART, ya es 12 en UTC
  ])('a las %s sugiere %s y %s', async (instante, fecha, turno) => {
    fijarReloj(new Date(instante));
    const { agente, vaca } = await prepararVaca();
    expect((await agente.get(url(vaca.id)).expect(200)).body.sugerencia).toEqual({ fecha, turno });
  });
});

describe('vaca que no está en ordeñe y el historial (RF-15, RF-16)', () => {
  it('una vaca seca devuelve igual sus registros', async () => {
    const base = await prepararVaca({ estado: 'SECA' });
    await sembrar(base, { fecha: '2026-11-10', litros: 9 });
    const res = await base.agente.get(url(base.vaca.id)).expect(200);
    expect(res.body.total).toBe(1);
  });

  it('el historial único de la 007 no incluye la producción', async () => {
    const base = await prepararVaca();
    await sembrar(base, { fecha: '2026-11-10', litros: 33.3 });
    const res = await base.agente.get(`/api/animales/${base.vaca.id}/historial`).expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/litros|producci/i);
  });
});

describe('ficha de baja en solo lectura (RF-33)', () => {
  async function conBaja() {
    const base = await prepararVaca();
    const lote = await prisma.lote.create({ data: { establecimientoId: base.tambo, nombre: 'Lote A' } });
    await prisma.animal.update({ where: { id: base.vaca.id }, data: { loteId: lote.id } });
    await sembrar(base, { fecha: '2026-11-09', litros: 11, loteId: lote.id, loteNombre: 'Lote A' });
    await sembrar(base, { fecha: '2026-11-10', litros: 22, anulacion: { porId: base.usuarioId, motivo: 'Error' } });
    await base.agente.post(`/api/animales/${base.vaca.id}/baja`).send({ motivo: 'venta', fecha: '2026-11-10' }).expect(201);
    return base;
  }

  it('da lo mismo que la ficha activa, sin sugerencia', async () => {
    const base = await conBaja();
    const res = await base.agente.get(urlBaja(base.vaca.id)).expect(200);
    expect(res.body).toMatchObject({ total: 2, truncado: false, promedio30Dias: 11, ultimoRegistro: { fecha: '2026-11-09', litros: 11 } });
    expect(res.body.registros.map((r: any) => [r.fecha, r.litros, r.anulado ? 'anulado' : 'vigente'])).toEqual([
      ['2026-11-10', 22, 'anulado'],
      ['2026-11-09', 11, 'vigente'],
    ]);
    expect(res.body).not.toHaveProperty('sugerencia');
  });

  it('un animal activo da 404 en la ruta de bajas y uno de baja da 404 en la de activos', async () => {
    const base = await conBaja();
    const activa = await crearAnimalDirecto(base.tambo, '102');
    await base.agente.get(urlBaja(activa.id)).expect(404);
    await base.agente.get(url(base.vaca.id)).expect(404);
  });

  it('un animal de baja por "parto anulado" da 404 en las dos rutas', async () => {
    const { agente, tambo } = await prepararVaca();
    const cria = await crearAnimalDirecto(tambo, 'C1', { estado: 'BAJA', motivoBaja: 'PARTO_ANULADO' });
    await agente.get(urlBaja(cria.id)).expect(404);
    await agente.get(url(cria.id)).expect(404);
  });

  it('si se revierte la baja, la ficha activa vuelve a mostrar toda su producción con el lote original', async () => {
    const base = await conBaja();
    await base.agente.post(`/api/animales/${base.vaca.id}/revertir-baja`).send({ motivoReversion: 'Se cargó mal' }).expect(200);
    const res = await base.agente.get(url(base.vaca.id)).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.registros.find((r: any) => r.litros === 11).loteNombre).toBe('Lote A');
    await base.agente.get(urlBaja(base.vaca.id)).expect(404);
  });

  it('los registros de la baja se ven aunque la baja se haya hecho por muerte', async () => {
    const base = await prepararVaca();
    await sembrar(base, { fecha: '2026-11-09', litros: 4 });
    await crearBajaRegistradaDirecta({ establecimientoId: base.tambo, animalId: base.vaca.id, registradoPorId: base.usuarioId, fecha: '2026-11-10', motivo: 'MUERTE' });
    expect((await base.agente.get(urlBaja(base.vaca.id)).expect(200)).body.total).toBe(1);
  });
});

describe('permisos, aislamiento y 404 (RF-26, RF-27)', () => {
  it('los tres roles leen (200) y sin sesión da 401', async () => {
    const base = await prepararVaca();
    await sembrar(base, { fecha: '2026-11-10', litros: 9 });
    const encargado = await crearUsuario(base.agente, 'ENCARGADO', 'encargado@prueba.test');
    const vet = await crearUsuario(base.agente, 'VETERINARIO', 'vet@prueba.test');
    for (const agente of [base.agente, encargado, vet]) await agente.get(url(base.vaca.id)).expect(200);
    await request(app).get(url(base.vaca.id)).expect(401);
    await request(app).get(urlBaja(base.vaca.id)).expect(401);
  });

  it('el veterinario también lee la ficha de baja', async () => {
    const base = await prepararVaca();
    await crearBajaRegistradaDirecta({ establecimientoId: base.tambo, animalId: base.vaca.id, registradoPorId: base.usuarioId, fecha: '2026-11-10' });
    const vet = await crearUsuario(base.agente, 'VETERINARIO', 'vet@prueba.test');
    await vet.get(urlBaja(base.vaca.id)).expect(200);
  });

  it('inexistente, mal formado o de otro tambo: el mismo 404 (activos y bajas)', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    await sembrar(b, { fecha: '2026-11-10', litros: 9 });
    const bBaja = await crearAnimalDirecto(b.tambo, 'B2');
    await crearBajaRegistradaDirecta({ establecimientoId: b.tambo, animalId: bBaja.id, registradoPorId: b.usuarioId, fecha: '2026-11-10' });

    const mensajes = new Set<string>();
    for (const id of [ID_INEXISTENTE, 'no-es-uuid', b.vaca.id]) mensajes.add((await a.agente.get(url(id)).expect(404)).body.error);
    for (const id of [ID_INEXISTENTE, 'no-es-uuid', bBaja.id]) mensajes.add((await a.agente.get(urlBaja(id)).expect(404)).body.error);
    expect(mensajes.size).toBe(1);
  });

  it('no mezcla registros de otro tambo y un establecimientoId en la query se ignora', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    await sembrar(a, { fecha: '2026-11-10', litros: 9 });
    await sembrar(b, { fecha: '2026-11-10', litros: 70 });
    const res = await a.agente.get(`${url(a.vaca.id)}?establecimientoId=${b.tambo}`).expect(200);
    expect(res.body.registros.map((r: any) => r.litros)).toEqual([9]);
    await a.agente.get(`${url(b.vaca.id)}?establecimientoId=${a.tambo}`).expect(404);
  });

  it('no incluye hashes ni el id ni el email de ningún usuario', async () => {
    const base = await prepararVaca();
    await sembrar(base, { fecha: '2026-11-10', litros: 9, anulacion: { porId: base.usuarioId, motivo: 'x' } });
    const texto = JSON.stringify((await base.agente.get(url(base.vaca.id)).expect(200)).body);
    expect(texto).not.toMatch(/passwordHash|tokenHash|dueno@prueba\.test/);
    expect(texto).not.toContain(base.usuarioId);
  });
});
