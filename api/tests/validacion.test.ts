import { describe, expect, it } from 'vitest';
import {
  descripcionLoteSchema,
  nombreLoteSchema,
  normalizarNombre,
} from '../src/validacion.js';

// Tests unitarios: prueban funciones y esquemas de zod sin pasar por la API
// ni tocar la base (RF-4, RF-5, RF-27).

// Devuelve los mensajes de error de un safeParse fallido, para comparar el texto.
function mensajes(resultado: { success: boolean; error?: { issues: { message: string }[] } }) {
  return resultado.error?.issues.map((i) => i.message) ?? [];
}

describe('normalizarNombre (RF-4)', () => {
  it('quita espacios y tabulaciones de los extremos', () => {
    expect(normalizarNombre('  \tSecas\t  ')).toBe('Secas');
  });

  it('reduce los espacios internos repetidos a uno', () => {
    expect(normalizarNombre('En   ordeñe')).toBe('En ordeñe');
    expect(normalizarNombre('  En \t ordeñe ')).toBe('En ordeñe');
  });

  it('pasa la forma descompuesta a la compuesta (NFC)', () => {
    // "n" + tilde combinable (U+0303) es la forma descompuesta de "ñ".
    const descompuesto = 'Bañado';
    expect(normalizarNombre(descompuesto)).toBe('Bañado');
  });
});

describe('nombreLoteSchema (RF-4, RF-5)', () => {
  it('devuelve el nombre normalizado', () => {
    const r = nombreLoteSchema.safeParse(' \t En  ordeñe \t');
    expect(r.success).toBe(true);
    expect(r.data).toBe('En ordeñe');
  });

  it('rechaza el nombre vacío diciendo que es obligatorio', () => {
    const r = nombreLoteSchema.safeParse('');
    expect(r.success).toBe(false);
    expect(mensajes(r)).toEqual(['El nombre del lote es obligatorio']);
  });

  it('rechaza el nombre de solo espacios y tabulaciones como vacío', () => {
    const r = nombreLoteSchema.safeParse('  \t   ');
    expect(r.success).toBe(false);
    expect(mensajes(r)).toEqual(['El nombre del lote es obligatorio']);
  });

  it('rechaza un valor que no es texto', () => {
    expect(nombreLoteSchema.safeParse(undefined).success).toBe(false);
    expect(nombreLoteSchema.safeParse(123).success).toBe(false);
  });

  it('acepta 50 caracteres con ñ y é', () => {
    const nombre = 'ñé'.repeat(25); // 50 caracteres
    const r = nombreLoteSchema.safeParse(nombre);
    expect(r.success).toBe(true);
    expect(r.data).toBe(nombre);
  });

  it('rechaza 51 caracteres con ñ y é diciendo que supera 50', () => {
    const r = nombreLoteSchema.safeParse('ñé'.repeat(25) + 'a');
    expect(r.success).toBe(false);
    expect(mensajes(r)).toEqual(['El nombre del lote no puede superar los 50 caracteres']);
  });

  it('cuenta igual la forma descompuesta: 50 "ñ" descompuestas se aceptan', () => {
    // Cada "ñ" ocupa 2 code points antes de normalizar y 1 después.
    const nombre = 'ñ'.repeat(50);
    const r = nombreLoteSchema.safeParse(nombre);
    expect(r.success).toBe(true);
    expect(r.data).toBe('ñ'.repeat(50));
  });

  it('cuenta igual la forma descompuesta: 51 "é" descompuestas se rechazan', () => {
    const r = nombreLoteSchema.safeParse('é'.repeat(51));
    expect(r.success).toBe(false);
    expect(mensajes(r)).toEqual(['El nombre del lote no puede superar los 50 caracteres']);
  });

  it('los espacios de los extremos no cuentan para el largo', () => {
    const r = nombreLoteSchema.safeParse('   ' + 'a'.repeat(50) + '\t\t');
    expect(r.success).toBe(true);
  });
});

describe('descripcionLoteSchema (RF-27)', () => {
  it('quita los espacios de los extremos y respeta los internos', () => {
    const r = descripcionLoteSchema.safeParse('  Vacas  de  primera parición \t');
    expect(r.success).toBe(true);
    expect(r.data).toBe('Vacas  de  primera parición');
  });

  it('la descripción vacía pasa a null', () => {
    const r = descripcionLoteSchema.safeParse('');
    expect(r.success).toBe(true);
    expect(r.data).toBeNull();
  });

  it('la descripción de solo espacios pasa a null', () => {
    const r = descripcionLoteSchema.safeParse('   \t ');
    expect(r.success).toBe(true);
    expect(r.data).toBeNull();
  });

  it('null se mantiene null (al editar, borra la descripción)', () => {
    const r = descripcionLoteSchema.safeParse(null);
    expect(r.success).toBe(true);
    expect(r.data).toBeNull();
  });

  it('acepta 200 caracteres con ñ', () => {
    const r = descripcionLoteSchema.safeParse('ñ'.repeat(200));
    expect(r.success).toBe(true);
  });

  it('rechaza 201 caracteres diciendo que supera 200', () => {
    const r = descripcionLoteSchema.safeParse('ñ'.repeat(201));
    expect(r.success).toBe(false);
    expect(mensajes(r)).toEqual(['La descripción no puede superar los 200 caracteres']);
  });

  it('rechaza un valor que no es texto ni null', () => {
    expect(descripcionLoteSchema.safeParse(42).success).toBe(false);
  });
});
