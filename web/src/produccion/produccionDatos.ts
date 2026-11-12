import type { TurnoOrdeno } from '../compartido/api';

// Utilidades de la producción de leche (spec 008). La API es la que valida de verdad.

export const NOMBRE_TURNO: Record<TurnoOrdeno, string> = { manana: 'Mañana', tarde: 'Tarde' };

// El usuario tipea coma o punto ("12,5" o "12.5"); la API solo acepta punto (RF-2).
// No se convierte a número acá: se manda el texto para no introducir errores de coma flotante.
export function litrosParaApi(texto: string): string {
  return texto.trim().replace(',', '.');
}

export type ResultadoLitros = { ok: true; litros: string } | { ok: false; mensaje: string };

// Mismas reglas y MISMOS mensajes que la API (api/src/produccion/validacion.ts, spec 008): sirve para
// validar sin conexión (spec 009, RF-19). Devuelve los litros como texto con punto ("12.5"): nunca se
// convierte a número, para no introducir errores de coma flotante.
export function validarLitros(texto: string): ResultadoLitros {
  const t = litrosParaApi(texto);
  if (t === '') return { ok: false, mensaje: 'Los litros son obligatorios' };
  if (/^(\d{1,2})(?:\.(\d))?$/.test(t)) return { ok: true, litros: t };
  if (t.startsWith('-')) return { ok: false, mensaje: 'Los litros no pueden ser negativos' };
  const numerico = /^\d+(?:\.(\d+))?$/.exec(t);
  if (numerico) {
    if ((numerico[1]?.length ?? 0) > 1) return { ok: false, mensaje: 'Los litros admiten un solo decimal (por ejemplo 12.5)' };
    return { ok: false, mensaje: 'Los litros no pueden superar 99,9' };
  }
  return { ok: false, mensaje: 'Los litros tienen que ser un número con punto decimal, por ejemplo 12.5' };
}

// Litros con UN decimal y coma, como se habla en el tambo: 12.5 -> "12,5", 8 -> "8,0".
export function formatearLitros(litros: number): string {
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(litros);
}

// "11/11/2026 18:30" en hora de Argentina.
export function textoMomento(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
