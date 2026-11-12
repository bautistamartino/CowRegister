// Envío real de un litro al servidor (spec 009). Es la pieza que habla con la red: la lógica de qué hacer
// con la respuesta está en clasificar.ts, cola.ts y sincronizar.ts (puras y con tests).
//
// No pasa por `api()` a propósito: `api()` convierte los errores en excepciones y, sin conexión, responde
// desde la copia; acá hace falta la respuesta CRUDA (código y cuerpo) para clasificarla.

import { avisarSesionVencida } from '../compartido/api';
import type { Pendiente } from './almacen';
import type { Respuesta } from './clasificar';
import { obtenerConexion } from './conexion';

export async function enviarLitros(p: Pendiente, senal: AbortSignal): Promise<Respuesta> {
  const conexion = obtenerConexion();
  let res: Response;
  try {
    res = await fetch(`/api/animales/${encodeURIComponent(p.animalId)}/produccion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // El tambo sale de la sesión (cookie), nunca del cuerpo. `id` hace el envío repetible sin duplicar.
      body: JSON.stringify({ id: p.id, fecha: p.fecha, turno: p.turno, litros: p.litros, cargadoEnDispositivo: p.cargadoEnDispositivo }),
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
