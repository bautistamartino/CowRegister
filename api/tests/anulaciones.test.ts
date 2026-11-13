import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import {
  app,
  crearPartoDirecto,
  crearSecadoDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
  registrarTambo,
} from './ayudas.js';

// Tests de POST /api/servicios/:id/anular y /api/tactos/:id/anular: RF-19 a RF-21, RF-27, RF-28.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';

type Agente = ReturnType<typeof request.agent>;
// AUSENTE manda el cuerpo sin la clave motivo (un valor undefined usaría el motivo por defecto).
const AUSENTE = Symbol('ausente');
const cuerpoMotivo = (motivo: unknown) => (motivo === AUSENTE ? {} : { motivo });
const anularServicio = (agente: Agente, id: string, motivo: unknown = 'Lo cargué mal') =>
  agente.post(`/api/servicios/${id}/anular`).send(cuerpoMotivo(motivo));
const anularTacto = (agente: Agente, id: string, motivo: unknown = 'Lo cargué mal') =>
  agente.post(`/api/tactos/${id}/anular`).send(cuerpoMotivo(motivo));
const situacionDe = async (agente: Agente, animalId: string) =>
  (await agente.get(`/api/animales/${animalId}/eventos`).expect(200)).body.situacion;

// Una vaca con un servicio y un tacto "preñada" (el tacto es el último evento).
async function vacaServidaYPrenada() {
  const t = await prepararVaca();
  const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
  const servicio = await crearServicioDirecto({ ...base, fecha: '2026-03-01' });
  const tacto = await crearTactoDirecto({ ...base, fecha: '2026-05-01', resultado: 'PRENADA' });
  return { ...t, base, servicio, tacto };
}

describe('anular el último evento (RF-19)', () => {
  it('anula un tacto: queda guardado con quién, cuándo y el motivo, y la situación se recalcula', async () => {
    const { agente, vaca, tacto, usuarioId } = await vacaServidaYPrenada();
    expect((await situacionDe(agente, vaca.id)).estado).toBe('PRENADA');

    const res = await anularTacto(agente, tacto.id, '  Tacto de otra vaca  ').expect(200);
    expect(res.body).toMatchObject({ id: tacto.id, tipo: 'TACTO', anulacion: { motivo: 'Tacto de otra vaca', por: 'Dueño' } });
    expect(typeof res.body.anulacion.en).toBe('string');

    const guardado = await prisma.evento.findUniqueOrThrow({ where: { id: tacto.id } });
    expect(guardado.anuladoPorId).toBe(usuarioId);
    expect(guardado.anuladoEn).not.toBeNull();
    expect(guardado.motivoAnulacion).toBe('Tacto de otra vaca');
    expect(await prisma.tacto.count({ where: { eventoId: tacto.id } })).toBe(1); // no se borra
    expect((await situacionDe(agente, vaca.id)).estado).toBe('SERVIDA');
  });

  it('anula un servicio y después, de a uno, el anterior', async () => {
    const t = await prepararVaca();
    const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
    const s1 = await crearServicioDirecto({ ...base, fecha: '2026-08-01' });
    const s2 = await crearServicioDirecto({ ...base, fecha: '2026-09-01' });
    await anularServicio(t.agente, s2.id).expect(200);
    await anularServicio(t.agente, s1.id).expect(200);
    expect((await situacionDe(t.agente, t.vaca.id)).estado).toBe('SIN_SERVICIO');
  });

  it('un tacto "vacía" anulado: vuelve a valer el estado anterior; estado y lote del animal no cambian (RF-21)', async () => {
    const t = await vacaServidaYPrenada();
    const vacia = await crearTactoDirecto({ ...t.base, fecha: '2026-07-01', resultado: 'VACIA' });
    expect((await situacionDe(t.agente, t.vaca.id)).estado).toBe('VACIA');
    await anularTacto(t.agente, vacia.id).expect(200);
    const situacion = await situacionDe(t.agente, t.vaca.id);
    expect(situacion.estado).toBe('PRENADA');
    expect(situacion.fechaProbableParto.fecha).toBe('2026-12-09');
    const animal = await prisma.animal.findUniqueOrThrow({ where: { id: t.vaca.id } });
    expect(animal.estado).toBe('EN_ORDENE');
    expect(animal.loteId).toBeNull();
  });

  it('el motivo de 200 caracteres se acepta', async () => {
    const { agente, tacto } = await vacaServidaYPrenada();
    await anularTacto(agente, tacto.id, 'ñ'.repeat(200)).expect(200);
  });
});

describe('solo el último evento no anulado (RF-20)', () => {
  it('uno anterior: 409 con el evento que hay que anular primero', async () => {
    const { agente, servicio, tacto } = await vacaServidaYPrenada();
    const res = await anularServicio(agente, servicio.id).expect(409);
    expect(res.body.error).toBe('Primero tenés que anular el tacto del 01/05/2026');
    const guardado = await prisma.evento.findUniqueOrThrow({ where: { id: servicio.id } });
    expect(guardado.anuladoEn).toBeNull();
    await anularTacto(agente, tacto.id).expect(200);
    await anularServicio(agente, servicio.id).expect(200);
  });

  it('nombra al servicio cuando es el último', async () => {
    const t = await prepararVaca();
    const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
    const tacto = await crearTactoDirecto({ ...base, fecha: '2026-05-01', resultado: 'VACIA' });
    await crearServicioDirecto({ ...base, fecha: '2026-06-10' });
    const res = await anularTacto(t.agente, tacto.id).expect(409);
    expect(res.body.error).toBe('Primero tenés que anular el servicio del 10/06/2026');
  });

  it('a igual fecha se anula primero el registrado después', async () => {
    const t = await prepararVaca();
    const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
    const a = await crearServicioDirecto({ ...base, fecha: '2026-08-01' });
    const b = await crearServicioDirecto({ ...base, fecha: '2026-08-01' });
    await anularServicio(t.agente, a.id).expect(409);
    await anularServicio(t.agente, b.id).expect(200);
    await anularServicio(t.agente, a.id).expect(200);
  });

  it('ya anulado: 409', async () => {
    const { agente, tacto } = await vacaServidaYPrenada();
    await anularTacto(agente, tacto.id).expect(200);
    // Spec 010: el mismo usuario con el mismo motivo es una repetición aceptada; con otro motivo, 409.
    const res = await anularTacto(agente, tacto.id, 'Otro motivo').expect(409);
    expect(res.body.error).toMatch(/ya fue anulado/i);
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['ausente', AUSENTE],
    ['no es texto', 5],
    ['de 201 caracteres', 'a'.repeat(201)],
  ])('motivo %s: 400', async (_caso, motivo) => {
    const { agente, tacto } = await vacaServidaYPrenada();
    const res = await anularTacto(agente, tacto.id, motivo).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/motivo/i);
    expect((await prisma.evento.findUniqueOrThrow({ where: { id: tacto.id } })).anuladoEn).toBeNull();
  });
});

describe('último evento de la spec 004: parto y secado (RF-26)', () => {
  // Una vaca con un servicio, un tacto y, después, un parto o un secado como último evento.
  async function vacaConUltimo(tipo: 'PARTO' | 'SECADO') {
    const t = await vacaServidaYPrenada();
    if (tipo === 'PARTO') await crearPartoDirecto({ ...t.base, fecha: '2026-11-01' });
    else await crearSecadoDirecto({ ...t.base, fecha: '2026-11-01' });
    return t;
  }

  it.each([
    ['PARTO', 'Primero tenés que anular el parto del 01/11/2026'],
    ['SECADO', 'Primero tenés que anular el secado del 01/11/2026'],
  ] as const)('dueño: con un %s posterior, el mensaje dice qué anular primero', async (tipo, mensaje) => {
    const { agente, servicio, tacto } = await vacaConUltimo(tipo);
    expect((await anularTacto(agente, tacto.id).expect(409)).body.error).toBe(mensaje);
    expect((await anularServicio(agente, servicio.id).expect(409)).body.error).toBe(mensaje);
  });

  it.each([
    ['PARTO', 'Primero hay que anular el parto del 01/11/2026; lo tiene que hacer un dueño o encargado'],
    ['SECADO', 'Primero hay que anular el secado del 01/11/2026; lo tiene que hacer un dueño o encargado'],
  ] as const)('veterinario: con un %s posterior, el mensaje dice que lo tiene que hacer un dueño o encargado', async (tipo, mensaje) => {
    const { agente, servicio, tacto } = await vacaConUltimo(tipo);
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    expect((await anularTacto(vet, tacto.id).expect(409)).body.error).toBe(mensaje);
    expect((await anularServicio(vet, servicio.id).expect(409)).body.error).toBe(mensaje);
    expect((await prisma.evento.findUniqueOrThrow({ where: { id: tacto.id } })).anuladoEn).toBeNull();
  });

  it('veterinario: si el que hay que anular primero es un servicio o tacto, mantiene el mensaje de la 003', async () => {
    const { agente, servicio } = await vacaServidaYPrenada();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    expect((await anularServicio(vet, servicio.id).expect(409)).body.error).toBe('Primero tenés que anular el tacto del 01/05/2026');
  });

  it('la respuesta de anular un servicio o un tacto sigue siendo el evento a secas (sin avisos)', async () => {
    const { agente, tacto } = await vacaServidaYPrenada();
    const res = await anularTacto(agente, tacto.id).expect(200);
    expect(res.body).toMatchObject({ id: tacto.id, tipo: 'TACTO' });
    expect(res.body.avisos).toBeUndefined();
  });
});

describe('"no encontrado" (RF-19, RF-27)', () => {
  it('inexistente, mal formado, de otro tambo, de otro tipo y de un animal de baja: el mismo 404', async () => {
    const { agente, servicio, tacto, vaca } = await vacaServidaYPrenada();
    const ajeno = await prepararVaca({ nombreTambo: 'Ajeno', email: 'ajeno@prueba.test' });
    const servicioAjeno = await crearServicioDirecto({
      establecimientoId: ajeno.tambo,
      animalId: ajeno.vaca.id,
      registradoPorId: ajeno.usuarioId,
      fecha: '2026-08-01',
    });
    const respuestas = [
      (await anularServicio(agente, ID_INEXISTENTE).expect(404)).body,
      (await anularServicio(agente, 'no-es-un-uuid').expect(404)).body,
      (await anularServicio(agente, servicioAjeno.id).expect(404)).body,
      (await anularServicio(agente, tacto.id).expect(404)).body, // un tacto por la ruta de servicios
      (await anularTacto(agente, servicio.id).expect(404)).body, // un servicio por la ruta de tactos
    ];
    await prisma.animal.update({ where: { id: vaca.id }, data: { estado: 'BAJA', fechaBaja: new Date('2026-11-01'), motivoBaja: 'PARTO_ANULADO' } });
    respuestas.push((await anularTacto(agente, tacto.id).expect(404)).body);
    expect(new Set(respuestas.map((r) => JSON.stringify(r))).size).toBe(1);
    expect((await prisma.evento.findUniqueOrThrow({ where: { id: servicioAjeno.id } })).anuladoEn).toBeNull();
  });

  it('un tambo no puede anular un evento de otro: 404 y no queda anulado', async () => {
    const { tacto } = await vacaServidaYPrenada();
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    await anularTacto(otro.agente, tacto.id).expect(404);
    expect((await prisma.evento.findUniqueOrThrow({ where: { id: tacto.id } })).anuladoEn).toBeNull();
  });

  it('un cuerpo inválido con un evento inexistente: 400 (el cuerpo gana sobre la búsqueda)', async () => {
    const { agente } = await prepararVaca();
    await anularTacto(agente, ID_INEXISTENTE, '').expect(400);
    await anularServicio(agente, 'no-es-un-uuid', AUSENTE).expect(400);
  });

  it('un establecimientoId en el cuerpo se ignora', async () => {
    const { agente, tacto, tambo } = await vacaServidaYPrenada();
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    await agente
      .post(`/api/tactos/${tacto.id}/anular`)
      .send({ motivo: 'Error', establecimientoId: otro.perfil.establecimiento.id })
      .expect(200);
    expect((await prisma.evento.findUniqueOrThrow({ where: { id: tacto.id } })).establecimientoId).toBe(tambo);
  });
});

describe('permisos (RF-28)', () => {
  it('sin sesión: 401, también con JSON roto', async () => {
    const { tacto } = await vacaServidaYPrenada();
    await request(app).post(`/api/tactos/${tacto.id}/anular`).send({ motivo: 'x' }).expect(401);
    await request(app).post(`/api/tactos/${tacto.id}/anular`).set('Content-Type', 'application/json').send('{roto').expect(401);
    await request(app).post(`/api/servicios/${tacto.id}/anular`).set('Content-Type', 'application/json').send('{roto').expect(401);
  });

  it.each(['ENCARGADO', 'VETERINARIO'] as const)('el %s puede anular', async (rol) => {
    const { agente, tacto } = await vacaServidaYPrenada();
    const agenteRol = await crearUsuario(agente, rol, `${rol.toLowerCase()}@prueba.test`);
    const res = await anularTacto(agenteRol, tacto.id).expect(200);
    expect(res.body.anulacion.por).toBe(`Usuario ${rol}`);
  });
});
