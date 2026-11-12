// Carga de los litros de una vaca desde el formulario (spec 009, RF-18, RF-22, RF-24).
// Lógica pura: el envío, el reloj y el generador de ids se inyectan.
//
//   Con señal : se manda enseguida. Si el servidor no confirma a los 10 s o falla la red, queda como
//               pendiente CON EL MISMO ID (reenviarlo después no duplica). Si el servidor lo rechaza por
//               una regla del negocio, se muestra el motivo y NO se guarda como pendiente.
//   Sin señal : directo a pendiente, sin intentar la red.

import type { RegistroProduccion } from '../compartido/api';
import type { Almacen, Pendiente } from './almacen';
import { clasificarRespuesta, enviarConLimite, type Respuesta } from './clasificar';
import { controlarCarga, guardarNuevoPendiente, type DatosCarga, type Persona } from './cola';
import { horaParaApi } from './horaArgentina';
import { ESPERA_CARGA_MS } from './limites';

export type ResultadoCarga =
  | { tipo: 'enviado'; registro: RegistroProduccion } // el servidor lo aceptó en el momento
  | { tipo: 'pendiente'; pendiente: Pendiente } // quedó guardado en la tablet, pendiente de sincronizar
  | { tipo: 'invalido'; errores: Record<string, string>; general: string | null }
  | { tipo: 'sinLugar'; mensaje: string };

export async function cargarLitros(args: {
  almacen: Almacen;
  persona: Persona;
  datos: DatosCarga;
  // Registros de la copia de la vaca, para el duplicado local sin conexión (RF-20).
  registrosCopia: RegistroProduccion[] | null;
  enLinea: boolean;
  enviar: (p: Pendiente, senal: AbortSignal) => Promise<Respuesta> | Respuesta;
  ahora: Date;
  generarId: () => string;
  tiempoMs?: number;
  maxPendientes?: number;
}): Promise<ResultadoCarga> {
  const { almacen, persona, datos, enLinea, enviar, ahora, generarId, maxPendientes } = args;

  // Sin señal se mira también la copia; con señal manda el servidor (la copia puede estar vieja).
  const control = await controlarCarga({ almacen, persona, datos, registrosCopia: enLinea ? null : args.registrosCopia, ahora });
  if (!control.ok) return { tipo: 'invalido', errores: control.errores, general: control.general };

  const completos: DatosCarga = { ...datos, litros: control.litros };
  const id = generarId(); // el id nace acá, en el dispositivo, y es el mismo en todos los reintentos

  const guardar = async (): Promise<ResultadoCarga> => {
    const r = await guardarNuevoPendiente({ almacen, persona, datos: completos, id, ahora, maxPendientes });
    return r.ok ? { tipo: 'pendiente', pendiente: r.pendiente } : { tipo: 'sinLugar', mensaje: r.mensaje };
  };

  if (!enLinea) return guardar();

  // Con señal: se manda como si ya fuera un pendiente (mismo formato), sin guardarlo todavía.
  const p: Pendiente = {
    id,
    usuarioId: persona.usuarioId,
    establecimientoId: persona.establecimientoId,
    animalId: completos.animalId,
    numero: completos.numero,
    fecha: completos.fecha,
    turno: completos.turno as Pendiente['turno'],
    litros: completos.litros,
    cargadoEnDispositivo: horaParaApi(ahora),
    orden: 0,
    estado: 'enviando',
    motivo: null,
    codigoRechazo: null,
    intentos: 0,
    proximoIntento: null,
  };
  const respuesta = await enviarConLimite(enviar, p, args.tiempoMs ?? ESPERA_CARGA_MS);
  const c = clasificarRespuesta(respuesta, p);

  if (c.tipo === 'aceptado') {
    // Queda como "enviado" hasta que la copia lo incluya: si se corta la señal enseguida, la ficha igual lo muestra.
    await almacen
      .guardarEnviado({ id, usuarioId: persona.usuarioId, establecimientoId: persona.establecimientoId, animalId: p.animalId, numero: p.numero, registro: c.registro })
      .catch(() => undefined);
    return { tipo: 'enviado', registro: c.registro };
  }
  if (c.tipo === 'rechazado') {
    // El servidor dijo que no por una regla: se muestra (campo por campo si corresponde) y no se guarda.
    const generalSinCampo = Object.keys(c.campos).length === 0 ? c.motivo : null;
    return { tipo: 'invalido', errores: c.campos, general: generalSinCampo };
  }
  // 'esperar' (red, tiempo agotado, 5xx, HTML...) o 'sesion' (401): no se pierde lo cargado.
  return guardar();
}

