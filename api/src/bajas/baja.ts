import { HttpError, errorDeCampo, esErrorPrisma } from '../errores.js';
import { fechaADate } from '../animales/reglas.js';
import { bloquearAnimal, siguienteRegistro } from '../reproduccion/bloqueo.js';
import { ejecutarCarga } from '../reproduccion/idempotencia.js';
import { motivoABase, motivoATexto, validarFechaBaja, type MotivoBajaApi } from './validacion.js';

/**
 * Da de baja a un animal activo por venta o muerte (spec 006, RF-1 a RF-6).
 *
 * Todo en una transacción (todo o nada): se bloquea al animal, se valida la fecha y se guardan, en
 * este orden, el evento BAJA, su detalle (con el estado y el lote previos) y el pase del animal a
 * BAJA con su fecha y motivo y sin lote. La baja NO toca a la madre ni a las crías.
 * `motivo` y `observaciones` ya vienen validados (zod); `fecha` ya tiene formato válido.
 *
 * Spec 010: acepta el `id` propio de la tablet y su hora de carga. Es idempotente (ver `ejecutarCarga`):
 * reenviar la misma baja responde `{ evento, avisos, yaExistia: true }` con código 200, también cuando el
 * animal ya está de baja por ese mismo evento. Devuelve el código HTTP y el cuerpo.
 */
export async function registrarBaja(datos: {
  id?: string | undefined;
  animalId: string;
  establecimientoId: string;
  usuarioId: string;
  usuarioNombre: string;
  motivo: MotivoBajaApi;
  fecha: string;
  observaciones: string | null;
  cargadoEnDispositivo?: Date | null | undefined;
}) {
  const { animalId, establecimientoId, usuarioId, usuarioNombre, motivo, fecha, observaciones } = datos;

  try {
    return await ejecutarCarga({
      idPropio: datos.id,
      establecimientoId,
      animalId,
      pedido: { tipo: 'BAJA', animalId, usuarioId, fecha, motivo, observaciones },
      // El lote del animal se toma con FOR SHARE ANTES de bloquear al animal. Eliminar un lote toma primero
      // el lote y después mira a los animales que lo usan; si acá fuera al revés (animal y después lote), las
      // dos operaciones simultáneas podrían esperarse entre sí (interbloqueo). Con el mismo orden que la
      // eliminación (lote, animal) no puede pasar. Si el animal no está activo devuelve null: `ejecutarCarga`
      // mira primero si es el reenvío de esta misma baja (200) y si no, responde el 404 de siempre.
      bloquear: async (tx) => {
        const previo = await tx.animal.findFirst({
          where: { id: animalId, establecimientoId, estado: { not: 'BAJA' } },
          select: { loteId: true },
        });
        if (!previo) return null;
        if (previo.loteId) {
          await tx.$queryRaw`
            SELECT "id" FROM "lotes"
            WHERE "id" = ${previo.loteId}::uuid AND "establecimientoId" = ${establecimientoId}::uuid
            FOR SHARE`;
        }
        // Bloqueo del animal y relectura con datos firmes (puede haber cambiado mientras se esperaba).
        return bloquearAnimal(tx, animalId, establecimientoId);
      },
      crear: async (tx, { id: eventoId, animal, hoy }) => {
        // Fecha (400): no futura, no anterior a 2000, al nacimiento ni al último evento no anulado
        // del animal que no sea una baja (una baja anulada no cuenta, y una vigente no puede haber:
        // el animal está activo).
        const { _max } = await tx.evento.aggregate({
          where: { animalId, establecimientoId, anuladoEn: null, tipo: { not: 'BAJA' } },
          _max: { fecha: true },
        });
        const errorFecha = validarFechaBaja(fecha, {
          hoy,
          nacimiento: animal.nacimiento,
          ultimoEvento: _max.fecha ? _max.fecha.toISOString().slice(0, 10) : null,
        });
        if (errorFecha) throw errorDeCampo('fecha', errorFecha);

        // Se guarda todo. El lote previo es el que tiene el animal ahora (ya bloqueado), que casi
        // siempre es el que se miró arriba.
        const creadoEn = await siguienteRegistro(tx, animalId);
        await tx.evento.create({
          data: {
            id: eventoId,
            establecimientoId,
            animalId,
            tipo: 'BAJA',
            fecha: fechaADate(fecha),
            registradoPorId: usuarioId,
            creadoEn,
            cargadoEnDispositivo: datos.cargadoEnDispositivo ?? null,
          },
        });
        await tx.baja.create({
          data: {
            eventoId,
            establecimientoId,
            tipo: 'BAJA',
            animalId,
            motivo: motivoABase(motivo),
            observaciones,
            estadoAnterior: animal.estado,
            tuvoLoteAnterior: animal.loteId !== null,
            loteAnteriorId: animal.loteId,
          },
        });
        // El CHECK animales_baja_sin_lote exige loteId null en una baja; los CHECK de fecha y motivo y
        // el disparador diferido de coherencia se comprueban al confirmar.
        const guardado = await tx.animal.update({
          where: { establecimientoId_id: { establecimientoId, id: animalId } },
          data: { estado: 'BAJA', fechaBaja: fechaADate(fecha), motivoBaja: motivoABase(motivo), loteId: null },
          select: { numero: true },
        });

        return {
          id: eventoId,
          animalId,
          numero: guardado.numero,
          motivo: motivoATexto(motivoABase(motivo)),
          fecha,
          observaciones,
          estadoAnterior: animal.estado,
          registradoPor: usuarioNombre,
          registradoEn: creadoEn,
        };
      },
    });
  } catch (err) {
    // Defensa: el lote previo desapareció a último momento (la clave foránea de la baja lo frenó).
    if (esErrorPrisma(err, 'P2003')) throw new HttpError(409, 'El lote del animal cambió mientras se guardaba, volvé a intentar');
    throw err;
  }
}
