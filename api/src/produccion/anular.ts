import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { bloquearAnimal } from '../reproduccion/bloqueo.js';
import { NO_ENCONTRADO, SELECT_REGISTRO, armarRegistro } from './leer.js';

/**
 * Anula un registro de producción de una vaca ACTIVA (spec 008, RF-9, RF-10, RF-36).
 * `motivo` ya viene validado (zod) y los dos ids ya son UUID válidos.
 *
 * El registro no se borra ni se edita: solo se completan las tres columnas de la anulación (quién,
 * cuándo y motivo). Se bloquea la vaca con `FOR UPDATE`, así dos anulaciones simultáneas del mismo
 * registro se serializan: la segunda lo ve ya anulado y da 409. NO se pide que la vaca esté en
 * ordeñe: se puede anular el registro de una vaca que ya se secó. Una vaca de baja es 404.
 */
export async function anularProduccion(entrada: {
  animalId: string;
  registroId: string;
  establecimientoId: string;
  usuarioId: string;
  motivo: string;
}) {
  const { animalId, registroId, establecimientoId, usuarioId, motivo } = entrada;

  return prisma.$transaction(
    async (tx) => {
      const animal = await bloquearAnimal(tx, animalId, establecimientoId);
      if (!animal) throw new HttpError(404, NO_ENCONTRADO);

      // El registro tiene que ser de ESA vaca y de ESE tambo: si no, el mismo 404.
      const registro = await tx.produccion.findFirst({
        where: { id: registroId, animalId, establecimientoId },
        select: { anuladoEn: true },
      });
      if (!registro) throw new HttpError(404, NO_ENCONTRADO);
      if (registro.anuladoEn) throw new HttpError(409, 'Este registro ya está anulado');

      const fila = await tx.produccion.update({
        where: { id: registroId },
        data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: motivo },
        select: SELECT_REGISTRO,
      });
      return armarRegistro(fila);
    },
    { timeout: 15_000 },
  );
}
