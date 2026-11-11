import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { crearAnimalDirecto, crearPartoDirecto, crearSecadoDirecto, limpiarBase, prepararVaca, verificarInvariantes } from './ayudas.js';

// DELETE /api/lotes/:id con lotes que figuran como lote previo en partos y secados (RF-37):
// se puede eliminar si cumple la regla de la spec 001 (sin animales activos y sin ser destino)
// y el historial queda con el lote previo "eliminado".

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

async function tamboConHistorial() {
  const t = await prepararVaca();
  const lote = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Previo' } });
  const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
  const parto = await crearPartoDirecto({ ...base, fecha: '2026-10-05', loteAnteriorId: lote.id });
  const secado = await crearSecadoDirecto({ ...base, fecha: '2026-11-01', loteAnteriorId: lote.id });
  return { ...t, lote, base, parto, secado };
}

describe('eliminar un lote que es lote previo del historial (RF-37)', () => {
  it('204 y el historial queda con el lote previo eliminado, sin tocar nada más', async () => {
    const { agente, lote, tambo, parto, secado } = await tamboConHistorial();
    await agente.delete(`/api/lotes/${lote.id}`).expect(204);
    expect(await prisma.lote.findUnique({ where: { id: lote.id } })).toBeNull();
    const detalles = [
      await prisma.parto.findUniqueOrThrow({ where: { eventoId: parto.id } }),
      await prisma.secado.findUniqueOrThrow({ where: { eventoId: secado.id } }),
    ];
    for (const d of detalles) {
      expect(d.loteAnteriorId).toBeNull();
      expect(d.tuvoLoteAnterior).toBe(true);
      expect(d.establecimientoId).toBe(tambo);
    }
    expect(await verificarInvariantes()).toEqual([]);
  });

  it('con un animal activo en el lote da 409 y el historial no cambia', async () => {
    const { agente, lote, tambo, parto } = await tamboConHistorial();
    await crearAnimalDirecto(tambo, '300', { loteId: lote.id });
    const res = await agente.delete(`/api/lotes/${lote.id}`).expect(409);
    expect(res.body.error).toBe('El lote tiene 1 animal');
    expect((await prisma.parto.findUniqueOrThrow({ where: { eventoId: parto.id } })).loteAnteriorId).toBe(lote.id);
  });

  it('siendo destino de un estado da 409 y el historial no cambia', async () => {
    const { agente, lote, tambo, secado } = await tamboConHistorial();
    await prisma.reglaLote.upsert({
      where: { establecimientoId_estado: { establecimientoId: tambo, estado: 'SECA' } },
      update: { loteId: lote.id },
      create: { establecimientoId: tambo, estado: 'SECA', loteId: lote.id },
    });
    await agente.delete(`/api/lotes/${lote.id}`).expect(409);
    expect((await prisma.secado.findUniqueOrThrow({ where: { eventoId: secado.id } })).loteAnteriorId).toBe(lote.id);
  });

  it('un animal de baja nunca tiene lote: eliminar otro lote no lo toca', async () => {
    const { agente, tambo } = await tamboConHistorial();
    const otro = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Vacío' } });
    const baja = await crearAnimalDirecto(tambo, '777', { estado: 'BAJA' });
    await agente.delete(`/api/lotes/${otro.id}`).expect(204);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: baja.id } })).loteId).toBeNull();
  });
});
