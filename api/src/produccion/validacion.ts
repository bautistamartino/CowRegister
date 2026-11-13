import { z } from 'zod';
import { FECHA_MINIMA, hoyArgentina } from '../animales/reglas.js';
import { fechaEventoSchema } from '../reproduccion/fechas.js';
import { ahora } from '../reloj.js';
import { horaTabletSchema } from '../horaTablet.js';

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
