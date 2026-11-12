import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { armarRespuesta, type FilaEvento } from '../src/reproduccion/eventos.js';
import { cicloActual, ultimoNoAnulado } from '../src/reproduccion/situacion.js';
import {
  app,
  crearAnimalDirecto,
  crearAnimalDeBajaPartoAnulado,
  crearBajaRegistradaDirecta,
  crearPartoDirecto,
  crearServicioDirecto,
  limpiarBase,
  prepararVaca,
  verificarInvariantes,
} from './ayudas.js';

// Spec 006, T3: cómo se integran las bajas con las specs 002 a 005 (RF-11, RF-14, RF-15).
// Los animales de baja se siembran directo en la base (crearBajaRegistradaDirecta) y la baja
// "por la API" se usa solo donde hace falta el recorrido completo.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

type Contexto = Awaited<ReturnType<typeof prepararVaca>>;

// Da de baja (sembrando directo) a un animal del tambo y devuelve el animal.
async function sembrarBaja(
  c: Contexto,
  numero: string,
  opciones: { motivo?: 'VENTA' | 'MUERTE'; fecha?: string; creadoEn?: Date; madreId?: string | null; sexo?: 'HEMBRA' | 'MACHO' } = {},
) {
  const animal = await crearAnimalDirecto(c.tambo, numero, { madreId: opciones.madreId, sexo: opciones.sexo });
  await crearBajaRegistradaDirecta({
    establecimientoId: c.tambo,
    animalId: animal.id,
    registradoPorId: c.usuarioId,
    fecha: opciones.fecha ?? '2026-11-05',
    motivo: opciones.motivo ?? 'VENTA',
    creadoEn: opciones.creadoEn,
  });
  return animal;
}

const altaNumero = (c: Contexto, numero: string) =>
  c.agente.post('/api/animales').send({ numero, sexo: 'HEMBRA', estado: 'VAQUILLONA' });

// ─── RF-14: aviso por el número de un animal de baja ─────────────────────────────────────────

describe('aviso de número de un animal de baja: alta manual (RF-14)', () => {
  it('con una baja vigente por venta: se guarda igual y avisa motivo y fecha; no persiste', async () => {
    const c = await prepararVaca();
    await sembrarBaja(c, 'X1', { motivo: 'VENTA', fecha: '2026-11-05' });
    const res = await altaNumero(c, 'X1').expect(201);
    expect(res.body.avisoNumeroDeBaja).toEqual({ motivo: 'venta', fecha: '2026-11-05' });
    // El aviso no se guarda: la ficha del animal nuevo no lo trae.
    const ficha = await c.agente.get(`/api/animales/${res.body.animal.id}`).expect(200);
    expect(ficha.body).not.toHaveProperty('avisoNumeroDeBaja');
  });

  it('por muerte también avisa; un número sin baja no avisa (null)', async () => {
    const c = await prepararVaca();
    await sembrarBaja(c, 'X2', { motivo: 'MUERTE', fecha: '2026-10-20' });
    expect((await altaNumero(c, 'X2').expect(201)).body.avisoNumeroDeBaja).toEqual({ motivo: 'muerte', fecha: '2026-10-20' });
    expect((await altaNumero(c, 'LIBRE').expect(201)).body.avisoNumeroDeBaja).toBeNull();
  });

  it('con varias bajas del mismo número informa la más reciente (por fecha y, a igual fecha, por registro)', async () => {
    const c = await prepararVaca();
    await sembrarBaja(c, 'X3', { motivo: 'MUERTE', fecha: '2026-10-01' });
    await sembrarBaja(c, 'X3', { motivo: 'VENTA', fecha: '2026-11-05' });
    expect((await altaNumero(c, 'X3').expect(201)).body.avisoNumeroDeBaja).toEqual({ motivo: 'venta', fecha: '2026-11-05' });

    // A igual fecha manda el momento de registro: la muerte se registró después.
    await sembrarBaja(c, 'X4', { motivo: 'VENTA', fecha: '2026-11-05', creadoEn: new Date('2026-11-06T10:00:00Z') });
    await sembrarBaja(c, 'X4', { motivo: 'MUERTE', fecha: '2026-11-05', creadoEn: new Date('2026-11-06T11:00:00Z') });
    expect((await altaNumero(c, 'X4').expect(201)).body.avisoNumeroDeBaja).toEqual({ motivo: 'muerte', fecha: '2026-11-05' });
  });

  it('una baja "parto anulado" no avisa', async () => {
    const c = await prepararVaca();
    await crearAnimalDeBajaPartoAnulado(c.tambo, 'X5');
    expect((await altaNumero(c, 'X5').expect(201)).body.avisoNumeroDeBaja).toBeNull();
  });

  it('con la baja revertida el animal vuelve a ser activo: 409 por número repetido, sin aviso', async () => {
    const c = await prepararVaca();
    const vieja = await sembrarBaja(c, 'X6');
    await c.agente.post(`/api/animales/${vieja.id}/revertir-baja`).send({ motivoReversion: 'Error de carga' }).expect(200);
    const res = await altaNumero(c, 'X6').expect(409);
    expect(res.body.error).toBe('Ya existe un animal activo con ese número');
  });

  it('un animal de baja de otro tambo no avisa', async () => {
    const c = await prepararVaca();
    const otro = await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test' });
    await sembrarBaja(otro, 'X7');
    expect((await altaNumero(c, 'X7').expect(201)).body.avisoNumeroDeBaja).toBeNull();
  });
});

describe('aviso de número de un animal de baja: edición del número (RF-14)', () => {
  it('cambiar el número a uno de un animal de baja avisa en `avisos`; sin baja, lista vacía', async () => {
    const c = await prepararVaca({ numero: '101' });
    await sembrarBaja(c, 'X1', { motivo: 'MUERTE', fecha: '2026-10-20' });
    const res = await c.agente.patch(`/api/animales/${c.vaca.id}`).send({ numero: 'X1' }).expect(200);
    expect(res.body.numero).toBe('X1');
    expect(res.body.avisos).toEqual(['El número X1 perteneció a un animal dado de baja por muerte el 20/10/2026']);

    const sin = await c.agente.patch(`/api/animales/${c.vaca.id}`).send({ numero: 'LIBRE' }).expect(200);
    expect(sin.body.avisos).toEqual([]);
  });

  it('si no se cambia el número no hay aviso, aunque el número actual coincida con uno de baja', async () => {
    const c = await prepararVaca({ numero: '101' });
    await sembrarBaja(c, 'X1');
    const actual = await crearAnimalDirecto(c.tambo, 'X1', { estado: 'RECIEN_NACIDO' }); // reutiliza el número
    const res = await c.agente.patch(`/api/animales/${actual.id}`).send({ sexo: 'MACHO' }).expect(200);
    expect(res.body.avisos).toEqual([]);
  });

  it('el parto no avisa: la cría con el número de un animal de baja se crea sin aviso ni error', async () => {
    const c = await prepararVaca({ numero: 'MADRE' });
    await sembrarBaja(c, 'X8');
    const res = await c.agente.post(`/api/animales/${c.vaca.id}/partos`).send({ fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: 'X8' }] }).expect(201);
    expect(res.body).not.toHaveProperty('avisoNumeroDeBaja');
  });
});

describe('aviso de número de un animal de baja: planilla (RF-14)', () => {
  const texto = (...filas: string[][]) => filas.map((f) => f.join('\t')).join('\n');

  it('vista previa y confirmar avisan por fila, como aviso y no como error', async () => {
    const c = await prepararVaca();
    await sembrarBaja(c, 'X1', { motivo: 'VENTA', fecha: '2026-11-05' });
    await crearAnimalDeBajaPartoAnulado(c.tambo, 'X2');
    const t = texto(['X1', 'H', '', 'seca', ''], ['X2', 'H', '', 'seca', ''], ['LIBRE', 'H', '', 'seca', '']);

    const previa = await c.agente.post('/api/animales/planilla/vista-previa').send({ texto: t }).expect(200);
    expect(previa.body.filas.map((f: any) => [f.numero, f.ok, f.avisoNumeroDeBaja])).toEqual([
      ['X1', true, { motivo: 'venta', fecha: '2026-11-05' }],
      ['X2', true, null],
      ['LIBRE', true, null],
    ]);
    expect(previa.body.resumen).toMatchObject({ total: 3, correctas: 3, conError: 0 });

    const antes = await prisma.animal.count();
    const conf = await c.agente.post('/api/animales/planilla/confirmar').send({ texto: t }).expect(200);
    expect(conf.body.guardados).toBe(3);
    // Confirmar devuelve los avisos de las filas guardadas.
    expect(conf.body.avisosDeNumero).toEqual([{ fila: 1, numero: 'X1', avisoNumeroDeBaja: { motivo: 'venta', fecha: '2026-11-05' } }]);
    expect(await prisma.animal.count()).toBe(antes + 3);
  });

  it('una fila con error no lleva aviso', async () => {
    const c = await prepararVaca();
    await sembrarBaja(c, 'X1');
    const previa = await c.agente.post('/api/animales/planilla/vista-previa').send({ texto: texto(['X1', 'vaca', '', 'seca', '']) }).expect(200);
    expect(previa.body.filas[0]).toMatchObject({ ok: false, avisoNumeroDeBaja: null });
  });
});

// ─── RF-15: vínculos madre-cría hacia animales de baja ──────────────────────────────────────

describe('vínculos hacia animales de baja (RF-15)', () => {
  it('la ficha de una cría activa muestra a su madre de baja por venta con motivoBaja; "parto anulado" también', async () => {
    const c = await prepararVaca({ numero: 'MADRE' });
    const madreVenta = await sembrarBaja(c, 'MV', { motivo: 'VENTA' });
    const cria = await crearAnimalDirecto(c.tambo, 'CRIA', { estado: 'RECIEN_NACIDO', madreId: madreVenta.id });
    const f1 = await c.agente.get(`/api/animales/${cria.id}`).expect(200);
    expect(f1.body.madre).toEqual({ id: madreVenta.id, numero: 'MV', activa: false, motivoBaja: 'venta' });

    const madrePA = await crearAnimalDeBajaPartoAnulado(c.tambo, 'MP');
    const cria2 = await crearAnimalDirecto(c.tambo, 'CRIA2', { estado: 'RECIEN_NACIDO', madreId: madrePA.id });
    const f2 = await c.agente.get(`/api/animales/${cria2.id}`).expect(200);
    expect(f2.body.madre).toEqual({ id: madrePA.id, numero: 'MP', activa: false, motivoBaja: 'parto_anulado' });

    // Una madre activa: motivoBaja null.
    const cria3 = await crearAnimalDirecto(c.tambo, 'CRIA3', { estado: 'RECIEN_NACIDO', madreId: c.vaca.id });
    expect((await c.agente.get(`/api/animales/${cria3.id}`).expect(200)).body.madre).toMatchObject({ activa: true, motivoBaja: null });
  });

  it('la ficha de una madre lista las crías activas en `crias` y las de baja en `criasDeBaja` con su motivo', async () => {
    const c = await prepararVaca({ numero: 'MADRE' });
    const activa = await crearAnimalDirecto(c.tambo, 'A1', { estado: 'RECIEN_NACIDO', madreId: c.vaca.id });
    const vendida = await sembrarBaja(c, 'B10', { motivo: 'VENTA', madreId: c.vaca.id });
    const muerta = await sembrarBaja(c, 'B2', { motivo: 'MUERTE', madreId: c.vaca.id });
    const anulada = await crearAnimalDeBajaPartoAnulado(c.tambo, 'B3', { madreId: c.vaca.id });
    const ficha = (await c.agente.get(`/api/animales/${c.vaca.id}`).expect(200)).body;
    expect(ficha.crias).toEqual([{ id: activa.id, numero: 'A1' }]);
    // Orden natural de números: 2, 3, 10.
    expect(ficha.criasDeBaja).toEqual([
      { id: muerta.id, numero: 'B2', motivo: 'muerte' },
      { id: anulada.id, numero: 'B3', motivo: 'parto_anulado' },
      { id: vendida.id, numero: 'B10', motivo: 'venta' },
    ]);
  });

  it('la ficha de baja de una madre lista sus crías de baja igual', async () => {
    const c = await prepararVaca({ numero: 'MADRE' });
    const madre = await sembrarBaja(c, 'MB');
    const cria = await sembrarBaja(c, 'CB', { motivo: 'MUERTE', madreId: madre.id });
    const res = await c.agente.get(`/api/bajas/${madre.id}`).expect(200);
    expect(res.body.criasDeBaja).toEqual([{ id: cria.id, numero: 'CB', motivo: 'muerte' }]);
  });

  it('la lista de eventos de la madre trae a la cría dada de baja con su motivo (y activa: true en las vivas)', async () => {
    const c = await prepararVaca({ numero: 'MADRE' });
    const viva = await crearAnimalDirecto(c.tambo, 'VIVA', { estado: 'RECIEN_NACIDO', madreId: c.vaca.id });
    const vendida = await sembrarBaja(c, 'VEN', { motivo: 'VENTA', madreId: c.vaca.id });
    const anulada = await crearAnimalDeBajaPartoAnulado(c.tambo, 'ANU', { madreId: c.vaca.id });
    // Un parto admite hasta dos crías: dos partos (con 200 días o más de separación).
    await crearPartoDirecto({ establecimientoId: c.tambo, animalId: c.vaca.id, registradoPorId: c.usuarioId, fecha: '2025-08-01', crias: [{ animalId: viva.id }, { nacidaMuerta: true }] });
    await crearPartoDirecto({ establecimientoId: c.tambo, animalId: c.vaca.id, registradoPorId: c.usuarioId, fecha: '2026-03-01', crias: [{ animalId: vendida.id }, { animalId: anulada.id }] });
    const res = await c.agente.get(`/api/animales/${c.vaca.id}/eventos`).expect(200);
    const mapa = (e: any) => e.parto.crias.map((x: any) => x.animal && [x.animal.numero, x.animal.activo, x.animal.motivoBaja]);
    expect(mapa(res.body.eventos[0])).toEqual([['VEN', false, 'venta'], ['ANU', false, 'parto_anulado']]);
    expect(mapa(res.body.eventos[1])).toEqual([['VIVA', true, null], null]);
  });

  it('el alta y la edición no admiten una madre de baja (400 genérico); los vínculos existentes se conservan', async () => {
    const c = await prepararVaca({ numero: 'MADRE' });
    const madre = await sembrarBaja(c, 'MB');
    const alta = await c.agente.post('/api/animales').send({ numero: 'N1', sexo: 'HEMBRA', estado: 'VAQUILLONA', madre: 'MB' }).expect(400);
    expect(JSON.stringify(alta.body)).toContain('No hay una hembra activa con el número MB');
    const otra = await crearAnimalDirecto(c.tambo, 'OTRA');
    const ed = await c.agente.patch(`/api/animales/${otra.id}`).send({ madre: 'MB' }).expect(400);
    expect(ed.body.error).toContain('No hay una hembra activa con el número MB');
    // La cría ya vinculada sigue vinculada tras la baja.
    const cria = await crearAnimalDirecto(c.tambo, 'CRIA', { estado: 'RECIEN_NACIDO', madreId: madre.id });
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: cria.id } })).madreId).toBe(madre.id);
  });

  it('un ciclo de madres que pasa por un animal de baja se detecta (400)', async () => {
    // Z (de baja) es hija de X; W (activa) es hija de Z. Ponerle a X la madre W cerraría X → W → Z → X.
    const c = await prepararVaca({ numero: 'X' });
    const z = await sembrarBaja(c, 'Z', { madreId: c.vaca.id });
    const w = await crearAnimalDirecto(c.tambo, 'W', { madreId: z.id });
    const res = await c.agente.patch(`/api/animales/${c.vaca.id}`).send({ madre: w.numero }).expect(400);
    expect(res.body.error).toBe('W ya es descendiente de este animal');
  });
});

describe('anular un parto con una cría dada de baja (RF-15)', () => {
  async function partoConCria(c: Contexto, cria: { id: string }) {
    return crearPartoDirecto({
      establecimientoId: c.tambo,
      animalId: c.vaca.id,
      registradoPorId: c.usuarioId,
      fecha: '2026-08-01',
      crias: [{ animalId: cria.id }],
    });
  }

  it.each([
    ['VENTA', 'venta'],
    ['MUERTE', 'muerte'],
  ] as const)('cría dada de baja por %s: 409 con el mensaje exacto y no cambia nada', async (motivo, texto) => {
    const c = await prepararVaca({ numero: 'MADRE', estado: 'EN_ORDENE' });
    const cria = await sembrarBaja(c, 'CRIA7', { motivo, madreId: c.vaca.id });
    const parto = await partoConCria(c, cria);
    const res = await c.agente.post(`/api/partos/${parto.id}/anular`).send({ motivo: 'Lo cargué mal' }).expect(409);
    expect(res.body.error).toBe(`La cría N.º CRIA7 está dada de baja por ${texto}: revertí primero su baja`);
    expect((await prisma.evento.findUniqueOrThrow({ where: { id: parto.id } })).anuladoEn).toBeNull();
  });

  it('cría de baja por "parto anulado": mantiene el mensaje de "ya no está activa"', async () => {
    const c = await prepararVaca({ numero: 'MADRE', estado: 'EN_ORDENE' });
    const cria = await crearAnimalDeBajaPartoAnulado(c.tambo, 'CRIA8', { madreId: c.vaca.id });
    const parto = await partoConCria(c, cria);
    const res = await c.agente.post(`/api/partos/${parto.id}/anular`).send({ motivo: 'Lo cargué mal' }).expect(409);
    expect(res.body.error).toBe('No se puede anular el parto: la cría N.º CRIA8 ya no está activa');
  });

  it('con la baja de la cría revertida, el parto se anula y la cría pasa a "parto anulado"', async () => {
    const c = await prepararVaca({ numero: 'MADRE', estado: 'EN_ORDENE' });
    const cria = await sembrarBaja(c, 'CRIA9', { madreId: c.vaca.id });
    const parto = await partoConCria(c, cria);
    await c.agente.post(`/api/animales/${cria.id}/revertir-baja`).send({ motivoReversion: 'Error' }).expect(200);
    await c.agente.post(`/api/partos/${parto.id}/anular`).send({ motivo: 'Lo cargué mal' }).expect(200);
    const despues = await prisma.animal.findUniqueOrThrow({ where: { id: cria.id } });
    expect([despues.estado, despues.motivoBaja]).toEqual(['BAJA', 'PARTO_ANULADO']);
    expect(await verificarInvariantes()).toEqual([]);
  });
});

// ─── RF-11 y RF-15: el tipo BAJA no cuenta en los cálculos ──────────────────────────────────
// Una baja vigente solo existe mientras el animal está de baja, así que estas pruebas la
// siembran a la fuerza sobre un animal ACTIVO (apagando los disparadores en esa transacción):
// es la única forma de comprobar que el tipo BAJA, por sí solo, no cuenta.

async function sembrarBajaVigenteSobreActivo(c: Contexto, animalId: string, fecha: string) {
  const id = crypto.randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.evento.create({
      data: { id, establecimientoId: c.tambo, animalId, tipo: 'BAJA', fecha: new Date(`${fecha}T00:00:00.000Z`), registradoPorId: c.usuarioId, creadoEn: new Date('2026-11-10T10:00:00Z') },
    });
    await tx.baja.create({
      data: { eventoId: id, establecimientoId: c.tambo, tipo: 'BAJA', animalId, motivo: 'VENTA', estadoAnterior: 'EN_ORDENE', tuvoLoteAnterior: false, vigente: true },
    });
  });
  return id;
}

// ("eventos propios de una cría" no necesita prueba aparte: una cría con baja vigente se rechaza antes con el 409 de baja,
// y una baja revertida está anulada y no cuenta; ver 'con la baja de la cría revertida' más arriba.)
describe('el tipo BAJA no cuenta en situación, ciclo, aviso 8, sexo ni eventos propios (RF-15)', () => {
  const fila = (tipo: FilaEvento['tipo'], fecha: string, n: number): FilaEvento =>
    ({
      id: `e${n}`, tipo, fecha, creadoEn: new Date(2026, 10, n), anulado: false, resultado: null, fechaProbableIndicada: null,
      registradoPor: 'Ana', anuladoEn: null, anuladoPor: null, motivoAnulacion: null,
      servicio: tipo === 'SERVICIO' ? { tipoServicio: 'INSEMINACION', semen: null } : null,
      anomalias: null, parto: null, secado: null, baja: null,
    }) as FilaEvento;

  it('funciones puras: último evento a anular, ciclo y situación ignoran la baja', () => {
    const servicio = fila('SERVICIO', '2026-09-01', 1);
    const baja = fila('BAJA', '2026-10-01', 2);
    expect(ultimoNoAnulado([servicio, baja])?.id).toBe('e1');
    expect(cicloActual([servicio, baja]).map((e) => e.id)).toEqual(['e1']);
    const { situacion, eventos } = armarRespuesta([servicio, baja], '2026-11-11');
    expect(situacion.estado).toBe('SERVIDA');
    expect(eventos.map((e) => e.tipo)).toEqual(['BAJA', 'SERVICIO']); // figura en la lista
  });

  it('anular el servicio no pide anular primero una baja vigente', async () => {
    const c = await prepararVaca();
    const servicio = await crearServicioDirecto({ establecimientoId: c.tambo, animalId: c.vaca.id, registradoPorId: c.usuarioId, fecha: '2026-09-01' });
    await sembrarBajaVigenteSobreActivo(c, c.vaca.id, '2026-10-01');
    await c.agente.post(`/api/servicios/${servicio.id}/anular`).send({ motivo: 'Lo cargué mal' }).expect(200);
  });

  it('registrar un servicio no se compara con la fecha de una baja vigente', async () => {
    const c = await prepararVaca();
    await sembrarBajaVigenteSobreActivo(c, c.vaca.id, '2026-11-01');
    await c.agente.post(`/api/animales/${c.vaca.id}/servicios`).send({ fecha: '2026-10-15', tipo: 'INSEMINACION' }).expect(201);
  });

  it('el sexo se puede cambiar: la baja no cuenta como "evento registrado"', async () => {
    const c = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    await sembrarBajaVigenteSobreActivo(c, c.vaca.id, '2026-11-01');
    await c.agente.patch(`/api/animales/${c.vaca.id}`).send({ sexo: 'MACHO' }).expect(200);
  });
});

// ─── RF-11: con el animal de baja todo responde "no encontrado"; al revertir vuelve ──────────

describe('un animal de baja no admite eventos, edición ni movimiento (RF-11)', () => {
  it('registrar, anular, editar, mover y leer por las rutas de activos: 404; al revertir, todo vuelve', async () => {
    const c = await prepararVaca({ numero: 'V1' });
    const servicio = await crearServicioDirecto({ establecimientoId: c.tambo, animalId: c.vaca.id, registradoPorId: c.usuarioId, fecha: '2026-10-01' });
    await c.agente.post(`/api/animales/${c.vaca.id}/baja`).send({ motivo: 'muerte', fecha: '2026-11-05' }).expect(201);
    const a = c.agente;
    const id = c.vaca.id;
    for (const r of [
      a.post(`/api/animales/${id}/servicios`).send({ fecha: '2026-11-06', tipo: 'INSEMINACION' }),
      a.post(`/api/animales/${id}/tactos`).send({ fecha: '2026-11-06', resultado: 'VACIA' }),
      a.post(`/api/animales/${id}/partos`).send({ fecha: '2026-11-06', crias: [{ sexo: 'HEMBRA', numero: 'Q1' }] }),
      a.post(`/api/animales/${id}/secados`).send({ fecha: '2026-11-06' }),
      a.post(`/api/servicios/${servicio.id}/anular`).send({ motivo: 'x' }),
      a.patch(`/api/animales/${id}`).send({ numero: 'Z9' }),
      a.patch(`/api/animales/${id}/lote`).send({ loteId: null }),
      a.get(`/api/animales/${id}`),
      a.get(`/api/animales/${id}/eventos`),
      a.get(`/api/animales/${id}/cambios`),
      a.get('/api/animales/buscar?numero=V1'),
    ]) {
      expect((await r).status).toBe(404);
    }
    expect((await a.get('/api/animales')).body.animales.map((x: any) => x.numero)).not.toContain('V1');

    await a.post(`/api/animales/${id}/revertir-baja`).send({ motivoReversion: 'Error' }).expect(200);
    await a.get(`/api/animales/${id}`).expect(200);
    await a.get(`/api/animales/${id}/eventos`).expect(200);
    await a.get(`/api/animales/${id}/cambios`).expect(200);
    await a.get('/api/animales/buscar?numero=V1').expect(200);
    await a.patch(`/api/animales/${id}`).send({ numero: 'Z9' }).expect(200);
    await a.post(`/api/animales/${id}/servicios`).send({ fecha: '2026-11-06', tipo: 'INSEMINACION' }).expect(201);
  });
});

// Sin sesión nada cambia: las rutas nuevas ya tienen sus pruebas de permisos en los otros archivos.
describe('permisos', () => {
  it('sin sesión, las rutas de lectura de bajas responden 401', async () => {
    await request(app).get('/api/bajas').expect(401);
  });
});
