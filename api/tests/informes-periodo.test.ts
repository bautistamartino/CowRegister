import { describe, expect, it } from 'vitest';
import { periodoSchema, validarPeriodo } from '../src/informes/periodo.js';
import { porcentajeEntero } from '../src/informes/porcentaje.js';

// Spec 007 (RF-15): el período de los informes y el porcentaje son funciones puras, se prueban sin base.

const HOY = '2026-11-12';

describe('validarPeriodo', () => {
  it('acepta un período normal, de un solo día y hasta hoy', () => {
    expect(validarPeriodo('2025-11-13', '2026-11-12', HOY)).toBeNull();
    expect(validarPeriodo('2026-03-05', '2026-03-05', HOY)).toBeNull();
    expect(validarPeriodo('2026-11-12', '2026-11-12', HOY)).toBeNull();
  });

  it('rechaza formato inválido y fechas que no existen, diciendo cuál campo', () => {
    expect(validarPeriodo('2026-02-30', '2026-11-12', HOY)).toMatch(/"Desde".*no es válida/);
    expect(validarPeriodo('2026/01/01', '2026-11-12', HOY)).toMatch(/"Desde".*no es válida/);
    expect(validarPeriodo('2026-01-01', 'abc', HOY)).toMatch(/"Hasta".*no es válida/);
    expect(validarPeriodo('2026-01-01', '2026-13-01', HOY)).toMatch(/"Hasta".*no es válida/);
  });

  it('rechaza desde posterior a hasta', () => {
    expect(validarPeriodo('2026-06-02', '2026-06-01', HOY)).toBe('"Desde" no puede ser posterior a "Hasta"');
  });

  it('rechaza hasta futura (mañana) pero acepta hoy', () => {
    expect(validarPeriodo('2026-01-01', '2026-11-13', HOY)).toBe('"Hasta" no puede ser una fecha futura');
    expect(validarPeriodo('2026-01-01', '2026-11-12', HOY)).toBeNull();
  });

  it('rechaza desde anterior al 01/01/2000', () => {
    expect(validarPeriodo('1999-12-31', '2000-01-05', HOY)).toBe('"Desde" no puede ser anterior al 01/01/2000');
    expect(validarPeriodo('2000-01-01', '2000-01-05', HOY)).toBeNull();
  });

  it('acepta 5 años justos y rechaza un día más', () => {
    expect(validarPeriodo('2000-01-01', '2004-12-31', HOY)).toBeNull();
    expect(validarPeriodo('2000-01-01', '2005-01-01', HOY)).toBe('El período no puede abarcar más de 5 años');
    expect(validarPeriodo('2021-03-10', '2026-03-09', HOY)).toBeNull();
    expect(validarPeriodo('2021-03-10', '2026-03-10', '2030-01-01')).toBe('El período no puede abarcar más de 5 años');
  });

  it('el 29/02 se toma como 28/02 para el máximo de 5 años', () => {
    const hoy = '2040-01-01';
    expect(validarPeriodo('2024-02-29', '2029-02-27', hoy)).toBeNull();
    expect(validarPeriodo('2024-02-29', '2029-02-28', hoy)).toBe('El período no puede abarcar más de 5 años');
  });

  it('respeta el orden de los controles: formato, orden, futuro, mínimo y rango', () => {
    // Desde inválido gana a todo lo demás.
    expect(validarPeriodo('x', '2099-01-01', HOY)).toMatch(/"Desde"/);
    // Desde > hasta gana a "hasta futura".
    expect(validarPeriodo('2099-02-01', '2099-01-01', HOY)).toMatch(/posterior/);
    // Futura gana a "desde < 2000".
    expect(validarPeriodo('1990-01-01', '2099-01-01', HOY)).toMatch(/futura/);
  });
});

describe('periodoSchema', () => {
  it('toma desde y hasta y descarta el resto (por ejemplo un establecimientoId)', () => {
    const r = periodoSchema.safeParse({ desde: '2026-01-01', hasta: '2026-02-01', establecimientoId: 'otro' });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ desde: '2026-01-01', hasta: '2026-02-01' });
  });

  it('falla si falta alguno, está repetido (arreglo) o no es texto, con mensaje en español', () => {
    const casos = [
      {},
      { desde: '2026-01-01' },
      { hasta: '2026-01-01' },
      { desde: ['a', 'b'], hasta: '2026-01-01' },
      { desde: '2026-01-01', hasta: { x: 1 } },
    ];
    for (const q of casos) {
      const r = periodoSchema.safeParse(q);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toMatch(/Indicá "Desde" y "Hasta"/);
    }
  });
});

describe('porcentajeEntero', () => {
  it('redondea el medio punto hacia arriba con enteros', () => {
    expect(porcentajeEntero(1, 8)).toBe(13); // 12,5 %
    expect(porcentajeEntero(2, 3)).toBe(67);
    expect(porcentajeEntero(1, 3)).toBe(33);
    expect(porcentajeEntero(0, 5)).toBe(0);
    expect(porcentajeEntero(5, 5)).toBe(100);
    expect(porcentajeEntero(1, 200)).toBe(1); // 0,5 % sube a 1
    expect(porcentajeEntero(1, 201)).toBe(0); // 0,497 % baja
  });

  it('da null si no hay base (nunca 0 % ni 100 %)', () => {
    expect(porcentajeEntero(0, 0)).toBeNull();
  });
});
