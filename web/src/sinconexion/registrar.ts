// Punto único de registro de una carga o una anulación (spec 010, RF-15, RF-20, RF-22; spec 009, RF-18 y RF-24
// para los litros). Lógica pura: el envío, el reloj, el almacén y el generador de ids se inyectan.
//
//   Con señal y SIN eventos no aceptados delante de la vaca: se manda enseguida con su `id`, sin control local
//     previo (manda el servidor). Si lo acepta, se guarda como "enviado". Si lo rechaza (400, 403, 404, 409), se
//     devuelve el motivo y NO se guarda nada. Si no confirma en 10 s, falla la red, hay un 5xx o un 401, se sigue
//     como pendiente con el MISMO `id` (reenviarlo no duplica).
//   Sin señal, con eventos de la vaca delante o sin confirmación: se controla con las reglas locales sobre la
//     vista local (si es inválido se devuelve y no se guarda) y se guarda como pendiente DETRÁS de los existentes,
//     aunque haya señal, para no saltearse la cola. Con límite de pendientes y sin confirmar nunca algo que no
//     se guardó.
//
// Los litros siguen la misma decisión pero (a) esperan a los eventos no aceptados de su vaca y (b) los litros
// pendientes no desvían a los eventos. Sus validaciones propias (formato y duplicado) las hace quien llama
// (cargarLitros.ts) antes de entrar acá.

import type { Aviso, RegistroProduccion, Rol } from '../compartido/api';
import type { Almacen, AvisoGuardado, Pendiente, TipoPendiente } from './almacen';
import { clasificarRespuesta, enviarConLimite, type Respuesta } from './clasificar';
import { enviadosDe, guardarPendienteNuevo, pendientesDe, type Persona } from './cola';
import { fechaYTurnoArgentina, horaParaApi } from './horaArgentina';
import { ESPERA_CARGA_MS } from './limites';
import { mensajeSinPermiso, puedeRegistrar } from './permisos';
import { validarCarga } from './reglasLocales';
import { construirVista, entradasValidas, numerosEnUso } from './vistaLocal';

export type ResultadoRegistro =
  // El servidor lo aceptó en el momento. `registro` solo viene en los litros.
  | { tipo: 'enviado'; avisos: Aviso[]; aceptadoEn: number; registro: RegistroProduccion | null }
  // Quedó guardado en la tablet, pendiente de sincronizar.
  | { tipo: 'pendiente'; pendiente: Pendiente }
  // Rechazado (por el servidor o por las reglas locales): no se guardó nada. `campos` trae el mensaje de cada campo.
  | { tipo: 'rechazado'; origen: 'servidor' | 'local'; codigo: number; mensaje: string; campos: Record<string, string> }
  | { tipo: 'sinLugar'; mensaje: string };

export type ArgsRegistro = {
  almacen: Almacen;
  persona: Persona;
  rol: Rol; // el del usuario de la sesión: la tablet no guarda lo que su rol no puede cargar (RF-22)
  tipo: TipoPendiente;
  animal: { id: string; numero: string };
  // Lo que se mandaría a la API (por tipo; ver el plan). Sin `id` ni la hora de la tablet.
  datos: Record<string, unknown>;
  enLinea: boolean;
  enviar: (p: Pendiente, senal: AbortSignal) => Promise<Respuesta> | Respuesta;
  ahora: Date;
  generarId: () => string;
  tiempoMs?: number;
  maxPendientes?: number;
};

const ANULABLES = ['SERVICIO', 'TACTO', 'PARTO', 'SECADO'];

const rechazoLocal = (codigo: number, mensaje: string, campo?: string): ResultadoRegistro => ({
  tipo: 'rechazado',
  origen: 'local',
  codigo,
  mensaje,
  campos: campo ? { [campo]: mensaje } : {},
});

// Controla una carga de EVENTO contra la vista local de la vaca (copia + pendientes). Devuelve el rechazo o null.
async function controlarConVista(args: ArgsRegistro): Promise<ResultadoRegistro | null> {
  const { almacen, persona, rol, tipo, animal, datos, ahora } = args;
  const animales = await almacen.leerAnimales();
  const copia = animales.find((a) => a.ficha.id === animal.id);
  // Sin conexión la vaca sale de la copia: si no está (o la copia no existe), no hay con qué validar ni a quién cargarle.
  if (!copia) return rechazoLocal(404, 'Animal no encontrado');

  const hoy = fechaYTurnoArgentina(ahora).fecha;
  const meta = await almacen.leerMeta();
  const entradas = entradasValidas(await pendientesDe(almacen, persona), await enviadosDe(almacen, persona));
  const vista = construirVista(copia, entradas, hoy);
  const resultado = validarCarga({ tipo: tipo as Exclude<TipoPendiente, 'LITROS'>, datos }, vista, {
    hoy,
    rol,
    semen: meta?.semen,
    numeros: numerosEnUso(animales, entradas),
  });
  if (resultado.ok) return null;
  return rechazoLocal(resultado.codigo, resultado.mensaje, resultado.campo);
}

export async function registrar(args: ArgsRegistro): Promise<ResultadoRegistro> {
  const { almacen, persona, rol, tipo, animal, datos, enLinea, enviar, ahora, generarId, maxPendientes } = args;

  // 1. Permiso por rol (RF-22). Una anulación depende del tipo del evento que anula; si ese tipo no existe, no tiene ruta.
  if (tipo === 'ANULACION') {
    if (!ANULABLES.includes(String(datos.tipoEvento))) return rechazoLocal(404, 'Evento no encontrado');
    if (!puedeRegistrar(rol, tipo, String(datos.tipoEvento))) return rechazoLocal(403, mensajeSinPermiso(tipo));
  } else if (!puedeRegistrar(rol, tipo)) {
    return rechazoLocal(403, mensajeSinPermiso(tipo));
  }

  // 2. ¿Hay eventos de esta vaca sin aceptar delante? (esperando, enviando o rechazados: si siguen en la cola, el
  // servidor todavía no los aceptó). Los litros pendientes no cuentan: no frenan ni desvían a nadie.
  const delante = (await pendientesDe(almacen, persona)).some((p) => p.animalId === animal.id && p.tipo !== 'LITROS');

  // El id nace acá, en el dispositivo, y es el mismo en el envío directo y en el pendiente si se cae a ese camino.
  const id = generarId();
  const cargadoEnDispositivo = horaParaApi(ahora);

  // 3. Con señal y sin nada delante: se manda enseguida, sin guardarlo todavía.
  if (enLinea && !delante) {
    const p: Pendiente = {
      id,
      usuarioId: persona.usuarioId,
      establecimientoId: persona.establecimientoId,
      animalId: animal.id,
      numero: animal.numero,
      tipo,
      datos,
      cargadoEnDispositivo,
      orden: 0,
      estado: 'enviando',
      motivo: null,
      codigoRechazo: null,
      intentos: 0,
      proximoIntento: null,
    };
    const c = clasificarRespuesta(await enviarConLimite(enviar, p, args.tiempoMs ?? ESPERA_CARGA_MS), p);
    if (c.tipo === 'aceptado') {
      // Queda como "enviado" hasta que la copia lo refleje, y con sus avisos, por si se corta la señal justo después.
      const avisos: AvisoGuardado | null = c.avisos.length > 0 ? { id, usuarioId: persona.usuarioId, establecimientoId: persona.establecimientoId, animalId: animal.id, numero: animal.numero, tipo, avisos: c.avisos } : null;
      await almacen
        .aceptarPendiente(
          id,
          { id, usuarioId: persona.usuarioId, establecimientoId: persona.establecimientoId, animalId: animal.id, numero: animal.numero, tipo, datos, aceptadoEn: c.aceptadoEn, registro: c.registro },
          avisos,
        )
        .catch(() => undefined);
      return { tipo: 'enviado', avisos: c.avisos, aceptadoEn: c.aceptadoEn, registro: c.registro };
    }
    if (c.tipo === 'rechazado') return { tipo: 'rechazado', origen: 'servidor', codigo: c.estado, mensaje: c.motivo, campos: c.campos };
    // 'esperar' (red, tiempo agotado, 5xx, HTML...) o 'sesion' (401): no se pierde lo cargado, sigue como pendiente.
  }

  // 4. Sin señal, con pendientes delante o sin confirmación: reglas locales sobre la vista y a la cola (detrás de todo).
  if (tipo !== 'LITROS') {
    const rechazo = await controlarConVista(args);
    if (rechazo) return rechazo;
  }
  const guardado = await guardarPendienteNuevo({ almacen, persona, tipo, animalId: animal.id, numero: animal.numero, datos, id, ahora, maxPendientes });
  return guardado.ok ? { tipo: 'pendiente', pendiente: guardado.pendiente } : { tipo: 'sinLugar', mensaje: guardado.mensaje };
}
