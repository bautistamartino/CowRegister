import { z } from 'zod';
import { ahora } from './reloj.js';

// Hora en que se cargó un registro en la tablet: la comparten los litros (spec 009) y los cinco eventos
// reproductivos (spec 010). Antes vivía en produccion/validacion.ts; se extrajo SIN cambiar su comportamiento.

// Hora en que se cargó el registro en la tablet (spec 009, RF-26 a RF-28): fecha y hora ISO CON zona
// (`2026-11-12T08:15:00-03:00` o terminada en Z). Es solo informativa.
const HORA_TABLET = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const TOLERANCIA_RELOJ_MS = 5 * 60 * 1000; // la tablet puede estar hasta 5 minutos adelantada
const MINIMA_HORA_TABLET = Date.parse('2000-01-01T00:00:00Z');
const MENSAJE_HORA_TABLET = 'La hora de carga de la tablet no es una fecha y hora válida';

// JavaScript "corrige" un 31 de febrero a marzo en vez de rechazarlo: se comprueba aparte que el día exista.
function diaExiste(texto: string): boolean {
  const [anio, mes, dia] = texto.slice(0, 10).split('-').map(Number) as [number, number, number];
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  return f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia;
}

// Devuelve la hora (Date) o null si no vino, y rechaza (400) un formato inválido. Una hora válida pero
// de un reloj desfasado (más de 5 minutos adelantada respecto del servidor, o anterior al 2000) NO
// rechaza la carga: se descarta el dato (null) y el litro se guarda igual.
export const horaTabletSchema = z
  .unknown()
  .transform((valor, ctx): Date | null => {
    if (valor === undefined || valor === null) return null;
    const instante = typeof valor === 'string' && HORA_TABLET.test(valor) && diaExiste(valor) ? Date.parse(valor) : Number.NaN;
    if (Number.isNaN(instante)) {
      ctx.addIssue({ code: 'custom', message: MENSAJE_HORA_TABLET });
      return z.NEVER;
    }
    if (instante > ahora().getTime() + TOLERANCIA_RELOJ_MS || instante < MINIMA_HORA_TABLET) return null;
    return new Date(instante);
  })
  .optional(); // sin el campo la clave puede faltar (zod exige .optional() para eso)
