import { z } from 'zod';
import { FECHA_MINIMA, hoyArgentina } from '../animales/reglas.js';
import { fechaEventoSchema } from '../reproduccion/fechas.js';
import { ahora } from '../reloj.js';

// Validación de la carga de producción (spec 008, RF-2 a RF-4). Todo lo que NO necesita la base.

type ResultadoLitros = { ok: true; decimas: number } | { ok: false; mensaje: string };

/**
 * Litros (número JSON o texto) -> décimas enteras, sin pasar nunca por coma flotante.
 * Formato aceptado: `d`, `dd`, `d.d` o `dd.d`, sin signo, sin notación científica y sin coma
 * (la coma la convierte la pantalla). Un número JSON se pasa primero a texto con String(n): así
 * 0.1 + 0.2 (0.30000000000000004) o 1e21 se rechazan por su forma, no por un cálculo.
 */
export function litrosADecimas(valor: unknown): ResultadoLitros {
  if (valor === undefined || valor === null) return { ok: false, mensaje: 'Los litros son obligatorios' };
  if (typeof valor !== 'string' && typeof valor !== 'number') return { ok: false, mensaje: 'Los litros tienen que ser un número' };

  const texto = typeof valor === 'number' ? String(valor) : valor;
  if (texto.trim() === '') return { ok: false, mensaje: 'Los litros son obligatorios' };

  const formato = /^(\d{1,2})(?:\.(\d))?$/.exec(texto);
  if (formato) return { ok: true, decimas: Number(formato[1]) * 10 + Number(formato[2] ?? 0) };

  // No tiene el formato: se explica el motivo más claro.
  if (texto.startsWith('-')) return { ok: false, mensaje: 'Los litros no pueden ser negativos' };
  const numerico = /^\d+(?:\.(\d+))?$/.exec(texto);
  if (numerico) {
    if ((numerico[1]?.length ?? 0) > 1) return { ok: false, mensaje: 'Los litros admiten un solo decimal (por ejemplo 12.5)' };
    return { ok: false, mensaje: 'Los litros no pueden superar 99,9' };
  }
  return { ok: false, mensaje: 'Los litros tienen que ser un número con punto decimal, por ejemplo 12.5' };
}

const litrosSchema = z.unknown().transform((valor, ctx) => {
  const r = litrosADecimas(valor);
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.mensaje });
    return z.NEVER;
  }
  return r.decimas;
});

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
const horaTabletSchema = z
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

// Cuerpo de POST /api/animales/:id/produccion. Cualquier otro campo (por ejemplo un
// establecimientoId) se descarta: z.object ignora lo que no declara.
// La fecha se compara con el "hoy" de Argentina en el momento de validar (reloj inyectable en los tests).
export const cargaSchema = z
  .object({
    fecha: fechaEventoSchema,
    turno: z.enum(['manana', 'tarde'], { error: 'El turno tiene que ser mañana o tarde' }),
    litros: litrosSchema,
    id: z.uuid({ error: 'El identificador del registro tiene que ser un UUID válido' }).optional(),
    cargadoEnDispositivo: horaTabletSchema,
  })
  .superRefine((datos, ctx) => {
    if (datos.fecha > hoyArgentina(ahora())) {
      ctx.addIssue({ code: 'custom', path: ['fecha'], message: 'La fecha no puede ser futura' });
    } else if (datos.fecha < FECHA_MINIMA) {
      ctx.addIssue({ code: 'custom', path: ['fecha'], message: 'La fecha no puede ser anterior al 01/01/2000' });
    }
  })
  .transform(({ fecha, turno, litros, id, cargadoEnDispositivo }) => ({
    fecha,
    turno: turno === 'manana' ? ('MANANA' as const) : ('TARDE' as const),
    litrosDecimas: litros,
    id: id?.toLowerCase(),
    cargadoEnDispositivo: cargadoEnDispositivo ?? null, // Date o null
  }));

export type CargaProduccion = z.output<typeof cargaSchema>;
