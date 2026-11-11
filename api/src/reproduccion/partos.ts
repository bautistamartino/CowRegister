import { aFechaCorta, diasEntre } from './fechas.js';
import type { EventoCalculo } from './situacion.js';

// Reglas puras del parto (spec 004). No tocan la base.

// Separación mínima entre dos partos no anulados de la misma vaca (RF-11).
export const DIAS_MINIMOS_ENTRE_PARTOS = 200;

/**
 * Devuelve el mensaje de rechazo (para el 409) si ya hay un parto no anulado a menos de 200 días
 * de `fecha`, o `null` si está bien. Protege de cargar dos veces el mismo parto; un aborto o un
 * parto prematuro dentro del plazo se registra como tacto "vacía", y el mensaje lo sugiere.
 * `lista` son los eventos ya existentes de la vaca.
 */
export function validarSeparacionPartos(lista: readonly EventoCalculo[], fecha: string): string | null {
  const cercano = lista
    .filter((e) => e.tipo === 'PARTO' && !e.anulado)
    .find((e) => Math.abs(diasEntre(e.fecha, fecha)) < DIAS_MINIMOS_ENTRE_PARTOS);
  if (!cercano) return null;
  return `La vaca ya tiene un parto del ${aFechaCorta(cercano.fecha)}: tiene que haber al menos ${DIAS_MINIMOS_ENTRE_PARTOS} días entre dos partos. Si fue un aborto o un parto prematuro, registralo como un tacto "vacía"`;
}
