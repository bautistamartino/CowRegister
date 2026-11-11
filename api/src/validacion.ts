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

// ---------------------------------------------------------------------------
// Número de animal (RF-2, RF-34)
// ---------------------------------------------------------------------------

const MAX_NUMERO = 20;

// Solo letras ASCII, dígitos, guion y punto, de 1 a 20 caracteres.
const FORMATO_NUMERO = /^[A-Za-z0-9.-]+$/;

/**
 * Normaliza el número de un animal (caravana / botón) o devuelve `null` si no es válido.
 * 1) Quita los extremos con `trim()` (espacios, tabulaciones, saltos de línea y
 *    espacios Unicode como el de no separación).
 * 2) Valida los caracteres sobre el texto ORIGINAL, antes de pasar a mayúsculas:
 *    `toUpperCase()` convierte "ß" en "SS" y "ı" en "I", y esas letras entrarían
 *    como válidas por error.
 * 3) Recién entonces pasa a mayúsculas. El resultado es lo que se guarda y se busca.
 */
export function normalizarNumero(texto: string): string | null {
  const limpio = texto.trim();
  if (limpio.length < 1 || limpio.length > MAX_NUMERO) return null;
  if (!FORMATO_NUMERO.test(limpio)) return null;
  return limpio.toUpperCase();
}

// Como normalizarNumero, pero con un mensaje distinto para cada problema.
// Devuelve el número ya normalizado.
export const numeroSchema = z
  .string({ error: 'El número del animal es obligatorio' })
  .transform((texto) => texto.trim())
  .pipe(
    z
      .string()
      .refine((n) => n.length >= 1, { error: 'El número del animal es obligatorio', abort: true })
      .refine((n) => n.length <= MAX_NUMERO, {
        error: `El número del animal no puede superar los ${MAX_NUMERO} caracteres`,
        abort: true,
      })
      .refine((n) => FORMATO_NUMERO.test(n), {
        error: 'El número solo puede tener letras sin tildes, números, guion y punto (sin espacios)',
      }),
  )
  .transform((n) => n.toUpperCase());

// ---------------------------------------------------------------------------
// Catálogo de semen y toros y anulación de eventos (spec 003)
// ---------------------------------------------------------------------------

const MAX_NOMBRE_SEMEN = 50;
const MAX_RAZA_SEMEN = 50;
const MAX_MOTIVO_ANULACION = 200;

// Nombre de una entrada del catálogo: se normaliza igual que el de los lotes
// (RF-3) y se valida el resultado, que es lo que se guarda y se compara.
export const nombreSemenSchema = z
  .string({ error: 'El nombre del semen o toro es obligatorio' })
  .transform(normalizarNombre)
  .pipe(
    z
      .string()
      .refine((nombre) => largo(nombre) >= 1, {
        error: 'El nombre del semen o toro es obligatorio',
        abort: true,
      })
      .refine((nombre) => largo(nombre) <= MAX_NOMBRE_SEMEN, {
        error: `El nombre del semen o toro no puede superar los ${MAX_NOMBRE_SEMEN} caracteres`,
      }),
  );

// Raza opcional. Texto o `null`; vacía o de solo espacios pasa a `null` ("sin raza"),
// que es lo único que acepta la base para "sin raza" (CHECK semen_toros_raza_valida).
// El "opcional" (que el campo no venga) lo agrega cada ruta con `.optional()`.
export const razaSemenSchema = z
  .string({ error: 'La raza debe ser un texto' })
  .nullable()
  .transform((texto) => {
    if (texto === null) return null;
    const limpio = normalizarNombre(texto);
    return limpio === '' ? null : limpio;
  })
  .refine((texto) => texto === null || largo(texto) <= MAX_RAZA_SEMEN, {
    error: `La raza no puede superar los ${MAX_RAZA_SEMEN} caracteres`,
  });

// Motivo de una anulación: obligatorio, hasta 200 caracteres sin contar los extremos (RF-19, RF-20).
export const motivoAnulacionSchema = z
  .string({ error: 'El motivo de la anulación es obligatorio' })
  .transform((texto) => texto.normalize('NFC').trim())
  .pipe(
    z
      .string()
      .refine((motivo) => largo(motivo) >= 1, {
        error: 'El motivo de la anulación es obligatorio',
        abort: true,
      })
      .refine((motivo) => largo(motivo) <= MAX_MOTIVO_ANULACION, {
        error: `El motivo no puede superar los ${MAX_MOTIVO_ANULACION} caracteres`,
      }),
  );

const MAX_ANOMALIAS = 200;

// Anomalías detectadas en un tacto (RF-17): texto opcional de hasta 200 caracteres sin contar
// los extremos. Vacío, de solo espacios o `null` se guarda como `null` ("sin anomalías").
export const anomaliasSchema = z
  .string({ error: 'Las anomalías tienen que ser un texto' })
  .nullish()
  .transform((texto) => {
    const limpio = texto?.normalize('NFC').trim() ?? '';
    return limpio === '' ? null : limpio;
  })
  .refine((texto) => texto === null || largo(texto) <= MAX_ANOMALIAS, {
    error: `Las anomalías no pueden superar los ${MAX_ANOMALIAS} caracteres`,
  });

// ---------------------------------------------------------------------------
// Crías de un parto (spec 004, RF-5 a RF-7)
// ---------------------------------------------------------------------------

const MAX_OBSERVACIONES_CRIA = 200;

// Observaciones de una cría: texto opcional de hasta 200 caracteres sin contar los extremos.
// Vacío, de solo espacios o `null` se guarda como `null` ("sin observaciones"), que es lo único
// que acepta la base (CHECK crias_observaciones_largo).
const observacionesCriaSchema = z
  .string({ error: 'Las observaciones tienen que ser un texto' })
  .nullish()
  .transform((texto) => {
    const limpio = texto?.normalize('NFC').trim() ?? '';
    return limpio === '' ? null : limpio;
  })
  .refine((texto) => texto === null || largo(texto) <= MAX_OBSERVACIONES_CRIA, {
    error: `Las observaciones no pueden superar los ${MAX_OBSERVACIONES_CRIA} caracteres`,
  });

// El número de una cría: la web puede mandar "" o null cuando no corresponde (cría nacida muerta);
// eso cuenta como "no vino". Un texto con algo escrito se valida con las reglas de la spec 002.
const numeroCriaSchema = z.preprocess(
  (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
  numeroSchema.optional(),
);

const criaSchema = z
  .object({
    sexo: z.enum(['HEMBRA', 'MACHO'], { error: 'El sexo de la cría tiene que ser hembra o macho' }),
    // Ausente = vive. Un texto o un número NO se convierten: 400 (z.boolean no es "coerce").
    nacidaMuerta: z.boolean({ error: '«Nació muerta» tiene que ser verdadero o falso' }).default(false),
    numero: numeroCriaSchema,
    observaciones: observacionesCriaSchema,
    // Cualquier otro campo de la cría se descarta: z.object ignora lo que no declara.
  })
  .superRefine((cria, ctx) => {
    if (cria.nacidaMuerta && cria.numero !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['numero'], message: 'Una cría nacida muerta no lleva número' });
    }
    if (!cria.nacidaMuerta && cria.numero === undefined) {
      ctx.addIssue({ code: 'custom', path: ['numero'], message: 'El número de la cría viva es obligatorio' });
    }
  });

// Lista de 1 o 2 crías. Dos crías vivas del mismo parto no pueden repetir número, aunque cambien
// las mayúsculas (el número ya viene normalizado a mayúsculas).
export const criasPartoSchema = z
  .array(criaSchema, { error: 'Las crías tienen que ser una lista' })
  .min(1, { error: 'El parto necesita al menos una cría' })
  .max(2, { error: 'Un parto puede tener como máximo dos crías' })
  .superRefine((crias, ctx) => {
    const vistos = new Set<string>();
    crias.forEach((cria, i) => {
      if (cria.nacidaMuerta || cria.numero === undefined) return;
      if (vistos.has(cria.numero)) {
        ctx.addIssue({ code: 'custom', path: [i, 'numero'], message: 'Las dos crías no pueden tener el mismo número' });
      }
      vistos.add(cria.numero);
    });
  });
