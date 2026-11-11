import type { Prisma } from '../generated/prisma/client.js';
import { aFechaCorta } from './fechas.js';
import { calcularSituacion, ordenarEventos, type EventoCalculo } from './situacion.js';

// Lectura de los eventos de un animal y armado de las respuestas (spec 003).
// Todas las lecturas usan `select` explícito y del usuario se pide SOLO el nombre
// (RF-26: ninguna respuesta lleva hashes, tokens ni emails).

type Semen = { id: string; nombre: string } | null;

// Un evento leído de la base: lo que necesita el cálculo más lo que se muestra.
export type FilaEvento = EventoCalculo & {
  registradoPor: string;
  anuladoEn: Date | null;
  anuladoPor: string | null;
  motivoAnulacion: string | null;
  servicio: { tipoServicio: 'INSEMINACION' | 'MONTA_NATURAL'; semen: Semen } | null;
  anomalias: string | null; // solo en tactos
};

const aTexto = (fecha: Date) => fecha.toISOString().slice(0, 10);

// Todos los eventos del animal (anulados incluidos), sin ordenar.
export async function leerEventos(tx: Prisma.TransactionClient, animalId: string, establecimientoId: string): Promise<FilaEvento[]> {
  const filas = await tx.evento.findMany({
    where: { animalId, establecimientoId },
    select: {
      id: true,
      tipo: true,
      fecha: true,
      creadoEn: true,
      anuladoEn: true,
      motivoAnulacion: true,
      registradoPor: { select: { nombre: true } },
      anuladoPor: { select: { nombre: true } },
      servicio: { select: { tipoServicio: true, semen: { select: { id: true, nombre: true } } } },
      tacto: { select: { resultado: true, fechaProbableIndicada: true, anomalias: true } },
    },
  });
  return filas.map((f) => ({
    id: f.id,
    tipo: f.tipo,
    fecha: aTexto(f.fecha),
    creadoEn: f.creadoEn,
    anulado: f.anuladoEn !== null,
    resultado: f.tacto?.resultado ?? null,
    fechaProbableIndicada: f.tacto?.fechaProbableIndicada ? aTexto(f.tacto.fechaProbableIndicada) : null,
    registradoPor: f.registradoPor.nombre,
    anuladoEn: f.anuladoEn,
    anuladoPor: f.anuladoPor?.nombre ?? null,
    motivoAnulacion: f.motivoAnulacion,
    servicio: f.servicio,
    anomalias: f.tacto?.anomalias ?? null,
  }));
}

// Un evento como lo ve la web. `fechaProbable` es la fecha resuelta de un tacto "preñada"
// no anulado (RF-13) y null en los demás.
export function armarEvento(fila: FilaEvento, fechasTactos: Map<string, string>) {
  return {
    id: fila.id,
    tipo: fila.tipo,
    fecha: fila.fecha,
    registradoPor: fila.registradoPor,
    registradoEn: fila.creadoEn,
    anulacion: fila.anuladoEn
      ? { motivo: fila.motivoAnulacion, por: fila.anuladoPor, en: fila.anuladoEn }
      : null,
    servicio: fila.servicio,
    tacto:
      fila.tipo === 'TACTO'
        ? {
            resultado: fila.resultado,
            fechaProbableIndicada: fila.fechaProbableIndicada,
            fechaProbable: fechasTactos.get(fila.id) ?? null,
            anomalias: fila.anomalias,
          }
        : null,
  };
}

/**
 * Situación reproductiva y lista de eventos (del más reciente al más antiguo) para la ficha.
 * `hoy` es el "hoy" de Argentina del reloj inyectable.
 */
export function armarRespuesta(filas: FilaEvento[], hoy: string) {
  const s = calcularSituacion(filas, hoy);
  const situacion = {
    estado: s.estado,
    ultimoServicio: s.ultimoServicio
      ? { id: s.ultimoServicio.id, fecha: s.ultimoServicio.fecha, tipoServicio: s.ultimoServicio.servicio?.tipoServicio ?? null, semen: s.ultimoServicio.servicio?.semen ?? null }
      : null,
    ultimoTacto: s.ultimoTacto
      ? {
          id: s.ultimoTacto.id,
          fecha: s.ultimoTacto.fecha,
          resultado: s.ultimoTacto.resultado,
          fechaProbableIndicada: s.ultimoTacto.fechaProbableIndicada,
          anomalias: s.ultimoTacto.anomalias,
        }
      : null,
    fechaProbableParto: s.fechaProbableParto,
    fechaReferencia: s.fechaReferencia,
  };
  const eventos = ordenarEventos(filas)
    .reverse()
    .map((f) => armarEvento(f, s.fechasTactos));
  return { situacion, eventos };
}

// Un solo evento ya guardado, armado con la misma forma que la lista (para las respuestas de
// registrar y anular). Se arma con todos los eventos del animal porque la fecha probable de
// un tacto depende de los anteriores.
export function eventoPorId(filas: FilaEvento[], id: string, hoy: string) {
  const { eventos } = armarRespuesta(filas, hoy);
  return eventos.find((e) => e.id === id);
}

// "tacto del 05/11/2026": nombra un evento en los mensajes.
export function textoEvento(tipo: 'SERVICIO' | 'TACTO', fecha: string): string {
  return `${tipo === 'SERVICIO' ? 'servicio' : 'tacto'} del ${aFechaCorta(fecha)}`;
}
