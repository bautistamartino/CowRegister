import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { tomarLotePrevio } from '../src/bajas/revertir.js';
import { crearAnimalDirecto, limpiarBase, prepararVaca, verificarInvariantes } from './ayudas.js';

// Spec 006, RF-16: operaciones simultáneas de baja y reversión. Hay una prueba por cada fila de la
// tabla que toca solo a bajas y reversiones (las filas con eventos, edición, altas y planillas van en
// la T3). Cada carrera se repite varias veces y solo se aceptan los resultados que enumera la
// tabla (no un orden fijo: depende de quién llegue primero a la base). Un fallo intermitente es un
// error real: no se reintenta. Al final de cada ronda se comprueban los invariantes de la base.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const RONDAS = 8;
type Agente = ReturnType<typeof request.agent>;
type Respuesta = { status: number; body: any };

const baja = (agente: Agente, id: string, fecha = '2026-11-05') =>
  agente.post(`/api/animales/${id}/baja`).send({ motivo: 'venta', fecha }) as unknown as Promise<Respuesta>;
const revertir = (agente: Agente, id: string) =>
  agente.post(`/api/animales/${id}/revertir-baja`).send({ motivoReversion: 'Se cargó mal' }) as unknown as Promise<Respuesta>;
const eliminarLote = (agente: Agente, id: string) => agente.delete(`/api/lotes/${id}`) as unknown as Promise<Respuesta>;
const estados = (rs: Respuesta[]) => rs.map((r) => r.status);
const ordenados = (rs: Respuesta[]) => estados(rs).sort((a, b) => a - b);
const invariantes = async () => expect(await verificarInvariantes()).toEqual([]);

describe('baja × baja del mismo animal (RF-16)', () => {
  it('uno 201 y el otro 404, con una sola baja vigente', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      const rs = await Promise.all([baja(agente, vaca.id), baja(agente, vaca.id)]);
      expect(ordenados(rs)).toEqual([201, 404]);
      expect(await prisma.baja.count({ where: { animalId: vaca.id } })).toBe(1);
      expect(await prisma.evento.count({ where: { animalId: vaca.id, tipo: 'BAJA' } })).toBe(1);
      expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('BAJA');
      await invariantes();
    }
  });
});

describe('revertir × revertir el mismo animal (RF-16)', () => {
  it('uno 200 y el otro 404; el animal queda activo y la baja anulada una sola vez', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      await baja(agente, vaca.id);
      const rs = await Promise.all([revertir(agente, vaca.id), revertir(agente, vaca.id)]);
      expect(ordenados(rs)).toEqual([200, 404]);
      expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('EN_ORDENE');
      expect(await prisma.baja.count({ where: { animalId: vaca.id, vigente: true } })).toBe(0);
      await invariantes();
    }
  });
});

describe('revertir × baja del mismo animal (RF-16)', () => {
  it('revertir siempre 200; la baja 404 (llegó antes) o 201 (llegó después de revertir)', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      await baja(agente, vaca.id, '2026-11-01');
      const rs = await Promise.all([revertir(agente, vaca.id), baja(agente, vaca.id, '2026-11-05')]);
      expect(rs[0]!.status).toBe(200);
      expect([201, 404]).toContain(rs[1]!.status);
      const animal = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
      if (rs[1]!.status === 201) {
        // Revertir fue primero y la nueva baja quedó vigente; la primera, anulada.
        expect(animal.estado).toBe('BAJA');
        expect(await prisma.baja.count({ where: { animalId: vaca.id } })).toBe(2);
        expect(await prisma.baja.count({ where: { animalId: vaca.id, vigente: true } })).toBe(1);
      } else {
        expect(animal.estado).toBe('EN_ORDENE');
        expect(await prisma.baja.count({ where: { animalId: vaca.id, vigente: true } })).toBe(0);
      }
      await invariantes();
    }
  });
});

describe('baja × eliminar el lote del animal (RF-16)', () => {
  it('baja 201 siempre; el lote se elimina (queda "eliminado" en la baja) o la eliminación da 409', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: `Tmp${r}` } });
      const vaca = await crearAnimalDirecto(tambo, `V${r}`, { loteId: lote.id });
      const rs = await Promise.all([baja(agente, vaca.id), eliminarLote(agente, lote.id)]);
      expect(rs[0]!.status).toBe(201);
      const guardada = await prisma.baja.findFirstOrThrow({ where: { animalId: vaca.id } });
      const existe = (await prisma.lote.count({ where: { id: lote.id } })) === 1;
      expect(guardada.tuvoLoteAnterior).toBe(true);
      if (rs[1]!.status === 204) {
        // La baja se guardó primero y sacó al animal del lote; después se eliminó el lote.
        expect(existe).toBe(false);
        expect(guardada.loteAnteriorId).toBeNull();
      } else {
        // El lote todavía tenía al animal: la eliminación se rechazó y el lote previo sigue.
        expect(rs[1]!.status).toBe(409);
        expect(existe).toBe(true);
        expect(guardada.loteAnteriorId).toBe(lote.id);
      }
      await invariantes();
    }
  });
});

describe('revertir × eliminar el lote previo (RF-16)', () => {
  it('revertir 200 siempre: vuelve al lote (y la eliminación 409) o sin lote y con el aviso (y la eliminación 204)', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: `Prev${r}` } });
      const vaca = await crearAnimalDirecto(tambo, `V${r}`, { loteId: lote.id });
      await baja(agente, vaca.id);
      const rs = await Promise.all([revertir(agente, vaca.id), eliminarLote(agente, lote.id)]);
      expect(rs[0]!.status).toBe(200);
      const animal = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
      const existe = (await prisma.lote.count({ where: { id: lote.id } })) === 1;
      if (rs[1]!.status === 409) {
        expect(existe).toBe(true);
        expect(animal.loteId).toBe(lote.id);
        expect(rs[0]!.body.avisos).toEqual([]);
      } else {
        expect(rs[1]!.status).toBe(204);
        expect(existe).toBe(false);
        expect(animal.loteId).toBeNull();
        expect(rs[0]!.body.avisos).toEqual(['El animal volvió a «en ordeñe» y quedó sin lote: su lote anterior ya no existe']);
      }
      await invariantes();
    }
  });
});

describe('revertir: el lote previo desaparece entre la lectura y el guardado (cliente simulado)', () => {
  // Simula la parte de `tx` que usa tomarLotePrevio: la consulta con FOR SHARE.
  const txSimulado = (lotesQueExisten: string[]) =>
    ({
      $queryRaw: async (_s: TemplateStringsArray, ...valores: unknown[]) =>
        lotesQueExisten.includes(String(valores[0])) ? [{ id: valores[0] }] : [],
    }) as never;

  it('lote que existe: devuelve su id', async () => {
    expect(await tomarLotePrevio(txSimulado(['L1']), 'E1', 'L1')).toBe('L1');
  });

  it('lote que ya no existe: null (el animal vuelve sin lote y se arma el aviso "ya no existe")', async () => {
    expect(await tomarLotePrevio(txSimulado([]), 'E1', 'L1')).toBeNull();
  });

  it('sin lote previo no consulta nada y devuelve null', async () => {
    const tx = { $queryRaw: async () => { throw new Error('no debería consultar'); } } as never;
    expect(await tomarLotePrevio(tx, 'E1', null)).toBeNull();
  });
});
