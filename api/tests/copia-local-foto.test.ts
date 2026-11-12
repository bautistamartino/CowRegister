import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarGanchoCopia } from '../src/copia/copiaLocal.js';
import { fijarReloj } from '../src/reloj.js';
import { crearAnimalDirecto, crearProduccionDirecta, limpiarBase, prepararVaca } from './ayudas.js';

// Spec 009, RF-6: la copia es UNA foto del tambo en un instante. Un cambio hecho por otra persona
// MIENTRAS se arma la copia (entre dos lecturas) no puede aparecer, ni a medias ni entero.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => {
  fijarReloj(null);
  fijarGanchoCopia(null);
});
afterAll(() => prisma.$disconnect());

describe('foto consistente (RF-6)', () => {
  it('lo que cambia entre las lecturas no aparece, y la copia siguiente sí lo trae', async () => {
    const { agente, tambo, usuarioId, vaca } = await prepararVaca({ numero: '101' });
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Lote original' } });
    await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: lote.id } });
    await crearProduccionDirecta({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-11-10', litros: 10 });

    // El gancho corre dentro de la copia, entre dos lecturas: acá "otra persona" cambia el tambo.
    const etapas: string[] = [];
    fijarGanchoCopia(async (etapa) => {
      etapas.push(etapa);
      if (etapas.length > 1) return; // los cambios se hacen una sola vez, en la primera pausa
      await crearAnimalDirecto(tambo, 'NUEVA'); // un animal nuevo
      await prisma.lote.update({ where: { id: lote.id }, data: { nombre: 'Lote renombrado' } });
      await prisma.animal.update({ where: { id: vaca.id }, data: { estado: 'SECA' } });
      await crearProduccionDirecta({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-11-11', litros: 20 });
    });

    const foto = (await agente.get('/api/copia-local').expect(200)).body;
    expect(etapas.length).toBeGreaterThanOrEqual(2); // hubo pausas entre varias lecturas
    expect(foto.totalAnimales).toBe(1);
    expect(foto.animales.map((a: any) => a.ficha.numero)).toEqual(['101']);
    expect(foto.animales[0].ficha.estado).toBe('EN_ORDENE');
    expect(foto.animales[0].ficha.lote.nombre).toBe('Lote original');
    const loteFoto = foto.lotes.find((l: any) => l.id === lote.id);
    expect(loteFoto).toMatchObject({ nombre: 'Lote original', cantidadAnimales: 1 });
    expect(foto.animales[0].produccion.total).toBe(1);

    // Sin el gancho, la copia siguiente muestra todo lo nuevo.
    fijarGanchoCopia(null);
    const despues = (await agente.get('/api/copia-local').expect(200)).body;
    expect(despues.totalAnimales).toBe(2);
    expect(despues.lotes.find((l: any) => l.id === lote.id).nombre).toBe('Lote renombrado');
    expect(despues.animales.find((a: any) => a.ficha.numero === '101').produccion.total).toBe(2);
  });
});
