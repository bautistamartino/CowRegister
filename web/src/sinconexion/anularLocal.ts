// Anular un evento desde la tablet, o descartarlo si todavía no salió (spec 010, RF-16 y RF-17). Lógica pura.
//
// Se anula el ÚLTIMO evento no anulado de la vaca según la vista local (servicio, tacto, parto o secado):
//   - Si ese evento es un pendiente que el servidor todavía no aceptó, no hay nada que anular: se DESCARTA, y no
//     se crea ninguna anulación. Lo mismo si lo que se quiere anular es una anulación pendiente (`eventoId` con
//     el id de esa anulación).
//   - Si no, entra por el punto único de registro (registrar.ts) como una anulación: se manda enseguida o queda
//     pendiente según RF-15.
// Al descartar se devuelven los pendientes de la misma vaca cargados DESPUÉS, para que la pantalla pueda avisar;
// no se descarta ni se modifica ninguno por su cuenta.

import type { Rol } from '../compartido/api';
import type { Almacen, Pendiente } from './almacen';
import type { Respuesta } from './clasificar';
import { enviadosDe, pendientesDe, type Persona } from './cola';
import { posterioresDe } from './dependencias';
import { fechaYTurnoArgentina } from './horaArgentina';
import { registrar, type ResultadoRegistro } from './registrar';
import { construirVista, entradasValidas } from './vistaLocal';

export type ResultadoAnulacion =
  // Se quitó un pendiente (un evento o una anulación) y NO se creó ninguna anulación.
  | { tipo: 'descartado'; id: string; posteriores: Pendiente[] }
  // Lo que resolvió el punto único de registro (enviada, pendiente, rechazada o sin lugar).
  | { tipo: 'registro'; resultado: ResultadoRegistro };

export type ResultadoDescarte = 'descartado' | 'ya-guardado' | 'no-existe' | 'requiere-confirmacion';

export type ArgsAnulacion = {
  almacen: Almacen;
  persona: Persona;
  rol: Rol;
  animal: { id: string; numero: string };
  motivo: string;
  // El evento (o la anulación pendiente) a anular. Por omisión, el último evento no anulado de la vista.
  eventoId?: string;
  enLinea: boolean;
  enviar: (p: Pendiente, senal: AbortSignal) => Promise<Respuesta> | Respuesta;
  ahora: Date;
  generarId: () => string;
  tiempoMs?: number;
  maxPendientes?: number;
  // Cómo descartar un pendiente. En la app es `sincronizador.descartar`, que espera si el pendiente se está
  // enviando y responde 'ya-guardado' si el servidor lo aceptó. Por omisión se borra directo del almacén.
  descartar?: (id: string) => Promise<ResultadoDescarte>;
};

const rechazo = (codigo: number, mensaje: string): ResultadoAnulacion => ({
  tipo: 'registro',
  resultado: { tipo: 'rechazado', origen: 'local', codigo, mensaje, campos: {} },
});

export async function anularLocal(args: ArgsAnulacion): Promise<ResultadoAnulacion> {
  const { almacen, persona, animal, motivo } = args;
  const pendientes = await pendientesDe(almacen, persona);
  const copia = (await almacen.leerAnimales()).find((a) => a.ficha.id === animal.id);
  if (!copia) return rechazo(404, 'Animal no encontrado');

  const vista = construirVista(copia, entradasValidas(pendientes, await enviadosDe(almacen, persona)), fechaYTurnoArgentina(args.ahora).fecha);
  const objetivoId = args.eventoId ?? vista.ultimoNoAnulado?.id;
  if (!objetivoId) return rechazo(404, 'Evento no encontrado');

  // ¿Es un pendiente que todavía no se aceptó? Una anulación pendiente siempre se descarta; un evento pendiente
  // solo si es el último no anulado (anular uno del medio lo resuelven las reglas con su mensaje de siempre).
  const pendiente = pendientes.find((p) => p.id === objetivoId && p.animalId === animal.id);
  const esAnulacionPendiente = pendiente?.tipo === 'ANULACION';
  const esUltimoPendiente = pendiente !== undefined && pendiente.tipo !== 'LITROS' && pendiente.tipo !== 'BAJA' && vista.ultimoNoAnulado?.id === pendiente.id;

  if (pendiente && (esAnulacionPendiente || esUltimoPendiente)) {
    const posteriores = posterioresDe(pendiente, pendientes);
    const descartar = args.descartar ?? (async (id: string): Promise<ResultadoDescarte> => {
      await almacen.borrarPendiente(id);
      return 'descartado';
    });
    const resultado = await descartar(pendiente.id);
    if (resultado === 'descartado') return { tipo: 'descartado', id: pendiente.id, posteriores };
    if (esAnulacionPendiente) {
      // La anulación ya se envió (o ya no está): no hay otra anulación que crear sobre ella.
      return resultado === 'no-existe' ? rechazo(404, 'Evento no encontrado') : rechazo(409, 'La anulación ya se envió al servidor y no se puede descartar');
    }
    if (resultado === 'requiere-confirmacion') return rechazo(409, 'No se pudo descartar el pendiente sin confirmación');
    // 'ya-guardado' (el servidor lo aceptó mientras tanto): sigue como una anulación común del evento.
  }

  const evento = vista.eventos.find((e) => e.id === objetivoId);
  return {
    tipo: 'registro',
    resultado: await registrar({
      almacen,
      persona,
      rol: args.rol,
      tipo: 'ANULACION',
      animal,
      // Si el id no es de un evento de la vista, `tipoEvento` queda indefinido y registrar lo informa como "no encontrado".
      datos: { eventoId: objetivoId, tipoEvento: evento?.tipo, motivo },
      enLinea: args.enLinea,
      enviar: args.enviar,
      ahora: args.ahora,
      generarId: args.generarId,
      tiempoMs: args.tiempoMs,
      maxPendientes: args.maxPendientes,
    }),
  };
}
