import { diasEntre } from './fechas.js';
import { ordenarEventos, type EventoCalculo } from './situacion.js';

// Genética de la cría (spec 004, RF-15 y RF-16). Funciones PURAS: no tocan la base.
//
// Al registrar un parto se busca qué servicio lo originó, para saber de qué semen o toro
// es la cría. Es una búsqueda DISTINTA del "servicio base" de la 003 (situacion.ts) a
// propósito: el servicio base se corta con un tacto "vacía", y para la genética un tacto
// "vacía" no importa (la vaca puede haber sido tactada vacía por error y parir igual).

// Rango de días entre el servicio y el parto en que se vincula (extremos incluidos).
export const DIAS_MINIMOS_GENETICA = 240;
export const DIAS_MAXIMOS_GENETICA = 300;

/**
 * El último servicio no anulado posterior al último parto no anulado (o de todo el historial
 * si no hubo parto), ignorando los tactos "vacía". `lista` son los eventos YA existentes de
 * la vaca (el parto nuevo todavía no está). Devuelve null si no hay.
 */
export function servicioParaGenetica<T extends EventoCalculo>(lista: readonly T[]): T | null {
  const vigentes = ordenarEventos(lista).filter((e) => !e.anulado);
  const posicionUltimoParto = vigentes.map((e) => e.tipo).lastIndexOf('PARTO');
  const posteriores = vigentes.slice(posicionUltimoParto + 1); // sin parto: lastIndexOf = -1 → todo
  const servicios = posteriores.filter((e) => e.tipo === 'SERVICIO');
  return servicios[servicios.length - 1] ?? null;
}

export type ResultadoGenetica =
  | { vinculado: true; servicioId: string }
  | { vinculado: false; motivo: 'SIN_SERVICIO' }
  | { vinculado: false; motivo: 'FUERA_DE_RANGO'; fechaServicio: string };

/**
 * ¿Se vincula el servicio al parto? Sí si entre las dos fechas hay de 240 a 300 días.
 * Si no hay servicio o está fuera de rango, el parto se guarda igual, sin genética (RF-16):
 * quien llama usa el motivo para elegir el aviso.
 */
export function evaluarGenetica(
  servicio: Pick<EventoCalculo, 'id' | 'fecha'> | null,
  fechaParto: string,
): ResultadoGenetica {
  if (!servicio) return { vinculado: false, motivo: 'SIN_SERVICIO' };
  const dias = diasEntre(servicio.fecha, fechaParto);
  if (dias >= DIAS_MINIMOS_GENETICA && dias <= DIAS_MAXIMOS_GENETICA) {
    return { vinculado: true, servicioId: servicio.id };
  }
  return { vinculado: false, motivo: 'FUERA_DE_RANGO', fechaServicio: servicio.fecha };
}
