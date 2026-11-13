// Quién espera a quién entre los pendientes de una misma vaca (spec 010, RF-24 a RF-27). Lógica pura.
//
// Regla de fondo: los EVENTOS (servicio, tacto, parto, secado, baja y anulaciones) de una vaca se envían en el
// orden en que se cargaron: un evento no sale mientras haya otro evento anterior de esa vaca sin aceptar
// (esperando, enviando o rechazado: si sigue en `pendientes`, el servidor todavía no lo aceptó). Los LITROS
// esperan a los eventos anteriores de su vaca, pero no frenan a nadie: un litro pendiente o rechazado nunca
// detiene a otro pendiente.
//
// Todas las funciones reciben la lista de pendientes YA filtrada por dueño (usuario y tambo de la sesión).

import type { Pendiente } from './almacen';

// Lo que ve el usuario. `enEspera` no se guarda: se calcula acá a partir de lo que hay delante, así reintentar
// o descartar el rechazado libera solo a los que esperaban y no puede quedar un estado viejo.
export type EstadoVisible = 'esperando' | 'enviando' | 'rechazado' | 'enEspera';

const esEvento = (p: Pendiente) => p.tipo !== 'LITROS';

// Pendientes de la misma vaca cargados antes que `p`, en orden de carga.
export function anterioresDe(p: Pendiente, pendientes: Pendiente[]): Pendiente[] {
  return pendientes.filter((x) => x.id !== p.id && x.animalId === p.animalId && x.orden < p.orden).sort((a, b) => a.orden - b.orden);
}

// Pendientes de la misma vaca cargados después que `p`, en orden de carga (lo que se ve afectado si se lo descarta).
export function posterioresDe(p: Pendiente, pendientes: Pendiente[]): Pendiente[] {
  return pendientes.filter((x) => x.id !== p.id && x.animalId === p.animalId && x.orden > p.orden).sort((a, b) => a.orden - b.orden);
}

// Eventos anteriores de la misma vaca que siguen sin aceptarse (los litros anteriores no cuentan).
function eventosAnteriores(p: Pendiente, pendientes: Pendiente[]): Pendiente[] {
  return anterioresDe(p, pendientes).filter(esEvento);
}

// ¿Se puede enviar ahora? Está `esperando`, ya cumplió su espera (salvo que se pida ignorarla) y no tiene
// eventos anteriores de su vaca sin aceptar. Un fallo transitorio de un anterior también frena a los siguientes
// de esa vaca: el anterior sigue en `pendientes`.
export function puedeEnviarse(p: Pendiente, pendientes: Pendiente[], ahoraMs: number, ignorarEsperas = false): boolean {
  if (p.estado !== 'esperando') return false;
  if (!ignorarEsperas && p.proximoIntento !== null && p.proximoIntento > ahoraMs) return false;
  return eventosAnteriores(p, pendientes).length === 0;
}

// El primero que puede enviarse por orden de carga (entre todas las vacas), o null si no hay ninguno.
export function primeroEnviable(pendientes: Pendiente[], ahoraMs: number, ignorarEsperas = false): Pendiente | null {
  const orden = [...pendientes].sort((a, b) => a.orden - b.orden);
  return orden.find((p) => puedeEnviarse(p, pendientes, ahoraMs, ignorarEsperas)) ?? null;
}

// Estado que se muestra: `enEspera` si un evento anterior de la misma vaca está rechazado y este pendiente
// todavía no se envió. Un litro rechazado no frena a nadie (no es un evento).
export function estadoVisible(p: Pendiente, pendientes: Pendiente[]): EstadoVisible {
  if (p.estado === 'esperando' && eventosAnteriores(p, pendientes).some((x) => x.estado === 'rechazado')) return 'enEspera';
  return p.estado;
}
