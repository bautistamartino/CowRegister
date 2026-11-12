import type { Prisma } from '../generated/prisma/client.js';
import { motivoATexto, type MotivoBajaApi } from './validacion.js';

// Aviso por número de un animal de baja (spec 006, RF-14). Solo cuenta una baja VIGENTE por venta o
// muerte (no "parto anulado", que no tiene evento, ni un animal ya reactivado, cuya baja quedó anulada).
// Si hay varias bajas con el mismo número, se informa la más reciente: por fecha de baja y, a igual
// fecha, por momento de registro. El aviso no se guarda en ningún lado: se arma al responder.

export type BajaPorNumero = { motivo: MotivoBajaApi; fecha: string }; // fecha AAAA-MM-DD

/**
 * Busca, para cada número (ya normalizado), la baja vigente por venta o muerte más reciente del
 * tambo. Devuelve un mapa número → baja; los números sin baja no figuran.
 */
export async function buscarBajasPorNumero(
  cliente: Pick<Prisma.TransactionClient, 'evento'>,
  establecimientoId: string,
  numeros: string[],
): Promise<Map<string, BajaPorNumero>> {
  const resultado = new Map<string, BajaPorNumero>();
  if (numeros.length === 0) return resultado;

  const filas = await cliente.evento.findMany({
    where: {
      establecimientoId,
      tipo: 'BAJA',
      anuladoEn: null,
      baja: { is: { vigente: true } },
      animal: { estado: 'BAJA', numero: { in: numeros } },
    },
    // La primera que aparece de cada número es la más reciente.
    orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
    select: { fecha: true, animal: { select: { numero: true } }, baja: { select: { motivo: true } } },
  });
  for (const f of filas) {
    if (!f.baja || resultado.has(f.animal.numero)) continue;
    resultado.set(f.animal.numero, { motivo: motivoATexto(f.baja.motivo) as MotivoBajaApi, fecha: f.fecha.toISOString().slice(0, 10) });
  }
  return resultado;
}

// "El número 101 perteneció a un animal dado de baja por venta el 05/11/2026" (RF-14).
export function textoAvisoNumeroDeBaja(numero: string, baja: BajaPorNumero): string {
  const [a, m, d] = baja.fecha.split('-');
  return `El número ${numero} perteneció a un animal dado de baja por ${baja.motivo} el ${d}/${m}/${a}`;
}
