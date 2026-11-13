// Permisos por rol de las cargas y anulaciones sin conexión (spec 010, RF-10 y RF-22).
//
// Es la misma matriz que controla la API (api/src/app.ts y las rutas), copiada acá porque la web no importa
// código de la API: la tablet no guarda un pendiente que el rol del usuario no puede cargar. El permiso REAL lo
// sigue controlando el servidor (un veterinario que manipule la tablet recibe 403 igual).
//
//   Servicio y tacto (y anular un servicio o un tacto): los tres roles.
//   Parto, secado y baja (y anular un parto o un secado): dueño y encargado.
//   Litros (spec 009): dueño y encargado.

import type { Rol } from '../compartido/api';
import type { TipoPendiente } from './almacen';

// Los eventos que se pueden anular (el tipo del evento, no de la anulación).
export type TipoEventoAnulable = 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO';

// Mensajes de la API: el 403 de los eventos y el de los litros (api/src/auth/middleware.ts).
export const MENSAJE_SIN_PERMISO = 'No tenés permiso para hacer esto';
export const MENSAJE_SOLO_DUENO_O_ENCARGADO = 'Esta acción la tiene que hacer un dueño o encargado';

const TODOS: readonly Rol[] = ['DUENO', 'ENCARGADO', 'VETERINARIO'];
const DUENO_Y_ENCARGADO: readonly Rol[] = ['DUENO', 'ENCARGADO'];

// Quién puede cargar cada tipo (la anulación depende del tipo del evento que anula).
const CARGAR: Record<Exclude<TipoPendiente, 'ANULACION'>, readonly Rol[]> = {
  LITROS: DUENO_Y_ENCARGADO,
  SERVICIO: TODOS,
  TACTO: TODOS,
  PARTO: DUENO_Y_ENCARGADO,
  SECADO: DUENO_Y_ENCARGADO,
  BAJA: DUENO_Y_ENCARGADO,
};

const ANULAR: Record<TipoEventoAnulable, readonly Rol[]> = {
  SERVICIO: TODOS,
  TACTO: TODOS,
  PARTO: DUENO_Y_ENCARGADO,
  SECADO: DUENO_Y_ENCARGADO,
};

// ¿Puede este rol cargar este tipo? Para una ANULACION hay que indicar el tipo del evento que se anula.
export function puedeRegistrar(rol: Rol, tipo: TipoPendiente, tipoEvento?: string): boolean {
  if (tipo === 'ANULACION') {
    const permitidos = ANULAR[tipoEvento as TipoEventoAnulable];
    return permitidos !== undefined && permitidos.includes(rol);
  }
  return CARGAR[tipo].includes(rol);
}

// El mensaje de rechazo, igual al de la API para ese tipo.
export function mensajeSinPermiso(tipo: TipoPendiente): string {
  return tipo === 'LITROS' ? MENSAJE_SOLO_DUENO_O_ENCARGADO : MENSAJE_SIN_PERMISO;
}
