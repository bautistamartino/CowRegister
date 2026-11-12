import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { crearAnimalDirecto, crearProduccionDirecta, limpiarBase, prepararVaca } from './ayudas.js';

// Spec 008: pedidos simultáneos (RF-35 y RF-36). Cada carrera se repite varias veces y solo se
// aceptan los resultados posibles (no un orden fijo: depende de quién llegue primero a la base).
// Un fallo intermitente es un error real: no se reintenta.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const RONDAS = 8;
type Agente = ReturnType<typeof request.agent>;
type Respuesta = { status: number; body: any };

const OK = { fecha: '2026-11-11', turno: 'manana', litros: '12.5' };
const cargar = (agente: Agente, id: string, cuerpo: object = OK) => agente.post(`/api/animales/${id}/produccion`).send(cuerpo) as unknown as Promise<Respuesta>;
const anular = (agente: Agente, id: string, registroId: string) =>
  agente.post(`/api/animales/${id}/produccion/${registroId}/anular`).send({ motivo: 'Error de tipeo' }) as unknown as Promise<Respuesta>;
const ordenados = (rs: Respuesta[]) => rs.map((r) => r.status).sort((a, b) => a - b);

describe('carga × carga del mismo ordeño (RF-35)', () => {
  it('una 201 y la otra 409 (nunca 500), con un solo registro vigente', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      const rs = await Promise.all([cargar(agente, vaca.id), cargar(agente, vaca.id, { ...OK, litros: '7.0' })]);
      expect(ordenados(rs)).toEqual([201, 409]);
      expect(await prisma.produccion.count({ where: { animalId: vaca.id, anuladoEn: null } })).toBe(1);
    }
  });

  it('con el mismo id y los mismos datos las dos dan 201 y queda un solo registro (idempotencia)', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      const id = crypto.randomUUID();
      const rs = await Promise.all([cargar(agente, vaca.id, { ...OK, id }), cargar(agente, vaca.id, { ...OK, id })]);
      expect(ordenados(rs)).toEqual([201, 201]);
      expect(await prisma.produccion.count({ where: { animalId: vaca.id } })).toBe(1);
    }
  });
});

describe('carga × cambio de estado de la vaca (RF-35)', () => {
  it('o la carga se guarda y después se seca, o la carga da 409: nunca se guarda una carga de una vaca ya seca', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      const [carga, secado] = await Promise.all([
        cargar(agente, vaca.id),
        agente.post(`/api/animales/${vaca.id}/secados`).send({ fecha: '2026-11-10' }) as unknown as Promise<Respuesta>,
      ]);
      expect(secado.status).toBe(201);
      expect([201, 409]).toContain(carga.status);
      // El registro existe si y solo si la carga dio 201.
      expect(await prisma.produccion.count({ where: { animalId: vaca.id } })).toBe(carga.status === 201 ? 1 : 0);
      expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('SECA');
    }
  });
});

describe('anulación × anulación del mismo registro (RF-36)', () => {
  it('una 200 y la otra 409 (nunca 500); el registro queda anulado una sola vez', async () => {
    const { agente, tambo, usuarioId, vaca } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const registro = await crearProduccionDirecta({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: `2026-10-${String(r + 1).padStart(2, '0')}` });
      const rs = await Promise.all([anular(agente, vaca.id, registro.id), anular(agente, vaca.id, registro.id)]);
      expect(ordenados(rs)).toEqual([200, 409]);
      expect((await prisma.produccion.findUniqueOrThrow({ where: { id: registro.id } })).motivoAnulacion).toBe('Error de tipeo');
    }
  });
});

describe('carga × anulación (RF-35, RF-36)', () => {
  it('cargar de nuevo tras anular el que ocupaba el ordeño: según el orden, 201 o 409, y nunca dos vigentes', async () => {
    const { agente, tambo, usuarioId, vaca } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const fecha = `2026-10-${String(r + 1).padStart(2, '0')}`;
      const viejo = await crearProduccionDirecta({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha });
      const [carga, anulacion] = await Promise.all([cargar(agente, vaca.id, { ...OK, fecha, litros: '3.0' }), anular(agente, vaca.id, viejo.id)]);
      expect(anulacion.status).toBe(200);
      expect([201, 409]).toContain(carga.status);
      expect(await prisma.produccion.count({ where: { animalId: vaca.id, fecha: new Date(`${fecha}T00:00:00Z`), anuladoEn: null } })).toBe(carga.status === 201 ? 1 : 0);
    }
  });
});
