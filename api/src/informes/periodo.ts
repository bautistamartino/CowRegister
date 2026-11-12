import { z } from 'zod';
import { FECHA_MINIMA, esFechaValida } from '../animales/reglas.js';
import { sumarDias } from '../reproduccion/fechas.js';

// Período de los informes (spec 007, RF-15). Son funciones puras: se prueban sin base.

// `desde` y `hasta` son obligatorios y tienen que ser TEXTO. Si el cliente repite un parámetro
// (`desde=a&desde=b`) Express lo entrega como arreglo, y un arreglo no es texto: da el mismo error.
// Cualquier otra cosa de la query (por ejemplo un `establecimientoId`) se descarta: z.object
// ignora las claves que no conoce.
const MENSAJE_OBLIGATORIO = 'Indicá "Desde" y "Hasta" una sola vez, con el formato AAAA-MM-DD';
export const periodoSchema = z.object({
  desde: z.string({ error: MENSAJE_OBLIGATORIO }),
  hasta: z.string({ error: MENSAJE_OBLIGATORIO }),
});

const mensajeFecha = (campo: 'Desde' | 'Hasta') =>
  `La fecha "${campo}" no es válida: usá el formato AAAA-MM-DD con un día que exista`;

// Último día que puede tener un período que empieza en `desde`: el día anterior al quinto
// aniversario (el 29/02 se toma como 28/02). Ej.: desde 01/01/2000 -> hasta máximo 31/12/2004.
export function hastaMaximo(desde: string): string {
  const [anio, mes, dia] = desde.split('-') as [string, string, string];
  const diaAniversario = mes === '02' && dia === '29' ? '28' : dia;
  const aniversario = `${Number(anio) + 5}-${mes}-${diaAniversario}`;
  return sumarDias(aniversario, -1);
}

/**
 * Valida el período. Devuelve el mensaje de error (en español) o `null` si está bien.
 * Orden de los controles: formato y existencia, desde <= hasta, hasta no futura (`hoy` es el
 * hoy argentino), desde >= 01/01/2000 y máximo 5 años. Las fechas son textos AAAA-MM-DD y se
 * comparan como texto (el orden alfabético es el cronológico).
 */
export function validarPeriodo(desde: string, hasta: string, hoy: string): string | null {
  if (!esFechaValida(desde)) return mensajeFecha('Desde');
  if (!esFechaValida(hasta)) return mensajeFecha('Hasta');
  if (desde > hasta) return '"Desde" no puede ser posterior a "Hasta"';
  if (hasta > hoy) return '"Hasta" no puede ser una fecha futura';
  if (desde < FECHA_MINIMA) return '"Desde" no puede ser anterior al 01/01/2000';
  if (hasta > hastaMaximo(desde)) return 'El período no puede abarcar más de 5 años';
  return null;
}
