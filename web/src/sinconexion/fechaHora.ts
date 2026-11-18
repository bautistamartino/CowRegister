// Formato de fecha y hora para los carteles de la copia local (spec 009). Sin dependencias.

import { formatearFechaHoraArgentina } from './horaArgentina';

// "12/11/2026 12:05" en hora de Argentina (para "Datos al día de…"). Delega en la implementación única (spec 011).
export function formatearFechaHora(iso: string): string {
  return formatearFechaHoraArgentina(new Date(iso));
}
