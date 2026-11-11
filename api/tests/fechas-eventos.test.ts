import { afterEach, describe, expect, it } from 'vitest';
import { ahora, fijarReloj } from '../src/reloj.js';
import { hoyArgentina } from '../src/animales/reglas.js';
import { DIAS_GESTACION, diasEntre, sumarDias, validarFechaEvento } from '../src/reproduccion/fechas.js';

// Tests puros (sin base) de las fechas de los eventos reproductivos: RF-18 y el reloj inyectable.

afterEach(() => fijarReloj(null));

const base = { hoy: '2026-11-11', nacimiento: null, ultimoEvento: null };

describe('reloj inyectable', () => {
  it('sin fijar devuelve la hora real y fijado devuelve la fijada', () => {
    expect(Math.abs(ahora().getTime() - Date.now())).toBeLessThan(1000);
    fijarReloj(new Date('2026-05-05T12:00:00Z'));
    expect(ahora().toISOString()).toBe('2026-05-05T12:00:00.000Z');
    fijarReloj(null);
    expect(Math.abs(ahora().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('a las 22:00 de Argentina ya es otro día en UTC, pero "hoy" sigue siendo el de Argentina', () => {
    // 22:00 del 11/11 en Argentina (UTC-3) = 01:00 UTC del 12/11
    fijarReloj(new Date('2026-11-12T01:00:00Z'));
    expect(hoyArgentina(ahora())).toBe('2026-11-11');
    // "mañana" para Argentina (12/11) es futura, aunque en UTC ya sea hoy
    expect(validarFechaEvento('2026-11-12', { ...base, hoy: hoyArgentina(ahora()) })).toMatch(/futura/);
    expect(validarFechaEvento('2026-11-11', { ...base, hoy: hoyArgentina(ahora()) })).toBeNull();
  });
});

describe('sumarDias y diasEntre', () => {
  it('suma días cruzando meses, años y bisiestos', () => {
    expect(sumarDias('2026-11-11', 283)).toBe('2027-08-21');
    expect(sumarDias('2024-02-28', 2)).toBe('2024-03-01');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-11-11', 0)).toBe('2026-11-11');
    expect(DIAS_GESTACION).toBe(283);
  });

  it('cuenta días entre fechas, negativo si ya pasó', () => {
    expect(diasEntre('2026-11-11', '2026-11-21')).toBe(10);
    expect(diasEntre('2026-11-11', '2026-11-11')).toBe(0);
    expect(diasEntre('2026-11-11', '2026-11-01')).toBe(-10);
    expect(diasEntre('2026-03-01', '2026-02-01')).toBe(-28);
  });
});

describe('validarFechaEvento (RF-18)', () => {
  it.each(['2026-11-11T10:00', '11/11/2026', '2026-2-3', '', 'hoy'])('rechaza el formato %s', (fecha) => {
    expect(validarFechaEvento(fecha, base)).toMatch(/AAAA-MM-DD/);
  });

  it('rechaza una fecha inexistente', () => {
    expect(validarFechaEvento('2026-02-30', base)).toMatch(/AAAA-MM-DD/);
  });

  it('rechaza una fecha futura y acepta hoy', () => {
    expect(validarFechaEvento('2026-11-12', base)).toMatch(/futura/);
    expect(validarFechaEvento('2026-11-11', base)).toBeNull();
  });

  it('rechaza una fecha anterior al 2000 y acepta el 01/01/2000', () => {
    expect(validarFechaEvento('1999-12-31', base)).toMatch(/01\/01\/2000/);
    expect(validarFechaEvento('2000-01-01', base)).toBeNull();
  });

  it('rechaza una fecha anterior al nacimiento y acepta igual', () => {
    const c = { ...base, nacimiento: '2024-03-10' };
    expect(validarFechaEvento('2024-03-09', c)).toMatch(/nacimiento/);
    expect(validarFechaEvento('2024-03-10', c)).toBeNull();
  });

  it('rechaza una fecha anterior al último evento no anulado y acepta igual', () => {
    const c = { ...base, ultimoEvento: '2026-10-05' };
    expect(validarFechaEvento('2026-10-04', c)).toMatch(/último evento/);
    expect(validarFechaEvento('2026-10-05', c)).toBeNull();
    expect(validarFechaEvento('2026-10-06', c)).toBeNull();
  });
});
