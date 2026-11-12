import type { EstadoAnimal, Prisma, Sexo } from '../generated/prisma/client.js';
import { aFechaCorta } from './fechas.js';
import { calcularSituacion, ordenarEventos, type EventoCalculo } from './situacion.js';

// Lectura de los eventos de un animal y armado de las respuestas (spec 003).
// Todas las lecturas usan `select` explícito y del usuario se pide SOLO el nombre
// (RF-26: ninguna respuesta lleva hashes, tokens ni emails).

type Semen = { id: string; nombre: string } | null;

// Lote en el que estaba la vaca justo antes de un parto o secado (spec 004): "sin lote previo",
// "lote previo eliminado" (tenía y se eliminó después) o el lote con su nombre actual.
export type LoteAnterior = 'SIN_LOTE' | 'ELIMINADO' | { id: string; nombre: string };

// Una cría de un parto. `animal` es null si nació muerta; `activo` es false si la cría fue dada
// de baja (por parto anulado): se muestra con "dada de baja" y sin acceso a su ficha.
export type CriaDeParto = {
  orden: number;
  sexo: Sexo;
  nacidaMuerta: boolean;
  observaciones: string | null;
  animal: { id: string; numero: string; activo: boolean } | null;
};

// Un evento leído de la base: lo que necesita el cálculo más lo que se muestra.
export type FilaEvento = EventoCalculo & {
  registradoPor: string;
  anuladoEn: Date | null;
  anuladoPor: string | null;
  motivoAnulacion: string | null;
  servicio: { tipoServicio: 'INSEMINACION' | 'MONTA_NATURAL'; semen: Semen } | null;
  anomalias: string | null; // solo en tactos
  parto: { estadoAnterior: EstadoAnimal; loteAnterior: LoteAnterior; servicioId: string | null; crias: CriaDeParto[] } | null;
  secado: { estadoAnterior: EstadoAnimal; loteAnterior: LoteAnterior } | null;
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
      parto: {
        select: {
          estadoAnterior: true,
          tuvoLoteAnterior: true,
          loteAnteriorId: true,
          servicioId: true,
          crias: {
            orderBy: { orden: 'asc' },
            select: {
              orden: true,
              sexo: true,
              nacidaMuerta: true,
              observaciones: true,
              animal: { select: { id: true, numero: true, estado: true } },
            },
          },
        },
      },
      secado: { select: { estadoAnterior: true, tuvoLoteAnterior: true, loteAnteriorId: true } },
    },
  });

  // Nombres de los lotes previos: Prisma no modela esa clave (es una FK escrita a mano con
  // ON DELETE SET NULL), así que se leen con una consulta aparte, del mismo tambo.
  const idsLotes = new Set<string>();
  for (const f of filas) {
    const id = f.parto?.loteAnteriorId ?? f.secado?.loteAnteriorId;
    if (id) idsLotes.add(id);
  }
  const lotes = idsLotes.size
    ? await tx.lote.findMany({ where: { establecimientoId, id: { in: [...idsLotes] } }, select: { id: true, nombre: true } })
    : [];
  const loteAnterior = (d: { tuvoLoteAnterior: boolean; loteAnteriorId: string | null }): LoteAnterior => {
    if (!d.tuvoLoteAnterior) return 'SIN_LOTE';
    const lote = d.loteAnteriorId ? lotes.find((l) => l.id === d.loteAnteriorId) : undefined;
    return lote ?? 'ELIMINADO'; // tenía lote y ya no existe
  };

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
    parto: f.parto
      ? {
          estadoAnterior: f.parto.estadoAnterior,
          loteAnterior: loteAnterior(f.parto),
          servicioId: f.parto.servicioId,
          crias: f.parto.crias.map((c) => ({
            orden: c.orden,
            sexo: c.sexo,
            nacidaMuerta: c.nacidaMuerta,
            observaciones: c.observaciones,
            animal: c.animal ? { id: c.animal.id, numero: c.animal.numero, activo: c.animal.estado !== 'BAJA' } : null,
          })),
        }
      : null,
    secado: f.secado ? { estadoAnterior: f.secado.estadoAnterior, loteAnterior: loteAnterior(f.secado) } : null,
  }));
}

// Un evento como lo ve la web. `fechaProbable` es la fecha resuelta de un tacto "preñada"
// no anulado (RF-13) y null en los demás.
export function armarEvento(fila: FilaEvento, fechasTactos: Map<string, string>, todas: readonly FilaEvento[]) {
  // Genética del parto: el servicio vinculado (de la misma vaca) con el nombre actual del semen.
  const servicioDeGenetica = fila.parto?.servicioId ? todas.find((f) => f.id === fila.parto?.servicioId) : undefined;
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
    parto: fila.parto
      ? {
          estadoAnterior: fila.parto.estadoAnterior,
          loteAnterior: fila.parto.loteAnterior,
          // null = sin genética vinculada; semen null = el servicio no tenía semen o toro ("sin dato").
          genetica: servicioDeGenetica
            ? { fechaServicio: servicioDeGenetica.fecha, semen: servicioDeGenetica.servicio?.semen ?? null }
            : null,
          crias: fila.parto.crias,
        }
      : null,
    secado: fila.secado ? { estadoAnterior: fila.secado.estadoAnterior, loteAnterior: fila.secado.loteAnterior } : null,
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
    // `cicloAnterior`: el servicio o tacto es anterior al último parto no anulado (spec 004, RF-40).
    ultimoServicio: s.ultimoServicio
      ? {
          id: s.ultimoServicio.id,
          fecha: s.ultimoServicio.fecha,
          tipoServicio: s.ultimoServicio.servicio?.tipoServicio ?? null,
          semen: s.ultimoServicio.servicio?.semen ?? null,
          cicloAnterior: s.ultimoServicioCicloAnterior,
        }
      : null,
    ultimoTacto: s.ultimoTacto
      ? {
          id: s.ultimoTacto.id,
          fecha: s.ultimoTacto.fecha,
          resultado: s.ultimoTacto.resultado,
          fechaProbableIndicada: s.ultimoTacto.fechaProbableIndicada,
          anomalias: s.ultimoTacto.anomalias,
          cicloAnterior: s.ultimoTactoCicloAnterior,
        }
      : null,
    fechaProbableParto: s.fechaProbableParto,
    fechaReferencia: s.fechaReferencia,
  };
  const eventos = ordenarEventos(filas)
    .reverse()
    .map((f) => armarEvento(f, s.fechasTactos, filas));
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
export function textoEvento(tipo: 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO' | 'BAJA', fecha: string): string {
  const nombres = { SERVICIO: 'servicio', TACTO: 'tacto', PARTO: 'parto', SECADO: 'secado', BAJA: 'baja' };
  return `${nombres[tipo]} del ${aFechaCorta(fecha)}`;
}
