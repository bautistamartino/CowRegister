import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { fechaADate, hoyArgentina } from '../animales/reglas.js';
import type { Prisma, TurnoOrdeno } from '../generated/prisma/client.js';
import { sumarDias } from '../reproduccion/fechas.js';
import { ahora } from '../reloj.js';
import { topeProduccionFicha } from '../topes.js';
import { decimasALitros, redondearDecimas } from './formato.js';
import { sugerirOrdeno } from './sugerencia.js';

// Lectura de la producción de una vaca (spec 008, RF-12 a RF-16, RF-33). Todo se filtra por el
// establecimientoId de la sesión. Los nombres de quien cargó y anuló se leen con `select`
// explícito: nunca viaja el id de un usuario, su email ni su hash.

export const NO_ENCONTRADO = 'Animal no encontrado';

// Un id mal formado responde 404, igual que uno inexistente, ajeno o de baja.
export function idUuid(texto: string | string[] | undefined): string {
  const id = z.uuid().safeParse(texto);
  if (!id.success) throw new HttpError(404, NO_ENCONTRADO);
  return id.data.toLowerCase();
}

// Columnas de un registro tal como se lee (cargar, anular y ficha usan la misma).
export const SELECT_REGISTRO = {
  id: true,
  animalId: true,
  fecha: true,
  turno: true,
  litrosDecimas: true,
  loteNombre: true,
  creadoEn: true,
  registradoPor: { select: { nombre: true } },
  anuladoEn: true,
  motivoAnulacion: true,
  anuladoPor: { select: { nombre: true } },
} as const satisfies Prisma.ProduccionSelect;

export type FilaRegistro = Prisma.ProduccionGetPayload<{ select: typeof SELECT_REGISTRO }>;

export const turnoATexto = (turno: TurnoOrdeno): 'manana' | 'tarde' => (turno === 'MANANA' ? 'manana' : 'tarde');
const aTextoFecha = (fecha: Date) => fecha.toISOString().slice(0, 10);

// Un registro como lo ve la API: litros con un decimal, "anulado" con quién, cuándo y motivo.
export function armarRegistro(fila: FilaRegistro) {
  return {
    id: fila.id,
    animalId: fila.animalId,
    fecha: aTextoFecha(fila.fecha),
    turno: turnoATexto(fila.turno),
    litros: decimasALitros(fila.litrosDecimas),
    loteNombre: fila.loteNombre, // null = "Sin lote"
    registradoPor: fila.registradoPor.nombre,
    registradoEn: fila.creadoEn,
    anulado: fila.anuladoEn ? { por: fila.anuladoPor?.nombre ?? null, en: fila.anuladoEn, motivo: fila.motivoAnulacion } : null,
  };
}

// Orden de la ficha y del "último registro": fecha y turno descendentes (la tarde antes que la
// mañana, por el orden del enum) y, a igual ordeño, el más reciente cargado.
const ORDEN: Prisma.ProduccionOrderByWithRelationInput[] = [{ fecha: 'desc' }, { turno: 'desc' }, { creadoEn: 'desc' }];

/**
 * Ficha de producción de un animal ya validado por la ruta (activo o de baja). Devuelve hasta
 * `topeProduccionFicha()` registros (los más recientes, anulados incluidos y marcados), el total,
 * el promedio por vaca-día de los últimos 30 días corridos, el último registro no anulado y, solo
 * si `conSugerencia` (ficha activa), la fecha y el turno propuestos para cargar.
 */
export async function leerFicha(animalId: string, establecimientoId: string, conSugerencia: boolean) {
  const donde = { animalId, establecimientoId };
  const tope = topeProduccionFicha();
  const hoy = hoyArgentina(ahora());
  const desde30 = sumarDias(hoy, -29); // hoy y los 29 días anteriores

  const [total, filas, ultimo, ventana] = await Promise.all([
    prisma.produccion.count({ where: donde }),
    prisma.produccion.findMany({ where: donde, orderBy: ORDEN, take: tope, select: SELECT_REGISTRO }),
    prisma.produccion.findFirst({
      where: { ...donde, anuladoEn: null },
      orderBy: ORDEN,
      select: { fecha: true, turno: true, litrosDecimas: true },
    }),
    prisma.produccion.findMany({
      where: { ...donde, anuladoEn: null, fecha: { gte: fechaADate(desde30), lte: fechaADate(hoy) } },
      select: { fecha: true, litrosDecimas: true },
    }),
  ]);

  // Promedio por vaca-día: litros de la ventana / días distintos con registro (suma de los turnos
  // del día). Todo en décimas enteras; se redondea una sola vez al final.
  const sumaDecimas = ventana.reduce((s, r) => s + r.litrosDecimas, 0);
  const dias = new Set(ventana.map((r) => aTextoFecha(r.fecha))).size;

  return {
    ...armarFichaProduccion({ filas, total, sumaDecimas, dias, ultimo, tope }),
    ...(conSugerencia && { sugerencia: sugerirOrdeno(ahora()) }),
  };
}

/**
 * Arma la ficha de producción (sin sugerencia) desde lo ya leído. Es PURA y la comparten la ficha
 * individual y la copia local (spec 009), que lee todo por tambo con consultas masivas: así las dos
 * respuestas son idénticas. `sumaDecimas` y `dias` son los de los últimos 30 días (registros no anulados).
 */
export function armarFichaProduccion(d: {
  filas: FilaRegistro[];
  total: number;
  sumaDecimas: number;
  dias: number;
  ultimo: { fecha: Date; turno: TurnoOrdeno; litrosDecimas: number } | null;
  tope: number;
}) {
  const promedio = redondearDecimas(d.sumaDecimas, d.dias);
  return {
    registros: d.filas.map(armarRegistro),
    total: d.total,
    mostrados: d.filas.length,
    truncado: d.total > d.tope,
    tope: d.tope,
    promedio30Dias: promedio === null ? null : decimasALitros(promedio),
    ultimoRegistro: d.ultimo
      ? { fecha: aTextoFecha(d.ultimo.fecha), turno: turnoATexto(d.ultimo.turno), litros: decimasALitros(d.ultimo.litrosDecimas) }
      : null,
  };
}
