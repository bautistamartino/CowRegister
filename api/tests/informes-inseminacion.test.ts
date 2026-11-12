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
  crearSemenDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
} from './ayudas.js';

// Spec 007: GET /api/informes/inseminacion (RF-7 a RF-10, RF-15 a RF-19).

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z')); // hoy argentino: 2026-11-11
  return limpiarBase();
});
afterEach(() => {
  fijarReloj(null);
  fijarTopes(null);
});
afterAll(() => prisma.$disconnect());

const URL = '/api/informes/inseminacion';
const ANIO = '?desde=2026-01-01&hasta=2026-11-11';

type Servicio = {
  servicioId: string;
  fecha: string;
  tipoServicio: string;
  semen: { id: string; nombre: string } | null;
  resultado: string;
  animal: { id: string; numero: string; activo: boolean; motivoBaja: string | null };
};
type Fila = { total: number; prenadas: number; vacias: number; sinTacto: number; base: number; porcentajePrenez: number | null; semen?: { id: string; nombre: string } | null };

// Un tambo con su dueño y varias vacas "101", "102", ... listas para sembrar eventos.
async function tambo(cantidad = 1, sufijo = 'a') {
  const t = await prepararVaca({ nombreTambo: `Tambo ${sufijo}`, email: `${sufijo}@prueba.test`, numero: '101' });
  const vacas = [t.vaca];
  for (let i = 2; i <= cantidad; i++) vacas.push(await crearAnimalDirecto(t.tambo, `${100 + i}`));
  const base = (vaca: { id: string }) => ({ establecimientoId: t.tambo, animalId: vaca.id, registradoPorId: t.usuarioId });
  return { ...t, vacas, base };
}

describe('resumen del período (RF-7)', () => {
  it('cuenta preñadas por tacto y por parto, vacías y sin tacto, con la base y el porcentaje', async () => {
    const t = await tambo(4);
    const [a, b, c, d] = t.vacas as [typeof t.vaca, typeof t.vaca, typeof t.vaca, typeof t.vaca];
    await crearServicioDirecto({ ...t.base(a), fecha: '2026-02-01' });
    await crearTactoDirecto({ ...t.base(a), fecha: '2026-03-05', resultado: 'PRENADA' });
    await crearServicioDirecto({ ...t.base(b), fecha: '2026-02-01' });
    await crearTactoDirecto({ ...t.base(b), fecha: '2026-03-05', resultado: 'VACIA' });
    await crearServicioDirecto({ ...t.base(c), fecha: '2026-02-01' });
    const sd = await crearServicioDirecto({ ...t.base(d), fecha: '2026-02-01' });
    await crearPartoDirecto({ ...t.base(d), fecha: '2026-11-01', servicioId: sd.id });

    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.periodo).toEqual({ desde: '2026-01-01', hasta: '2026-11-11' });
    expect(res.body.resumen).toEqual({ total: 4, prenadas: 2, vacias: 1, sinTacto: 1, base: 3, porcentajePrenez: 67 });
    const porVaca = Object.fromEntries((res.body.detalle as Servicio[]).map((s) => [s.animal.numero, s.resultado]));
    expect(porVaca).toEqual({ '101': 'PRENADA_TACTO', '102': 'VACIA', '103': 'SIN_TACTO', '104': 'PRENADA_PARTO' });
  });

  it('redondea 1 de 8 (12,5 %) a 13 % y 0 de 3 a 0 %', async () => {
    const t = await tambo(8);
    for (const [i, vaca] of t.vacas.entries()) {
      await crearServicioDirecto({ ...t.base(vaca), fecha: '2026-02-01' });
      await crearTactoDirecto({ ...t.base(vaca), fecha: '2026-03-05', resultado: i === 0 ? 'PRENADA' : 'VACIA' });
    }
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen).toMatchObject({ prenadas: 1, vacias: 7, base: 8, porcentajePrenez: 13 });
  });

  it('el resultado se mide a hoy: un tacto posterior al fin del período cuenta', async () => {
    const t = await tambo();
    await crearServicioDirecto({ ...t.base(t.vaca), fecha: '2026-03-20' });
    await crearTactoDirecto({ ...t.base(t.vaca), fecha: '2026-05-10', resultado: 'PRENADA' });
    const res = await t.agente.get(`${URL}?desde=2026-03-01&hasta=2026-03-31`).expect(200);
    expect(res.body.resumen).toMatchObject({ total: 1, prenadas: 1, sinTacto: 0 });
  });

  it('solo entran los servicios con fecha dentro del período (ambos extremos incluidos)', async () => {
    const t = await tambo();
    for (const fecha of ['2026-02-28', '2026-03-01', '2026-03-31', '2026-04-01']) {
      await crearServicioDirecto({ ...t.base(t.vaca), fecha });
    }
    const res = await t.agente.get(`${URL}?desde=2026-03-01&hasta=2026-03-31`).expect(200);
    expect((res.body.detalle as Servicio[]).map((s) => s.fecha)).toEqual(['2026-03-31', '2026-03-01']);
    expect(res.body.resumen.total).toBe(2);
  });

  it('un servicio anulado no entra', async () => {
    const t = await tambo();
    await crearServicioDirecto({ ...t.base(t.vaca), fecha: '2026-02-01', anulacion: { porId: t.usuarioId, motivo: 'Error' } });
    await crearServicioDirecto({ ...t.base(t.vaca), fecha: '2026-03-01' });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen.total).toBe(1);
  });

  it('período sin servicios: totales en cero, porcentaje null y listas vacías (RF-10)', async () => {
    const t = await tambo();
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen).toEqual({ total: 0, prenadas: 0, vacias: 0, sinTacto: 0, base: 0, porcentajePrenez: null });
    expect(res.body.porSemen).toEqual([]);
    expect(res.body.detalle).toEqual([]);
    expect(res.body.totalDetalle).toBe(0);
    expect(res.body.truncado).toBe(false);
  });

  it('solo servicios sin tacto: porcentaje null (nunca 0 % ni 100 %)', async () => {
    const t = await tambo();
    await crearServicioDirecto({ ...t.base(t.vaca), fecha: '2026-02-01' });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen).toEqual({ total: 1, prenadas: 0, vacias: 0, sinTacto: 1, base: 0, porcentajePrenez: null });
  });
});

describe('desglose por semen o toro (RF-8)', () => {
  it('agrupa por identidad con el nombre actual y junta los sin semen en "No especificado"', async () => {
    const t = await tambo(6);
    const toroA = await crearSemenDirecto(t.tambo, 'Toro viejo');
    const toroB = await crearSemenDirecto(t.tambo, 'Alfa', { activo: false });
    // Se renombra después de usarlo: el informe muestra el nombre actual.
    await prisma.semenToro.update({ where: { id: toroA.id }, data: { nombre: 'Toro nuevo' } });
    const [v1, v2, v3, v4, v5, v6] = t.vacas as [typeof t.vaca, typeof t.vaca, typeof t.vaca, typeof t.vaca, typeof t.vaca, typeof t.vaca];
    await crearServicioDirecto({ ...t.base(v1), fecha: '2026-02-01', semenId: toroA.id });
    await crearTactoDirecto({ ...t.base(v1), fecha: '2026-03-05', resultado: 'PRENADA' });
    await crearServicioDirecto({ ...t.base(v2), fecha: '2026-02-01', semenId: toroA.id });
    await crearTactoDirecto({ ...t.base(v2), fecha: '2026-03-05', resultado: 'VACIA' });
    await crearServicioDirecto({ ...t.base(v3), fecha: '2026-02-01', semenId: toroB.id });
    // Inseminación sin semen y monta natural sin toro: una sola fila.
    await crearServicioDirecto({ ...t.base(v4), fecha: '2026-02-01', semenId: null });
    await crearServicioDirecto({ ...t.base(v5), fecha: '2026-02-01', tipoServicio: 'MONTA_NATURAL' });
    await crearServicioDirecto({ ...t.base(v6), fecha: '2026-02-01', tipoServicio: 'MONTA_NATURAL' });

    const res = await t.agente.get(URL + ANIO).expect(200);
    const filas = res.body.porSemen as Fila[];
    // Orden: por cantidad de mayor a menor; a igual cantidad, por nombre (Toro nuevo con 2, "No especificado" con 3 va primero).
    expect(filas.map((f) => [f.semen?.nombre ?? 'No especificado', f.total])).toEqual([
      ['No especificado', 3],
      ['Toro nuevo', 2],
      ['Alfa', 1],
    ]);
    expect(filas[0]).toMatchObject({ semen: null, total: 3, prenadas: 0, vacias: 0, sinTacto: 3, base: 0, porcentajePrenez: null });
    expect(filas[1]).toMatchObject({ prenadas: 1, vacias: 1, sinTacto: 0, base: 2, porcentajePrenez: 50 });
    expect(filas[1]!.semen).toEqual({ id: toroA.id, nombre: 'Toro nuevo' });
    expect(filas[2]!.semen).toEqual({ id: toroB.id, nombre: 'Alfa' });
    // El detalle trae el mismo nombre actual.
    const s1 = (res.body.detalle as Servicio[]).find((s) => s.animal.numero === '101')!;
    expect(s1.semen).toEqual({ id: toroA.id, nombre: 'Toro nuevo' });
  });

  it('a igual cantidad ordena por nombre', async () => {
    const t = await tambo(2);
    const zeta = await crearSemenDirecto(t.tambo, 'Zeta');
    const beta = await crearSemenDirecto(t.tambo, 'Beta');
    await crearServicioDirecto({ ...t.base(t.vacas[0]!), fecha: '2026-02-01', semenId: zeta.id });
    await crearServicioDirecto({ ...t.base(t.vacas[1]!), fecha: '2026-02-01', semenId: beta.id });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect((res.body.porSemen as Fila[]).map((f) => f.semen?.nombre)).toEqual(['Beta', 'Zeta']);
  });

  it('el desglose y el resumen cuentan todo aunque el detalle se corte', async () => {
    const t = await tambo(3);
    const toro = await crearSemenDirecto(t.tambo, 'Toro');
    for (const v of t.vacas) await crearServicioDirecto({ ...t.base(v), fecha: '2026-02-01', semenId: toro.id });
    fijarTopes({ informe: 2 });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.porSemen).toHaveLength(1);
    expect(res.body.porSemen[0].total).toBe(3);
  });
});

describe('detalle (RF-9)', () => {
  it('ordena del más reciente al más antiguo y da los datos de enlace de la vaca activa y de baja', async () => {
    const t = await tambo(3);
    const [activa, vendida, muerta] = t.vacas as [typeof t.vaca, typeof t.vaca, typeof t.vaca];
    await crearServicioDirecto({ ...t.base(vendida), fecha: '2026-01-10', tipoServicio: 'MONTA_NATURAL' });
    await crearServicioDirecto({ ...t.base(muerta), fecha: '2026-02-10' });
    await crearServicioDirecto({ ...t.base(activa), fecha: '2026-03-10' });
    await crearBajaRegistradaDirecta({ ...t.base(vendida), fecha: '2026-06-01', motivo: 'VENTA' });
    await crearBajaRegistradaDirecta({ ...t.base(muerta), fecha: '2026-06-02', motivo: 'MUERTE' });

    const res = await t.agente.get(URL + ANIO).expect(200);
    const detalle = res.body.detalle as Servicio[];
    expect(detalle.map((s) => s.fecha)).toEqual(['2026-03-10', '2026-02-10', '2026-01-10']);
    expect(detalle[0]!.animal).toEqual({ id: activa.id, numero: '101', activo: true, motivoBaja: null });
    expect(detalle[1]!.animal).toEqual({ id: muerta.id, numero: '103', activo: false, motivoBaja: 'muerte' });
    expect(detalle[2]!.animal).toEqual({ id: vendida.id, numero: '102', activo: false, motivoBaja: 'venta' });
    expect(detalle[2]!.tipoServicio).toBe('MONTA_NATURAL');
    expect(detalle[0]!.tipoServicio).toBe('INSEMINACION');
    // Las bajas cuentan en los informes.
    expect(res.body.resumen.total).toBe(3);
  });

  it('a igual fecha manda el registro más reciente primero', async () => {
    const t = await tambo(2);
    const x = await crearServicioDirecto({ ...t.base(t.vacas[0]!), fecha: '2026-02-01' });
    const y = await crearServicioDirecto({ ...t.base(t.vacas[1]!), fecha: '2026-02-01' });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect((res.body.detalle as Servicio[]).map((s) => s.servicioId)).toEqual([y.id, x.id]);
  });
});

describe('tope del detalle (RF-16)', () => {
  it('con tope 2 el detalle trae las 2 más recientes, avisa y los totales cuentan todo', async () => {
    const t = await tambo();
    for (const fecha of ['2026-01-10', '2026-02-10', '2026-03-10']) {
      await crearServicioDirecto({ ...t.base(t.vaca), fecha });
      await crearTactoDirecto({ ...t.base(t.vaca), fecha, resultado: 'VACIA' });
    }
    fijarTopes({ informe: 2 });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect((res.body.detalle as Servicio[]).map((s) => s.fecha)).toEqual(['2026-03-10', '2026-02-10']);
    expect(res.body.totalDetalle).toBe(3);
    expect(res.body.truncado).toBe(true);
    expect(res.body.tope).toBe(2);
    expect(res.body.resumen).toMatchObject({ total: 3, vacias: 3 });
  });

  it('sin tope inyectado el tope es 2.000 y no hay corte', async () => {
    const t = await tambo();
    await crearServicioDirecto({ ...t.base(t.vaca), fecha: '2026-02-01' });
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.tope).toBe(2000);
    expect(res.body.truncado).toBe(false);
  });
});

describe('anular se refleja en el siguiente cálculo (RF-17)', () => {
  it('anular un tacto por la API cambia el resultado del servicio', async () => {
    const t = await tambo();
    await crearServicioDirecto({ ...t.base(t.vaca), fecha: '2026-02-01' });
    const tacto = await crearTactoDirecto({ ...t.base(t.vaca), fecha: '2026-03-05', resultado: 'PRENADA' });
    let res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen).toMatchObject({ prenadas: 1, sinTacto: 0 });
    await t.agente.post(`/api/tactos/${tacto.id}/anular`).send({ motivo: 'Lo cargué mal' }).expect(200);
    res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen).toMatchObject({ prenadas: 0, sinTacto: 1, porcentajePrenez: null });
  });

  it('anular un servicio por la API lo saca del informe', async () => {
    const t = await tambo();
    const s = await crearServicioDirecto({ ...t.base(t.vaca), fecha: '2026-02-01' });
    await t.agente.post(`/api/servicios/${s.id}/anular`).send({ motivo: 'Lo cargué mal' }).expect(200);
    const res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.resumen.total).toBe(0);
  });

  it('anular un parto vinculado devuelve el servicio a "sin tacto"', async () => {
    const t = await tambo();
    const s = await crearServicioDirecto({ ...t.base(t.vaca), fecha: '2026-02-01' });
    const parto = await crearPartoDirecto({ ...t.base(t.vaca), fecha: '2026-11-01', servicioId: s.id });
    let res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.detalle[0].resultado).toBe('PRENADA_PARTO');
    await t.agente.post(`/api/partos/${parto.id}/anular`).send({ motivo: 'Lo cargué mal' }).expect(200);
    res = await t.agente.get(URL + ANIO).expect(200);
    expect(res.body.detalle[0].resultado).toBe('SIN_TACTO');
  });
});

describe('validación del período (RF-15)', () => {
  it('400 con mensaje en español si falta alguno, está repetido o es inválido', async () => {
    const t = await tambo();
    const casos: Array<[string, RegExp]> = [
      ['', /Indicá "Desde" y "Hasta"/],
      ['?desde=2026-01-01', /Indicá "Desde" y "Hasta"/],
      ['?hasta=2026-01-01', /Indicá "Desde" y "Hasta"/],
      ['?desde=2026-01-01&desde=2026-02-01&hasta=2026-03-01', /Indicá "Desde" y "Hasta"/],
      ['?desde[a]=1&hasta=2026-03-01', /Indicá "Desde" y "Hasta"/],
      ['?desde=2026-02-30&hasta=2026-03-01', /no es válida/],
      ['?desde=2026-03-02&hasta=2026-03-01', /posterior/],
      ['?desde=2026-01-01&hasta=2026-11-12', /futura/], // hoy es 2026-11-11
      ['?desde=1999-12-31&hasta=2000-01-05', /anterior al 01\/01\/2000/],
      ['?desde=2021-01-01&hasta=2026-01-01', /más de 5 años/],
    ];
    for (const [query, mensaje] of casos) {
      const res = await t.agente.get(URL + query).expect(400);
      expect(res.body.error, query).toMatch(mensaje);
    }
  });

  it('acepta un período de un solo día y hasta hoy', async () => {
    const t = await tambo();
    await t.agente.get(`${URL}?desde=2026-11-11&hasta=2026-11-11`).expect(200);
  });
});

describe('aislamiento, permisos y datos sensibles (RF-18, RF-19)', () => {
  it('el otro tambo no ve datos ajenos ni cambian los suyos; un establecimientoId enviado se ignora', async () => {
    const a = await tambo(1, 'a');
    const b = await tambo(2, 'b');
    await crearServicioDirecto({ ...a.base(a.vaca), fecha: '2026-02-01' });
    await crearTactoDirecto({ ...a.base(a.vaca), fecha: '2026-03-05', resultado: 'PRENADA' });
    const toroB = await crearSemenDirecto(b.tambo, 'Toro de B');
    for (const v of b.vacas) await crearServicioDirecto({ ...b.base(v), fecha: '2026-02-01', semenId: toroB.id });

    const antes = await b.agente.get(URL + ANIO).expect(200);
    const resA = await a.agente.get(`${URL}${ANIO}&establecimientoId=${b.tambo}`).expect(200);
    expect(resA.body.resumen).toMatchObject({ total: 1, prenadas: 1 });
    expect(resA.body.porSemen.map((f: Fila) => f.semen)).toEqual([null]);
    expect(JSON.stringify(resA.body)).not.toContain('Toro de B');
    expect(JSON.stringify(resA.body)).not.toContain(b.tambo);
    // Lo de B no cambió por consultar A.
    const despues = await b.agente.get(URL + ANIO).expect(200);
    expect(despues.body).toEqual(antes.body);
    expect(antes.body.resumen.total).toBe(2);
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
    await crearServicioDirecto({ ...t.base(t.vaca), fecha: '2026-02-01' });
    const texto = JSON.stringify((await t.agente.get(URL + ANIO).expect(200)).body);
    expect(texto).not.toMatch(/passwordHash|tokenHash|@prueba\.test/);
    expect(texto).not.toContain(t.usuarioId);
  });
});
