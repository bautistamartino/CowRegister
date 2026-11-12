import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { fijarTopes } from '../src/topes.js';
import {
  app,
  crearAnimalDirecto,
  crearBajaRegistradaDirecta,
  crearPartoDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
} from './ayudas.js';

// Spec 007: GET /api/informes/natalidad (RF-11 a RF-13, RF-15 a RF-19).

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z')); // hoy argentino: 2026-11-11
  return limpiarBase();
});
afterEach(() => {
  fijarReloj(null);
  fijarTopes(null);
});
afterAll(() => prisma.$disconnect());

const URL = '/api/informes/natalidad';
const ANIO = '?desde=2026-01-01&hasta=2026-11-11';

type Cria = { orden: number; sexo: string; nacidaMuerta: boolean; animal: { id: string; numero: string; activo: boolean; motivoBaja: string | null } | null };
type Parto = { partoId: string; fecha: string; vaca: { id: string; numero: string; activo: boolean; motivoBaja: string | null }; crias: Cria[] };

async function tambo(cantidad = 1, sufijo = 'a') {
  const t = await prepararVaca({ nombreTambo: `Tambo ${sufijo}`, email: `${sufijo}@prueba.test`, numero: '101' });
  const vacas = [t.vaca];
  for (let i = 2; i <= cantidad; i++) vacas.push(await crearAnimalDirecto(t.tambo, `${100 + i}`));
  const base = (vaca: { id: string }) => ({ establecimientoId: t.tambo, animalId: vaca.id, registradoPorId: t.usuarioId });
  return { ...t, vacas, base };
}

describe('resumen de natalidad (RF-11)', () => {
  it('cuenta partos, crías vivas y muertas por sexo, mellizos y el porcentaje de nacidas muertas', async () => {
    const t = await tambo(5);
    const [v1, v2, v3, v4, v5] = t.vacas as [typeof t.vaca, typeof t.vaca, typeof t.vaca, typeof t.vaca, typeof t.vaca];
    // Una cría viva hembra.
    await crearPartoDirecto({ ...t.base(v1), fecha: '2026-03-01', crias: [{ sexo: 'HEMBRA' }] });
    // Una cría muerta macho.
    await crearPartoDirecto({ ...t.base(v2), fecha: '2026-03-02', crias: [{ sexo: 'MACHO', nacidaMuerta: true }] });
    // Mellizos: dos vivas de distinto sexo.
    await crearPartoDirecto({ ...t.base(v3), fecha: '2026-03-03', crias: [{ sexo: 'HEMBRA' }, { sexo: 'MACHO' }] });
    // Mellizos: una viva y una muerta.
    await crearPartoDirecto({ ...t.base(v4), fecha: '2026-03-04', crias: [{ sexo: 'MACHO' }, { sexo: 'HEMBRA', nacidaMuerta: true }] });
    // Mellizos: dos muertas.
    await crearPartoDirecto({ ...t.base(v5), fecha: '2026-03-05', crias: [{ sexo: 'HEMBRA', nacidaMuerta: true }, { sexo: 'HEMBRA', nacidaMuerta: true }] });

    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.periodo).toEqual({ desde: '2026-01-01', hasta: '2026-11-11' });
    expect(res.body.resumen).toEqual({
      partos: 5,
      criasVivas: { total: 4, hembras: 2, machos: 2 },
      criasMuertas: { total: 4, hembras: 3, machos: 1 },
      mellizos: 3,
      porcentajeNacidasMuertas: 50, // 4 de 8
    });
  });

  it('redondea el medio punto hacia arriba (1 muerta de 8 crías = 13 %)', async () => {
    const t = await tambo(4);
    for (const [i, v] of t.vacas.entries()) {
      await crearPartoDirecto({
        ...t.base(v),
        fecha: `2026-03-0${i + 1}`,
        crias: i === 0 ? [{ sexo: 'MACHO', nacidaMuerta: true }, { sexo: 'MACHO' }] : [{ sexo: 'HEMBRA' }, { sexo: 'HEMBRA' }],
      });
    }
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen).toMatchObject({ partos: 4, mellizos: 4, porcentajeNacidasMuertas: 13 });
  });

  it('un parto anulado no cuenta; una cría vendida o muerta cuenta como viva', async () => {
    const t = await tambo(2);
    const [v1, v2] = t.vacas as [typeof t.vaca, typeof t.vaca];
    await crearPartoDirecto({ ...t.base(v1), fecha: '2026-03-01', anulacion: { porId: t.usuarioId, motivo: 'Error' }, crias: [{ sexo: 'HEMBRA' }] });
    await crearPartoDirecto({ ...t.base(v2), fecha: '2026-03-02', crias: [{ sexo: 'MACHO', numero: 'C-VENDIDA' }] });
    const cria = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: t.tambo, numero: 'C-VENDIDA' } });
    await crearBajaRegistradaDirecta({ ...t.base(cria), fecha: '2026-06-01', motivo: 'VENTA', estadoAnterior: 'RECIEN_NACIDO' });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen).toMatchObject({ partos: 1, criasVivas: { total: 1, machos: 1 }, criasMuertas: { total: 0 }, mellizos: 0 });
    expect(res.body.detalle).toHaveLength(1);
  });

  it('solo entran los partos del período (extremos incluidos)', async () => {
    const t = await tambo(4);
    const fechas = ['2026-02-28', '2026-03-01', '2026-03-31', '2026-04-01'];
    for (const [i, v] of t.vacas.entries()) await crearPartoDirecto({ ...t.base(v), fecha: fechas[i]! });
    const res = await t.agente.get(`${URL}?desde=2026-03-01&hasta=2026-03-31`).expect(200);
    expect((res.body.detalle as Parto[]).map((p) => p.fecha)).toEqual(['2026-03-31', '2026-03-01']);
    expect(res.body.resumen.partos).toBe(2);
  });

  it('período sin partos: totales en cero y porcentaje null (RF-13)', async () => {
    const t = await tambo();
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen).toEqual({
      partos: 0,
      criasVivas: { total: 0, hembras: 0, machos: 0 },
      criasMuertas: { total: 0, hembras: 0, machos: 0 },
      mellizos: 0,
      porcentajeNacidasMuertas: null,
    });
    expect(res.body.detalle).toEqual([]);
    expect(res.body.totalDetalle).toBe(0);
    expect(res.body.truncado).toBe(false);
  });
});

describe('detalle de partos (RF-12)', () => {
  it('da vaca y crías con datos de enlace (activa, de baja por venta y nacida muerta), del más reciente al más antiguo', async () => {
    const t = await tambo(2);
    const [v1, v2] = t.vacas as [typeof t.vaca, typeof t.vaca];
    await crearPartoDirecto({ ...t.base(v1), fecha: '2026-03-01', crias: [{ sexo: 'HEMBRA', numero: 'C-ACTIVA' }, { sexo: 'MACHO', numero: 'C-VENTA' }] });
    await crearPartoDirecto({ ...t.base(v2), fecha: '2026-05-01', crias: [{ sexo: 'MACHO', nacidaMuerta: true }] });
    const venta = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: t.tambo, numero: 'C-VENTA' } });
    const activa = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: t.tambo, numero: 'C-ACTIVA' } });
    await crearBajaRegistradaDirecta({ ...t.base(venta), fecha: '2026-06-01', motivo: 'VENTA', estadoAnterior: 'RECIEN_NACIDO' });
    // La vaca 101 también se vende: el informe la sigue contando y la marca de baja.
    await crearBajaRegistradaDirecta({ ...t.base(v1), fecha: '2026-07-01', motivo: 'MUERTE' });

    const res = await t.agente.get(URL + ANIO).expect(200);
    const detalle = res.body.detalle as Parto[];
    expect(detalle.map((p) => p.fecha)).toEqual(['2026-05-01', '2026-03-01']);
    expect(detalle[0]!.vaca).toEqual({ id: v2.id, numero: '102', activo: true, motivoBaja: null });
    expect(detalle[0]!.crias).toEqual([{ orden: 1, sexo: 'MACHO', nacidaMuerta: true, animal: null }]);
    expect(detalle[1]!.vaca).toEqual({ id: v1.id, numero: '101', activo: false, motivoBaja: 'muerte' });
    expect(detalle[1]!.crias).toEqual([
      { orden: 1, sexo: 'HEMBRA', nacidaMuerta: false, animal: { id: activa.id, numero: 'C-ACTIVA', activo: true, motivoBaja: null } },
      { orden: 2, sexo: 'MACHO', nacidaMuerta: false, animal: { id: venta.id, numero: 'C-VENTA', activo: false, motivoBaja: 'venta' } },
    ]);
    expect(detalle[1]!.partoId).toEqual(expect.any(String));
  });

  it('a igual fecha manda el registro más reciente primero', async () => {
    const t = await tambo(2);
    const x = await crearPartoDirecto({ ...t.base(t.vacas[0]!), fecha: '2026-03-01' });
    const y = await crearPartoDirecto({ ...t.base(t.vacas[1]!), fecha: '2026-03-01' });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect((res.body.detalle as Parto[]).map((p) => p.partoId)).toEqual([y.id, x.id]);
  });
});

describe('tope del detalle (RF-16)', () => {
  it('con tope 2 el detalle trae los 2 más recientes, avisa y el resumen cuenta todo', async () => {
    const t = await tambo(3);
    const fechas = ['2026-03-01', '2026-04-01', '2026-05-01'];
    for (const [i, v] of t.vacas.entries()) await crearPartoDirecto({ ...t.base(v), fecha: fechas[i]!, crias: [{ sexo: 'MACHO' }] });
    fijarTopes({ informe: 2 });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect((res.body.detalle as Parto[]).map((p) => p.fecha)).toEqual(['2026-05-01', '2026-04-01']);
    expect(res.body.totalDetalle).toBe(3);
    expect(res.body.truncado).toBe(true);
    expect(res.body.tope).toBe(2);
    expect(res.body.resumen).toMatchObject({ partos: 3, criasVivas: { total: 3 } });
  });
});

describe('anular un parto se refleja en el siguiente cálculo (RF-17)', () => {
  it('anular un parto por la API lo saca del informe', async () => {
    const t = await tambo();
    const parto = await crearPartoDirecto({ ...t.base(t.vaca), fecha: '2026-03-01', crias: [{ sexo: 'HEMBRA' }] });
    let res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen.partos).toBe(1);
    await t.agente.post(`/api/partos/${parto.id}/anular`).send({ motivo: 'Lo cargué mal' }).expect(200);
    res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen.partos).toBe(0);
    expect(res.body.detalle).toEqual([]);
  });
});

describe('validación del período (RF-15)', () => {
  it('400 con mensaje en español si falta alguno, está repetido o es inválido', async () => {
    const t = await tambo();
    const casos: Array<[string, RegExp]> = [
      ['', /Indicá "Desde" y "Hasta"/],
      ['?desde=2026-01-01', /Indicá "Desde" y "Hasta"/],
      ['?desde=2026-01-01&hasta=2026-02-01&hasta=2026-03-01', /Indicá "Desde" y "Hasta"/],
      ['?desde=2026-02-30&hasta=2026-03-01', /no es válida/],
      ['?desde=2026-03-02&hasta=2026-03-01', /posterior/],
      ['?desde=2026-01-01&hasta=2026-11-12', /futura/],
      ['?desde=1999-12-31&hasta=2000-01-05', /anterior al 01\/01\/2000/],
      ['?desde=2021-01-01&hasta=2026-01-01', /más de 5 años/],
    ];
    for (const [query, mensaje] of casos) {
      const res = await t.agente.get(URL + query).expect(400);
      expect(res.body.error, query).toMatch(mensaje);
    }
  });
});

describe('aislamiento, permisos y datos sensibles (RF-18, RF-19)', () => {
  it('el otro tambo no ve datos ajenos ni cambian los suyos; un establecimientoId enviado se ignora', async () => {
    const a = await tambo(1, 'a');
    const b = await tambo(2, 'b');
    await crearPartoDirecto({ ...a.base(a.vaca), fecha: '2026-03-01', crias: [{ sexo: 'HEMBRA', numero: 'CRIA-A' }] });
    for (const v of b.vacas) await crearPartoDirecto({ ...b.base(v), fecha: '2026-03-01', crias: [{ sexo: 'MACHO', numero: `CRIA-B-${v.numero}` }] });

    const antes = await b.agente.get(URL + ANIO).expect(200);
    const resA = await a.agente.get(`${URL}${ANIO}&establecimientoId=${b.tambo}`).expect(200);
    expect(resA.body.resumen).toMatchObject({ partos: 1, criasVivas: { total: 1, hembras: 1, machos: 0 } });
    expect(JSON.stringify(resA.body)).not.toContain('CRIA-B');
    expect(JSON.stringify(resA.body)).not.toContain(b.tambo);
    const despues = await b.agente.get(URL + ANIO).expect(200);
    expect(despues.body).toEqual(antes.body);
    expect(antes.body.resumen.partos).toBe(2);
  });

  it('los tres roles reciben 200', async () => {
    const t = await tambo();
    const encargado = await crearUsuario(t.agente, 'ENCARGADO', 'enc@prueba.test');
    const vet = await crearUsuario(t.agente, 'VETERINARIO', 'vet@prueba.test');
    for (const agente of [t.agente, encargado, vet]) await agente.get(URL + ANIO).expect(200);
  });

  it('sin sesión 401, también con un período inválido (401 antes que 400)', async () => {
    await request(app).get(URL + ANIO).expect(401);
    await request(app).get(URL).expect(401);
    await request(app).get(`${URL}?desde=basura&hasta=basura`).expect(401);
  });

  it('la respuesta no lleva hashes, tokens ni emails', async () => {
    const t = await tambo();
    await crearPartoDirecto({ ...t.base(t.vaca), fecha: '2026-03-01' });
    const texto = JSON.stringify((await t.agente.get(URL + ANIO).expect(200)).body);
    expect(texto).not.toMatch(/passwordHash|tokenHash|@prueba\.test/);
    expect(texto).not.toContain(t.usuarioId);
  });
});
