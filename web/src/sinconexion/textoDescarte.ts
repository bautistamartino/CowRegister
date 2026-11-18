// Texto que se muestra al descartar un pendiente (spec 011, RF-7). Lógica pura, compartida por las pantallas.
// `descartado` lleva el texto de lo que se quitó (cada pantalla sabe cómo nombrarlo); el resto no depende de la pantalla.

export type ResultadoDescarte = 'descartado' | 'ya-guardado' | 'no-existe' | 'requiere-confirmacion';

export function textoDescarte(r: ResultadoDescarte, descartado: string): { tipo: 'aviso' | 'error'; texto: string } {
  if (r === 'descartado') return { tipo: 'aviso', texto: descartado };
  // El servidor lo aceptó mientras tanto: no hay nada que descartar y no es un error.
  if (r === 'ya-guardado') return { tipo: 'aviso', texto: 'Ya estaba guardado en el servidor' };
  if (r === 'no-existe') return { tipo: 'error', texto: 'Ese pendiente ya no está' };
  return { tipo: 'error', texto: 'No se pudo descartar sin confirmación. Probá de nuevo' };
}
