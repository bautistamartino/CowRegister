import { describe, expect, it } from 'vitest';
import type { Pendiente } from '../src/sinconexion/almacen';
import { marcaDePendiente, MARCA_ENVIADO, textoCargadoSinConexion, textoMarca, TEXTO_ANULACION_PENDIENTE } from '../src/sinconexion/marcasHistorial';
import { pendiente } from './ayudas';

// Marcas del historial (spec 012, RF-1, RF-2 y RF-4). Lógica pura.

const evento = (cambios: Partial<Pendiente> = {}): Pendiente => pendiente({ id: 'e-1', tipo: 'SERVICIO', datos: { fecha: '2026-11-01', tipo: 'INSEMINACION' }, ...cambios });

describe('textoMarca (RF-1, RF-2)', () => {
  it('usa los textos exactos de cada estado', () => {
    expect(textoMarca({ estado: 'pendiente' })).toBe('Pendiente de sincronizar');
    expect(textoMarca({ estado: 'enviado' })).toBe('Enviado: se confirma al actualizar');
    expect(textoMarca({ estado: 'enEspera' })).toBe('En espera del anterior');
    expect(textoMarca({ estado: 'rechazado', motivo: 'La fecha no puede ser futura' })).toBe('Rechazado: La fecha no puede ser futura');
    expect(TEXTO_ANULACION_PENDIENTE).toBe('Anulación pendiente');
  });

  it('un rechazado sin motivo igual dice que fue rechazado', () => {
    expect(textoMarca({ estado: 'rechazado' })).toBe('Rechazado');
  });
});

describe('marcaDePendiente (RF-1)', () => {
  it('esperando y enviando son "pendiente"', () => {
    const esperando = evento();
    const enviando = evento({ id: 'e-2', estado: 'enviando', orden: 2 });
    expect(marcaDePendiente(esperando, [esperando, enviando])).toEqual({ estado: 'pendiente' });
    expect(marcaDePendiente(enviando, [esperando, enviando])).toEqual({ estado: 'pendiente' });
  });

  it('rechazado lleva su motivo', () => {
    const p = evento({ estado: 'rechazado', motivo: 'Animal no encontrado', codigoRechazo: 404 });
    expect(marcaDePendiente(p, [p])).toEqual({ estado: 'rechazado', motivo: 'Animal no encontrado' });
  });

  it('un esperando detrás de un rechazado de la misma vaca es "enEspera"', () => {
    const delante = evento({ id: 'e-1', estado: 'rechazado', motivo: 'x', orden: 1 });
    const detras = evento({ id: 'e-2', orden: 2 });
    expect(marcaDePendiente(detras, [delante, detras])).toEqual({ estado: 'enEspera' });
  });

  it('el rechazado de OTRA vaca no frena', () => {
    const otra = evento({ id: 'e-1', estado: 'rechazado', motivo: 'x', orden: 1, animalId: 'a2' });
    const mia = evento({ id: 'e-2', orden: 2 });
    expect(marcaDePendiente(mia, [otra, mia])).toEqual({ estado: 'pendiente' });
  });

  it('la marca de un enviado es "enviado"', () => {
    expect(MARCA_ENVIADO).toEqual({ estado: 'enviado' });
  });
});

describe('textoCargadoSinConexion (RF-4)', () => {
  // El servidor registró a las 12:00 (UTC); la tablet cargó N minutos antes.
  const registrado = '2026-11-12T12:00:00.000Z';
  const cargadoHaceMin = (min: number) => new Date(Date.parse(registrado) - min * 60_000).toISOString();

  it('4 minutos de diferencia: no muestra nada', () => {
    expect(textoCargadoSinConexion(registrado, cargadoHaceMin(4))).toBeNull();
  });

  it('exactamente 5 minutos: no muestra nada', () => {
    expect(textoCargadoSinConexion(registrado, cargadoHaceMin(5))).toBeNull();
  });

  it('6 minutos de diferencia: muestra la hora de carga en Argentina', () => {
    // 11:54 UTC = 08:54 en Argentina.
    expect(textoCargadoSinConexion(registrado, cargadoHaceMin(6))).toBe('Cargado sin conexión el 12/11/2026 08:54');
  });

  it('entiende la hora con -03:00 que manda la tablet', () => {
    expect(textoCargadoSinConexion('2026-11-12T15:00:00.000Z', '2026-11-12T08:15:00-03:00')).toBe('Cargado sin conexión el 12/11/2026 08:15');
  });

  it('sin alguno de los dos datos o con un texto ilegible: null', () => {
    expect(textoCargadoSinConexion(registrado, null)).toBeNull();
    expect(textoCargadoSinConexion(registrado, undefined)).toBeNull();
    expect(textoCargadoSinConexion('', cargadoHaceMin(10))).toBeNull();
    expect(textoCargadoSinConexion(registrado, 'no es una fecha')).toBeNull();
  });

  it('con la hora de la tablet DESPUÉS del registro (reloj adelantado): null', () => {
    expect(textoCargadoSinConexion(registrado, cargadoHaceMin(-30))).toBeNull();
  });
});
