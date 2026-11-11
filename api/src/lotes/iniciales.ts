import type { Prisma } from '../generated/prisma/client.js';
import type { EstadoConDestino } from './estados.js';

// Lote que recibe cada tambo nuevo para cada estado con destino (RF-18).
// La migración lotes_iniciales_existentes (RF-19) usa estos mismos nombres.
export const LOTES_INICIALES: ReadonlyArray<{ estado: EstadoConDestino; nombre: string }> = [
  { estado: 'RECIEN_NACIDO', nombre: 'Terneros' },
  { estado: 'VAQUILLONA', nombre: 'Vaquillonas' },
  { estado: 'EN_ORDENE', nombre: 'En ordeñe' },
  { estado: 'SECA', nombre: 'Secas' },
];

// Crea los 4 lotes iniciales del tambo y los deja como destino de su estado.
// Recibe `tx` (el cliente de una transacción) y no `prisma`, para que corra
// dentro de la transacción del registro: si algo falla después, se deshace.
export async function crearLotesIniciales(tx: Prisma.TransactionClient, establecimientoId: string) {
  for (const { estado, nombre } of LOTES_INICIALES) {
    const lote = await tx.lote.create({ data: { establecimientoId, nombre } });
    await tx.reglaLote.create({ data: { establecimientoId, estado, loteId: lote.id } });
  }
}
