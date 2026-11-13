// Qué hacer con la respuesta del servidor al enviar un pendiente (spec 009, RF-24 y RF-29 a RF-32; spec 010, RF-25).
// Es la TABLA CERRADA de la spec, en código y sin React:
//
//   aceptado  : 2xx con la forma de la API y los mismos datos (incluye "ya estaba guardado"). La forma depende
//               del tipo (ver `leerAceptado`).
//   rechazado : 400, 403, 404, 409 con el mensaje en español de la API. No se reintenta solo.
//   sesion    : 401. Se detiene el envío y se conserva todo.
//   esperar   : todo lo demás (408, 429, 5xx, códigos no listados, corte de red, tiempo agotado, una
//               respuesta que no es de la API como el HTML de un portal de WiFi). Se reintenta solo.
//
// La regla de fondo: ante la duda, ESPERAR. Marcar como rechazado algo que fue una falla de red haría
// perder un litro; esperar de más solo demora su envío.

import type { Aviso, RegistroProduccion } from '../compartido/api';
import { datosLitros, type Pendiente } from './almacen';

// Lo que devuelve un envío: o no se llegó al servidor (red / tiempo agotado), o hubo una respuesta
// con su código y su cuerpo ya leído como JSON (null si el cuerpo no era JSON).
export type Respuesta = { red: true; motivo?: 'tiempo' | 'red' } | { red?: false; estado: number; cuerpo: unknown };

export type Clasificacion =
  // `registro` solo viene en los litros (como en la 009). `aceptadoEn` es la hora del SERVIDOR (milisegundos) y
  // `avisos` los que dio al aceptar (en un reenvío, los del primer envío).
  | { tipo: 'aceptado'; registro: RegistroProduccion | null; aceptadoEn: number; avisos: Aviso[] }
  | { tipo: 'rechazado'; estado: number; motivo: string; campos: Record<string, string> }
  | { tipo: 'sesion' }
  | { tipo: 'esperar'; motivo: string; red: boolean };

// Lo mínimo de un litro pendiente para comparar con lo que devuelve el servidor.
type Esperado = { id: string; animalId: string; fecha: string; turno: string; litros: string };

const esperadoDe = (p: Pendiente): Esperado => ({ id: p.id, animalId: p.animalId, ...datosLitros(p) });

const RECHAZOS = [400, 403, 404, 409];

// Avisos del cuerpo: una lista de { codigo, mensaje }. Lo que no tenga esa forma se ignora.
function leerAvisos(x: unknown): Aviso[] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((a) => (esObjeto(a) && typeof a.codigo === 'string' && typeof a.mensaje === 'string' ? [{ codigo: a.codigo, mensaje: a.mensaje }] : []));
}

const mismoId = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

// Lee el 2xx de un pendiente de EVENTO (no litros) según la forma de su ruta (spec 010, RF-5 y RF-7):
//   servicio, tacto       : 201 con el evento a secas.
//   parto, secado         : 201 con { evento, avisos }.
//   baja                  : 201 con el objeto plano de la baja.
//   reenvío de una carga  : 200 con { evento, avisos, yaExistia: true } (los cinco tipos).
//   anulación             : 200 con el evento anulado (servicio, tacto) o { evento, avisos } (parto, secado);
//                           en el reenvío se suma `yaEstabaAnulado: true`.
// Devuelve null si no es esa forma o si el `id` no es el del pendiente (algo que no es de la API: se espera).
function leerAceptadoEvento(cuerpo: unknown, p: Pendiente): { aceptadoEn: number; avisos: Aviso[] } | null {
  if (!esObjeto(cuerpo)) return null;
  let evento: unknown;
  let avisos: unknown = [];

  if (p.tipo === 'ANULACION') {
    const conCaja = p.datos.tipoEvento === 'PARTO' || p.datos.tipoEvento === 'SECADO';
    evento = conCaja ? cuerpo.evento : cuerpo;
    if (conCaja) avisos = cuerpo.avisos;
    if (!esObjeto(evento) || !mismoId(evento.id, String(p.datos.eventoId))) return null;
    // La anulación aceptada trae el evento ya anulado; la hora de la anulación es la del servidor.
    const anulacion = evento.anulacion;
    if (!esObjeto(anulacion) || typeof anulacion.en !== 'string') return null;
    const aceptadoEn = Date.parse(anulacion.en);
    return Number.isNaN(aceptadoEn) ? null : { aceptadoEn, avisos: leerAvisos(avisos) };
  }

  if (cuerpo.yaExistia === true || p.tipo === 'PARTO' || p.tipo === 'SECADO') {
    evento = cuerpo.evento;
    avisos = cuerpo.avisos;
  } else {
    evento = cuerpo; // servicio, tacto y baja (201)
  }
  if (!esObjeto(evento) || !mismoId(evento.id, p.id)) return null;
  // Si el evento trae su tipo (el de la lista), tiene que ser el que se mandó. La baja plana no lo trae.
  if (typeof evento.tipo === 'string' && evento.tipo !== p.tipo) return null;
  if (typeof evento.registradoEn !== 'string') return null;
  const aceptadoEn = Date.parse(evento.registradoEn);
  return Number.isNaN(aceptadoEn) ? null : { aceptadoEn, avisos: leerAvisos(avisos) };
}

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

export function clasificarRespuesta(r: Respuesta, pendiente: Pendiente): Clasificacion {
  if (r.red) return esperar(r.motivo === 'tiempo' ? 'El servidor no respondió a tiempo' : 'No se pudo conectar con el servidor', true);

  const { estado, cuerpo } = r;
  if (estado >= 200 && estado < 300) {
    if (pendiente.tipo === 'LITROS') {
      if (esElRegistro(cuerpo, esperadoDe(pendiente))) return { tipo: 'aceptado', registro: cuerpo, aceptadoEn: Date.parse(cuerpo.registradoEn), avisos: [] };
    } else {
      const aceptado = leerAceptadoEvento(cuerpo, pendiente);
      if (aceptado) return { tipo: 'aceptado', registro: null, ...aceptado };
    }
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
