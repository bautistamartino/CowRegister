// Lógica de la copia local del tambo (spec 009, RF-4 a RF-9). Es "pura": no usa React ni el
// navegador. Recibe el almacén y la función de descarga, así se prueba con Vitest.

import { ApiError, type CopiaLocal } from '../compartido/api';
import { ErrorSinEspacio, type Almacen, type Propietario } from './almacen';

// Por qué no se pudo actualizar la copia:
//   red       = no hay conexión o se cortó la descarga.
//   tope      = el tambo tiene más animales de los que entran (422, RF-8).
//   espacio   = la tablet no tiene lugar para guardar (RF-9).
//   servidor  = el servidor falló o respondió algo que no es la copia (portal de WiFi, 5xx...).
//   almacen   = falló la escritura local por otra causa.
export type MotivoFalla = 'red' | 'tope' | 'espacio' | 'servidor' | 'almacen';

export type ResultadoActualizacion =
  | { ok: true; primera: boolean; generadaEn: string; totalAnimales: number }
  | {
      ok: false;
      primera: boolean; // true = no había copia (el uso queda bloqueado)
      motivo: MotivoFalla;
      mensaje: string;
      conservada: boolean; // true = se conserva la copia anterior completa
      generadaEn: string | null; // fecha "al día de" de la copia conservada
    };

// Revisa que lo descargado tenga la forma de una copia completa. Un portal cautivo de WiFi puede
// devolver una página con código 200: eso NO es una copia y nunca debe guardarse.
function esCopiaValida(x: unknown): x is CopiaLocal {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as Partial<CopiaLocal>;
  return (
    typeof c.generadaEn === 'string' &&
    !Number.isNaN(Date.parse(c.generadaEn)) &&
    Array.isArray(c.lotes) &&
    Array.isArray(c.animales) &&
    c.totalAnimales === c.animales.length // una copia cortada o recortada no coincide con su total
  );
}

// Descarga la copia y la guarda. Nunca lanza: devuelve el resultado.
//  - Primera descarga (no hay copia): si falla, no queda nada.
//  - Actualización: si falla (descarga o escritura), queda la copia anterior completa y su fecha.
export async function actualizarCopia(args: {
  almacen: Almacen;
  propietario: Propietario;
  descargar: () => Promise<CopiaLocal>;
}): Promise<ResultadoActualizacion> {
  const { almacen, propietario, descargar } = args;
  const anterior = await almacen.leerMeta().catch(() => null);
  const primera = anterior === null;

  const falla = (motivo: MotivoFalla, mensaje: string): ResultadoActualizacion => ({
    ok: false,
    primera,
    motivo,
    mensaje,
    conservada: !primera,
    generadaEn: anterior?.generadaEn ?? null,
  });

  // 1. Descarga (todavía no se tocó nada de lo guardado).
  let copia: unknown;
  try {
    copia = await descargar();
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 0) return falla('red', 'No se pudo conectar con el servidor. Revisá tu conexión.');
      if (e.status === 422) return falla('tope', e.message); // "El tambo tiene más animales de los que entran…"
      return falla('servidor', e.message);
    }
    return falla('servidor', 'No se pudo descargar la copia del tambo');
  }
  if (!esCopiaValida(copia)) return falla('servidor', 'El servidor respondió algo que no es la copia del tambo');

  // 2. Guardado atómico: o queda la nueva completa o la anterior intacta.
  try {
    await almacen.reemplazarCopia(copia, propietario);
  } catch (e) {
    if (e instanceof ErrorSinEspacio) return falla('espacio', e.message);
    return falla('almacen', 'No se pudo guardar la copia en la tablet');
  }
  return { ok: true, primera, generadaEn: copia.generadaEn, totalAnimales: copia.totalAnimales };
}

// "12/11/2026 12:05" en hora de Argentina (para "Datos al día de…").
export function formatearFechaHora(iso: string): string {
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? '';
  return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}`;
}
