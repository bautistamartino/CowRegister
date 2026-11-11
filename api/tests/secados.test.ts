import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import {
  app,
  crearAnimalDirecto,
  crearPartoDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
  registrarTambo,
  verificarInvariantes,
} from './ayudas.js';

// Tests de POST /api/animales/:id/secados: RF-18 a RF-21, RF-41 y RF-42 (spec 004).

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';

type Agente = ReturnType<typeof request.agent>;
const url = (animalId: string) => `/api/animales/${animalId}/secados`;
const loteDe = (establecimientoId: string, nombre: string) => prisma.lote.findFirstOrThrow({ where: { establecimientoId, nombre } });
const situacionDe = async (agente: Agente, animalId: string) =>
  (await agente.get(`/api/animales/${animalId}/eventos`).expect(200)).body.situacion;

describe('registrar un secado (RF-18)', () => {
  it('una vaca en ordeñe: 201, pasa a "seca" y a su lote, y el secado guarda el estado y el lote previos', async () => {
    const { agente, tambo, vaca, usuarioId } = await prepararVaca();
    const ordene = await loteDe(tambo, 'En ordeñe');
    await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: ordene.id } });

    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-05' }).expect(201);
    expect(res.body.avisos).toEqual([]);
    expect(res.body.evento).toMatchObject({
      tipo: 'SECADO',
      fecha: '2026-11-05',
      registradoPor: 'Dueño',
      anulacion: null,
      secado: { estadoAnterior: 'EN_ORDENE', loteAnterior: { id: ordene.id, nombre: 'En ordeñe' } },
    });
    const despues = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(despues).toMatchObject({ estado: 'SECA', loteId: (await loteDe(tambo, 'Secas')).id });
    const secado = await prisma.secado.findUniqueOrThrow({ where: { eventoId: res.body.evento.id } });
    expect(secado).toMatchObject({ estadoAnterior: 'EN_ORDENE', tuvoLoteAnterior: true, loteAnteriorId: ordene.id });
    const evento = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.evento.id } });
    expect(evento.registradoPorId).toBe(usuarioId);
    expect(await verificarInvariantes()).toEqual([]);
  });

  it('una vaca sin lote previo: se guarda como "sin lote previo"', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-05' }).expect(201);
    expect(res.body.evento.secado.loteAnterior).toBe('SIN_LOTE');
  });

  it('es libre: se acepta preñada y no preñada, y no cambia el estado reproductivo', async () => {
    const a = await prepararVaca({ nombreTambo: 'A', email: 'a@prueba.test' });
    const baseA = { establecimientoId: a.tambo, animalId: a.vaca.id, registradoPorId: a.usuarioId };
    await crearServicioDirecto({ ...baseA, fecha: '2026-03-01' });
    await crearTactoDirecto({ ...baseA, fecha: '2026-05-01', resultado: 'PRENADA' });
    const antes = await situacionDe(a.agente, a.vaca.id);
    expect(antes.estado).toBe('PRENADA');
    await a.agente.post(url(a.vaca.id)).send({ fecha: '2026-09-01' }).expect(201);
    expect(await situacionDe(a.agente, a.vaca.id)).toEqual(antes);

    const b = await prepararVaca({ nombreTambo: 'B', email: 'b@prueba.test' });
    await b.agente.post(url(b.vaca.id)).send({ fecha: '2026-09-01' }).expect(201);
    expect((await situacionDe(b.agente, b.vaca.id)).estado).toBe('SIN_SERVICIO');
  });

  it('un secado después de un parto cuenta como último evento y no reinicia el ciclo', async () => {
    const { agente, tambo, vaca, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearPartoDirecto({ ...base, fecha: '2026-03-01' });
    await agente.post(`/api/animales/${vaca.id}/servicios`).send({ fecha: '2026-04-20', tipo: 'INSEMINACION' }).expect(201);
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-20' }).expect(201);
    expect((await situacionDe(agente, vaca.id)).estado).toBe('SERVIDA');
  });
});

describe('quién no se puede secar (RF-19)', () => {
  it.each([
    ['seca', { estado: 'SECA' as const }, /seca/i],
    ['vaquillona', { estado: 'VAQUILLONA' as const }, /vaquillona/i],
    ['recién nacida', { estado: 'RECIEN_NACIDO' as const }, /recién nacido/i],
  ])('una %s: 409 con el estado actual y nada cambia', async (_n, opciones, patron) => {
    const { agente, tambo, vaca } = await prepararVaca(opciones);
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-05' }).expect(409);
    expect(res.body.error).toMatch(patron);
    expect(await prisma.secado.count({ where: { establecimientoId: tambo } })).toBe(0);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe(opciones.estado);
  });

  it('un macho: 409', async () => {
    const { agente, vaca } = await prepararVaca({ sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-05' }).expect(409);
    expect(res.body.error).toMatch(/macho/i);
  });

  it('un animal de baja, de otro tambo, inexistente o con id mal formado: el mismo 404', async () => {
    const { agente, tambo } = await prepararVaca();
    const baja = await crearAnimalDirecto(tambo, '9', { estado: 'BAJA' });
    const ajeno = await prepararVaca({ nombreTambo: 'Ajeno', email: 'ajeno@prueba.test' });
    const respuestas = [
      await agente.post(url(baja.id)).send({ fecha: '2026-11-05' }).expect(404),
      await agente.post(url(ajeno.vaca.id)).send({ fecha: '2026-11-05' }).expect(404),
      await agente.post(url(ID_INEXISTENTE)).send({ fecha: '2026-11-05' }).expect(404),
      await agente.post(url('no-es-un-id')).send({ fecha: '2026-11-05' }).expect(404),
    ];
    expect(new Set(respuestas.map((r) => r.body.error)).size).toBe(1);
  });
});

describe('fechas (RF-21)', () => {
  it('formato inválido, inexistente, ausente, futura (reloj fijo) y anterior a 2000: 400 con la fecha como campo', async () => {
    const { agente, vaca } = await prepararVaca();
    for (const cuerpo of [{ fecha: '05/11/2026' }, { fecha: '2026-02-30' }, {}, { fecha: '2026-11-12' }, { fecha: '1999-12-31' }]) {
      const res = await agente.post(url(vaca.id)).send(cuerpo).expect(400);
      expect(typeof res.body.error).toBe('string');
    }
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('EN_ORDENE');
  });

  it('no puede ser anterior al último evento de ninguno de los cuatro tipos; igual fecha se acepta', async () => {
    const { agente, tambo, vaca, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearPartoDirecto({ ...base, fecha: '2026-10-01' });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-09-30' }).expect(400);
    expect(res.body.detalles[0].campo).toBe('fecha');
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01' }).expect(201);
  });

  it('no puede ser anterior al nacimiento de la vaca', async () => {
    const { agente, vaca } = await prepararVaca({ fechaNacimiento: '2024-05-10' });
    await agente.post(url(vaca.id)).send({ fecha: '2024-05-09' }).expect(400);
  });

  it('la fecha inválida gana al 409 de estado (400 antes que 409)', async () => {
    const { agente, vaca } = await prepararVaca({ estado: 'SECA' });
    await agente.post(url(vaca.id)).send({ fecha: '2026-11-12' }).expect(400);
  });
});

describe('lote destino sin configurar (RF-20)', () => {
  it('sin regla para "seca": se guarda, la vaca queda sin lote y viene el aviso 2', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await prisma.reglaLote.deleteMany({ where: { establecimientoId: tambo, estado: 'SECA' } });
    const ordene = await loteDe(tambo, 'En ordeñe');
    await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: ordene.id } });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-05' }).expect(201);
    expect(res.body.avisos).toEqual([
      { codigo: 'SIN_LOTE_MADRE_SECA', mensaje: 'La vaca quedó sin lote: el estado «seca» no tiene un lote asignado' },
    ]);
    const despues = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(despues).toMatchObject({ estado: 'SECA', loteId: null });
    // Igual guarda el lote previo para poder volver atrás.
    expect((await prisma.secado.findUniqueOrThrow({ where: { eventoId: res.body.evento.id } })).loteAnteriorId).toBe(ordene.id);
  });
});

describe('permisos, aislamiento y orden de controles (RF-41, RF-42)', () => {
  it('sin sesión: 401, también con JSON roto', async () => {
    await request(app).post(url(ID_INEXISTENTE)).send({ fecha: '2026-11-05' }).expect(401);
    await request(app).post(url(ID_INEXISTENTE)).set('Content-Type', 'application/json').send('{roto').expect(401);
  });

  it('el veterinario recibe 403 con datos válidos, inválidos, JSON roto, animal inexistente y ajeno', async () => {
    const { agente, vaca } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const ajeno = await prepararVaca({ nombreTambo: 'Ajeno', email: 'ajeno@prueba.test' });
    await vet.post(url(vaca.id)).send({ fecha: '2026-11-05' }).expect(403);
    await vet.post(url(vaca.id)).send({ fecha: 'mala' }).expect(403);
    await vet.post(url(vaca.id)).set('Content-Type', 'application/json').send('{roto').expect(403);
    await vet.post(url(ID_INEXISTENTE)).send({ fecha: '2026-11-05' }).expect(403);
    await vet.post(url(ajeno.vaca.id)).send({ fecha: '2026-11-05' }).expect(403);
    expect(await prisma.secado.count()).toBe(0);
  });

  it('el encargado puede', async () => {
    const { agente, vaca } = await prepararVaca();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');
    await encargado.post(url(vaca.id)).send({ fecha: '2026-11-05' }).expect(201);
  });

  it('aislamiento: el dueño de otro tambo recibe 404 y nada cambia', async () => {
    const a = await prepararVaca({ nombreTambo: 'A', email: 'a@prueba.test' });
    const b = await registrarTambo('B', 'b@prueba.test');
    await b.agente.post(url(a.vaca.id)).send({ fecha: '2026-11-05' }).expect(404);
    expect(await prisma.secado.count()).toBe(0);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: a.vaca.id } })).estado).toBe('EN_ORDENE');
  });

  it('un establecimientoId en el cuerpo se ignora', async () => {
    const a = await prepararVaca({ nombreTambo: 'A', email: 'a@prueba.test' });
    const b = await registrarTambo('B', 'b@prueba.test');
    const res = await a.agente.post(url(a.vaca.id)).send({ fecha: '2026-11-05', establecimientoId: b.perfil.establecimiento.id }).expect(201);
    const evento = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.evento.id } });
    expect(evento.establecimientoId).toBe(a.tambo);
    expect(JSON.stringify(res.body)).not.toMatch(/hash|dueno@prueba|email/i);
  });
});
