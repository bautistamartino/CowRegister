import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../errores.js';

// Mover un animal de lote a mano (spec 005, RF-9 a RF-11).

export const MENSAJE_LOTE_DESAPARECIO = 'El lote destino ya no existe, volvé a intentar';

/**
 * Toma el lote destino con `SELECT ... FOR SHARE` DENTRO de la transacción del movimiento:
 *  - si el lote ya no existe (lo eliminaron entre que se buscó y ahora) → 409;
 *  - si existe, el bloqueo compartido hace que quien intente eliminarlo espere a que termine el
 *    movimiento, y recién entonces falle porque ahora tiene un animal (la base lo frena con la
 *    clave foránea). Así el animal nunca queda apuntando a un lote inexistente.
 * Devuelve el id y el nombre del lote (el historial guarda el nombre como texto).
 */
export async function bloquearLoteDestino(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  establecimientoId: string,
  loteId: string,
): Promise<{ id: string; nombre: string }> {
  const filas = await tx.$queryRaw<{ id: string; nombre: string }[]>`
    SELECT "id"::text AS "id", "nombre" FROM "lotes"
    WHERE "id" = ${loteId}::uuid AND "establecimientoId" = ${establecimientoId}::uuid
    FOR SHARE`;
  const lote = filas[0];
  if (!lote) throw new HttpError(409, MENSAJE_LOTE_DESAPARECIO);
  return lote;
}
