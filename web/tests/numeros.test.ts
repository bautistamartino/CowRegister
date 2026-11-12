import { describe, expect, it } from 'vitest';
import { compararNumeros, normalizarNumero } from '../src/sinconexion/numeros';
// Las funciones "de verdad" del servidor: la copia de la web tiene que dar siempre lo mismo (RF-14).
import { normalizarNumero as normalizarEnApi } from '../../api/src/validacion';
import { compararNumeros as compararEnApi } from '../../api/src/animales/orden';

// Tests de numeros.ts (spec 009, RF-14): el buscador sin conexión normaliza y ordena igual que la API.

// [texto escrito, resultado esperado]
const casosNormalizar: [string, string | null][] = [
  ['123', '123'],
  ['a12', 'A12'], // mayúsculas
  ['  a-12.b  ', 'A-12.B'], // se quitan los extremos
  ['\t7\n', '7'],
  [' 7 ', '7'], // espacio de no separación en los extremos
  ['A'.repeat(20), 'A'.repeat(20)], // el máximo
  ['A'.repeat(21), null], // demasiado largo
  ['', null],
  ['   ', null],
  ['12 3', null], // espacio adentro
  ['ñ12', null], // letra con tilde o eñe
  ['á1', null],
  ['ß', null], // toUpperCase() la convertiría en "SS": se valida antes
  ['ı1', null], // i sin punto
  ['A_1', null],
  ['A/1', null],
  ['١٢٣', null], // dígitos que no son ASCII
  ['-', '-'],
  ['.', '.'],
];

describe('normalizarNumero', () => {
  it.each(casosNormalizar)('"%s" da %s', (texto, esperado) => {
    expect(normalizarNumero(texto)).toBe(esperado);
  });

  it('da lo mismo que normalizarNumero de la API en todos los casos', () => {
    for (const [texto] of casosNormalizar) expect(normalizarNumero(texto)).toBe(normalizarEnApi(texto));
  });
});

describe('compararNumeros (orden natural)', () => {
  it('ordena A2 antes que A10 y 9 antes que 10', () => {
    expect(['A10', 'A2', '10', '9', 'A1'].sort(compararNumeros)).toEqual(['9', '10', 'A1', 'A2', 'A10']);
  });

  it('desempata por el texto: "01" antes que "1"', () => {
    expect(['1', '01'].sort(compararNumeros)).toEqual(['01', '1']);
  });

  it('da el mismo orden que la API para una lista mezclada', () => {
    const lista = ['10', '9', 'A10', 'A2', 'a2', 'B-1', 'B-10', 'B-2', '01', '1', '001', '2.5', '2.10', 'Z', '100', '99'];
    expect([...lista].sort(compararNumeros)).toEqual([...lista].sort(compararEnApi));
  });

  it('da el mismo signo que la API para cada par', () => {
    const lista = ['1', '01', '2', '10', 'A1', 'A10', 'a1', 'B', '1.5', '1-5'];
    for (const a of lista) for (const b of lista) expect(Math.sign(compararNumeros(a, b))).toBe(Math.sign(compararEnApi(a, b)));
  });
});
