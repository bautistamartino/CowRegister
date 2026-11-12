import { prisma } from '../db.js';
import { HttpError, esErrorPrisma } from '../errores.js';
import { fechaADate } from '../animales/reglas.js';
import { aFechaCorta } from '../reproduccion/fechas.js';
import { bloquearAnimal } from '../reproduccion/bloqueo.js';
import { NO_ENCONTRADO, SELECT_REGISTRO, armarRegistro } from './leer.js';
import type { CargaProduccion } from './validacion.js';

const NOMBRE_TURNO = { MANANA: 'mañana', TARDE: 'tarde' } as const;

// Motivo por el que un animal activo no puede recibir una carga (RF-5), o null si puede.
function motivoDeEstado(sexo: string, estado: string): string | null {
  if (sexo === 'MACHO') return 'este animal es un macho';
  if (estado === 'EN_ORDENE') return null;
  if (estado === 'SECA') return 'esta vaca está seca';
  if (estado === 'VAQUILLONA') return 'esta vaca es una vaquillona';
  return 'esta vaca es una recién nacida';
}

/**
 * Carga los litros de una vaca en un ordeño (spec 008, RF-1 a RF-8, RF-34, RF-35).
 *
 * Todo en una transacción con la vaca BLOQUEADA (`FOR UPDATE`): dos pedidos sobre la misma vaca se
 * serializan, y el estado y el lote que se leen son los que se guardan. Orden de controles dentro
 * de la transacción: (1) repetición idempotente por `id`, (2) 409 por estado, (3) 409 por duplicado.
 * `datos` ya viene validado (zod); el animal inexistente, ajeno o de baja es 404.
 */
export async function cargarProduccion(entrada: {
  animalId: string;
  establecimientoId: string;
  usuarioId: string;
  datos: CargaProduccion;
}) {
  const { animalId, establecimientoId, usuarioId, datos } = entrada;
  const { fecha, turno, litrosDecimas, id, cargadoEnDispositivo } = datos;

  try {
    return await prisma.$transaction(
      async (tx) => {
        const animal = await bloquearAnimal(tx, animalId, establecimientoId);
        if (!animal) throw new HttpError(404, NO_ENCONTRADO);

        // 1. Idempotencia: el mismo id con los mismos datos devuelve el registro ya guardado. Se busca
        //    en TODA la tabla (el id es la clave primaria): si existe pero es de otro tambo, de otra
        //    vaca o con otros datos, 409 con un mensaje genérico que no dice de quién es.
        if (id) {
          const existente = await tx.produccion.findUnique({
            where: { id },
            select: { ...SELECT_REGISTRO, establecimientoId: true },
          });
          if (existente) {
            const mismo =
              existente.establecimientoId === establecimientoId &&
              existente.animalId === animalId &&
              existente.fecha.toISOString().slice(0, 10) === fecha &&
              existente.turno === turno &&
              existente.litrosDecimas === litrosDecimas;
            if (!mismo) throw new HttpError(409, 'Ese identificador de registro ya se usó con otros datos');
            return armarRegistro(existente);
          }
        }

        // 2. Estado de la vaca (409 con el motivo).
        const motivo = motivoDeEstado(animal.sexo, animal.estado);
        if (motivo) throw new HttpError(409, `Solo se carga producción de vacas en ordeñe; ${motivo}`);

        // 3. Un solo registro vigente por vaca, fecha y turno. La base también lo garantiza con un
        //    índice único parcial (ver el catch de abajo).
        const duplicado = await tx.produccion.findFirst({
          where: { animalId, fecha: fechaADate(fecha), turno, anuladoEn: null },
          select: { id: true },
        });
        if (duplicado) {
          throw new HttpError(
            409,
            `Ya hay una carga de esta vaca para el ordeño de ${NOMBRE_TURNO[turno]} del ${aFechaCorta(fecha)}. Para corregirla, anulala primero y cargá la correcta`,
          );
        }

        // 4. El lote que tiene la vaca AHORA se copia (id y nombre) al registro, sin clave foránea.
        const lote = animal.loteId
          ? await tx.lote.findFirst({ where: { id: animal.loteId, establecimientoId }, select: { id: true, nombre: true } })
          : null;

        const fila = await tx.produccion.create({
          data: {
            ...(id && { id }),
            establecimientoId,
            animalId,
            fecha: fechaADate(fecha),
            turno,
            litrosDecimas,
            loteId: lote?.id ?? null,
            loteNombre: lote?.nombre ?? null,
            registradoPorId: usuarioId,
            // Hora de la tablet (spec 009): solo informativa, aparte de `creadoEn` (que pone el servidor).
            cargadoEnDispositivo,
          },
          select: SELECT_REGISTRO,
        });
        return armarRegistro(fila);
      },
      { timeout: 15_000 },
    );
  } catch (err) {
    // Defensa: si el choque lo detecta la base (índice único del ordeño o clave primaria del id), la
    // transacción ya terminó y se traduce a 409: nunca 500.
    if (esErrorPrisma(err, 'P2002')) {
      throw new HttpError(409, `Ya hay una carga para el ordeño de ${NOMBRE_TURNO[turno]} del ${aFechaCorta(fecha)} o ese identificador. Revisá la ficha de la vaca`);
    }
    throw err;
  }
}
