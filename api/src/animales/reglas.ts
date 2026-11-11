import type { EstadoAnimal, Sexo } from '../generated/prisma/client.js';

// Reglas de negocio de los animales que no dependen de la base ni de Express,
// así se pueden probar solas y reutilizar en el alta y en la planilla.

// Estados con los que se puede dar de alta un animal (BAJA nunca) (RF-5).
export const ESTADOS_INICIALES = ['RECIEN_NACIDO', 'VAQUILLONA', 'EN_ORDENE', 'SECA'] as const satisfies readonly EstadoAnimal[];

// Un macho solo puede ser recién nacido; una hembra, cualquier estado inicial (RF-5).
export function puedeTenerEstado(sexo: Sexo, estado: EstadoAnimal): boolean {
  if (sexo === 'MACHO') return estado === 'RECIEN_NACIDO';
  return (ESTADOS_INICIALES as readonly EstadoAnimal[]).includes(estado);
}

// "Hoy" como texto AAAA-MM-DD según la hora de Argentina (RF-6). El servidor puede
// estar en UTC: entre las 21 y las 24 de Argentina ya es "mañana" en UTC, y
// compararía mal. 'en-CA' da el formato AAAA-MM-DD. Recibe el instante como
// parámetro para poder probar el cambio de día.
export function hoyArgentina(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(ahora);
}

export const FECHA_MINIMA = '2000-01-01';

// ¿Es un texto AAAA-MM-DD que existe en el calendario? ("2021-02-31" no.)
export function esFechaValida(texto: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Date.UTC "desborda" los días inexistentes (31/02 pasa a marzo): se compara de vuelta.
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/**
 * Valida la fecha de nacimiento (RF-6). Devuelve el mensaje de error o `null` si está bien.
 * Todas las fechas son textos AAAA-MM-DD, que se comparan como texto (el orden
 * alfabético coincide con el cronológico).
 * @param fechaMadre fecha de nacimiento de la madre, si se conoce: la cría tiene que ser posterior.
 */
export function validarFechaNacimiento(fecha: string, hoy: string, fechaMadre?: string | null): string | null {
  if (!esFechaValida(fecha)) return 'La fecha de nacimiento no es una fecha válida';
  if (fecha > hoy) return 'La fecha de nacimiento no puede ser futura';
  if (fecha < FECHA_MINIMA) return 'La fecha de nacimiento no puede ser anterior al 01/01/2000';
  if (fechaMadre && fecha <= fechaMadre) return 'La fecha de nacimiento tiene que ser posterior a la de la madre';
  return null;
}

// Convierte AAAA-MM-DD en el Date (UTC, medianoche) que se guarda en la columna @db.Date.
export function fechaADate(texto: string): Date {
  return new Date(`${texto}T00:00:00.000Z`);
}
