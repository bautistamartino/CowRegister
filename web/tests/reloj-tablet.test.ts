import { describe, expect, it } from 'vitest';
import { MARGEN_RELOJ_MS, fechaTrasCambioReloj, opcionesFecha, relojAtrasado } from '../src/sinconexion/relojTablet';

// Aviso de reloj atrasado (spec 012, RF-14 a RF-16). Reloj inyectable: nunca se lee la hora real.

const GENERADA = '2026-11-12T15:00:00.000Z';
const ahoraMenos = (min: number) => new Date(Date.parse(GENERADA) - min * 60_000);

describe('relojAtrasado (RF-14)', () => {
  it('el margen es de 5 minutos', () => {
    expect(MARGEN_RELOJ_MS).toBe(5 * 60_000);
  });

  it('4 minutos atrás: no avisa', () => {
    expect(relojAtrasado(ahoraMenos(4), GENERADA)).toBe(false);
  });

  it('exactamente 5 minutos atrás: no avisa', () => {
    expect(relojAtrasado(ahoraMenos(5), GENERADA)).toBe(false);
  });

  it('6 minutos atrás: avisa', () => {
    expect(relojAtrasado(ahoraMenos(6), GENERADA)).toBe(true);
  });

  it('la hora de la copia o posterior: no avisa', () => {
    expect(relojAtrasado(new Date(GENERADA), GENERADA)).toBe(false);
    expect(relojAtrasado(ahoraMenos(-60), GENERADA)).toBe(false);
  });

  it('sin copia (generadaEn nulo) o con un texto ilegible: no avisa', () => {
    expect(relojAtrasado(ahoraMenos(600), null)).toBe(false);
    expect(relojAtrasado(ahoraMenos(600), 'basura')).toBe(false);
  });

  it('el reloj ADELANTADO no se detecta (RF-16)', () => {
    expect(relojAtrasado(ahoraMenos(-24 * 60), GENERADA)).toBe(false);
  });
});

describe('opcionesFecha (RF-15)', () => {
  it('con el reloj bien propone hoy, con máximo hoy', () => {
    expect(opcionesFecha(false, '2026-11-12')).toEqual({ valorInicial: '2026-11-12', max: '2026-11-12', obligatorio: true, ayuda: null });
  });

  it('con el reloj atrasado el campo queda vacío, obligatorio y sin máximo, y pide elegir la fecha', () => {
    expect(opcionesFecha(true, '2026-11-12')).toEqual({ valorInicial: '', max: undefined, obligatorio: true, ayuda: 'Elegí la fecha del evento' });
  });
});

describe('fechaTrasCambioReloj (RF-14, RF-15: reloj corregido)', () => {
  it('fecha vacía por el atraso: al corregirse el reloj toma la nueva por defecto', () => {
    expect(fechaTrasCambioReloj('', '', '2026-11-12')).toBe('2026-11-12');
  });

  it('fecha que seguía siendo la por defecto: se actualiza a la nueva', () => {
    expect(fechaTrasCambioReloj('2026-11-10', '2026-11-10', '')).toBe('');
  });

  it('fecha elegida por el usuario: no se pisa', () => {
    expect(fechaTrasCambioReloj('2026-11-05', '', '2026-11-12')).toBe('2026-11-05');
    expect(fechaTrasCambioReloj('2026-11-05', '2026-11-10', '')).toBe('2026-11-05');
  });

  it('la fecha vacía vuelve a quedar vacía si el reloj se atrasa', () => {
    expect(fechaTrasCambioReloj('', '2026-11-10', '')).toBe('');
  });
});
