import { describe, expect, it } from 'vitest';
import { normalizarNumero, numeroSchema } from '../src/validacion.js';
import {
  ESTADOS_INICIALES,
  hoyArgentina,
  puedeTenerEstado,
  validarFechaNacimiento,
} from '../src/animales/reglas.js';
import { compararNumeros } from '../src/animales/orden.js';

// Tests puros (sin base de datos) de la validación de animales (RF-2, RF-5, RF-6, RF-23).

describe('normalizarNumero (RF-2)', () => {
  it('quita los extremos (espacios, tabulaciones, saltos de línea, NBSP) y pasa a mayúsculas', () => {
    expect(normalizarNumero(' ab-1 ')).toBe('AB-1');
    expect(normalizarNumero('\t12\n')).toBe('12');
    expect(normalizarNumero(' x.9 ')).toBe('X.9');
  });

  it('devuelve null si queda vacío', () => {
    expect(normalizarNumero('')).toBeNull();
    expect(normalizarNumero('   \n')).toBeNull();
  });

  it('acepta 20 caracteres y rechaza 21', () => {
    expect(normalizarNumero('A'.repeat(20))).toBe('A'.repeat(20));
    expect(normalizarNumero('A'.repeat(21))).toBeNull();
  });

  it('rechaza espacio interno, ñ, tildes, guion bajo y la ß', () => {
    for (const malo of ['1 2', 'AÑ1', 'ÁB', 'A_1', 'ß', 'ı']) {
      expect(normalizarNumero(malo), malo).toBeNull();
    }
  });
});

describe('numeroSchema (RF-2)', () => {
  const mensaje = (v: unknown) => {
    const r = numeroSchema.safeParse(v);
    return r.success ? null : r.error.issues[0]?.message;
  };

  it('devuelve el número normalizado', () => {
    expect(numeroSchema.parse(' ab-1 ')).toBe('AB-1');
  });

  it('da un mensaje distinto para cada problema', () => {
    const vacio = mensaje('  ');
    const largo = mensaje('A'.repeat(21));
    const raro = mensaje('1 2');
    const noTexto = mensaje(5);
    for (const m of [vacio, largo, raro, noTexto]) expect(typeof m).toBe('string');
    expect(new Set([vacio, largo, raro]).size).toBe(3);
  });
});

describe('sexo y estado (RF-5)', () => {
  it('los estados iniciales no incluyen BAJA', () => {
    expect(ESTADOS_INICIALES).toEqual(['RECIEN_NACIDO', 'VAQUILLONA', 'EN_ORDENE', 'SECA']);
  });

  it('una hembra puede tener cualquier estado inicial', () => {
    for (const e of ESTADOS_INICIALES) expect(puedeTenerEstado('HEMBRA', e)).toBe(true);
  });

  it('un macho solo puede ser recién nacido', () => {
    expect(puedeTenerEstado('MACHO', 'RECIEN_NACIDO')).toBe(true);
    for (const e of ['VAQUILLONA', 'EN_ORDENE', 'SECA'] as const) expect(puedeTenerEstado('MACHO', e)).toBe(false);
  });
});

describe('hoyArgentina (RF-6)', () => {
  it('a las 22:00 de Argentina (ya es otro día en UTC) sigue siendo el día argentino', () => {
    // 2026-03-10 22:00 en Argentina (UTC-3) = 2026-03-11 01:00 UTC.
    expect(hoyArgentina(new Date('2026-03-11T01:00:00Z'))).toBe('2026-03-10');
  });
  it('pasada la medianoche argentina cambia el día', () => {
    expect(hoyArgentina(new Date('2026-03-11T03:00:00Z'))).toBe('2026-03-11');
  });
});

describe('validarFechaNacimiento (RF-6)', () => {
  const hoy = '2026-03-10';

  it('acepta hoy y rechaza mañana', () => {
    expect(validarFechaNacimiento('2026-03-10', hoy)).toBeNull();
    expect(validarFechaNacimiento('2026-03-11', hoy)).toMatch(/futura/i);
  });

  it('rechaza antes del 01/01/2000 y acepta esa fecha', () => {
    expect(validarFechaNacimiento('1999-12-31', hoy)).toMatch(/2000/);
    expect(validarFechaNacimiento('2000-01-01', hoy)).toBeNull();
  });

  it('rechaza fechas inexistentes y formatos raros', () => {
    expect(validarFechaNacimiento('2021-02-31', hoy)).toMatch(/válida/);
    expect(validarFechaNacimiento('5/3/2021', hoy)).toMatch(/válida/);
  });

  it('exige que la madre sea anterior; sin fecha de madre no compara', () => {
    expect(validarFechaNacimiento('2021-05-01', hoy, '2020-01-01')).toBeNull();
    expect(validarFechaNacimiento('2021-05-01', hoy, '2021-05-01')).toMatch(/madre/);
    expect(validarFechaNacimiento('2021-05-01', hoy, '2022-01-01')).toMatch(/madre/);
    expect(validarFechaNacimiento('2021-05-01', hoy, null)).toBeNull();
  });
});

describe('compararNumeros: orden natural (RF-23)', () => {
  it('"9" antes que "10" y "A2" antes que "A10"', () => {
    const lista = ['10', 'A10', '9', 'A2', '2'];
    expect([...lista].sort(compararNumeros)).toEqual(['2', '9', '10', 'A2', 'A10']);
  });

  it('si empatan numéricamente, desempata alfabéticamente por el texto', () => {
    expect([...['01', '1']].sort(compararNumeros)).toEqual(['01', '1']);
    expect(compararNumeros('1', '1')).toBe(0);
  });
});
