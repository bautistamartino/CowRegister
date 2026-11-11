import { z } from 'zod';
import { FECHA_MINIMA, esFechaValida } from '../animales/reglas.js';

// Fechas de los eventos reproductivos (spec 003). Todas son textos AAAA-MM-DD (solo día, sin
// horas ni husos horarios) y se comparan como texto: el orden alfabético es el cronológico.

// Días de gestación: fecha probable de parto = servicio + 283 días (constitución §4).
export const DIAS_GESTACION = 283;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Texto AAAA-MM-DD → milisegundos en UTC a medianoche. Hacer la cuenta en UTC evita los
// corrimientos por horario de verano o por el huso del servidor.
const aMs = (texto: string) => Date.parse(`${texto}T00:00:00.000Z`);

// Suma (o resta, con n negativo) días a una fecha.
export function sumarDias(fecha: string, n: number): string {
  return new Date(aMs(fecha) + n * MS_POR_DIA).toISOString().slice(0, 10);
}

// Días desde `desde` hasta `hasta`: positivo si `hasta` es posterior, negativo si ya pasó.
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aMs(hasta) - aMs(desde)) / MS_POR_DIA);
}

const MENSAJE_FORMATO = 'La fecha no es válida: usá el formato AAAA-MM-DD con un día que exista';

// Fecha de un evento en el cuerpo de un pedido: obligatoria, formato AAAA-MM-DD y existente.
// Las reglas que dependen del animal (futura, nacimiento, último evento) van en validarFechaEvento.
export const fechaEventoSchema = z
  .string({ error: 'La fecha es obligatoria' })
  .refine(esFechaValida, { error: MENSAJE_FORMATO });

type ContextoFecha = {
  hoy: string; // el "hoy" de Argentina (hoyArgentina(ahora()))
  nacimiento: string | null; // fecha de nacimiento del animal, si se conoce
  ultimoEvento: string | null; // fecha del último evento NO anulado del animal
};

/**
 * Valida la fecha de un evento (RF-18). Devuelve el mensaje de error o `null` si está bien.
 * Rechaza: formato o día inexistente, futura, anterior al 01/01/2000, anterior al nacimiento
 * y anterior al último evento no anulado. Una fecha igual a la del último evento se acepta.
 */
export function validarFechaEvento(fecha: string, { hoy, nacimiento, ultimoEvento }: ContextoFecha): string | null {
  if (!esFechaValida(fecha)) return MENSAJE_FORMATO;
  if (fecha > hoy) return 'La fecha no puede ser futura';
  if (fecha < FECHA_MINIMA) return 'La fecha no puede ser anterior al 01/01/2000';
  if (nacimiento && fecha < nacimiento) return 'La fecha no puede ser anterior al nacimiento del animal';
  if (ultimoEvento && fecha < ultimoEvento) {
    return `La fecha no puede ser anterior a la del último evento (${aFechaCorta(ultimoEvento)}). Si falta cargar un evento anterior, primero anulá los posteriores`;
  }
  return null;
}

// AAAA-MM-DD → dd/mm/aaaa, como se muestra en los mensajes.
export function aFechaCorta(fecha: string): string {
  const [a, m, d] = fecha.split('-');
  return `${d}/${m}/${a}`;
}
