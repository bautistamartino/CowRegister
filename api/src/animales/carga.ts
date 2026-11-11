import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { HttpError, esErrorPrisma } from '../errores.js';
import { normalizarNumero } from '../validacion.js';
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
  return { filas: analizadas, reglas, sinLotePorEstado: sinLotePorEstado(analizadas, reglas) };
}

// Fila sin el dato interno `vinculo`, como se devuelve a la web.
export function filaPublica({ vinculo: _vinculo, ...resto }: FilaAnalizada) {
  return resto;
}

/**
 * Confirma la carga (RF-18, RF-19, RF-21): revalida el texto completo con la base de este
 * instante y guarda las filas correctas con UN solo createMany (una sola sentencia SQL:
 * se guarda todo o nada). Si un número se ocupa justo en el medio (P2002), vuelve a
 * revalidar y reintenta; tras 3 intentos responde 409 sin guardar nada.
 */
export async function confirmarPlanilla(texto: string, establecimientoId: string) {
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    const { filas, reglas, sinLotePorEstado } = await analizarTexto(texto, establecimientoId);
    const correctas = filas.filter((f) => f.ok);
    const quedaronAfuera = filas.filter((f) => !f.ok).map((f) => ({ fila: f.fila, motivo: f.motivo! }));

    if (correctas.length === 0) return { guardados: 0, quedaronAfuera, sinLotePorEstado };

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

    try {
      await prisma.animal.createMany({ data });
      return { guardados: data.length, quedaronAfuera, sinLotePorEstado };
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
