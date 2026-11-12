import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import {
  app,
  crearAnimalDirecto,
  crearBajaDirecta,
  crearPartoDirecto,
  crearSecadoDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
  registrarTambo,
  verificarInvariantes,
} from './ayudas.js';

// Tests de POST /api/partos/:id/anular y /api/secados/:id/anular: RF-22 a RF-30, RF-41 y RF-42 (spec 004).

beforeEach(() => {
  // "Hoy" en Argentina = 11/11/2026.
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';

type Agente = ReturnType<typeof request.agent>;
const AUSENTE = Symbol('ausente');
const cuerpoMotivo = (motivo: unknown) => (motivo === AUSENTE ? {} : { motivo });
const anularParto = (agente: Agente, id: string, motivo: unknown = 'Lo cargué mal') =>
  agente.post(`/api/partos/${id}/anular`).send(cuerpoMotivo(motivo));
const anularSecado = (agente: Agente, id: string, motivo: unknown = 'Lo cargué mal') =>
  agente.post(`/api/secados/${id}/anular`).send(cuerpoMotivo(motivo));
const viva = (numero: string, sexo: 'HEMBRA' | 'MACHO' = 'HEMBRA') => ({ sexo, numero });
const muerta = (sexo: 'HEMBRA' | 'MACHO' = 'MACHO') => ({ sexo, nacidaMuerta: true });
const loteDe = (tambo: string, nombre: string) => prisma.lote.findFirstOrThrow({ where: { establecimientoId: tambo, nombre } });
const vacaDe = (id: string) => prisma.animal.findUniqueOrThrow({ where: { id } });
const eventoDe = (id: string) => prisma.evento.findUniqueOrThrow({ where: { id } });
const situacionDe = async (agente: Agente, animalId: string) => (await agente.get(`/api/animales/${animalId}/eventos`).expect(200)).body.situacion;

// Registra por la API (así la vaca cambia de estado y lote como en la realidad).
async function registrarParto(agente: Agente, vacaId: string, fecha: string, crias: unknown[]) {
  return (await agente.post(`/api/animales/${vacaId}/partos`).send({ fecha, crias }).expect(201)).body.evento.id as string;
}
async function registrarSecado(agente: Agente, vacaId: string, fecha: string) {
  return (await agente.post(`/api/animales/${vacaId}/secados`).send({ fecha }).expect(201)).body.evento.id as string;
}

// Una vaca "seca" en el lote "Secas" que tuvo un parto de una viva (V1) y una muerta.
async function vacaConParto(opciones: { estado?: 'VAQUILLONA' | 'EN_ORDENE' | 'SECA'; conLote?: boolean } = {}) {
  const t = await prepararVaca({ estado: opciones.estado ?? 'SECA' });
  const secas = await loteDe(t.tambo, 'Secas');
  if (opciones.conLote !== false) await prisma.animal.update({ where: { id: t.vaca.id }, data: { loteId: secas.id } });
  const partoId = await registrarParto(t.agente, t.vaca.id, '2026-11-01', [viva('V1'), muerta()]);
  const cria = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: t.tambo, numero: 'V1' } });
  return { ...t, secas, partoId, cria };
}

describe('anular un secado (RF-22)', () => {
  it('la vaca vuelve a "en ordeñe" y a su lote previo; el secado queda anulado con quién, cuándo y motivo', async () => {
    const t = await prepararVaca();
    const ordene = await loteDe(t.tambo, 'En ordeñe');
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { loteId: ordene.id } });
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'SECA', loteId: (await loteDe(t.tambo, 'Secas')).id });

    const res = await anularSecado(t.agente, secadoId, '  Se secó otra vaca  ').expect(200);
    expect(res.body.avisos).toEqual([]);
    expect(res.body.evento).toMatchObject({ id: secadoId, tipo: 'SECADO', anulacion: { motivo: 'Se secó otra vaca', por: 'Dueño' } });
    expect(typeof res.body.evento.anulacion.en).toBe('string');

    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'EN_ORDENE', loteId: ordene.id });
    const guardado = await eventoDe(secadoId);
    expect(guardado.anuladoPorId).toBe(t.usuarioId);
    expect(guardado.anuladoEn).not.toBeNull();
    expect(await prisma.secado.count({ where: { eventoId: secadoId } })).toBe(1); // no se borra
    expect(await verificarInvariantes({ estadoVaca: true })).toEqual([]);
  });

  it('aviso 6: la vaca no tenía lote antes del secado; vuelve sin lote', async () => {
    const t = await prepararVaca(); // en ordeñe y sin lote
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    const res = await anularSecado(t.agente, secadoId).expect(200);
    expect(res.body.avisos).toEqual([
      {
        codigo: 'SIN_LOTE_PREVIO',
        mensaje: 'La vaca volvió a «en ordeñe» y quedó sin lote: no tenía lote antes del secado del 05/11/2026',
      },
    ]);
    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'EN_ORDENE', loteId: null });
  });

  it('aviso 7: el lote previo fue eliminado después; vuelve sin lote', async () => {
    const t = await prepararVaca();
    const previo = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Previo' } });
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { loteId: previo.id } });
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    await t.agente.delete(`/api/lotes/${previo.id}`).expect(204); // ya no tiene animales activos
    const res = await anularSecado(t.agente, secadoId).expect(200);
    expect(res.body.avisos).toEqual([
      { codigo: 'LOTE_PREVIO_ELIMINADO', mensaje: 'La vaca volvió a «en ordeñe» y quedó sin lote: su lote anterior ya no existe' },
    ]);
    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'EN_ORDENE', loteId: null });
  });

  it('un secado anulado se puede volver a cargar', async () => {
    const t = await prepararVaca();
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    await anularSecado(t.agente, secadoId).expect(200);
    await registrarSecado(t.agente, t.vaca.id, '2026-11-06');
    expect((await vacaDe(t.vaca.id)).estado).toBe('SECA');
  });
});

describe('anular un parto (RF-23, RF-24)', () => {
  it('la madre vuelve al estado y lote previos, la cría viva pasa a baja y la muerta sigue en el parto', async () => {
    const t = await vacaConParto();
    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'EN_ORDENE', loteId: (await loteDe(t.tambo, 'En ordeñe')).id });

    const res = await anularParto(t.agente, t.partoId, 'Era de otra vaca').expect(200);
    expect(res.body.avisos).toEqual([]);
    expect(res.body.evento).toMatchObject({
      id: t.partoId,
      tipo: 'PARTO',
      anulacion: { motivo: 'Era de otra vaca', por: 'Dueño' },
      parto: {
        crias: [
          { orden: 1, nacidaMuerta: false, animal: { numero: 'V1', activo: false } },
          { orden: 2, nacidaMuerta: true, animal: null },
        ],
      },
    });

    // La madre.
    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'SECA', loteId: t.secas.id });
    // La cría viva: baja lógica, motivo, fecha de hoy y sin lote. No se borra.
    const cria = await vacaDe(t.cria.id);
    expect(cria).toMatchObject({ estado: 'BAJA', motivoBaja: 'PARTO_ANULADO', loteId: null, madreId: t.vaca.id });
    expect(cria.fechaBaja?.toISOString().slice(0, 10)).toBe('2026-11-11');
    // El parto conserva el vínculo con la cría (y la muerta sigue figurando).
    const filas = await prisma.criaParto.findMany({ where: { eventoId: t.partoId }, orderBy: { orden: 'asc' } });
    expect(filas.map((f) => [f.nacidaMuerta, f.animalId === t.cria.id ? 'cria' : f.animalId])).toEqual([
      [false, 'cria'],
      [true, null],
    ]);
    const guardado = await eventoDe(t.partoId);
    expect(guardado.anuladoPorId).toBe(t.usuarioId);
    expect(guardado.motivoAnulacion).toBe('Era de otra vaca');
    expect(await verificarInvariantes({ estadoVaca: true })).toEqual([]);
  });

  it('la fecha de baja es el "hoy" de Argentina aunque en UTC ya sea otro día', async () => {
    const t = await vacaConParto();
    fijarReloj(new Date('2026-11-12T01:00:00Z')); // 22:00 del 11/11 en Argentina
    await anularParto(t.agente, t.partoId).expect(200);
    expect((await vacaDe(t.cria.id)).fechaBaja?.toISOString().slice(0, 10)).toBe('2026-11-11');
  });

  it('dos crías vivas: las dos pasan a baja', async () => {
    const t = await prepararVaca();
    const partoId = await registrarParto(t.agente, t.vaca.id, '2026-11-01', [viva('G1'), viva('G2', 'MACHO')]);
    await anularParto(t.agente, partoId).expect(200);
    const crias = await prisma.animal.findMany({ where: { establecimientoId: t.tambo, madreId: t.vaca.id } });
    expect(crias.map((c) => [c.estado, c.motivoBaja, c.loteId])).toEqual([
      ['BAJA', 'PARTO_ANULADO', null],
      ['BAJA', 'PARTO_ANULADO', null],
    ]);
  });

  it('todas muertas: no hay crías que dar de baja y la madre vuelve igual', async () => {
    const t = await prepararVaca({ estado: 'VAQUILLONA' });
    const partoId = await registrarParto(t.agente, t.vaca.id, '2026-11-01', [muerta('HEMBRA')]);
    expect((await vacaDe(t.vaca.id)).estado).toBe('EN_ORDENE');
    await anularParto(t.agente, partoId).expect(200);
    expect((await vacaDe(t.vaca.id)).estado).toBe('VAQUILLONA');
  });

  it('el número de la cría queda libre, no aparece en listados ni búsquedas y su ficha da 404', async () => {
    const t = await vacaConParto();
    await anularParto(t.agente, t.partoId).expect(200);
    const listado = (await t.agente.get('/api/animales').expect(200)).body;
    expect(JSON.stringify(listado)).not.toContain('"V1"');
    await t.agente.get(`/api/animales/${t.cria.id}`).expect(404);
    // Un animal nuevo puede usar el número.
    await t.agente.post('/api/animales').send({ numero: 'V1', sexo: 'HEMBRA', estado: 'VAQUILLONA' }).expect(201);
  });

  it('la situación reproductiva se recalcula como si el parto no existiera', async () => {
    const t = await prepararVaca({ estado: 'VAQUILLONA' });
    const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
    await crearServicioDirecto({ ...base, fecha: '2026-01-10' });
    const partoId = await registrarParto(t.agente, t.vaca.id, '2026-11-01', [viva('S1')]);
    expect((await situacionDe(t.agente, t.vaca.id)).estado).toBe('SIN_SERVICIO');
    await anularParto(t.agente, partoId).expect(200);
    const situacion = await situacionDe(t.agente, t.vaca.id);
    expect(situacion.estado).toBe('SERVIDA');
    expect(situacion.ultimoServicio.cicloAnterior).toBe(false);
  });

  it('con el parto anulado se puede anular el evento anterior', async () => {
    const t = await prepararVaca({ estado: 'VAQUILLONA' });
    const servicio = await crearServicioDirecto({ establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId, fecha: '2026-01-10' });
    const partoId = await registrarParto(t.agente, t.vaca.id, '2026-11-01', [viva('S1')]);
    await t.agente.post(`/api/servicios/${servicio.id}/anular`).send({ motivo: 'x' }).expect(409);
    await anularParto(t.agente, partoId).expect(200);
    await t.agente.post(`/api/servicios/${servicio.id}/anular`).send({ motivo: 'x' }).expect(200);
  });

  it('aviso 6: la vaca no tenía lote antes del parto', async () => {
    const t = await vacaConParto({ conLote: false });
    const res = await anularParto(t.agente, t.partoId).expect(200);
    expect(res.body.avisos).toEqual([
      {
        codigo: 'SIN_LOTE_PREVIO',
        mensaje: 'La vaca volvió a «seca» y quedó sin lote: no tenía lote antes del parto del 01/11/2026',
      },
    ]);
    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'SECA', loteId: null });
  });

  it('aviso 7: el lote previo fue eliminado antes de anular', async () => {
    const t = await prepararVaca({ estado: 'SECA' });
    const previo = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Previo' } });
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { loteId: previo.id } });
    const partoId = await registrarParto(t.agente, t.vaca.id, '2026-11-01', [viva('E1')]);
    await t.agente.delete(`/api/lotes/${previo.id}`).expect(204);
    const res = await anularParto(t.agente, partoId).expect(200);
    expect(res.body.avisos).toEqual([
      { codigo: 'LOTE_PREVIO_ELIMINADO', mensaje: 'La vaca volvió a «seca» y quedó sin lote: su lote anterior ya no existe' },
    ]);
    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'SECA', loteId: null });
    // El historial sigue mostrando que el lote previo fue eliminado.
    const lista = (await t.agente.get(`/api/animales/${t.vaca.id}/eventos`).expect(200)).body.eventos;
    expect(lista[0].parto.loteAnterior).toBe('ELIMINADO');
  });

  it('la lista de eventos muestra la cría como "dada de baja" (activo false)', async () => {
    const t = await vacaConParto();
    await anularParto(t.agente, t.partoId).expect(200);
    const lista = (await t.agente.get(`/api/animales/${t.vaca.id}/eventos`).expect(200)).body.eventos;
    expect(lista[0].parto.crias[0].animal).toMatchObject({ numero: 'V1', activo: false });
    expect(lista[0].anulacion).toMatchObject({ por: 'Dueño' });
  });
});

describe('ya anulado y último evento (RF-25, RF-26)', () => {
  it('un parto ya anulado: 409', async () => {
    const t = await vacaConParto();
    await anularParto(t.agente, t.partoId).expect(200);
    expect((await anularParto(t.agente, t.partoId).expect(409)).body.error).toBe('Este parto ya fue anulado');
  });

  it('un secado ya anulado: 409', async () => {
    const t = await prepararVaca();
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    await anularSecado(t.agente, secadoId).expect(200);
    expect((await anularSecado(t.agente, secadoId).expect(409)).body.error).toBe('Este secado ya fue anulado');
  });

  it.each([
    ['servicio', 'Primero tenés que anular el servicio del 10/11/2026'],
    ['tacto', 'Primero tenés que anular el tacto del 10/11/2026'],
  ] as const)('el parto no es el último porque hay un %s posterior: 409 con qué anular primero', async (tipo, mensaje) => {
    const t = await vacaConParto();
    const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId, fecha: '2026-11-10' };
    if (tipo === 'servicio') await crearServicioDirecto(base);
    else await crearTactoDirecto({ ...base, resultado: 'VACIA' });
    const res = await anularParto(t.agente, t.partoId).expect(409);
    expect(res.body.error).toBe(mensaje);
    expect((await eventoDe(t.partoId)).anuladoEn).toBeNull();
    expect((await vacaDe(t.cria.id)).estado).toBe('RECIEN_NACIDO'); // no se dio de baja nada
  });

  it('el parto no es el último porque hay un secado posterior', async () => {
    const t = await vacaConParto({ estado: 'VAQUILLONA' });
    await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    expect((await anularParto(t.agente, t.partoId).expect(409)).body.error).toBe('Primero tenés que anular el secado del 05/11/2026');
  });

  it('el secado no es el último porque hay un parto posterior', async () => {
    const t = await prepararVaca();
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-01-05');
    await registrarParto(t.agente, t.vaca.id, '2026-11-01', [viva('P1')]);
    expect((await anularSecado(t.agente, secadoId).expect(409)).body.error).toBe('Primero tenés que anular el parto del 01/11/2026');
  });

  it('a igual fecha se anula primero el registrado después', async () => {
    const t = await prepararVaca();
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-01');
    const partoId = await registrarParto(t.agente, t.vaca.id, '2026-11-01', [viva('Q1')]);
    await anularSecado(t.agente, secadoId).expect(409);
    await anularParto(t.agente, partoId).expect(200);
    await anularSecado(t.agente, secadoId).expect(200);
  });
});

describe('orden de los rechazos 409 (RF-25 a RF-28)', () => {
  it('(1) ya anulado gana a (2) no es el último', async () => {
    const t = await vacaConParto();
    await anularParto(t.agente, t.partoId).expect(200);
    await crearServicioDirecto({ establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId, fecha: '2026-11-10' });
    expect((await anularParto(t.agente, t.partoId).expect(409)).body.error).toBe('Este parto ya fue anulado');
  });

  it('(2) no es el último gana a (3) estado actual distinto', async () => {
    const t = await vacaConParto({ estado: 'VAQUILLONA' });
    await registrarSecado(t.agente, t.vaca.id, '2026-11-05'); // la vaca queda "seca", distinto de lo que dejó el parto
    expect((await anularParto(t.agente, t.partoId).expect(409)).body.error).toMatch(/^Primero tenés que anular el secado/);
  });

  it('(2) no es el último gana a (4) cría con eventos propios', async () => {
    const t = await vacaConParto();
    await crearServicioDirecto({ establecimientoId: t.tambo, animalId: t.cria.id, registradoPorId: t.usuarioId, fecha: '2026-11-08' });
    await crearTactoDirecto({ establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId, fecha: '2026-11-10', resultado: 'VACIA' });
    expect((await anularParto(t.agente, t.partoId).expect(409)).body.error).toMatch(/^Primero tenés que anular el tacto/);
  });

  it('(3) estado actual distinto gana a (4) cría con eventos propios', async () => {
    const t = await vacaConParto();
    await crearServicioDirecto({ establecimientoId: t.tambo, animalId: t.cria.id, registradoPorId: t.usuarioId, fecha: '2026-11-08' });
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { estado: 'SECA' } });
    expect((await anularParto(t.agente, t.partoId).expect(409)).body.error).toMatch(/ya no está en estado «en ordeñe».*«seca»/);
  });

  it('(2) gana a (3) también en el secado', async () => {
    const t = await prepararVaca();
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    await crearTactoDirecto({ establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId, fecha: '2026-11-06', resultado: 'VACIA' });
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { estado: 'EN_ORDENE' } });
    expect((await anularSecado(t.agente, secadoId).expect(409)).body.error).toBe('Primero tenés que anular el tacto del 06/11/2026');
  });
});

describe('defensas sembradas directo en la base (RF-27, RF-28)', () => {
  it('estado actual distinto del que dejó el parto: 409 sin cambios', async () => {
    const t = await vacaConParto();
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { estado: 'VAQUILLONA' } });
    const res = await anularParto(t.agente, t.partoId).expect(409);
    expect(res.body.error).toBe('No se puede anular el parto del 01/11/2026: la vaca ya no está en estado «en ordeñe», ahora está «vaquillona»');
    expect((await eventoDe(t.partoId)).anuladoEn).toBeNull();
    expect((await vacaDe(t.cria.id)).estado).toBe('RECIEN_NACIDO');
    expect((await vacaDe(t.vaca.id)).estado).toBe('VAQUILLONA');
  });

  it('estado actual distinto del que dejó el secado: 409 sin cambios', async () => {
    const t = await prepararVaca();
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { estado: 'EN_ORDENE' } });
    const res = await anularSecado(t.agente, secadoId).expect(409);
    expect(res.body.error).toBe('No se puede anular el secado del 05/11/2026: la vaca ya no está en estado «seca», ahora está «en ordeñe»');
    expect((await eventoDe(secadoId)).anuladoEn).toBeNull();
  });

  it('una cría que ya no está activa: 409 y no se da de baja la otra', async () => {
    const t = await prepararVaca();
    const partoId = await registrarParto(t.agente, t.vaca.id, '2026-11-01', [viva('A1'), viva('A2')]);
    const a1 = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: t.tambo, numero: 'A1' } });
    const a2 = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: t.tambo, numero: 'A2' } });
    // Dada de baja "por otra vía" (hoy no existe, llegará en la Etapa 3).
    await prisma.animal.update({ where: { id: a1.id }, data: { estado: 'BAJA', fechaBaja: new Date('2026-11-05'), motivoBaja: 'PARTO_ANULADO', loteId: null } });
    const res = await anularParto(t.agente, partoId).expect(409);
    expect(res.body.error).toBe('No se puede anular el parto: la cría N.º A1 ya no está activa');
    expect((await vacaDe(a2.id)).estado).toBe('RECIEN_NACIDO');
    expect((await eventoDe(partoId)).anuladoEn).toBeNull();
    expect((await vacaDe(t.vaca.id)).estado).toBe('EN_ORDENE');
  });

  it('una cría con un evento propio no anulado: 409 aunque la otra esté limpia, sin dar de baja ninguna', async () => {
    const t = await prepararVaca();
    const partoId = await registrarParto(t.agente, t.vaca.id, '2026-11-01', [viva('B1'), viva('B2')]);
    const b2 = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: t.tambo, numero: 'B2' } });
    await crearTactoDirecto({ establecimientoId: t.tambo, animalId: b2.id, registradoPorId: t.usuarioId, fecha: '2026-11-08', resultado: 'VACIA' });
    const res = await anularParto(t.agente, partoId).expect(409);
    expect(res.body.error).toBe('No se puede anular el parto: la cría N.º B2 tiene eventos registrados, primero hay que anularlos');
    expect(await prisma.animal.count({ where: { establecimientoId: t.tambo, estado: 'BAJA' } })).toBe(0);
    expect((await eventoDe(partoId)).anuladoEn).toBeNull();
  });

  it('un evento propio ya anulado de la cría no impide anular', async () => {
    const t = await vacaConParto();
    await crearTactoDirecto({
      establecimientoId: t.tambo,
      animalId: t.cria.id,
      registradoPorId: t.usuarioId,
      fecha: '2026-11-08',
      resultado: 'VACIA',
      anulacion: { porId: t.usuarioId, motivo: 'error' },
    });
    await anularParto(t.agente, t.partoId).expect(200);
    expect((await vacaDe(t.cria.id)).estado).toBe('BAJA');
  });

  it('una cría que es madre de animales activos: 409', async () => {
    const t = await vacaConParto();
    await crearAnimalDirecto(t.tambo, 'NIETA', { estado: 'RECIEN_NACIDO', madreId: t.cria.id });
    const res = await anularParto(t.agente, t.partoId).expect(409);
    expect(res.body.error).toBe('No se puede anular el parto: la cría N.º V1 es madre de animales activos');
    expect((await vacaDe(t.cria.id)).estado).toBe('RECIEN_NACIDO');
  });

  it('una cría que es madre solo de animales de baja: se puede anular', async () => {
    const t = await vacaConParto();
    await crearBajaDirecta(t.tambo, 'NIETA', { madreId: t.cria.id });
    await anularParto(t.agente, t.partoId).expect(200);
  });
});

describe('motivo (RF-29)', () => {
  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['ausente', AUSENTE],
    ['no es texto', 5],
    ['de 201 caracteres', 'a'.repeat(201)],
  ])('motivo %s: 400 y no cambia nada', async (_caso, motivo) => {
    const t = await vacaConParto();
    const res = await anularParto(t.agente, t.partoId, motivo).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/motivo/i);
    expect((await eventoDe(t.partoId)).anuladoEn).toBeNull();
    expect((await vacaDe(t.cria.id)).estado).toBe('RECIEN_NACIDO');
  });

  it('de 200 caracteres se acepta (secado)', async () => {
    const t = await prepararVaca();
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    await anularSecado(t.agente, secadoId, 'ñ'.repeat(200)).expect(200);
  });

  it('un cuerpo inválido con un evento inexistente: 400 (el cuerpo gana sobre la búsqueda)', async () => {
    const { agente } = await prepararVaca();
    await anularParto(agente, ID_INEXISTENTE, '').expect(400);
    await anularSecado(agente, 'no-es-un-uuid', AUSENTE).expect(400);
  });
});

describe('"no encontrado" (RF-29, RF-41)', () => {
  it('inexistente, mal formado, de otro tambo, de otro tipo y de un animal de baja: el mismo 404', async () => {
    const t = await vacaConParto();
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    const servicio = await crearServicioDirecto({ establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId, fecha: '2026-11-06' });
    const ajeno = await prepararVaca({ nombreTambo: 'Ajeno', email: 'ajeno@prueba.test' });
    const partoAjeno = await crearPartoDirecto({ establecimientoId: ajeno.tambo, animalId: ajeno.vaca.id, registradoPorId: ajeno.usuarioId, fecha: '2026-08-01' });
    const secadoAjeno = await crearSecadoDirecto({ establecimientoId: ajeno.tambo, animalId: ajeno.vaca.id, registradoPorId: ajeno.usuarioId, fecha: '2026-09-01' });

    const respuestas = [
      (await anularParto(t.agente, ID_INEXISTENTE).expect(404)).body,
      (await anularParto(t.agente, 'no-es-un-uuid').expect(404)).body,
      (await anularSecado(t.agente, ID_INEXISTENTE).expect(404)).body,
      (await anularSecado(t.agente, 'no-es-un-uuid').expect(404)).body,
      (await anularParto(t.agente, partoAjeno.id).expect(404)).body, // de otro tambo
      (await anularSecado(t.agente, secadoAjeno.id).expect(404)).body,
      (await anularParto(t.agente, secadoId).expect(404)).body, // un secado por la ruta de partos
      (await anularSecado(t.agente, t.partoId).expect(404)).body, // un parto por la ruta de secados
      (await anularParto(t.agente, servicio.id).expect(404)).body, // un servicio
    ];
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { estado: 'BAJA', fechaBaja: new Date('2026-11-01'), motivoBaja: 'PARTO_ANULADO', loteId: null } });
    respuestas.push((await anularParto(t.agente, t.partoId).expect(404)).body);
    expect(new Set(respuestas.map((r) => JSON.stringify(r))).size).toBe(1);
    // Nada de lo ajeno cambió.
    expect((await eventoDe(partoAjeno.id)).anuladoEn).toBeNull();
    expect((await eventoDe(secadoAjeno.id)).anuladoEn).toBeNull();
  });

  it('el dueño de otro tambo no puede anular: 404 y no cambia nada', async () => {
    const t = await vacaConParto();
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    await anularParto(otro.agente, t.partoId).expect(404);
    expect((await eventoDe(t.partoId)).anuladoEn).toBeNull();
    expect((await vacaDe(t.cria.id)).estado).toBe('RECIEN_NACIDO');
  });

  it('un establecimientoId en el cuerpo se ignora', async () => {
    const t = await vacaConParto();
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    await t.agente
      .post(`/api/partos/${t.partoId}/anular`)
      .send({ motivo: 'Error', establecimientoId: otro.perfil.establecimiento.id })
      .expect(200);
    expect((await eventoDe(t.partoId)).establecimientoId).toBe(t.tambo);
  });
});

describe('permisos (RF-42)', () => {
  it('sin sesión: 401, también con JSON roto', async () => {
    const t = await vacaConParto();
    await request(app).post(`/api/partos/${t.partoId}/anular`).send({ motivo: 'x' }).expect(401);
    await request(app).post(`/api/partos/${t.partoId}/anular`).set('Content-Type', 'application/json').send('{roto').expect(401);
    await request(app).post(`/api/secados/${t.partoId}/anular`).set('Content-Type', 'application/json').send('{roto').expect(401);
  });

  it('el veterinario recibe 403 antes de buscar el evento: válido, motivo inválido, JSON roto, inexistente, mal formado y ajeno', async () => {
    const t = await vacaConParto();
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    const vet = await crearUsuario(t.agente, 'VETERINARIO', 'vet@prueba.test');
    const ajeno = await prepararVaca({ nombreTambo: 'Ajeno', email: 'ajeno@prueba.test' });
    const partoAjeno = await crearPartoDirecto({ establecimientoId: ajeno.tambo, animalId: ajeno.vaca.id, registradoPorId: ajeno.usuarioId, fecha: '2026-08-01' });

    await vet.post(`/api/secados/${secadoId}/anular`).send({ motivo: 'x' }).expect(403);
    await vet.post(`/api/partos/${t.partoId}/anular`).send({ motivo: 'x' }).expect(403);
    await vet.post(`/api/partos/${t.partoId}/anular`).send({ motivo: '' }).expect(403);
    await vet.post(`/api/partos/${t.partoId}/anular`).set('Content-Type', 'application/json').send('{roto').expect(403);
    await vet.post(`/api/secados/${secadoId}/anular`).set('Content-Type', 'application/json').send('{roto').expect(403);
    await vet.post(`/api/partos/${ID_INEXISTENTE}/anular`).send({ motivo: 'x' }).expect(403);
    await vet.post('/api/secados/no-es-un-uuid/anular').send({ motivo: 'x' }).expect(403);
    await vet.post(`/api/partos/${partoAjeno.id}/anular`).send({ motivo: 'x' }).expect(403);
    expect((await eventoDe(secadoId)).anuladoEn).toBeNull();
    expect((await eventoDe(t.partoId)).anuladoEn).toBeNull();
  });

  it('el encargado puede anular un secado y un parto', async () => {
    const t = await vacaConParto();
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    const encargado = await crearUsuario(t.agente, 'ENCARGADO', 'enc@prueba.test');
    const res = await anularSecado(encargado, secadoId).expect(200);
    expect(res.body.evento.anulacion.por).toBe('Usuario ENCARGADO');
    await anularParto(encargado, t.partoId).expect(200);
  });
});

describe('quién anuló y datos sensibles (RF-38)', () => {
  it('la respuesta y la lista muestran solo el nombre, sin hashes ni emails', async () => {
    const t = await vacaConParto();
    const res = await anularParto(t.agente, t.partoId).expect(200);
    const lista = await t.agente.get(`/api/animales/${t.vaca.id}/eventos`).expect(200);
    for (const cuerpo of [res.body, lista.body]) {
      expect(JSON.stringify(cuerpo)).not.toMatch(/hash|argon|dueno@prueba|email|password/i);
    }
  });
});

describe('aviso 8: se descartó un lote puesto a mano después del evento (spec 005, RF-13)', () => {
  const moverA = (agente: Agente, vacaId: string, loteId: string | null) =>
    agente.patch(`/api/animales/${vacaId}/lote`).send({ loteId }).expect(200);

  it('secado y movimiento manual posterior: vuelve al lote previo del evento y avisa', async () => {
    const t = await prepararVaca();
    const ordene = await loteDe(t.tambo, 'En ordeñe');
    const enfermeria = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Enfermería' } });
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { loteId: ordene.id } });
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    await moverA(t.agente, t.vaca.id, enfermeria.id);

    const res = await anularSecado(t.agente, secadoId).expect(200);
    expect(res.body.avisos).toEqual([
      {
        codigo: 'LOTE_MANUAL_DESCARTADO',
        mensaje: 'La vaca volvió al lote «En ordeñe» y se descartó el lote que se le había puesto a mano después del secado del 05/11/2026',
      },
    ]);
    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'EN_ORDENE', loteId: ordene.id });
  });

  it('parto y movimiento manual posterior: el aviso nombra al parto', async () => {
    const t = await vacaConParto();
    const enfermeria = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Enfermería' } });
    await moverA(t.agente, t.vaca.id, enfermeria.id);
    const res = await anularParto(t.agente, t.partoId).expect(200);
    expect(res.body.avisos).toEqual([
      {
        codigo: 'LOTE_MANUAL_DESCARTADO',
        mensaje: 'La vaca volvió al lote «Secas» y se descartó el lote que se le había puesto a mano después del parto del 01/11/2026',
      },
    ]);
  });

  it('sin movimiento manual, o con uno anterior al evento: sin aviso', async () => {
    const t = await prepararVaca();
    const ordene = await loteDe(t.tambo, 'En ordeñe');
    const enfermeria = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Enfermería' } });
    await moverA(t.agente, t.vaca.id, enfermeria.id); // antes del evento
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    const res = await anularSecado(t.agente, secadoId).expect(200);
    expect(res.body.avisos).toEqual([]);
    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'EN_ORDENE', loteId: enfermeria.id });
    expect(ordene.id).not.toBe(enfermeria.id);
  });

  it('movimiento manual posterior que deja a la vaca en el mismo lote que el previo: sin aviso', async () => {
    const t = await prepararVaca();
    const ordene = await loteDe(t.tambo, 'En ordeñe');
    const otro = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Otro' } });
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { loteId: ordene.id } });
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    await moverA(t.agente, t.vaca.id, otro.id);
    await moverA(t.agente, t.vaca.id, ordene.id); // vuelve a mano al lote previo
    const res = await anularSecado(t.agente, secadoId).expect(200);
    expect(res.body.avisos).toEqual([]);
  });

  it('sin lote previo: avisa con "sin lote", después del aviso 6', async () => {
    const t = await prepararVaca(); // sin lote
    const enfermeria = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Enfermería' } });
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    await moverA(t.agente, t.vaca.id, enfermeria.id);
    const res = await anularSecado(t.agente, secadoId).expect(200);
    expect(res.body.avisos.map((a: { codigo: string }) => a.codigo)).toEqual(['SIN_LOTE_PREVIO', 'LOTE_MANUAL_DESCARTADO']);
    expect(res.body.avisos[1].mensaje).toBe(
      'La vaca quedó sin lote y se descartó el lote que se le había puesto a mano después del secado del 05/11/2026',
    );
    expect(await vacaDe(t.vaca.id)).toMatchObject({ estado: 'EN_ORDENE', loteId: null });
  });

  it('lote previo eliminado: avisa después del aviso 7', async () => {
    const t = await prepararVaca();
    const previo = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Previo' } });
    const enfermeria = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Enfermería' } });
    await prisma.animal.update({ where: { id: t.vaca.id }, data: { loteId: previo.id } });
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    await moverA(t.agente, t.vaca.id, enfermeria.id);
    await t.agente.delete(`/api/lotes/${previo.id}`).expect(204);
    const res = await anularSecado(t.agente, secadoId).expect(200);
    expect(res.body.avisos.map((a: { codigo: string }) => a.codigo)).toEqual(['LOTE_PREVIO_ELIMINADO', 'LOTE_MANUAL_DESCARTADO']);
  });

  it('el aviso no se guarda en la base y el historial conserva el movimiento manual', async () => {
    const t = await prepararVaca();
    const enfermeria = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Enfermería' } });
    const secadoId = await registrarSecado(t.agente, t.vaca.id, '2026-11-05');
    await moverA(t.agente, t.vaca.id, enfermeria.id);
    await anularSecado(t.agente, secadoId).expect(200);
    // La vuelta automática no entra al historial: solo el movimiento manual.
    expect(await prisma.cambioAnimal.count({ where: { animalId: t.vaca.id, campo: 'LOTE' } })).toBe(1);
  });
});
