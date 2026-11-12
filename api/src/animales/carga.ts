import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { HttpError, esErrorPrisma } from '../errores.js';
import { normalizarNumero } from '../validacion.js';
import { buscarBajasPorNumero, type BajaPorNumero } from '../bajas/numero-de-baja.js';
import { analizarPlanilla, leerPlanilla, sinLotePorEstado, type Existente, type FilaAnalizada } from './planilla.js';
import { ESTADOS_INICIALES, fechaADate, hoyArgentina } from './reglas.js';

// Parte de la carga desde planilla que usa la base (spec 002, RF-11 a RF-21).
// La lectura y la validación son funciones puras en `planilla.ts`; acá solo se
// consulta lo que hace falta y se guarda. Todo se filtra por el tambo de la sesión.

export const MAX_INTENTOS = 3; // RF-21

export interface AnalisisPlanilla {
  filas: FilaAnalizada[];
  reglas: Map<string, string>; // estado → lote destino
  sinLotePorEstado: { estado: (typeof ESTADOS_INICIALES)[number]; cantidad: number }[];
  // Número → baja vigente por venta o muerte más reciente del tambo (spec 006, RF-14): para los avisos.
  bajasPorNumero: Map<string, BajaPorNumero>;
}

// Lee el texto, lo valida contra el estado ACTUAL de la base y lo analiza. No escribe nada.
// Hace solo dos consultas por pedido, sin importar cuántas filas haya.
export async function analizarTexto(texto: string, establecimientoId: string): Promise<AnalisisPlanilla> {
  const { filas } = leerPlanilla(texto); // lanza HttpError 400 si el texto no sirve

  // Números que aparecen en la planilla como animal (columna 1) o como madre (columna 5).
  const numeros = new Set<string>();
  for (const f of filas) {
    for (const i of [0, 4]) {
      const n = f.celdas[i] ? normalizarNumero(f.celdas[i]!) : null;
      if (n) numeros.add(n);
    }
  }

  // Solo animales ACTIVOS de ESTE tambo: un número que existe solo en otro tambo (o dado de baja)
  // se trata como inexistente (RF-12, RF-37).
  const activos = numeros.size
    ? await prisma.animal.findMany({
        where: { establecimientoId, estado: { not: 'BAJA' }, numero: { in: [...numeros] } },
        select: { id: true, numero: true, sexo: true, fechaNacimiento: true },
      })
    : [];
  const existentes = new Map<string, Existente>(
    activos.map((a) => [
      a.numero,
      { id: a.id, sexo: a.sexo, fechaNacimiento: a.fechaNacimiento ? a.fechaNacimiento.toISOString().slice(0, 10) : null },
    ]),
  );

  const reglasDb = await prisma.reglaLote.findMany({ where: { establecimientoId }, select: { estado: true, loteId: true } });
  const reglas = new Map<string, string>(reglasDb.map((r) => [r.estado, r.loteId]));

  const analizadas = analizarPlanilla(filas, { hoy: hoyArgentina(), existentes });

  // Aviso de número de un animal de baja (RF-14): solo para las filas correctas, en una sola consulta.
  const numerosCorrectos = analizadas.filter((f) => f.ok && f.numero).map((f) => f.numero!);
  const bajasPorNumero = await buscarBajasPorNumero(prisma, establecimientoId, [...new Set(numerosCorrectos)]);

  return { filas: analizadas, reglas, sinLotePorEstado: sinLotePorEstado(analizadas, reglas), bajasPorNumero };
}

// Fila sin el dato interno `vinculo`, como se devuelve a la web, con su aviso de número de baja
// ({ motivo, fecha } o null). Es un aviso y no un error: la fila sigue siendo correcta.
export function filaPublica({ vinculo: _vinculo, ...resto }: FilaAnalizada, bajasPorNumero: Map<string, BajaPorNumero>) {
  const baja = resto.ok && resto.numero ? bajasPorNumero.get(resto.numero) : undefined;
  return { ...resto, avisoNumeroDeBaja: baja ?? null };
}

/**
 * Confirma la carga (RF-18, RF-19, RF-21): revalida el texto completo con la base de este
 * instante y guarda las filas correctas con UN solo createMany (una sola sentencia SQL:
 * se guarda todo o nada). Si un número se ocupa justo en el medio (P2002), vuelve a
 * revalidar y reintenta; tras 3 intentos responde 409 sin guardar nada.
 */
export async function confirmarPlanilla(texto: string, establecimientoId: string) {
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    const { filas, reglas, sinLotePorEstado, bajasPorNumero } = await analizarTexto(texto, establecimientoId);
    const correctas = filas.filter((f) => f.ok);
    const quedaronAfuera = filas.filter((f) => !f.ok).map((f) => ({ fila: f.fila, motivo: f.motivo! }));

    if (correctas.length === 0) return { guardados: 0, quedaronAfuera, sinLotePorEstado, avisosDeNumero: [] };

    // Los ids se generan acá para que una cría pueda apuntar a su madre aunque esté más
    // abajo en la planilla: PostgreSQL comprueba las claves foráneas al terminar la sentencia.
    const idPorFila = new Map(correctas.map((f) => [f.fila, randomUUID()]));
    const data = correctas.map((f) => ({
      id: idPorFila.get(f.fila)!,
      establecimientoId, // siempre el tambo de la sesión
      numero: f.numero!,
      sexo: f.sexo as 'HEMBRA' | 'MACHO',
      estado: f.estado as (typeof ESTADOS_INICIALES)[number],
      fechaNacimiento: f.fechaNacimiento ? fechaADate(f.fechaNacimiento) : null,
      madreId: !f.vinculo ? null : f.vinculo.tipo === 'existente' ? f.vinculo.id : idPorFila.get(f.vinculo.fila)!,
      loteId: reglas.get(f.estado!) ?? null, // sin regla: sin lote (RF-8)
    }));

    // Madres que YA existen (no las de otras filas): se bloquean en esta transacción para que nadie
    // las dé de baja entre el análisis y el guardado (spec 006, RF-15 d).
    const madresExistentes = [...new Set(data.map((d, i) => (correctas[i]!.vinculo?.tipo === 'existente' ? d.madreId : null)).filter((m): m is string => m !== null))].sort();

    try {
      let guardado = true;
      if (madresExistentes.length === 0) {
        await prisma.animal.createMany({ data }); // nada que bloquear: una sola sentencia
      } else {
        guardado = await prisma.$transaction(
          async (tx) => {
            // FOR SHARE (en orden de id, sin interbloqueos): una baja de la madre espera a que termine esta
            // carga y, si ya se dio de baja, la madre no aparece y se vuelve a analizar todo.
            const filas = await tx.$queryRaw<{ id: string }[]>`
              SELECT "id"::text AS "id" FROM "animales"
              WHERE "id" = ANY(${madresExistentes}::uuid[]) AND "establecimientoId" = ${establecimientoId}::uuid AND "estado" <> 'BAJA'
              ORDER BY "id" FOR SHARE`;
            if (filas.length < madresExistentes.length) return false; // una madre dejó de estar activa
            await tx.animal.createMany({ data });
            return true;
          },
          { timeout: 15_000 },
        );
      }
      if (!guardado) continue; // se revalida con la base de este instante
      // Avisos de número de baja de las filas guardadas (RF-14).
      const avisosDeNumero = correctas
        .filter((f) => bajasPorNumero.has(f.numero!))
        .map((f) => ({ fila: f.fila, numero: f.numero!, avisoNumeroDeBaja: bajasPorNumero.get(f.numero!)! }));
      return { guardados: data.length, quedaronAfuera, sinLotePorEstado, avisosDeNumero };
    } catch (err) {
      // P2002: otro usuario ocupó un número entre el análisis y el guardado → se revalida todo.
      if (esErrorPrisma(err, 'P2002')) continue;
      // P2003: el lote destino se eliminó justo antes (RF-9).
      if (esErrorPrisma(err, 'P2003')) throw new HttpError(409, 'El lote destino ya no existe, volvé a intentar');
      throw err;
    }
  }
  throw new HttpError(409, 'Otro usuario cargó animales con los mismos números mientras se guardaba: volvé a intentar');
}
