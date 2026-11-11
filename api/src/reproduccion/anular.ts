import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { fechaADate, hoyArgentina } from '../animales/reglas.js';
import type { EstadoAnimal, Rol } from '../generated/prisma/client.js';
import { NOMBRE_ESTADO } from '../lotes/estados.js';
import { ahora } from '../reloj.js';
import { avisoLoteAnteriorEliminado, avisoLoteManualDescartado, avisoSinLotePrevio, type Aviso } from './avisos.js';
import { bloquearAnimal } from './bloqueo.js';
import { eventoPorId, leerEventos, textoEvento } from './eventos.js';
import { ultimoNoAnulado } from './situacion.js';

const NO_ENCONTRADO = 'Evento no encontrado';

type TipoAnulable = 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO';
const NOMBRE_TIPO: Record<TipoAnulable, string> = { SERVICIO: 'servicio', TACTO: 'tacto', PARTO: 'parto', SECADO: 'secado' };

// Estado en el que tiene que estar la vaca para poder anular: el que dejó el evento.
const ESTADO_QUE_DEJA: Partial<Record<TipoAnulable, EstadoAnimal>> = { PARTO: 'EN_ORDENE', SECADO: 'SECA' };

const nombreEstado = (estado: EstadoAnimal) => NOMBRE_ESTADO[estado].toLowerCase();

/**
 * Anula un servicio, un tacto, un parto o un secado (spec 003 RF-19 a RF-22 y spec 004 RF-22 a
 * RF-30). Compartida por las cuatro rutas: el tipo sale de la ruta, así un id de otro tipo es
 * "no encontrado" sin lógica especial. `id` ya es un UUID válido y `motivo` ya está validado.
 *
 * El evento no se borra ni se edita: solo se completan las tres columnas de la anulación.
 * Servicios y tactos no tocan al animal (la situación reproductiva se recalcula sola al leer).
 * Un secado devuelve la vaca al estado y lote previos; un parto además da de baja a las crías
 * vivas. Todo en una sola transacción: se guarda completo o no se guarda nada.
 *
 * Devuelve el evento ya armado y los avisos (solo los de lote al volver atrás: 6, 7 y 8).
 */
export async function anularEvento(datos: {
  tipo: TipoAnulable;
  id: string;
  establecimientoId: string;
  usuarioId: string;
  rol: Rol;
  motivo: string;
}): Promise<{ evento: ReturnType<typeof eventoPorId>; avisos: Aviso[] }> {
  const { tipo, id, establecimientoId, usuarioId, rol, motivo } = datos;
  const nombre = NOMBRE_TIPO[tipo];

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

      // 4. Rechazos 409, en el orden de la spec: se informa siempre el PRIMERO que corresponda.
      // (1) ya anulado
      if (fila.anulado) throw new HttpError(409, `Este ${nombre} ya fue anulado`);
      // (2) no es el último evento no anulado
      const ultimo = ultimoNoAnulado(filas);
      if (ultimo && ultimo.id !== id) {
        // Un veterinario no puede anular partos ni secados: el mensaje se lo dice (RF-26).
        if (rol === 'VETERINARIO' && (ultimo.tipo === 'PARTO' || ultimo.tipo === 'SECADO')) {
          throw new HttpError(409, `Primero hay que anular el ${textoEvento(ultimo.tipo, ultimo.fecha)}; lo tiene que hacer un dueño o encargado`);
        }
        throw new HttpError(409, `Primero tenés que anular el ${textoEvento(ultimo.tipo, ultimo.fecha)}`);
      }
      // (3) el estado actual de la vaca ya no es el que dejó el evento. Hoy no puede pasar por la
      //     API (nada más cambia el estado), pero sí cuando lleguen la edición manual y las bajas.
      const esperado = ESTADO_QUE_DEJA[tipo];
      if (esperado && animal.estado !== esperado) {
        throw new HttpError(
          409,
          `No se puede anular el ${textoEvento(tipo, fila.fecha)}: la vaca ya no está en estado «${nombreEstado(esperado)}», ahora está «${nombreEstado(animal.estado)}»`,
        );
      }

      // 5. Vuelta atrás y baja de las crías (solo parto y secado).
      const avisos: Aviso[] = [];
      if (tipo === 'PARTO' || tipo === 'SECADO') {
        avisos.push(...(await volverAtras(tx, { tipo, id, establecimientoId, animalId: evento.animalId, fechaEvento: fila.fecha })));
      }

      // 6. Se completa la anulación. El filtro `anuladoEn: null` es una defensa extra: si
      //    otra operación lo anuló igual, afecta 0 filas y se responde 409 (se deshace todo).
      const { count } = await tx.evento.updateMany({
        where: { id, establecimientoId, anuladoEn: null },
        data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: motivo },
      });
      if (count === 0) throw new HttpError(409, `Este ${nombre} ya fue anulado`);

      const despues = await leerEventos(tx, evento.animalId, establecimientoId);
      return { evento: eventoPorId(despues, id, hoyArgentina(ahora())), avisos };
    },
    { timeout: 15_000 },
  );
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Deja a la vaca como estaba justo antes del parto o secado (estado y lote) y, en un parto,
 * da de baja a las crías vivas. Devuelve el aviso 6 o 7 si la vaca vuelve sin lote y, al final, el
 * aviso 8 si se descarta un lote puesto a mano después del evento (spec 005, RF-13).
 * El animal de la vaca ya está bloqueado (FOR UPDATE) por el llamador.
 */
async function volverAtras(
  tx: Tx,
  d: { tipo: 'PARTO' | 'SECADO'; id: string; establecimientoId: string; animalId: string; fechaEvento: string },
): Promise<Aviso[]> {
  const { tipo, id, establecimientoId, animalId, fechaEvento } = d;
  // `leerEventos` no trae el id crudo del lote previo ni si lo había: se relee el detalle.
  const detalle =
    tipo === 'PARTO'
      ? await tx.parto.findUniqueOrThrow({ where: { eventoId: id }, select: { estadoAnterior: true, tuvoLoteAnterior: true, loteAnteriorId: true } })
      : await tx.secado.findUniqueOrThrow({ where: { eventoId: id }, select: { estadoAnterior: true, tuvoLoteAnterior: true, loteAnteriorId: true } });

  // En un parto, primero las crías: se comprueban todas y recién después se cambia algo, así un
  // rechazo (409) nunca deja una baja a medias. Los animales se bloquean en orden de id.
  const criasVivas = tipo === 'PARTO' ? await bloquearYControlarCrias(tx, id, establecimientoId) : [];

  // Lote previo: se toma con FOR SHARE para que nadie lo elimine entre esta lectura y el guardado.
  // Si ya no existe (la base anuló `loteAnteriorId` al eliminarlo), la vaca vuelve sin lote.
  let loteId: string | null = null;
  const avisos: Aviso[] = [];
  if (detalle.loteAnteriorId) {
    const filas = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "lotes"
      WHERE "id" = ${detalle.loteAnteriorId}::uuid AND "establecimientoId" = ${establecimientoId}::uuid
      FOR SHARE`;
    if (filas.length > 0) loteId = filas[0]!.id;
  }
  if (!loteId) {
    avisos.push(
      detalle.tuvoLoteAnterior
        ? avisoLoteAnteriorEliminado(detalle.estadoAnterior)
        : avisoSinLotePrevio(detalle.estadoAnterior, tipo === 'PARTO' ? 'parto' : 'secado', fechaEvento),
    );
  }

  // Aviso 8 (spec 005, RF-13): si después del evento hubo un movimiento manual de lote y el lote
  // actual de la vaca es distinto del que va a recibir, ese lote manual se descarta y se avisa.
  // "Después" se mide con el `creadoEn` del evento y el de la fila LOTE del historial (que nunca es
  // anterior al último evento del animal). Va al final, después de los avisos 6 y 7.
  const [eventoAnulado, actual] = await Promise.all([
    tx.evento.findUniqueOrThrow({ where: { id }, select: { creadoEn: true } }),
    tx.animal.findUniqueOrThrow({ where: { id: animalId }, select: { loteId: true } }),
  ]);
  if (actual.loteId !== loteId) {
    const hubo = await tx.cambioAnimal.count({
      where: { animalId, establecimientoId, campo: 'LOTE', creadoEn: { gt: eventoAnulado.creadoEn } },
    });
    if (hubo > 0) {
      const previo = loteId ? await tx.lote.findUnique({ where: { id: loteId }, select: { nombre: true } }) : null;
      avisos.push(avisoLoteManualDescartado(previo?.nombre ?? null, tipo === 'PARTO' ? 'parto' : 'secado', fechaEvento));
    }
  }

  await tx.animal.update({
    where: { establecimientoId_id: { establecimientoId, id: animalId } },
    data: { estado: detalle.estadoAnterior, loteId },
  });

  // Baja lógica de las crías vivas: nunca se borran. Sin lote (lo exige la base) y con el número
  // libre (el índice único solo cuenta a los activos).
  if (criasVivas.length > 0) {
    await tx.animal.updateMany({
      where: { establecimientoId, id: { in: criasVivas.map((c) => c.id) } },
      data: { estado: 'BAJA', fechaBaja: fechaADate(hoyArgentina(ahora())), motivoBaja: 'PARTO_ANULADO', loteId: null },
    });
  }
  return avisos;
}

/**
 * Bloquea (FOR UPDATE, en orden de id) a las crías vivas del parto y comprueba que se puedan dar
 * de baja: activas, sin eventos propios no anulados y sin ser madres de animales activos (RF-28).
 * Con una sola que no cumpla se rechaza todo con 409. Devuelve las crías vivas (id y número).
 */
async function bloquearYControlarCrias(tx: Tx, partoId: string, establecimientoId: string) {
  const filas = await tx.criaParto.findMany({
    where: { eventoId: partoId, establecimientoId, animalId: { not: null } },
    orderBy: { orden: 'asc' },
    select: { animalId: true },
  });
  const ids = filas.map((f) => f.animalId!);
  if (ids.length === 0) return [];

  // Orden fijo de bloqueo (por id) para que dos operaciones sobre las mismas crías no se traben.
  await tx.$queryRaw`SELECT "id" FROM "animales" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`;

  const animales = await tx.animal.findMany({
    where: { establecimientoId, id: { in: ids } },
    select: { id: true, numero: true, estado: true },
  });
  const conEventos = await tx.evento.findMany({
    where: { establecimientoId, animalId: { in: ids }, anuladoEn: null },
    select: { animalId: true },
  });
  const conCrias = await tx.animal.findMany({
    where: { establecimientoId, madreId: { in: ids }, estado: { not: 'BAJA' } },
    select: { madreId: true },
  });
  // Se informa la primera cría (en el orden del parto) que tenga algún problema.
  for (const id of ids) {
    const cria = animales.find((a) => a.id === id);
    if (!cria || cria.estado === 'BAJA') {
      throw new HttpError(409, `No se puede anular el parto: la cría N.º ${cria?.numero ?? '?'} ya no está activa`);
    }
    if (conEventos.some((e) => e.animalId === id)) {
      throw new HttpError(409, `No se puede anular el parto: la cría N.º ${cria.numero} tiene eventos registrados, primero hay que anularlos`);
    }
    if (conCrias.some((c) => c.madreId === id)) {
      throw new HttpError(409, `No se puede anular el parto: la cría N.º ${cria.numero} es madre de animales activos`);
    }
  }
  return animales.map((a) => ({ id: a.id, numero: a.numero }));
}

