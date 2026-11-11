import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { hoyArgentina } from '../animales/reglas.js';
import { ahora } from '../reloj.js';
import { bloquearAnimal } from './bloqueo.js';
import { eventoPorId, leerEventos, textoEvento } from './eventos.js';
import { ultimoNoAnulado } from './situacion.js';

const NO_ENCONTRADO = 'Evento no encontrado';

/**
 * Anula un servicio o un tacto (RF-19 a RF-22). Compartida por las dos rutas: el tipo sale de
 * la ruta, así un id de otro tipo es "no encontrado" sin lógica especial. `id` ya es un UUID
 * válido y `motivo` ya está validado y normalizado.
 *
 * El evento no se borra ni se edita: solo se completan las tres columnas de la anulación.
 * No se toca el animal (RF-21): la situación reproductiva se recalcula sola al leer.
 */
export async function anularEvento(datos: {
  tipo: 'SERVICIO' | 'TACTO';
  id: string;
  establecimientoId: string;
  usuarioId: string;
  motivo: string;
}) {
  const { tipo, id, establecimientoId, usuarioId, motivo } = datos;

  return prisma.$transaction(
    async (tx) => {
      // 1. Búsqueda sin bloqueo: del tambo, del tipo de la ruta y de un animal activo.
      const evento = await tx.evento.findFirst({
        where: { id, establecimientoId, tipo, animal: { estado: { not: 'BAJA' } } },
        select: { animalId: true },
      });
      if (!evento) throw new HttpError(404, NO_ENCONTRADO);

      // 2. Bloqueo del animal: desde acá nadie más registra ni anula sobre él.
      const animal = await bloquearAnimal(tx, evento.animalId, establecimientoId);
      if (!animal) throw new HttpError(404, NO_ENCONTRADO);

      // 3. Se RELEE todo con el bloqueo tomado: lo leído antes pudo cambiar mientras se esperaba.
      const filas = await leerEventos(tx, evento.animalId, establecimientoId);
      const fila = filas.find((f) => f.id === id);
      if (!fila) throw new HttpError(404, NO_ENCONTRADO);
      if (fila.anulado) throw new HttpError(409, `Este ${tipo === 'SERVICIO' ? 'servicio' : 'tacto'} ya fue anulado`);
      const ultimo = ultimoNoAnulado(filas);
      if (ultimo && ultimo.id !== id) {
        throw new HttpError(409, `Primero tenés que anular el ${textoEvento(ultimo.tipo, ultimo.fecha)}`);
      }

      // 4. Se completa la anulación. El filtro `anuladoEn: null` es una defensa extra: si
      //    otra operación lo anuló igual, afecta 0 filas y se responde 409.
      const { count } = await tx.evento.updateMany({
        where: { id, establecimientoId, anuladoEn: null },
        data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: motivo },
      });
      if (count === 0) throw new HttpError(409, `Este ${tipo === 'SERVICIO' ? 'servicio' : 'tacto'} ya fue anulado`);

      const despues = await leerEventos(tx, evento.animalId, establecimientoId);
      return eventoPorId(despues, id, hoyArgentina(ahora()));
    },
    { timeout: 15_000 },
  );
}
