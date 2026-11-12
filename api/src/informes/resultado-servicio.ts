import { ordenarEventos, type EventoCalculo } from '../reproduccion/situacion.js';

// Resultado de un servicio para el informe de inseminación (spec 007, RF-7). Función PURA:
// recibe los eventos de UNA vaca y no toca la base.

export type ResultadoServicio = 'PRENADA_TACTO' | 'PRENADA_PARTO' | 'VACIA' | 'SIN_TACTO';

// Lo mínimo que se necesita de cada evento de la vaca (servicio, tacto o parto).
export type EventoResultado = Pick<EventoCalculo, 'id' | 'tipo' | 'fecha' | 'creadoEn' | 'resultado'> & {
  // Solo en partos: el servicio que se vinculó como genética de la cría (null si ninguno).
  servicioDelParto: string | null;
  // Los anulados se ignoran; así el cálculo es seguro aunque el que llama no los haya sacado.
  anulado?: boolean;
};

/**
 * Resultado de `servicio` según los eventos de la vaca, medido "a hoy":
 * 1. El tramo va desde el servicio hasta el siguiente servicio o parto no anulado (sin incluirlos),
 *    en el orden total (fecha y, a igual fecha, momento de registro).
 * 2. Manda el PRIMER tacto no anulado del tramo: "preñada" o "vacía". Uno posterior que lo
 *    contradiga no cambia nada.
 * 3. Sin tacto, si algún parto no anulado quedó vinculado a este servicio: preñada por parto.
 * 4. Si no, sin tacto.
 */
export function resultadoDeServicio(servicio: EventoResultado, eventosDeLaVaca: readonly EventoResultado[]): ResultadoServicio {
  const vigentes = ordenarEventos(eventosDeLaVaca.filter((e) => !e.anulado));
  const posicion = vigentes.findIndex((e) => e.id === servicio.id);

  if (posicion >= 0) {
    for (const e of vigentes.slice(posicion + 1)) {
      if (e.tipo === 'SERVICIO' || e.tipo === 'PARTO') break; // fin del tramo
      if (e.tipo === 'TACTO') return e.resultado === 'PRENADA' ? 'PRENADA_TACTO' : 'VACIA';
    }
  }

  const vinculado = vigentes.some((e) => e.tipo === 'PARTO' && e.servicioDelParto === servicio.id);
  return vinculado ? 'PRENADA_PARTO' : 'SIN_TACTO';
}
