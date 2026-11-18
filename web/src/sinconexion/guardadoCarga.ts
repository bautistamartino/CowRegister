// Traduce lo que devuelve `registrar` a lo que muestra un formulario de carga (spec 011, RF-8, RF-10, RF-11, RF-12).
// Lógica pura (sin React): la usa el hook `useGuardarCarga` y se prueba aparte.

import type { Aviso } from '../compartido/api';
import type { TipoPendiente } from './almacen';
import { aErroresFormulario, type ErroresFormulario } from './formularioRechazo';
import type { ResultadoRegistro } from './registrar';
import { resumenPendiente } from './resumenPendiente';

export const TEXTO_GUARDADO_PENDIENTE = 'Guardado en la tablet: pendiente de sincronizar';

// Lo que se le dice a la persona cuando la carga quedó guardada (en el servidor o en la tablet).
export type ConfirmacionCarga = { titulo: string; detalle: string | null; avisos: Aviso[] };

export type SalidaGuardado =
  // `pendiente`: true si quedó en la tablet; false si el servidor la aceptó en el momento.
  | { tipo: 'guardado'; pendiente: boolean; confirmacion: ConfirmacionCarga; evento: Record<string, unknown> | null }
  // `rechazo` dice quién rechazó (para casos como el 404 del servidor al dar de baja); null si fue "sin lugar".
  | { tipo: 'error'; errores: ErroresFormulario; rechazo: { origen: 'servidor' | 'local'; codigo: number } | null };

export type OpcionesTraduccion = {
  tipo: TipoPendiente;
  datos: Record<string, unknown>;
  tituloAceptado: string; // por ejemplo "Servicio registrado"
  camposDibujados: string[]; // los campos que el formulario muestra (el resto va a la alerta de arriba)
};

export function traducirGuardado(r: ResultadoRegistro, opciones: OpcionesTraduccion): SalidaGuardado {
  if (r.tipo === 'enviado') {
    return { tipo: 'guardado', pendiente: false, confirmacion: { titulo: opciones.tituloAceptado, detalle: null, avisos: r.avisos }, evento: r.evento ?? null };
  }
  if (r.tipo === 'pendiente') {
    // El resumen sale de lo que realmente quedó guardado.
    const detalle = resumenPendiente(r.pendiente.tipo, r.pendiente.datos);
    return { tipo: 'guardado', pendiente: true, confirmacion: { titulo: TEXTO_GUARDADO_PENDIENTE, detalle, avisos: [] }, evento: null };
  }
  const errores = aErroresFormulario(r, opciones.camposDibujados);
  return { tipo: 'error', errores, rechazo: r.tipo === 'rechazado' ? { origen: r.origen, codigo: r.codigo } : null };
}
