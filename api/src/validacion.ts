import { z } from 'zod';

// Mensajes por defecto de zod en español (constitución §2). Cubren los casos sin
// mensaje propio, por ejemplo un cuerpo que es un array en vez de un objeto.
// Se configura acá porque todas las rutas que validan importan este archivo.
z.config(z.locales.es());

// Reglas de validación compartidas por varias rutas.

export const emailSchema = z
  .string({ error: 'El email es obligatorio' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'El email no es válido' }));

export const passwordSchema = z
  .string({ error: 'La contraseña es obligatoria' })
  .min(10, { error: 'La contraseña debe tener al menos 10 caracteres' })
  .max(128, { error: 'La contraseña es demasiado larga' });

export const nombreSchema = z
  .string({ error: 'El nombre es obligatorio' })
  .trim()
  .min(1, { error: 'El nombre es obligatorio' })
  .max(100, { error: 'El nombre es demasiado largo' });

// ---------------------------------------------------------------------------
// Lotes (RF-4, RF-5, RF-27)
// ---------------------------------------------------------------------------

// Largo de un texto en "letras": cuenta code points, no unidades UTF-16.
// `texto.length` contaría 2 para algunos caracteres (por ejemplo emojis);
// `[...texto]` recorre el string por code points.
function largo(texto: string): number {
  return [...texto].length;
}

/**
 * Normaliza un nombre de lote para guardarlo y compararlo (RF-4):
 * - `normalize('NFC')`: una "ñ" escrita como "n" + tilde combinable pasa a ser
 *   un solo carácter, así cuenta 1 y se compara igual que la "ñ" común.
 * - `\s+` → un espacio: espacios y tabulaciones internos repetidos cuentan como uno.
 * - `trim()`: quita los que queden en los extremos.
 */
export function normalizarNombre(texto: string): string {
  return texto.normalize('NFC').replace(/\s+/g, ' ').trim();
}

const MAX_NOMBRE_LOTE = 50;
const MAX_DESCRIPCION_LOTE = 200;

// Primero se normaliza (transform) y después se valida el resultado (pipe),
// así el largo se mide sobre lo que se va a guardar. Cada regla tiene su
// propio mensaje para que el usuario sepa cuál de las dos falló (RF-5).
export const nombreLoteSchema = z
  .string({ error: 'El nombre del lote es obligatorio' })
  .transform(normalizarNombre)
  .pipe(
    z
      .string()
      .refine((nombre) => largo(nombre) >= 1, {
        error: 'El nombre del lote es obligatorio',
        abort: true, // si está vacío no hace falta revisar el máximo
      })
      .refine((nombre) => largo(nombre) <= MAX_NOMBRE_LOTE, {
        error: `El nombre del lote no puede superar los ${MAX_NOMBRE_LOTE} caracteres`,
      }),
  );

// Descripción opcional (RF-27). Acepta texto o `null` (al editar, `null` la
// borra). Solo se recortan los extremos: los espacios internos se respetan.
// Vacía o de solo espacios pasa a `null` ("sin descripción").
// El "opcional" (que el campo no venga) lo agrega cada ruta con `.optional()`.
export const descripcionLoteSchema = z
  .string({ error: 'La descripción debe ser un texto' })
  .nullable()
  .transform((texto) => {
    if (texto === null) return null;
    const limpio = texto.normalize('NFC').trim();
    return limpio === '' ? null : limpio;
  })
  .refine((texto) => texto === null || largo(texto) <= MAX_DESCRIPCION_LOTE, {
    error: `La descripción no puede superar los ${MAX_DESCRIPCION_LOTE} caracteres`,
  });
