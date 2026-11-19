import { prisma } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';

// Cambios de estado de un tambo por el administrador (spec 015). La lógica vive acá y las rutas solo
// validan la entrada y traducen el resultado a HTTP.

type Tx = Prisma.TransactionClient;

/**
 * Lee el estado de un tambo y lo BLOQUEA contra la baja hasta que termine la transacción
 * (`FOR SHARE`). El `UPDATE` de la baja choca con este bloqueo: la baja espera a que termine quien
 * lo tiene, y quien lo toma después de la baja ve el tambo ya dado de baja. Así un ingreso (o una
 * acción sobre un usuario) o queda antes de la baja, y ésta le cierra la sesión, o ve la baja.
 * Devuelve el estado o null si el tambo no existe.
 */
export async function bloquearTambo(tx: Tx, id: string): Promise<'ACTIVO' | 'BAJA' | null> {
  const filas = await tx.$queryRaw<{ estado: 'ACTIVO' | 'BAJA' }[]>`
    SELECT estado::text AS estado FROM establecimientos WHERE id = ${id}::uuid FOR SHARE`;
  return filas[0]?.estado ?? null;
}

export type ResultadoCambioTambo = 'ok' | 'no_existe' | 'estado_incorrecto';

/**
 * Pasa el tambo de `desde` a `hasta` en UNA transacción: el `UPDATE ... WHERE estado = desde` es
 * atómico y condicionado (de dos pedidos simultáneos, el segundo espera el bloqueo de la fila y
 * encuentra count = 0), después se agrega el registro y la auditoría. En la baja, además, se borran
 * todas las sesiones del tambo (después del UPDATE, para alcanzar también las de ingresos que
 * quedaron confirmados antes de la baja).
 */
async function cambiarEstado(
  id: string,
  administradorId: string,
  cambio: { desde: 'ACTIVO' | 'BAJA'; hasta: 'ACTIVO' | 'BAJA'; motivo: string | null },
): Promise<ResultadoCambioTambo> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.establecimiento.updateMany({
      where: { id, estado: cambio.desde },
      data: { estado: cambio.hasta },
    });
    if (count === 0) {
      // No cambió nada: o el tambo no existe o ya estaba en el estado pedido. No se registra ni audita.
      const existe = await tx.establecimiento.findUnique({ where: { id }, select: { id: true } });
      return existe ? 'estado_incorrecto' : 'no_existe';
    }

    const esBaja = cambio.hasta === 'BAJA';
    const tambo = await tx.establecimiento.findUniqueOrThrow({ where: { id }, select: { nombre: true } });
    await tx.registroEstadoTambo.create({
      // creadoEn explícito y posterior al UPDATE: el orden de los registros sigue al de los cambios.
      data: {
        establecimientoId: id,
        tipo: esBaja ? 'BAJA' : 'REACTIVACION',
        motivo: cambio.motivo,
        administradorId,
        creadoEn: new Date(),
      },
    });
    if (esBaja) await tx.sesion.deleteMany({ where: { usuario: { establecimientoId: id } } });
    await tx.auditoriaAdmin.create({
      data: {
        accion: esBaja ? 'TAMBO_BAJA' : 'TAMBO_REACTIVADO',
        administradorId,
        establecimientoId: id,
        tamboNombre: tambo.nombre,
      },
    });
    return 'ok';
  });
}

// Da de baja un tambo activo (RF-4, 7, 12). `motivo` ya viene validado y recortado.
export function darDeBajaTambo(id: string, motivo: string, administradorId: string) {
  return cambiarEstado(id, administradorId, { desde: 'ACTIVO', hasta: 'BAJA', motivo });
}

// Reactiva un tambo dado de baja (RF-14). No toca usuarios ni sesiones.
export function reactivarTambo(id: string, administradorId: string) {
  return cambiarEstado(id, administradorId, { desde: 'BAJA', hasta: 'ACTIVO', motivo: null });
}
