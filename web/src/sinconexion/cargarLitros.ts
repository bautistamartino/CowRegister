// Carga de los litros de una vaca desde el formulario (spec 009, RF-18, RF-22, RF-24). Desde la spec 010 la
// decisión de enviar enseguida o dejar pendiente la toma el punto único de registro (registrar.ts); acá quedan las
// validaciones propias de los litros (formato y duplicado) y la forma del resultado que usa la pantalla.
// Lógica pura: el envío, el reloj y el generador de ids se inyectan.
//
//   Con señal : se manda enseguida (si la vaca no tiene eventos sin aceptar delante). Si el servidor no confirma a
//               los 10 s o falla la red, queda como pendiente CON EL MISMO ID (reenviarlo no duplica). Si el
//               servidor lo rechaza por una regla del negocio, se muestra el motivo y NO se guarda.
//   Sin señal : directo a pendiente, sin intentar la red.
//   Los litros esperan a los eventos pendientes de su vaca (se guardan detrás sin enviarse) pero no los desvían.

import type { RegistroProduccion, Rol } from '../compartido/api';
import type { Almacen, Pendiente } from './almacen';
import type { Respuesta } from './clasificar';
import { controlarCarga, type DatosCarga, type Persona } from './cola';
import { registrar } from './registrar';

export type ResultadoCarga =
  | { tipo: 'enviado'; registro: RegistroProduccion } // el servidor lo aceptó en el momento
  | { tipo: 'pendiente'; pendiente: Pendiente } // quedó guardado en la tablet, pendiente de sincronizar
  | { tipo: 'invalido'; errores: Record<string, string>; general: string | null }
  | { tipo: 'sinLugar'; mensaje: string };

export async function cargarLitros(args: {
  almacen: Almacen;
  persona: Persona;
  rol: Rol; // los litros los cargan dueño y encargado (RF-22)
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
  const { almacen, persona, datos, enLinea } = args;

  // Sin señal se mira también la copia; con señal manda el servidor (la copia puede estar vieja).
  const control = await controlarCarga({ almacen, persona, datos, registrosCopia: enLinea ? null : args.registrosCopia, ahora: args.ahora });
  if (!control.ok) return { tipo: 'invalido', errores: control.errores, general: control.general };

  const r = await registrar({
    almacen,
    persona,
    rol: args.rol,
    tipo: 'LITROS',
    animal: { id: datos.animalId, numero: datos.numero },
    datos: { fecha: datos.fecha, turno: datos.turno, litros: control.litros },
    enLinea,
    enviar: args.enviar,
    ahora: args.ahora,
    generarId: args.generarId,
    tiempoMs: args.tiempoMs,
    maxPendientes: args.maxPendientes,
  });

  switch (r.tipo) {
    case 'enviado':
      // Un envío de litros aceptado siempre trae el registro (lo exige la clasificación).
      return r.registro ? { tipo: 'enviado', registro: r.registro } : { tipo: 'sinLugar', mensaje: 'Respuesta inesperada del servidor' };
    case 'pendiente':
      return { tipo: 'pendiente', pendiente: r.pendiente };
    case 'sinLugar':
      return { tipo: 'sinLugar', mensaje: r.mensaje };
    case 'rechazado': {
      // Se muestra campo por campo si corresponde (400 de validación) o como mensaje general.
      const generalSinCampo = Object.keys(r.campos).length === 0 ? r.mensaje : null;
      return { tipo: 'invalido', errores: r.campos, general: generalSinCampo };
    }
  }
}
