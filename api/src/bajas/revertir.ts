import { prisma } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError, esErrorPrisma } from '../errores.js';
import { aFechaCorta } from '../reproduccion/fechas.js';
import { NOMBRE_ESTADO } from '../lotes/estados.js';
import { bloquearAnimalDeBaja } from '../reproduccion/bloqueo.js';
import { leerFicha } from '../rutas/animales.js';

const NO_ENCONTRADO = 'Animal no encontrado';

const mensajeNumeroOcupado = (numero: string) =>
  `Ya existe un animal activo con el número ${numero}: cambiale el número a ese animal o dejá esta baja`;

/**
 * Toma el lote previo con `SELECT ... FOR SHARE` dentro de la transacción de la reversión: nadie
 * puede eliminarlo entre esta lectura y el guardado. Devuelve su id o `null` si no había lote previo
 * o ya no existe (lo eliminaron: el llamador deja al animal sin lote y avisa). Se separa para poder
 * probar con un cliente simulado la carrera "el lote desaparece entre la lectura y el guardado".
 */
export async function tomarLotePrevio(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  establecimientoId: string,
  loteAnteriorId: string | null,
): Promise<string | null> {
  if (!loteAnteriorId) return null;
  const filas = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id"::text AS "id" FROM "lotes"
    WHERE "id" = ${loteAnteriorId}::uuid AND "establecimientoId" = ${establecimientoId}::uuid
    FOR SHARE`;
  return filas[0]?.id ?? null;
}

/**
 * Revierte la baja por venta o muerte de un animal (spec 006, RF-7 a RF-10): lo devuelve a "activo"
 * con el estado y el lote previos, vacía su fecha y motivo de baja y marca la baja como anulada.
 * Nada se borra: el evento BAJA queda anulado (quién, cuándo y por qué) y su detalle, no vigente.
 *
 * Se identifica por el id del animal. Todo lo que no sea un animal de baja por venta o muerte del
 * tambo (activo, ya revertido, inexistente, ajeno, "parto anulado") es el mismo 404. Orden:
 * 404 y después 409 (número ocupado). `motivoReversion` ya viene validado (el 400 va antes).
 * Devuelve la ficha del animal activo más `avisos` (RF-9): textos que la pantalla muestra una vez.
 */
export async function revertirBaja(datos: { animalId: string; establecimientoId: string; usuarioId: string; motivoReversion: string }) {
  const { animalId, establecimientoId, usuarioId, motivoReversion } = datos;

  let avisos: string[];
  let numeroDelAnimal = ''; // para el mensaje del 409 que da la base
  try {
    avisos = await prisma.$transaction(
      async (tx) => {
        // 1. Bloqueo del animal de baja (404 si no es uno).
        const animal = await bloquearAnimalDeBaja(tx, animalId, establecimientoId);
        if (!animal) throw new HttpError(404, NO_ENCONTRADO);
        numeroDelAnimal = animal.numero;

        // 2. La baja vigente y su evento. Si no hubiera (la base lo impide) es un 404, no un error raro.
        const baja = await tx.baja.findFirst({
          where: { animalId, establecimientoId, vigente: true },
          select: { eventoId: true, estadoAnterior: true, tuvoLoteAnterior: true, loteAnteriorId: true, evento: { select: { fecha: true } } },
        });
        if (!baja) throw new HttpError(404, NO_ENCONTRADO);

        // 3. Conflicto (409): otro animal activo ya usa el número. La base lo vuelve a controlar con
        //    el índice único de números activos al guardar (más abajo, P2002).
        const ocupado = await tx.animal.findFirst({
          where: { establecimientoId, numero: animal.numero, estado: { not: 'BAJA' }, id: { not: animalId } },
          select: { id: true },
        });
        if (ocupado) throw new HttpError(409, mensajeNumeroOcupado(animal.numero));

        // 4. Lote previo, con FOR SHARE: nadie lo elimina entre esta lectura y el guardado. Si ya no
        //    existe (la base anuló loteAnteriorId al eliminarlo) o no tenía lote, vuelve sin lote.
        const loteId = await tomarLotePrevio(tx, establecimientoId, baja.loteAnteriorId);
        const avisosDeLote: string[] = [];
        if (!loteId) {
          const estado = NOMBRE_ESTADO[baja.estadoAnterior].toLowerCase();
          avisosDeLote.push(
            baja.tuvoLoteAnterior
              ? `El animal volvió a «${estado}» y quedó sin lote: su lote anterior ya no existe`
              : `El animal volvió a «${estado}» y quedó sin lote: no tenía lote antes de la baja del ${aFechaCorta(baja.evento.fecha.toISOString().slice(0, 10))}`,
          );
        }

        // 5. Se guarda todo junto: el animal vuelve a activo y la baja queda anulada. La anulación
        //    completa (quién, cuándo y motivo) va en un solo UPDATE por el CHECK de la base.
        await tx.animal.update({
          where: { establecimientoId_id: { establecimientoId, id: animalId } },
          data: { estado: baja.estadoAnterior, loteId, fechaBaja: null, motivoBaja: null },
        });
        await tx.evento.update({
          where: { id: baja.eventoId },
          data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: motivoReversion },
        });
        await tx.baja.update({ where: { eventoId: baja.eventoId }, data: { vigente: false } });
        return avisosDeLote;
      },
      { timeout: 15_000 },
    );
  } catch (err) {
    // El índice único de números activos es la garantía final si otro animal tomó el número justo ahora.
    if (esErrorPrisma(err, 'P2002')) {
      throw new HttpError(409, mensajeNumeroOcupado(numeroDelAnimal));
    }
    throw err;
  }

  const ficha = await leerFicha(prisma, animalId, establecimientoId);
  if (!ficha) throw new HttpError(404, NO_ENCONTRADO);
  return { ...ficha, avisos };
}
