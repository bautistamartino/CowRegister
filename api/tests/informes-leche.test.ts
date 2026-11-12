import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { fijarTopes } from '../src/topes.js';
import {
  app,
  crearAnimalDirecto,
  crearBajaRegistradaDirecta,
  crearProduccionDirecta,
  crearUsuario,
  limpiarBase,
  prepararVaca,
} from './ayudas.js';

// Spec 008: GET /api/informes/leche (RF-17 a RF-21, RF-23 a RF-27, RF-37).

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z')); // hoy argentino: 2026-11-11
  return limpiarBase();
});
afterEach(() => {
  fijarReloj(null);
  fijarTopes(null);
});
afterAll(() => prisma.$disconnect());

const URL = '/api/informes/leche';
const ANIO = '?desde=2026-01-01&hasta=2026-11-11';

type Datos = Parameters<typeof crearProduccionDirecta>[0];

async function tambo(cantidad = 1, sufijo = 'a') {
  const t = await prepararVaca({ nombreTambo: `Tambo ${sufijo}`, email: `${sufijo}@prueba.test`, numero: '101' });
  const vacas = [t.vaca];
  for (let i = 2; i <= cantidad; i++) vacas.push(await crearAnimalDirecto(t.tambo, `${100 + i}`));
  // Carga un registro de una vaca del tambo.
  const cargar = (vaca: { id: string }, resto: Pick<Datos, 'fecha'> & Partial<Datos>) =>
    crearProduccionDirecta({ establecimientoId: t.tambo, animalId: vaca.id, registradoPorId: t.usuarioId, ...resto });
  return { ...t, vacas, cargar };
}

describe('resumen (RF-17, RF-37)', () => {
  it('da total, ordeños, vacas distintas, vaca-días y promedios; la suma de 0,1 y 0,2 es 0,3', async () => {
    const t = await tambo(2);
    const [v1, v2] = t.vacas as [typeof t.vaca, typeof t.vaca];
    await t.cargar(v1, { fecha: '2026-03-01', turno: 'MANANA', litros: 0.1 });
    await t.cargar(v1, { fecha: '2026-03-01', turno: 'TARDE', litros: 0.2 });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.periodo).toEqual({ desde: '2026-01-01', hasta: '2026-11-11' });
    expect(res.body.resumen).toEqual({
      totalLitros: 0.3,
      ordenos: 2,
      vacas: 1,
      vacaDias: 1,
      promedioPorVacaDia: 0.3,
      promedioPorOrdeno: 0.2, // 0,15 -> medio punto hacia arriba
    });
    await t.cargar(v2, { fecha: '2026-03-02', litros: 24.5 });
    const res2 = await t.agente.get(URL + ANIO).expect(200);
    expect(res2.body.resumen).toMatchObject({ totalLitros: 24.8, ordenos: 3, vacas: 2, vacaDias: 2, promedioPorVacaDia: 12.4 });
  });

  it('un promedio de 12,25 se muestra 12,3 (redondeo sobre el valor exacto)', async () => {
    const t = await tambo(2);
    await t.cargar(t.vacas[0]!, { fecha: '2026-03-01', litros: 12.5 });
    await t.cargar(t.vacas[1]!, { fecha: '2026-03-01', litros: 12 });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen.promedioPorVacaDia).toBe(12.3);
  });

  it('los registros anulados no cuentan; las bajas sí; solo entra el período (extremos incluidos)', async () => {
    const t = await tambo(3);
    const [v1, v2, v3] = t.vacas as [typeof t.vaca, typeof t.vaca, typeof t.vaca];
    await t.cargar(v1, { fecha: '2026-03-01', litros: 10, anulacion: { porId: t.usuarioId, motivo: 'Error' } });
    await t.cargar(v2, { fecha: '2026-03-01', litros: 20 });
    await t.cargar(v3, { fecha: '2026-02-28', litros: 5 }); // antes del período
    await t.cargar(v3, { fecha: '2026-03-31', litros: 7 }); // último día
    await t.cargar(v3, { fecha: '2026-04-01', litros: 9 }); // después
    await crearBajaRegistradaDirecta({ establecimientoId: t.tambo, animalId: v2.id, registradoPorId: t.usuarioId, fecha: '2026-06-01', motivo: 'VENTA' });
    const res = await t.agente.get(`${URL}?desde=2026-03-01&hasta=2026-03-31`).expect(200);
    expect(res.body.resumen).toMatchObject({ totalLitros: 27, ordenos: 2, vacas: 2, vacaDias: 2 });
  });

  it('período sin registros: ceros y promedios null, sin dividir por cero (RF-21)', async () => {
    const t = await tambo();
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen).toEqual({ totalLitros: 0, ordenos: 0, vacas: 0, vacaDias: 0, promedioPorVacaDia: null, promedioPorOrdeno: null });
    expect(res.body.porLote).toEqual([]);
    expect(res.body.porVaca).toEqual([]);
    expect(res.body.porDia).toEqual([]);
    expect(res.body.totalVacas).toBe(0);
    expect(res.body.truncado).toBe(false);
  });

  it('anular un registro cambia el siguiente cálculo (RF-25)', async () => {
    const t = await tambo();
    const r = await t.cargar(t.vaca, { fecha: '2026-03-01', litros: 10 });
    await t.cargar(t.vaca, { fecha: '2026-03-02', litros: 6 });
    expect((await t.agente.get(URL + ANIO).expect(200)).body.resumen.totalLitros).toBe(16);
    await t.agente.post(`/api/animales/${t.vaca.id}/produccion/${r.id}/anular`).send({ motivo: 'Error de tipeo' }).expect(200);
    expect((await t.agente.get(URL + ANIO).expect(200)).body.resumen.totalLitros).toBe(6);
  });
});

describe('desglose por lote (RF-18)', () => {
  it('usa el lote del registro, "Sin lote" con nombre null, ordena por litros y luego por nombre', async () => {
    const t = await tambo(3);
    const [v1, v2, v3] = t.vacas as [typeof t.vaca, typeof t.vaca, typeof t.vaca];
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await t.cargar(v1, { fecha: '2026-03-01', litros: 10, loteId: a, loteNombre: 'Lote A' });
    await t.cargar(v2, { fecha: '2026-03-01', litros: 10, loteId: b, loteNombre: 'Lote B' });
    await t.cargar(v3, { fecha: '2026-03-01', litros: 30 }); // Sin lote
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.porLote).toEqual([
      { loteId: null, nombre: null, litros: 30, vacas: 1, vacaDias: 1, promedioPorVacaDia: 30 },
      { loteId: a, nombre: 'Lote A', litros: 10, vacas: 1, vacaDias: 1, promedioPorVacaDia: 10 },
      { loteId: b, nombre: 'Lote B', litros: 10, vacas: 1, vacaDias: 1, promedioPorVacaDia: 10 },
    ]);
  });

  it('una vaca con dos lotes el mismo día cuenta un vaca-día en cada uno (los lotes suman más que el total)', async () => {
    const t = await tambo();
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await t.cargar(t.vaca, { fecha: '2026-03-01', turno: 'MANANA', litros: 10, loteId: a, loteNombre: 'Lote A' });
    await t.cargar(t.vaca, { fecha: '2026-03-01', turno: 'TARDE', litros: 8, loteId: b, loteNombre: 'Lote B' });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen).toMatchObject({ vacas: 1, vacaDias: 1, totalLitros: 18 });
    const porLote = res.body.porLote as { vacas: number; vacaDias: number }[];
    expect(porLote.reduce((n, l) => n + l.vacas, 0)).toBe(2);
    expect(porLote.reduce((n, l) => n + l.vacaDias, 0)).toBe(2);
  });

  it('un lote renombrado no se parte en dos filas: se muestra el nombre del registro más reciente', async () => {
    const t = await tambo();
    const a = crypto.randomUUID();
    await t.cargar(t.vaca, { fecha: '2026-03-01', litros: 10, loteId: a, loteNombre: 'Nombre viejo' });
    await t.cargar(t.vaca, { fecha: '2026-03-02', litros: 10, loteId: a, loteNombre: 'Nombre nuevo' });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.porLote).toEqual([{ loteId: a, nombre: 'Nombre nuevo', litros: 20, vacas: 1, vacaDias: 2, promedioPorVacaDia: 10 }]);
  });
});

describe('desglose por vaca (RF-19, RF-24)', () => {
  it('da litros, días con registro y promedio, con el enlace a ficha activa o de baja', async () => {
    const t = await tambo(2);
    const [v1, v2] = t.vacas as [typeof t.vaca, typeof t.vaca];
    await t.cargar(v1, { fecha: '2026-03-01', turno: 'MANANA', litros: 10 });
    await t.cargar(v1, { fecha: '2026-03-01', turno: 'TARDE', litros: 5 });
    await t.cargar(v1, { fecha: '2026-03-02', litros: 6 });
    await t.cargar(v2, { fecha: '2026-03-01', litros: 4 });
    await crearBajaRegistradaDirecta({ establecimientoId: t.tambo, animalId: v2.id, registradoPorId: t.usuarioId, fecha: '2026-06-01', motivo: 'MUERTE' });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.porVaca).toEqual([
      { animal: { id: v1.id, numero: '101', activo: true, motivoBaja: null }, litros: 21, dias: 2, promedioPorVacaDia: 10.5 },
      { animal: { id: v2.id, numero: '102', activo: false, motivoBaja: 'muerte' }, litros: 4, dias: 1, promedioPorVacaDia: 4 },
    ]);
    expect(res.body.totalVacas).toBe(2);
    expect(res.body.truncado).toBe(false);
  });

  it('ordena por promedio EXACTO, no por el redondeado, aunque el número sea mayor', async () => {
    const t = await tambo(2);
    const [v1, v2] = t.vacas as [typeof t.vaca, typeof t.vaca];
    // 101: 20,1 en 2 días = 10,05 (se muestra 10,1). 102: 10,1 en 1 día = 10,1. Gana 102.
    await t.cargar(v1, { fecha: '2026-03-01', litros: 10 });
    await t.cargar(v1, { fecha: '2026-03-02', litros: 10.1 });
    await t.cargar(v2, { fecha: '2026-03-01', litros: 10.1 });
    const res = await t.agente.get(URL + ANIO).expect(200);
    const filas = res.body.porVaca as { animal: { numero: string }; promedioPorVacaDia: number }[];
    expect(filas.map((f) => f.animal.numero)).toEqual(['102', '101']);
    expect(filas.map((f) => f.promedioPorVacaDia)).toEqual([10.1, 10.1]);
  });

  it('con promedio exacto igual, desempata por número en orden natural (A2 antes que A10)', async () => {
    const { agente, tambo: id, usuarioId } = await prepararVaca({ numero: 'A10' });
    const a10 = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: id, numero: 'A10' } });
    const a2 = await crearAnimalDirecto(id, 'A2');
    const a1 = await crearAnimalDirecto(id, 'A1');
    for (const v of [a10, a2, a1]) {
      await crearProduccionDirecta({ establecimientoId: id, animalId: v.id, registradoPorId: usuarioId, fecha: '2026-03-01', litros: 8 });
    }
    const res = await agente.get(URL + ANIO).expect(200);
    expect((res.body.porVaca as { animal: { numero: string } }[]).map((f) => f.animal.numero)).toEqual(['A1', 'A2', 'A10']);
  });

  it('con más vacas que el tope devuelve las primeras del orden, el aviso y los totales completos', async () => {
    fijarTopes({ informe: 2 });
    const t = await tambo(4);
    for (const [i, v] of t.vacas.entries()) await t.cargar(v, { fecha: '2026-03-01', litros: 10 + i });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect((res.body.porVaca as { animal: { numero: string } }[]).map((f) => f.animal.numero)).toEqual(['104', '103']);
    expect(res.body).toMatchObject({ totalVacas: 4, truncado: true, tope: 2 });
    expect(res.body.resumen).toMatchObject({ vacas: 4, totalLitros: 46 });
  });
});

describe('desglose por día (RF-20)', () => {
  it('da litros, vacas ordeñadas y cada turno, del día más reciente al más antiguo, sin tope', async () => {
    fijarTopes({ informe: 1 }); // el tope no corta el desglose por día
    const t = await tambo(2);
    const [v1, v2] = t.vacas as [typeof t.vaca, typeof t.vaca];
    await t.cargar(v1, { fecha: '2026-03-01', turno: 'MANANA', litros: 10 });
    await t.cargar(v1, { fecha: '2026-03-01', turno: 'TARDE', litros: 4.5 });
    await t.cargar(v2, { fecha: '2026-03-01', turno: 'MANANA', litros: 3 });
    await t.cargar(v2, { fecha: '2026-03-02', turno: 'TARDE', litros: 7 });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.porDia).toEqual([
      { fecha: '2026-03-02', litros: 7, vacas: 1, litrosManana: 0, litrosTarde: 7 },
      { fecha: '2026-03-01', litros: 17.5, vacas: 2, litrosManana: 13, litrosTarde: 4.5 },
    ]);
  });
});

describe('período, permisos y aislamiento (RF-23, RF-26, RF-27)', () => {
  it('400 con mensaje en español si falta alguno, está repetido o es inválido, sin calcular', async () => {
    const t = await tambo();
    const consultas = [
      '',
      '?desde=2026-01-01',
      '?hasta=2026-11-11',
      '?desde=2026-01-01&desde=2026-02-01&hasta=2026-11-11',
      '?desde=2026-02-30&hasta=2026-11-11',
      '?desde=2026-05-01&hasta=2026-04-01',
      '?desde=2026-01-01&hasta=2026-11-12', // futura
      '?desde=1999-12-31&hasta=2026-11-11',
      '?desde=2021-01-01&hasta=2026-01-01', // más de 5 años
    ];
    for (const q of consultas) {
      const res = await t.agente.get(URL + q).expect(400);
      expect(typeof res.body.error).toBe('string');
    }
    // 5 años exactos y un solo día: se aceptan.
    await t.agente.get(`${URL}?desde=2021-11-12&hasta=2026-11-11`).expect(200);
    await t.agente.get(`${URL}?desde=2026-11-11&hasta=2026-11-11`).expect(200);
  });

  it('sin sesión 401, también con un período inválido (401 antes que 400)', async () => {
    await request(app).get(URL + ANIO).expect(401);
    await request(app).get(URL).expect(401);
  });

  it('los tres roles lo ven', async () => {
    const t = await tambo();
    await t.cargar(t.vaca, { fecha: '2026-03-01', litros: 10 });
    const enc = await crearUsuario(t.agente, 'ENCARGADO', 'enc@prueba.test');
    const vet = await crearUsuario(t.agente, 'VETERINARIO', 'vet@prueba.test');
    for (const agente of [t.agente, enc, vet]) {
      const res = await agente.get(URL + ANIO).expect(200);
      expect(res.body.resumen.totalLitros).toBe(10);
    }
  });

  it('aislamiento: cada tambo ve solo lo suyo y un establecimientoId en la query se ignora', async () => {
    const a = await tambo(1, 'a');
    const b = await tambo(1, 'b');
    await a.cargar(a.vaca, { fecha: '2026-03-01', litros: 10 });
    await b.cargar(b.vaca, { fecha: '2026-03-01', litros: 99 });
    const ra = await a.agente.get(`${URL}${ANIO}&establecimientoId=${b.tambo}`).expect(200);
    expect(ra.body.resumen.totalLitros).toBe(10);
    expect(ra.body.porVaca).toHaveLength(1);
    expect(ra.body.porVaca[0].animal.id).toBe(a.vaca.id);
    const rb = await b.agente.get(URL + ANIO).expect(200);
    expect(rb.body.resumen.totalLitros).toBe(99);
  });

  it('la respuesta no incluye hashes ni datos de usuarios', async () => {
    const t = await tambo();
    await t.cargar(t.vaca, { fecha: '2026-03-01', litros: 10 });
    const res = await t.agente.get(URL + ANIO).expect(200);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toMatch(/passwordHash|argon2|prueba\.test|registradoPor/);
  });
});

describe('volumen razonable', () => {
  it('responde bien con miles de registros y devuelve totales correctos', async () => {
    const t = await tambo(50);
    // 50 vacas x 100 días x 2 turnos = 10.000 registros, insertados en bloque con SQL.
    await prisma.$executeRaw`
      INSERT INTO producciones (id, "establecimientoId", "animalId", fecha, turno, "litrosDecimas", "registradoPorId", "actualizadoEn")
      SELECT gen_random_uuid(), ${t.tambo}::uuid, a.id, d::date, tn::"TurnoOrdeno", 100, ${t.usuarioId}::uuid, now()
      FROM animales a, generate_series('2026-01-01'::date, '2026-04-10'::date, '1 day') d, unnest(ARRAY['MANANA','TARDE']) tn
      WHERE a."establecimientoId" = ${t.tambo}::uuid`;
    await prisma.$executeRawUnsafe('ANALYZE producciones');
    const inicio = Date.now();
    const res = await t.agente.get(URL + ANIO).expect(200);
    const ms = Date.now() - inicio;
    expect(res.body.resumen).toMatchObject({ ordenos: 10000, vacas: 50, vacaDias: 5000, totalLitros: 100000, promedioPorVacaDia: 20 });
    expect(res.body.porDia).toHaveLength(100);
    expect(res.body.porVaca).toHaveLength(50);
    expect(ms).toBeLessThan(3000);
  });
});
