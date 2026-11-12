import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { crearAnimalDirecto, crearProduccionDirecta, crearUsuario, limpiarBase, prepararVaca, registrarTambo } from './ayudas.js';

// Spec 009: la carga de litros acepta `cargadoEnDispositivo`, la hora en que se cargó en la tablet
// (RF-26 a RF-28, RF-33, RF-50, RF-53). Es solo informativa: se guarda APARTE de `creadoEn`.
// Reloj del servidor fijado en las 12:00 de Argentina (15:00 UTC) del 11/11/2026.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';
const OK = { fecha: '2026-11-11', turno: 'manana', litros: '12.5' };
const url = (id: string) => `/api/animales/${id}/produccion`;
const leer = (id: string) => prisma.produccion.findUniqueOrThrow({ where: { id } });

describe('hora informativa de la tablet (RF-26)', () => {
  it('se guarda aparte de creadoEn, que sigue siendo la hora del servidor', async () => {
    const { agente, vaca } = await prepararVaca();
    const antes = Date.now();
    const res = await agente.post(url(vaca.id)).send({ ...OK, cargadoEnDispositivo: '2026-11-11T08:15:00-03:00' }).expect(201);
    const fila = await leer(res.body.id);
    expect(fila.cargadoEnDispositivo?.toISOString()).toBe('2026-11-11T11:15:00.000Z');
    // creadoEn es la hora REAL del servidor (no la de la tablet ni el reloj fijado).
    expect(fila.creadoEn.getTime()).toBeGreaterThanOrEqual(antes - 5000);
    // La respuesta no incluye el dato (es solo para consultar en la base).
    expect(res.body).not.toHaveProperty('cargadoEnDispositivo');
  });

  it('con una hora de la tablet de hace un año, creadoEn y el orden de la ficha no cambian', async () => {
    const { agente, vaca } = await prepararVaca();
    const a = await agente.post(url(vaca.id)).send({ ...OK, cargadoEnDispositivo: '2025-11-11T08:00:00-03:00' }).expect(201);
    const b = await agente.post(url(vaca.id)).send({ ...OK, turno: 'tarde', cargadoEnDispositivo: '2025-01-01T08:00:00-03:00' }).expect(201);
    const c = await agente.post(url(vaca.id)).send({ ...OK, fecha: '2026-11-10' }).expect(201);
    expect((await leer(a.body.id)).creadoEn.getFullYear()).toBeGreaterThanOrEqual(2026);
    const ficha = await agente.get(url(vaca.id)).expect(200);
    // Orden por fecha y turno (la tarde antes que la mañana); la hora de la tablet no cuenta.
    expect(ficha.body.registros.map((r: { id: string }) => r.id)).toEqual([b.body.id, a.body.id, c.body.id]);
    expect(ficha.body.registros[0].registradoEn).toBe((await leer(b.body.id)).creadoEn.toISOString());
  });

  it('el reenvío idempotente con el mismo id ignora el dato: devuelve lo ya guardado', async () => {
    const { agente, vaca } = await prepararVaca();
    const id = crypto.randomUUID();
    const primero = await agente.post(url(vaca.id)).send({ ...OK, id, cargadoEnDispositivo: '2026-11-11T08:00:00-03:00' }).expect(201);
    const segundo = await agente.post(url(vaca.id)).send({ ...OK, id, cargadoEnDispositivo: '2026-11-11T09:30:00-03:00' }).expect(201);
    expect(segundo.body).toEqual(primero.body);
    expect(await prisma.produccion.count()).toBe(1);
    // Queda el dato del primer envío: la repetición no modifica nada.
    expect((await leer(id)).cargadoEnDispositivo?.toISOString()).toBe('2026-11-11T11:00:00.000Z');
  });
});

describe('ausente, nulo o con formato inválido (RF-27)', () => {
  it('sin el campo o con null se guarda sin ese dato', async () => {
    const { agente, vaca } = await prepararVaca();
    const a = await agente.post(url(vaca.id)).send(OK).expect(201);
    const b = await agente.post(url(vaca.id)).send({ ...OK, turno: 'tarde', cargadoEnDispositivo: null }).expect(201);
    expect((await leer(a.body.id)).cargadoEnDispositivo).toBeNull();
    expect((await leer(b.body.id)).cargadoEnDispositivo).toBeNull();
  });

  it.each([
    ['texto cualquiera', 'ayer a la tarde'],
    ['solo la fecha', '2026-11-11'],
    ['sin zona horaria', '2026-11-11T08:15:00'],
    ['fecha imposible', '2026-02-31T08:15:00-03:00'],
    ['hora imposible', '2026-11-11T25:15:00-03:00'],
    ['texto vacío', ''],
    ['un número', 1762859700000],
    ['un objeto', {}],
  ])('%s da 400 con el mensaje en español y no guarda nada', async (_nombre, valor) => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ ...OK, cargadoEnDispositivo: valor }).expect(400);
    expect(res.body.detalles).toEqual([
      { campo: 'cargadoEnDispositivo', mensaje: 'La hora de carga de la tablet no es una fecha y hora válida' },
    ]);
    expect(await prisma.produccion.count()).toBe(0);
  });

  it('el formato inválido se rechaza antes de buscar la vaca (400 aunque no exista)', async () => {
    const { agente } = await prepararVaca();
    await agente.post(url(ID_INEXISTENTE)).send({ ...OK, cargadoEnDispositivo: 'nada' }).expect(400);
  });
});

describe('hora de la tablet fuera de rango: se guarda el litro sin el dato (RF-28)', () => {
  it('adelantada más de 5 minutos respecto del servidor: 201 y dato nulo', async () => {
    const { agente, vaca } = await prepararVaca();
    // El servidor "es" 15:00:00 UTC: 15:05:01 está 5 min 1 s adelantada.
    const res = await agente.post(url(vaca.id)).send({ ...OK, cargadoEnDispositivo: '2026-11-11T15:05:01Z' }).expect(201);
    expect((await leer(res.body.id)).cargadoEnDispositivo).toBeNull();
    expect(res.body.litros).toBe(12.5);
  });

  it('adelantada exactamente 5 minutos (o menos) se conserva', async () => {
    const { agente, vaca } = await prepararVaca();
    const a = await agente.post(url(vaca.id)).send({ ...OK, cargadoEnDispositivo: '2026-11-11T15:05:00Z' }).expect(201);
    const b = await agente.post(url(vaca.id)).send({ ...OK, turno: 'tarde', cargadoEnDispositivo: '2026-11-11T15:00:30Z' }).expect(201);
    expect((await leer(a.body.id)).cargadoEnDispositivo?.toISOString()).toBe('2026-11-11T15:05:00.000Z');
    expect((await leer(b.body.id)).cargadoEnDispositivo?.toISOString()).toBe('2026-11-11T15:00:30.000Z');
  });

  it('anterior al 01/01/2000: 201 y dato nulo; el 01/01/2000 a las 00:00 UTC se conserva', async () => {
    const { agente, vaca } = await prepararVaca();
    const a = await agente.post(url(vaca.id)).send({ ...OK, cargadoEnDispositivo: '1999-12-31T23:59:59Z' }).expect(201);
    const b = await agente.post(url(vaca.id)).send({ ...OK, turno: 'tarde', cargadoEnDispositivo: '2000-01-01T00:00:00Z' }).expect(201);
    expect((await leer(a.body.id)).cargadoEnDispositivo).toBeNull();
    expect((await leer(b.body.id)).cargadoEnDispositivo?.toISOString()).toBe('2000-01-01T00:00:00.000Z');
  });
});

describe('base de datos (RF-26)', () => {
  it('el CHECK impide una hora anterior al 2000 aunque se salte la API', async () => {
    const { tambo, vaca, usuarioId } = await prepararVaca();
    await expect(
      prisma.produccion.create({
        data: {
          establecimientoId: tambo,
          animalId: vaca.id,
          fecha: new Date('2026-11-11T00:00:00Z'),
          turno: 'MANANA',
          litrosDecimas: 100,
          registradoPorId: usuarioId,
          cargadoEnDispositivo: new Date('1999-01-01T00:00:00Z'),
        },
      }),
    ).rejects.toThrow(/producciones_hora_dispositivo_rango|check/i);
  });

  it('el disparador "solo se agrega" no deja modificar la hora de la tablet', async () => {
    const { tambo, vaca, usuarioId } = await prepararVaca();
    const fila = await prisma.produccion.create({
      data: {
        establecimientoId: tambo,
        animalId: vaca.id,
        fecha: new Date('2026-11-11T00:00:00Z'),
        turno: 'MANANA',
        litrosDecimas: 100,
        registradoPorId: usuarioId,
        cargadoEnDispositivo: new Date('2026-11-11T11:00:00Z'),
      },
    });
    // Anular completando las tres columnas es lo único permitido... pero sin tocar la hora.
    await expect(
      prisma.produccion.update({
        where: { id: fila.id },
        data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'x', cargadoEnDispositivo: new Date('2026-11-11T12:00:00Z') },
      }),
    ).rejects.toThrow(/solo se agrega/);
    // Anular sin tocarla sí se puede.
    await prisma.produccion.update({ where: { id: fila.id }, data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'x' } });
  });
});

describe('aislamiento y permisos (RF-33, RF-50, RF-53, RF-54)', () => {
  it('un animal de otro tambo y uno inexistente dan exactamente el mismo 404, también con el dato nuevo', async () => {
    const { agente } = await prepararVaca();
    const otro = await registrarTambo('Otro tambo', 'otro@prueba.test');
    const ajena = await crearAnimalDirecto(otro.perfil.establecimiento.id, '900');
    const cuerpo = { ...OK, cargadoEnDispositivo: '2026-11-11T08:15:00-03:00' };
    const deAjena = await agente.post(url(ajena.id)).send(cuerpo).expect(404);
    const deInexistente = await agente.post(url(ID_INEXISTENTE)).send(cuerpo).expect(404);
    expect(deAjena.body).toEqual(deInexistente.body);
    expect(await prisma.produccion.count()).toBe(0);
  });

  it('un establecimientoId del cuerpo se ignora: se guarda en el tambo de la sesión', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    const otro = await registrarTambo('Otro tambo', 'otro@prueba.test');
    const res = await agente
      .post(url(vaca.id))
      .send({ ...OK, establecimientoId: otro.perfil.establecimiento.id, cargadoEnDispositivo: '2026-11-11T08:15:00-03:00' })
      .expect(201);
    expect((await leer(res.body.id)).establecimientoId).toBe(tambo);
  });

  it('el veterinario recibe 403 con el mensaje exacto aunque mande el dato nuevo', async () => {
    const { agente, vaca } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const res = await vet.post(url(vaca.id)).send({ ...OK, cargadoEnDispositivo: '2026-11-11T08:15:00-03:00' }).expect(403);
    expect(res.body.error).toBe('Esta acción la tiene que hacer un dueño o encargado');
    expect(await prisma.produccion.count()).toBe(0);
  });

  it('sin sesión es 401', async () => {
    const { vaca } = await prepararVaca();
    const request = (await import('supertest')).default;
    const { app } = await import('./ayudas.js');
    await request(app).post(url(vaca.id)).send({ ...OK, cargadoEnDispositivo: '2026-11-11T08:15:00-03:00' }).expect(401);
  });
});

// La carga que ya existía (spec 008) no cambia: los registros sembrados a mano no tienen el dato.
describe('registros anteriores', () => {
  it('un registro sembrado sin el dato queda con cargadoEnDispositivo nulo', async () => {
    const { tambo, vaca, usuarioId } = await prepararVaca();
    const r = await crearProduccionDirecta({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-11-10' });
    expect((await leer(r.id)).cargadoEnDispositivo).toBeNull();
  });
});
