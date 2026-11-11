import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { limpiarBase } from './ayudas.js';

// Estos tests NO pasan por la API: insertan directo en la base para comprobar
// que las garantías de la migración "lotes_restricciones" están en PostgreSQL
// (RF-6, RF-9, RF-16, RF-17, RF-31). Aunque la API tuviera un error, la base
// tiene que rechazar estos datos.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

// Crea un tambo "pelado" (sin usuarios ni lotes) directo en la base.
function crearTambo(nombre: string) {
  return prisma.establecimiento.create({ data: { nombre } });
}

function crearLote(establecimientoId: string, nombre: string) {
  return prisma.lote.create({ data: { establecimientoId, nombre } });
}

describe('Nombre de lote único por tambo sin distinguir mayúsculas (RF-6)', () => {
  it('rechaza "secas" si el tambo ya tiene "Secas"', async () => {
    const tambo = await crearTambo('Tambo A');
    await crearLote(tambo.id, 'Secas');
    await expect(crearLote(tambo.id, 'secas')).rejects.toThrow();
  });

  it('rechaza el mismo nombre exacto en el mismo tambo', async () => {
    const tambo = await crearTambo('Tambo A');
    await crearLote(tambo.id, 'Secas');
    await expect(crearLote(tambo.id, 'Secas')).rejects.toThrow();
  });

  it('permite el mismo nombre en dos tambos distintos', async () => {
    const a = await crearTambo('Tambo A');
    const b = await crearTambo('Tambo B');
    await crearLote(a.id, 'Secas');
    await expect(crearLote(b.id, 'secas')).resolves.toBeDefined();
  });
});

describe('Reglas de destino (RF-16, RF-17)', () => {
  it('acepta una regla válida hacia un lote del mismo tambo (control)', async () => {
    const tambo = await crearTambo('Tambo A');
    const lote = await crearLote(tambo.id, 'Secas');
    await expect(
      prisma.reglaLote.create({ data: { establecimientoId: tambo.id, estado: 'SECA', loteId: lote.id } }),
    ).resolves.toBeDefined();
  });

  it('rechaza una regla para el estado BAJA', async () => {
    const tambo = await crearTambo('Tambo A');
    const lote = await crearLote(tambo.id, 'Bajas');
    await expect(
      prisma.reglaLote.create({ data: { establecimientoId: tambo.id, estado: 'BAJA', loteId: lote.id } }),
    ).rejects.toThrow();
  });

  it('rechaza una regla que apunta a un lote de otro tambo', async () => {
    const a = await crearTambo('Tambo A');
    const b = await crearTambo('Tambo B');
    const loteDeB = await crearLote(b.id, 'Secas');
    await expect(
      prisma.reglaLote.create({ data: { establecimientoId: a.id, estado: 'SECA', loteId: loteDeB.id } }),
    ).rejects.toThrow();
  });

  it('rechaza una regla que apunta a un lote inexistente', async () => {
    const tambo = await crearTambo('Tambo A');
    await expect(
      prisma.reglaLote.create({
        data: { establecimientoId: tambo.id, estado: 'SECA', loteId: '0190f3a0-0000-7000-8000-000000000000' },
      }),
    ).rejects.toThrow();
  });
});

describe('Borrar un lote que es destino (RF-9, RF-31)', () => {
  it('rechaza borrar el lote y la regla queda intacta', async () => {
    const tambo = await crearTambo('Tambo A');
    const lote = await crearLote(tambo.id, 'Secas');
    await prisma.reglaLote.create({ data: { establecimientoId: tambo.id, estado: 'SECA', loteId: lote.id } });

    await expect(prisma.lote.delete({ where: { id: lote.id } })).rejects.toThrow();

    // Ni el lote ni la regla desaparecieron.
    expect(await prisma.lote.count({ where: { id: lote.id } })).toBe(1);
    expect(await prisma.reglaLote.count({ where: { loteId: lote.id } })).toBe(1);
  });

  it('permite borrar un lote que no es destino (control)', async () => {
    const tambo = await crearTambo('Tambo A');
    const lote = await crearLote(tambo.id, 'Recría');
    await expect(prisma.lote.delete({ where: { id: lote.id } })).resolves.toBeDefined();
  });
});
