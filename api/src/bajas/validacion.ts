import { z } from 'zod';
import { FECHA_MINIMA } from '../animales/reglas.js';
import { aFechaCorta, fechaEventoSchema } from '../reproduccion/fechas.js';

// Validación de las bajas por venta o muerte (spec 006). Acá vive todo lo que NO necesita la base:
// el cuerpo de los pedidos (zod, mensajes en español) y las reglas de la fecha de baja.

// ─── Motivo: la API habla en minúsculas, la base guarda el enum ───────────────

export type MotivoBajaApi = 'venta' | 'muerte';
export type MotivoBajaCompleto = MotivoBajaApi | 'parto_anulado';

const DE_API_A_BASE = { venta: 'VENTA', muerte: 'MUERTE' } as const;

export const motivoABase = (motivo: MotivoBajaApi) => DE_API_A_BASE[motivo];

// Valor del enum de la base → texto de la API ("VENTA" → "venta", "PARTO_ANULADO" → "parto_anulado").
export function motivoATexto(motivo: 'VENTA' | 'MUERTE' | 'PARTO_ANULADO'): MotivoBajaCompleto {
  return motivo === 'VENTA' ? 'venta' : motivo === 'MUERTE' ? 'muerte' : 'parto_anulado';
}

// ─── Cuerpo de los pedidos ────────────────────────────────────────────────────

const MAX_TEXTO = 200;

// Largo en "letras" (code points), igual que en el resto de la API.
const largo = (texto: string) => [...texto].length;

// Solo "venta" o "muerte", exactos: "VENTA", " venta", "", null, un número o "parto anulado" dan 400.
const motivoSchema = z.enum(['venta', 'muerte'], { error: 'El motivo tiene que ser venta o muerte' });

// Observaciones: opcionales. null, ausentes, vacías o de solo espacios quedan como null ("sin
// observaciones", que es lo único que acepta la base). Un tipo que no es texto da 400.
const observacionesSchema = z
  .string({ error: 'Las observaciones tienen que ser un texto' })
  .nullish()
  .transform((texto) => {
    const limpio = texto?.normalize('NFC').trim() ?? '';
    return limpio === '' ? null : limpio;
  })
  .refine((texto) => texto === null || largo(texto) <= MAX_TEXTO, {
    error: `Las observaciones no pueden superar los ${MAX_TEXTO} caracteres`,
  });

// Cualquier otro campo del cuerpo (por ejemplo un establecimientoId) se descarta: z.object ignora lo no declarado.
export const bajaSchema = z.object({ motivo: motivoSchema, fecha: fechaEventoSchema, observaciones: observacionesSchema });

// Motivo de la reversión: obligatorio, texto, recortado, de 1 a 200 caracteres.
const motivoReversionSchema = z
  .string({ error: 'El motivo de la reversión es obligatorio' })
  .transform((texto) => texto.normalize('NFC').trim())
  .pipe(
    z
      .string()
      .refine((m) => largo(m) >= 1, { error: 'El motivo de la reversión es obligatorio', abort: true })
      .refine((m) => largo(m) <= MAX_TEXTO, { error: `El motivo no puede superar los ${MAX_TEXTO} caracteres` }),
  );

export const reversionSchema = z.object({ motivoReversion: motivoReversionSchema });

// ─── Fecha de la baja (RF-3) ─────────────────────────────────────────────────

type ContextoFecha = {
  hoy: string; // el "hoy" de Argentina (hoyArgentina(ahora()))
  nacimiento: string | null; // fecha de nacimiento del animal, si se conoce
  ultimoEvento: string | null; // fecha del último evento NO anulado del animal que no sea una baja
};

/**
 * Valida la fecha de una baja que ya tiene formato correcto. Devuelve el mensaje de error (con las
 * fechas como dd/mm/aaaa) o `null` si está bien. Una fecha igual a la del último evento se acepta.
 * No se compara con las crías ni con la madre (dar de baja a una madre no revisa a sus crías).
 */
export function validarFechaBaja(fecha: string, { hoy, nacimiento, ultimoEvento }: ContextoFecha): string | null {
  if (fecha > hoy) return `La fecha de la baja no puede ser futura (hoy es ${aFechaCorta(hoy)})`;
  if (fecha < FECHA_MINIMA) return 'La fecha de la baja no puede ser anterior al 01/01/2000';
  if (nacimiento && fecha < nacimiento) {
    return `La fecha de la baja no puede ser anterior al nacimiento del animal (${aFechaCorta(nacimiento)})`;
  }
  if (ultimoEvento && fecha < ultimoEvento) {
    return `La fecha de la baja no puede ser anterior a la del último evento del animal (${aFechaCorta(ultimoEvento)})`;
  }
  return null;
}
