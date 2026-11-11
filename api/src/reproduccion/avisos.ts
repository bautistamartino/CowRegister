import { aFechaCorta } from './fechas.js';

// Avisos de las operaciones de la spec 004 (lista cerrada de 7). Viajan con la respuesta de
// la operación y la pantalla los muestra una sola vez: NO se guardan en la base.
// Los textos viven acá, en un solo lugar, igual que los códigos.

export type CodigoAviso =
  | 'SIN_LOTE_MADRE_EN_ORDENE' // 1
  | 'SIN_LOTE_MADRE_SECA' // 2
  | 'SIN_LOTE_CRIA' // 3
  | 'SIN_GENETICA_SIN_SERVICIO' // 4
  | 'SIN_GENETICA_FUERA_DE_RANGO' // 5
  | 'SIN_LOTE_PREVIO' // 6 (anulación)
  | 'LOTE_PREVIO_ELIMINADO'; // 7 (anulación)

export type Aviso = { codigo: CodigoAviso; mensaje: string };

// Avisos 1 y 2: la vaca quedó sin lote porque su nuevo estado no tiene lote destino.
export function avisoSinLoteMadre(estado: 'EN_ORDENE' | 'SECA'): Aviso {
  const nombre = estado === 'EN_ORDENE' ? 'en ordeñe' : 'seca';
  return {
    codigo: estado === 'EN_ORDENE' ? 'SIN_LOTE_MADRE_EN_ORDENE' : 'SIN_LOTE_MADRE_SECA',
    mensaje: `La vaca quedó sin lote: el estado «${nombre}» no tiene un lote asignado`,
  };
}

// Aviso 3: una por cría viva (en el orden de carga).
export function avisoSinLoteCria(numero: string): Aviso {
  return {
    codigo: 'SIN_LOTE_CRIA',
    mensaje: `La cría N.º ${numero} quedó sin lote: el estado «recién nacido» no tiene un lote asignado`,
  };
}

// Aviso 4: no hay servicio posterior al último parto (o en todo el historial si no hubo parto).
export function avisoSinGeneticaSinServicio(huboPartoAntes: boolean): Aviso {
  return {
    codigo: 'SIN_GENETICA_SIN_SERVICIO',
    mensaje: huboPartoAntes
      ? 'El parto se guardó sin genética: no hay un servicio cargado después del último parto'
      : 'El parto se guardó sin genética: no hay un servicio cargado en el historial de la vaca',
  };
}

// Aviso 5: el último servicio está fuera del plazo de 240 a 300 días.
export function avisoSinGeneticaFueraDeRango(fechaServicio: string): Aviso {
  return {
    codigo: 'SIN_GENETICA_FUERA_DE_RANGO',
    mensaje: `El parto se guardó sin genética: el último servicio es del ${aFechaCorta(fechaServicio)} y está fuera del plazo de 240 a 300 días antes del parto`,
  };
}

// Aviso 6 (lo usa la anulación, T3): la vaca no tenía lote antes del evento.
export function avisoSinLotePrevio(estado: string, tipo: 'parto' | 'secado', fechaEvento: string): Aviso {
  return {
    codigo: 'SIN_LOTE_PREVIO',
    mensaje: `La vaca volvió a «${nombreEstado(estado)}» y quedó sin lote: no tenía lote antes del ${tipo} del ${aFechaCorta(fechaEvento)}`,
  };
}

// Aviso 7 (lo usa la anulación, T3): el lote anterior fue eliminado.
export function avisoLoteAnteriorEliminado(estado: string): Aviso {
  return {
    codigo: 'LOTE_PREVIO_ELIMINADO',
    mensaje: `La vaca volvió a «${nombreEstado(estado)}» y quedó sin lote: su lote anterior ya no existe`,
  };
}

// 'EN_ORDENE' → 'en ordeñe'. Acepta el estado de la base o el nombre ya en minúsculas.
function nombreEstado(estado: string): string {
  const nombres: Record<string, string> = {
    RECIEN_NACIDO: 'recién nacido',
    VAQUILLONA: 'vaquillona',
    EN_ORDENE: 'en ordeñe',
    SECA: 'seca',
  };
  return nombres[estado] ?? estado.toLowerCase();
}
