import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../errores.js';
import { ESTADOS_CON_DESTINO, type EstadoConDestino } from '../lotes/estados.js';

/**
 * Lote destino de cada estado pedido, leído DENTRO de la transacción del registro (spec 004, RF-14).
 *
 * Para cada estado con regla, además de leerla, toma el lote con `SELECT ... FOR SHARE`:
 *  - si el lote ya no existe (el tambo le quitó la regla al estado y lo eliminó justo entre la
 *    lectura de la regla y este paso) → 409 "El lote destino ya no existe, volvé a intentar";
 *  - si existe, el bloqueo compartido hace que quien intente eliminarlo espere a que termine el
 *    registro, y recién entonces falle porque ahora tiene animales. Así el lote no desaparece
 *    entre la lectura y la escritura.
 *
 * Devuelve un Map estado → id del lote, o `null` si el estado no tiene regla (el animal queda sin
 * lote y la operación avisa). Los estados se recorren siempre en el mismo orden (el de pantalla)
 * para evitar interbloqueos entre operaciones simultáneas.
 */
export async function resolverLotesDestino(
  tx: Pick<Prisma.TransactionClient, 'reglaLote' | '$queryRaw'>,
  establecimientoId: string,
  estados: readonly EstadoConDestino[],
): Promise<Map<EstadoConDestino, string | null>> {
  const pedidos = ESTADOS_CON_DESTINO.filter((e) => estados.includes(e));
  const reglas = await tx.reglaLote.findMany({
    where: { establecimientoId, estado: { in: pedidos } },
    select: { estado: true, loteId: true },
  });

  const destinos = new Map<EstadoConDestino, string | null>();
  for (const estado of pedidos) {
    const loteId = reglas.find((r) => r.estado === estado)?.loteId ?? null;
    if (loteId) {
      const filas = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "lotes"
        WHERE "id" = ${loteId}::uuid AND "establecimientoId" = ${establecimientoId}::uuid
        FOR SHARE`;
      if (filas.length === 0) throw new HttpError(409, 'El lote destino ya no existe, volvé a intentar');
    }
    destinos.set(estado, loteId);
  }
  return destinos;
}
