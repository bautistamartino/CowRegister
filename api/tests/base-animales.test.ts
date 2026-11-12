import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { limpiarBase } from './ayudas.js';

// Estos tests NO pasan por la API: insertan directo en la base para comprobar
// que las garantías de la migración "animales_restricciones" están en
// PostgreSQL (RF-4, RF-7, RF-9, RF-10). Aunque la API tuviera un error, la base
// tiene que rechazar estos datos.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

const crearTambo = (nombre: string) => prisma.establecimiento.create({ data: { nombre } });
const crearLote = (establecimientoId: string, nombre: string) =>
  prisma.lote.create({ data: { establecimientoId, nombre } });
const crearAnimal = (
  establecimientoId: string,
  numero: string,
  extra: { loteId?: string | null; madreId?: string | null; id?: string } = {},
) =>
  prisma.animal.create({
    data: { establecimientoId, numero, sexo: 'HEMBRA', estado: 'EN_ORDENE', ...extra },
  });

describe('Número del animal (RF-4)', () => {
  it('acepta un número normalizado (control)', async () => {
    const t = await crearTambo('A');
    await expect(crearAnimal(t.id, 'AB-1.2')).resolves.toBeDefined();
  });

  it('rechaza un número repetido entre activos del mismo tambo', async () => {
    const t = await crearTambo('A');
    await crearAnimal(t.id, '101');
    await expect(crearAnimal(t.id, '101')).rejects.toThrow();
  });

  it('permite el mismo número en otro tambo', async () => {
    const a = await crearTambo('A');
    const b = await crearTambo('B');
    await crearAnimal(a.id, '101');
    await expect(crearAnimal(b.id, '101')).resolves.toBeDefined();
  });

  it('permite repetir el número de un animal dado de baja', async () => {
    const t = await crearTambo('A');
    await prisma.animal.create({
      data: {
        establecimientoId: t.id,
        numero: '101',
        sexo: 'HEMBRA',
        estado: 'BAJA',
        fechaBaja: new Date('2026-01-01'),
        motivoBaja: 'PARTO_ANULADO', // la base exige motivo en toda baja (spec 006)
      },
    });
    await expect(crearAnimal(t.id, '101')).resolves.toBeDefined();
  });

  it('rechaza un número no normalizado (minúsculas, espacios, vacío, largo)', async () => {
    const t = await crearTambo('A');
    for (const malo of ['ab-1', ' 1', '1 2', '', 'A'.repeat(21), 'Ñ1']) {
      await expect(crearAnimal(t.id, malo), JSON.stringify(malo)).rejects.toThrow();
    }
  });
});

describe('Lote del animal (RF-9, RF-10)', () => {
  it('acepta un lote del mismo tambo y también sin lote (control)', async () => {
    const t = await crearTambo('A');
    const lote = await crearLote(t.id, 'Ordeñe');
    await expect(crearAnimal(t.id, '1', { loteId: lote.id })).resolves.toBeDefined();
    await expect(crearAnimal(t.id, '2', { loteId: null })).resolves.toBeDefined();
  });

  it('rechaza un lote de otro tambo', async () => {
    const a = await crearTambo('A');
    const b = await crearTambo('B');
    const loteDeB = await crearLote(b.id, 'Ordeñe');
    await expect(crearAnimal(a.id, '1', { loteId: loteDeB.id })).rejects.toThrow();
  });

  it('rechaza un lote inexistente', async () => {
    const t = await crearTambo('A');
    await expect(
      crearAnimal(t.id, '1', { loteId: '0190f3a0-0000-7000-8000-000000000000' }),
    ).rejects.toThrow();
  });

  it('rechaza borrar un lote que tiene animales (queda todo intacto)', async () => {
    const t = await crearTambo('A');
    const lote = await crearLote(t.id, 'Ordeñe');
    const animal = await crearAnimal(t.id, '1', { loteId: lote.id });
    await expect(prisma.lote.delete({ where: { id: lote.id } })).rejects.toThrow();
    expect(await prisma.lote.count({ where: { id: lote.id } })).toBe(1);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: animal.id } })).loteId).toBe(lote.id);
  });
});

describe('Madre del animal (RF-7)', () => {
  it('acepta una madre del mismo tambo (control)', async () => {
    const t = await crearTambo('A');
    const madre = await crearAnimal(t.id, '1');
    await expect(crearAnimal(t.id, '2', { madreId: madre.id })).resolves.toBeDefined();
  });

  it('rechaza una madre de otro tambo', async () => {
    const a = await crearTambo('A');
    const b = await crearTambo('B');
    const madreDeB = await crearAnimal(b.id, '1');
    await expect(crearAnimal(a.id, '2', { madreId: madreDeB.id })).rejects.toThrow();
  });

  it('rechaza ser su propia madre (CHECK)', async () => {
    const t = await crearTambo('A');
    const id = '0190f3a0-0000-7000-8000-0000000000aa';
    await expect(crearAnimal(t.id, '1', { id, madreId: id })).rejects.toThrow();
  });
});
