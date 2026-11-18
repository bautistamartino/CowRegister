import { describe, expect, it } from 'vitest';
import type { AnimalFicha, RespuestaEventos, RespuestaHistorial } from '../src/compartido/api';
import { resolverFichaLocal, rutaDeFicha, type ContextoFicha } from '../src/sinconexion/fichaLocal';
import { pendiente, vacaCopia } from './ayudas';

// Decisión de la fuente de las tres lecturas de la ficha (spec 011, RF-18).

const AHORA = new Date('2026-11-12T15:00:00.000Z');

function contexto(pendientes: ContextoFicha['pendientes'] = []): ContextoFicha {
  return { animales: [vacaCopia('a1', '12')], pendientes, enviados: [], semen: [], usuarioNombre: 'Ana Pérez' };
}
const servicioPendiente = (cambios = {}) => pendiente({ id: 'p-1', tipo: 'SERVICIO', datos: { fecha: '2026-11-01', tipo: 'INSEMINACION' }, ...cambios });

describe('rutaDeFicha', () => {
  it('reconoce las tres lecturas y descarta el resto', () => {
    expect(rutaDeFicha('GET', '/animales/a1')).toEqual({ animalId: 'a1', parte: 'ficha' });
    expect(rutaDeFicha('GET', '/animales/a1/eventos')).toEqual({ animalId: 'a1', parte: 'eventos' });
    expect(rutaDeFicha('get', '/animales/a1/historial')).toEqual({ animalId: 'a1', parte: 'historial' });
    expect(rutaDeFicha('GET', '/animales')).toBeNull();
    expect(rutaDeFicha('GET', '/animales/buscar?numero=12')).toBeNull();
    expect(rutaDeFicha('GET', '/animales/a1/produccion')).toBeNull();
    expect(rutaDeFicha('GET', '/bajas/a1/historial')).toBeNull();
    expect(rutaDeFicha('POST', '/animales/a1')).toBeNull();
  });
});

describe('resolverFichaLocal', () => {
  it('sin conexión usa la vista local, aunque no haya pendientes', () => {
    const f = resolverFichaLocal('GET', '/animales/a1', false, contexto(), AHORA) as AnimalFicha;
    expect(f.id).toBe('a1');
    expect(f.locales).toEqual({ sinAceptar: 0, avisoLotePendiente: false });
  });

  it('con conexión y sin pendientes de la vaca devuelve null: decide el servidor', () => {
    expect(resolverFichaLocal('GET', '/animales/a1', true, contexto(), AHORA)).toBeNull();
    // Pendientes de otra vaca o litros tampoco desvían la fuente.
    const otra = servicioPendiente({ animalId: 'a2' });
    expect(resolverFichaLocal('GET', '/animales/a1', true, contexto([otra, pendiente({ id: 'l-1', orden: 5 })]), AHORA)).toBeNull();
  });

  it('con conexión y un evento sin aceptar de la vaca usa la vista local en las tres lecturas', () => {
    const ctx = contexto([servicioPendiente()]);
    expect((resolverFichaLocal('GET', '/animales/a1', true, ctx, AHORA) as AnimalFicha).id).toBe('a1');
    const eventos = resolverFichaLocal('GET', '/animales/a1/eventos', true, ctx, AHORA) as RespuestaEventos;
    expect(eventos.eventos.map((e) => e.tipo)).toEqual(['SERVICIO']);
    const historial = resolverFichaLocal('GET', '/animales/a1/historial', true, ctx, AHORA) as RespuestaHistorial;
    expect(historial.total).toBe(1);
  });

  it('un rechazado también desvía la fuente y se avisa en la ficha', () => {
    const ctx = contexto([servicioPendiente({ estado: 'rechazado', codigoRechazo: 409, motivo: 'x' })]);
    const f = resolverFichaLocal('GET', '/animales/a1', true, ctx, AHORA) as AnimalFicha;
    expect(f.locales?.sinAceptar).toBe(1);
  });

  it('con conexión y una baja enviada sin reflejar: ficha en solo lectura "Baja enviada" desde la vista local', () => {
    const enviadaBaja = { id: 'b-1', usuarioId: 'u1', establecimientoId: 'e1', animalId: 'a1', numero: '12', tipo: 'BAJA' as const, datos: { fecha: '2026-11-12', motivo: 'venta' }, aceptadoEn: Date.parse('2026-11-12T14:00:00.000Z'), registro: null };
    const ctx = { ...contexto(), enviados: [enviadaBaja] };
    const f = resolverFichaLocal('GET', '/animales/a1', true, ctx, AHORA) as AnimalFicha;
    expect(f.estado).toBe('BAJA');
    expect(f.locales?.bajaPendiente?.estado).toBe('enviada');
    // La sección de reproducción y el historial también salen de la vista local (no dan 404).
    expect(resolverFichaLocal('GET', '/animales/a1/eventos', true, ctx, AHORA)).not.toBeNull();
    expect(resolverFichaLocal('GET', '/animales/a1/historial', true, ctx, AHORA)).not.toBeNull();
  });

  it('un animal que no está en la copia, o una ruta que no es de ficha, devuelve null', () => {
    expect(resolverFichaLocal('GET', '/animales/zzz', false, contexto(), AHORA)).toBeNull();
    expect(resolverFichaLocal('GET', '/animales/a1/produccion', false, contexto(), AHORA)).toBeNull();
  });
});
