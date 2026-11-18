// Texto corto de lo que es un pendiente (spec 011, RF-16). Lógica pura.
// Lo usan la confirmación "Guardado en la tablet: pendiente de sincronizar", el "Descartar" y, más adelante,
// la pantalla "Pendientes" (spec 012).

import type { TipoPendiente } from './almacen';

type DatosCria = { nacidaMuerta?: unknown };

// "Parto con 2 crías (1 nacida muerta)", "Parto con 1 cría (nacida muerta)", "Parto con 1 cría".
function resumenParto(datos: Record<string, unknown>): string {
  const crias = Array.isArray(datos.crias) ? (datos.crias as DatosCria[]) : [];
  if (crias.length === 0) return 'Parto';
  const muertas = crias.filter((c) => c?.nacidaMuerta === true).length;
  const base = `Parto con ${crias.length} ${crias.length === 1 ? 'cría' : 'crías'}`;
  if (muertas === 0) return base;
  // Con una sola cría muerta no hace falta contar: "(nacida muerta)".
  if (crias.length === 1) return `${base} (nacida muerta)`;
  return `${base} (${muertas} ${muertas === 1 ? 'nacida muerta' : 'nacidas muertas'})`;
}

export function resumenPendiente(tipo: TipoPendiente, datos: Record<string, unknown>): string {
  switch (tipo) {
    case 'SERVICIO':
      return 'Servicio';
    case 'TACTO':
      return datos.resultado === 'PRENADA' ? 'Tacto preñada' : 'Tacto vacía';
    case 'PARTO':
      return resumenParto(datos);
    case 'SECADO':
      return 'Secado';
    case 'BAJA':
      return datos.motivo === 'muerte' ? 'Baja por muerte' : 'Baja por venta';
    case 'ANULACION':
      // `tipoEvento` es el del evento que se anula (SERVICIO, TACTO, PARTO o SECADO).
      return `Anulación de ${String(datos.tipoEvento ?? 'evento').toLowerCase()}`;
    case 'LITROS':
      return 'Litros';
  }
}
