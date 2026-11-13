// Envío real de un pendiente al servidor (spec 009 para litros; spec 010 para todos los tipos). Es la pieza que
// habla con la red: la lógica de qué hacer con la respuesta está en clasificar.ts, cola.ts y sincronizar.ts (puras
// y con tests).
//
// No pasa por `api()` a propósito: `api()` convierte los errores en excepciones y, sin conexión, responde
// desde la copia; acá hace falta la respuesta CRUDA (código y cuerpo) para clasificarla.

import { avisarSesionVencida } from '../compartido/api';
import { datosLitros, type Pendiente } from './almacen';
import type { Respuesta } from './clasificar';
import { obtenerConexion } from './conexion';

// Ruta de cada anulación: una por tipo de evento (el tipo sale de la ruta, no del cuerpo).
const RUTA_ANULACION: Record<string, string> = { SERVICIO: 'servicios', TACTO: 'tactos', PARTO: 'partos', SECADO: 'secados' };
// Ruta de cada carga bajo /api/animales/:id.
const RUTA_CARGA: Record<string, string> = { LITROS: 'produccion', SERVICIO: 'servicios', TACTO: 'tactos', PARTO: 'partos', SECADO: 'secados', BAJA: 'baja' };

// Dirección y cuerpo del pedido de un pendiente. El tambo y el usuario salen de la sesión (cookie), nunca del cuerpo.
//   - Cargas: el `id` del pendiente (hace el envío repetible sin duplicar) y la hora de la tablet (solo informativa).
//   - Anulación: va a la ruta del tipo del evento con solo el motivo; no tiene `id` propio (es idempotente por
//     evento + usuario + motivo).
export function pedidoDe(p: Pendiente): { url: string; cuerpo: Record<string, unknown> } {
  if (p.tipo === 'ANULACION') {
    const ruta = RUTA_ANULACION[String(p.datos.tipoEvento)] ?? 'eventos-desconocidos';
    return { url: `/api/${ruta}/${encodeURIComponent(String(p.datos.eventoId))}/anular`, cuerpo: { motivo: p.datos.motivo } };
  }
  const datos = p.tipo === 'LITROS' ? { ...datosLitros(p) } : p.datos;
  return {
    url: `/api/animales/${encodeURIComponent(p.animalId)}/${RUTA_CARGA[p.tipo]}`,
    cuerpo: { ...datos, id: p.id, cargadoEnDispositivo: p.cargadoEnDispositivo },
  };
}

export async function enviarPendiente(p: Pendiente, senal: AbortSignal): Promise<Respuesta> {
  const conexion = obtenerConexion();
  const { url, cuerpo: cuerpoPedido } = pedidoDe(p);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpoPedido),
      credentials: 'same-origin',
      signal: senal,
    });
  } catch {
    conexion.hayFalloDeRed(); // no se llegó al servidor (o se agotó el tiempo)
    return { red: true };
  }

  const cuerpo: unknown = await res.json().catch(() => null);
  // Sin JSON no es la API: un portal de WiFi (200 con HTML) o un proxy con el servidor caído (502, 503...).
  if (cuerpo === null && (res.ok || res.status >= 500)) conexion.hayFalloDeRed();
  else conexion.hayRespuesta();

  if (res.status === 401) avisarSesionVencida(); // lleva al login; los pendientes se conservan
  return { estado: res.status, cuerpo };
}

// UUID v4 para el id de cada litro. `crypto.randomUUID` solo existe en contextos seguros (HTTPS o
// localhost): en una tablet por HTTP común no está, y se arma a mano con `getRandomValues`.
export function nuevoId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // versión 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variante
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
