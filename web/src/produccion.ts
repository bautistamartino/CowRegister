import type { TurnoOrdeno } from './api';

// Utilidades de la producción de leche (spec 008). La API es la que valida de verdad.

export const NOMBRE_TURNO: Record<TurnoOrdeno, string> = { manana: 'Mañana', tarde: 'Tarde' };

// El usuario tipea coma o punto ("12,5" o "12.5"); la API solo acepta punto (RF-2).
// No se convierte a número acá: se manda el texto para no introducir errores de coma flotante.
export function litrosParaApi(texto: string): string {
  return texto.trim().replace(',', '.');
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
