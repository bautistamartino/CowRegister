// Qué hacer con la respuesta del servidor al enviar un litro pendiente (spec 009, RF-24 y RF-29 a RF-32).
// Es la TABLA CERRADA de la spec, en código y sin React:
//
//   aceptado  : 2xx con la forma de la API y los mismos datos (incluye "ya estaba guardado").
//   rechazado : 400, 403, 404, 409 con el mensaje en español de la API. No se reintenta solo.
//   sesion    : 401. Se detiene el envío y se conserva todo.
//   esperar   : todo lo demás (408, 429, 5xx, códigos no listados, corte de red, tiempo agotado, una
//               respuesta que no es de la API como el HTML de un portal de WiFi). Se reintenta solo.
//
// La regla de fondo: ante la duda, ESPERAR. Marcar como rechazado algo que fue una falla de red haría
// perder un litro; esperar de más solo demora su envío.

import type { RegistroProduccion } from '../compartido/api';
import type { Pendiente } from './almacen';

// Lo que devuelve un envío: o no se llegó al servidor (red / tiempo agotado), o hubo una respuesta
// con su código y su cuerpo ya leído como JSON (null si el cuerpo no era JSON).
export type Respuesta = { red: true; motivo?: 'tiempo' | 'red' } | { red?: false; estado: number; cuerpo: unknown };

export type Clasificacion =
  | { tipo: 'aceptado'; registro: RegistroProduccion }
  | { tipo: 'rechazado'; estado: number; motivo: string; campos: Record<string, string> }
  | { tipo: 'sesion' }
  | { tipo: 'esperar'; motivo: string; red: boolean };

// Lo mínimo de un pendiente para comparar con lo que devuelve el servidor.
type Esperado = Pick<Pendiente, 'id' | 'animalId' | 'fecha' | 'turno' | 'litros'>;

const RECHAZOS = [400, 403, 404, 409];

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// ¿El cuerpo es el registro que se pidió guardar? Coinciden id, vaca, fecha, turno y litros.
// (Un 2xx que no coincide no es de la API: se espera en vez de darlo por guardado.)
function esElRegistro(cuerpo: unknown, p: Esperado): cuerpo is RegistroProduccion {
  if (!esObjeto(cuerpo)) return false;
  return (
    typeof cuerpo.id === 'string' &&
    cuerpo.id.toLowerCase() === p.id.toLowerCase() &&
    cuerpo.animalId === p.animalId &&
    cuerpo.fecha === p.fecha &&
    cuerpo.turno === p.turno &&
    typeof cuerpo.litros === 'number' &&
    Math.round(cuerpo.litros * 10) === Math.round(Number(p.litros) * 10) // comparación en décimas, sin coma flotante
  );
}

// Motivo de un rechazo: el de cada campo si lo hay (400 de validación) o el mensaje general.
function leerRechazo(cuerpo: unknown): { motivo: string; campos: Record<string, string> } | null {
  if (!esObjeto(cuerpo) || typeof cuerpo.error !== 'string' || cuerpo.error.trim() === '') return null;
  const campos: Record<string, string> = {};
  if (Array.isArray(cuerpo.detalles)) {
    for (const d of cuerpo.detalles) {
      if (esObjeto(d) && typeof d.campo === 'string' && typeof d.mensaje === 'string') campos[d.campo] = d.mensaje;
    }
  }
  const mensajes = Object.values(campos);
  return { motivo: mensajes.length ? mensajes.join('. ') : cuerpo.error, campos };
}

function esperar(motivo: string, red = false): Clasificacion {
  return { tipo: 'esperar', motivo, red };
}

export function clasificarRespuesta(r: Respuesta, p: Esperado): Clasificacion {
  if (r.red) return esperar(r.motivo === 'tiempo' ? 'El servidor no respondió a tiempo' : 'No se pudo conectar con el servidor', true);

  const { estado, cuerpo } = r;
  if (estado >= 200 && estado < 300) {
    if (esElRegistro(cuerpo, p)) return { tipo: 'aceptado', registro: cuerpo };
    return esperar('El servidor respondió algo que no es de CowRegister (¿WiFi sin internet?)');
  }
  if (estado === 401) return { tipo: 'sesion' };
  if (RECHAZOS.includes(estado)) {
    const rechazo = leerRechazo(cuerpo);
    if (rechazo) return { tipo: 'rechazado', estado, ...rechazo };
    // 400/403/404/409 sin el mensaje de la API: lo puso otro (portal, proxy), no una regla del negocio.
    return esperar(`El servidor respondió algo que no es de CowRegister (código ${estado})`);
  }
  if (estado === 429) return esperar('El servidor pide esperar un momento');
  if (estado === 408 || estado >= 500) return esperar('El servidor no pudo procesarlo por ahora');
  return esperar(`Respuesta inesperada del servidor (código ${estado})`);
}

// Corre un envío con tiempo límite: si el servidor no responde a tiempo se cancela el pedido (AbortSignal)
// y el resultado es "red / tiempo agotado". Nunca lanza: una excepción del envío cuenta como falla de red.
// La carrera (`Promise.race`) asegura que se siga adelante aunque el envío ignore la señal.
export async function enviarConLimite(
  enviar: (p: Pendiente, senal: AbortSignal) => Promise<Respuesta> | Respuesta,
  p: Pendiente,
  tiempoMs: number,
): Promise<Respuesta> {
  const control = new AbortController();
  let corte: ReturnType<typeof setTimeout> | undefined;
  const agotado = new Promise<Respuesta>((resolver) => {
    corte = setTimeout(() => {
      control.abort();
      resolver({ red: true, motivo: 'tiempo' });
    }, tiempoMs);
  });
  try {
    const envio = (async () => enviar(p, control.signal))().catch((): Respuesta => ({ red: true, motivo: 'red' }));
    return await Promise.race([envio, agotado]);
  } finally {
    clearTimeout(corte);
  }
}
