// Cola de pendientes de sincronizar: litros (spec 009, RF-18 a RF-23, RF-34, RF-36, RF-42) y, desde la spec 010,
// cualquier tipo de carga (RF-12, RF-14, RF-30). Lógica pura: no usa React ni el navegador. Recibe el almacén,
// así se prueba con Vitest.

import type { RegistroProduccion, TurnoOrdeno } from '../compartido/api';
import { validarLitros } from '../produccion/produccionDatos';
import { datosLitros, ErrorSinEspacio, type Almacen, type AvisoGuardado, type Enviado, type Pendiente, type TipoPendiente } from './almacen';
import { fechaYTurnoArgentina, horaParaApi } from './horaArgentina';
import { MAX_PENDIENTES } from './limites';

// Comienzo del mensaje de "ya hay una carga". El mismo texto lo devuelve la API (409 en api/src/produccion/cargar.ts):
// la validación local lo imita y la pantalla "Pendientes" lo usa para reconocer el rechazo por duplicado.
export const INICIO_MENSAJE_DUPLICADO = 'Ya hay una carga';

// Usuario y tambo de la sesión. Un pendiente solo lo ve, lo cuenta y lo envía su dueño (RF-17, RF-46).
export type Persona = { usuarioId: string; establecimientoId: string };

export function delPropietario<T extends Persona>(lista: T[], persona: Persona): T[] {
  return lista.filter((x) => x.usuarioId === persona.usuarioId && x.establecimientoId === persona.establecimientoId);
}

// Pendientes de la persona, en el orden en que se cargaron.
export async function pendientesDe(almacen: Almacen, persona: Persona): Promise<Pendiente[]> {
  return delPropietario(await almacen.listarPendientes(), persona).sort((a, b) => a.orden - b.orden);
}

export async function enviadosDe(almacen: Almacen, persona: Persona): Promise<Enviado[]> {
  return delPropietario(await almacen.listarEnviados(), persona);
}

// Avisos del servidor que el usuario todavía no cerró (spec 010, RF-28).
export async function avisosDe(almacen: Almacen, persona: Persona): Promise<AvisoGuardado[]> {
  return delPropietario(await almacen.listarAvisos(), persona);
}

// Cantidades para el menú y las confirmaciones (RF-42, RF-30): todos los pendientes NO aceptados, de cualquier
// tipo (esperando, enviando o rechazados), y cuántos están rechazados. Los enviados (ya aceptados) no cuentan.
export function contarPendientes(pendientes: Pendiente[]): { total: number; rechazados: number } {
  return { total: pendientes.length, rechazados: pendientes.filter((p) => p.estado === 'rechazado').length };
}

// ─── Validación y duplicados (RF-19, RF-20) ───

export type DatosCarga = { animalId: string; numero: string; fecha: string; turno: string; litros: string };

// Lo que puede salir mal al cargar: datos inválidos o duplicado (con el mensaje y el campo si lo hay),
// o que no haya lugar para guardar.
export type ErrorDeCarga =
  | { ok: false; tipo: 'invalido'; errores: Record<string, string>; general: string | null }
  | { ok: false; tipo: 'sinLugar'; mensaje: string };

const MENSAJE_FECHA = 'La fecha no es válida: usá el formato AAAA-MM-DD con un día que exista';

// AAAA-MM-DD con un día que existe (el 31 de febrero no).
function esFechaValida(texto: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  return f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia;
}

const FECHA_MINIMA = '2000-01-01';
const NOMBRE_TURNO = { manana: 'mañana', tarde: 'tarde' } as const;
const aFechaCorta = (f: string) => f.split('-').reverse().join('/');

// Mismas validaciones y mensajes que la API (spec 008). `hoy` es la fecha de Argentina según la tablet.
export function validarCarga(datos: Pick<DatosCarga, 'fecha' | 'turno' | 'litros'>, hoy: string): { ok: true; litros: string } | { ok: false; errores: Record<string, string> } {
  const errores: Record<string, string> = {};
  if (!esFechaValida(datos.fecha)) errores.fecha = MENSAJE_FECHA;
  else if (datos.fecha > hoy) errores.fecha = 'La fecha no puede ser futura';
  else if (datos.fecha < FECHA_MINIMA) errores.fecha = 'La fecha no puede ser anterior al 01/01/2000';
  if (datos.turno !== 'manana' && datos.turno !== 'tarde') errores.turno = 'El turno tiene que ser mañana o tarde';
  const litros = validarLitros(datos.litros);
  if (!litros.ok) errores.litros = litros.mensaje;
  if (Object.keys(errores).length > 0 || !litros.ok) return { ok: false, errores };
  return { ok: true, litros: litros.litros };
}

// Validaciones + duplicado local (RF-20). `registrosCopia` son los de la ficha de la vaca en la copia, o null
// si no hay que mirarlos (con señal manda el servidor: la copia puede estar vieja y bloquear de más).
// Los pendientes y los enviados recientes SÍ se miran siempre: el servidor todavía no los refleja.
export async function controlarCarga(args: {
  almacen: Almacen;
  persona: Persona;
  datos: DatosCarga;
  registrosCopia: RegistroProduccion[] | null;
  ahora: Date;
}): Promise<{ ok: true; litros: string } | Extract<ErrorDeCarga, { tipo: 'invalido' }>> {
  const { almacen, persona, datos, registrosCopia, ahora } = args;
  const v = validarCarga(datos, fechaYTurnoArgentina(ahora).fecha);
  if (!v.ok) return { ok: false, tipo: 'invalido', errores: v.errores, general: null };

  const turno = datos.turno as TurnoOrdeno;
  const misma = (x: { animalId: string; fecha: string; turno: string }) => x.animalId === datos.animalId && x.fecha === datos.fecha && x.turno === turno;
  const cual = `del ordeño de ${NOMBRE_TURNO[turno]} del ${aFechaCorta(datos.fecha)}`;

  // Solo los litros pendientes cuentan como duplicado (los demás tipos no tienen fecha ni turno de ordeñe).
  const mismaCarga = (p: Pendiente) => p.tipo === 'LITROS' && misma({ animalId: p.animalId, ...datosLitros(p) });
  if ((await pendientesDe(almacen, persona)).some(mismaCarga)) {
    return {
      ok: false,
      tipo: 'invalido',
      errores: {},
      general: `Ya hay un litro pendiente de esta vaca ${cual}. Para cargarlo de nuevo, descartá ese pendiente desde "Pendientes de sincronizar"`,
    };
  }
  const yaCargado =
    (await enviadosDe(almacen, persona)).some((e) => e.tipo === 'LITROS' && e.registro !== null && e.registro.anulado === null && misma(e.registro)) ||
    (registrosCopia ?? []).some((r) => r.anulado === null && misma(r));
  if (yaCargado) {
    return {
      ok: false,
      tipo: 'invalido',
      errores: {},
      general: `${INICIO_MENSAJE_DUPLICADO} de esta vaca ${cual}. Para corregirla, anulala primero con conexión y cargá la correcta`,
    };
  }
  return { ok: true, litros: v.litros };
}

// ─── Guardar un pendiente (RF-18, RF-22; spec 010 RF-12, RF-14) ───

const MENSAJE_SIN_LUGAR = (motivo: string) => `No se pudo guardar en la tablet: ${motivo}. Conectate para sincronizar los pendientes`;

// Guarda un pendiente de CUALQUIER tipo con el orden de carga siguiente y la hora de la tablet. `datos` es lo que
// se va a mandar al servidor (ya validado por quien llama). Si ya hay `maxPendientes` (de todos los tipos juntos)
// o el navegador no tiene espacio, NO se confirma como guardado.
export async function guardarPendienteNuevo(args: {
  almacen: Almacen;
  persona: Persona;
  tipo: TipoPendiente;
  animalId: string;
  numero: string;
  datos: Record<string, unknown>;
  id: string;
  ahora: Date;
  maxPendientes?: number;
}): Promise<{ ok: true; pendiente: Pendiente } | Extract<ErrorDeCarga, { tipo: 'sinLugar' }>> {
  const { almacen, persona, tipo, animalId, numero, datos, id, ahora, maxPendientes = MAX_PENDIENTES } = args;
  const propios = await pendientesDe(almacen, persona);
  if (propios.length >= maxPendientes) {
    return { ok: false, tipo: 'sinLugar', mensaje: MENSAJE_SIN_LUGAR(`ya hay ${maxPendientes} pendientes`) };
  }

  // El orden de carga crece siempre, aunque se cargue dos veces en el mismo milisegundo.
  const mayor = propios.reduce((m, p) => Math.max(m, p.orden), 0);
  const pendiente: Pendiente = {
    id,
    usuarioId: persona.usuarioId,
    establecimientoId: persona.establecimientoId,
    animalId,
    numero,
    tipo,
    datos,
    cargadoEnDispositivo: horaParaApi(ahora),
    orden: Math.max(ahora.getTime(), mayor + 1),
    estado: 'esperando',
    motivo: null,
    codigoRechazo: null,
    intentos: 0,
    proximoIntento: null,
  };
  try {
    await almacen.guardarPendiente(pendiente);
  } catch (e) {
    const motivo = e instanceof ErrorSinEspacio ? 'no hay espacio en la tablet' : 'falló el almacenamiento del navegador';
    return { ok: false, tipo: 'sinLugar', mensaje: MENSAJE_SIN_LUGAR(motivo) };
  }
  return { ok: true, pendiente };
}

// Guarda un pendiente de litros. `datos` ya pasó por `controlarCarga` (`litros` con punto).
export function guardarNuevoPendiente(args: {
  almacen: Almacen;
  persona: Persona;
  datos: DatosCarga;
  id: string;
  ahora: Date;
  maxPendientes?: number;
}): Promise<{ ok: true; pendiente: Pendiente } | Extract<ErrorDeCarga, { tipo: 'sinLugar' }>> {
  const { datos, ...resto } = args;
  return guardarPendienteNuevo({
    ...resto,
    tipo: 'LITROS',
    animalId: datos.animalId,
    numero: datos.numero,
    datos: { fecha: datos.fecha, turno: datos.turno, litros: datos.litros },
  });
}

// Controla y guarda en un solo paso (carga sin conexión directa).
export async function crearPendiente(args: {
  almacen: Almacen;
  persona: Persona;
  datos: DatosCarga;
  registrosCopia: RegistroProduccion[] | null;
  ahora: Date;
  generarId: () => string;
  id?: string;
  maxPendientes?: number;
}): Promise<{ ok: true; pendiente: Pendiente } | ErrorDeCarga> {
  const control = await controlarCarga(args);
  if (!control.ok) return control;
  return guardarNuevoPendiente({
    almacen: args.almacen,
    persona: args.persona,
    datos: { ...args.datos, litros: control.litros },
    id: args.id ?? args.generarId(),
    ahora: args.ahora,
    maxPendientes: args.maxPendientes,
  });
}

// Al abrir la app (de cualquier tipo): un pendiente que quedó "enviando" (se cerró la app a mitad del envío) vuelve a esperar.
// Reenviarlo es seguro: lleva el mismo id y el servidor no duplica.
export async function restablecerEnviando(almacen: Almacen, persona: Persona): Promise<void> {
  for (const p of delPropietario(await almacen.listarPendientes(), persona)) {
    if (p.estado === 'enviando') await almacen.guardarPendiente({ ...p, estado: 'esperando' });
  }
}

// ─── Lo que se ve en la ficha (RF-23, RF-34, RF-36) ───

// Marca de una fila: pendiente (esperando o enviando), rechazado, enviado (aceptado pero que la copia todavía no trae) o null.
export type Marca = 'pendiente' | 'rechazado' | 'enviado' | null;

// "Más reciente" por fecha y luego turno (la tarde viene después de la mañana). Nunca por orden de carga.
const clave = (x: { fecha: string; turno: TurnoOrdeno }) => `${x.fecha}|${x.turno === 'tarde' ? 1 : 0}`;

export type UltimoRegistro = { fecha: string; turno: TurnoOrdeno; litros: number; marca: Marca };

// Último registro de la vaca para el formulario: el más reciente entre el de la copia (o el servidor) y los
// pendientes esperando o enviando y los enviados recientes. Los rechazados no cuentan.
export function ultimoRegistro(args: {
  animalId: string;
  ultimoServidor: { fecha: string; turno: TurnoOrdeno; litros: number } | null;
  pendientes: Pendiente[];
  enviados: Enviado[];
}): UltimoRegistro | null {
  const candidatos: UltimoRegistro[] = [];
  if (args.ultimoServidor) candidatos.push({ ...args.ultimoServidor, marca: null });
  for (const p of args.pendientes) {
    if (p.tipo !== 'LITROS' || p.animalId !== args.animalId || p.estado === 'rechazado') continue;
    const d = datosLitros(p);
    candidatos.push({ fecha: d.fecha, turno: d.turno, litros: Number(d.litros), marca: 'pendiente' });
  }
  for (const e of args.enviados) {
    if (e.tipo === 'LITROS' && e.registro && e.animalId === args.animalId && e.registro.anulado === null) candidatos.push({ fecha: e.registro.fecha, turno: e.registro.turno, litros: e.registro.litros, marca: 'enviado' });
  }
  if (candidatos.length === 0) return null;
  // El primero que gana queda: ante un empate manda el orden en que se agregaron (servidor, pendientes, enviados).
  return candidatos.reduce((mejor, c) => (clave(c) > clave(mejor) ? c : mejor));
}

export type FilaFicha = {
  id: string;
  fecha: string;
  turno: TurnoOrdeno;
  marca: Marca;
  registro: RegistroProduccion | null; // el del servidor o el enviado; null en un pendiente
  pendiente: Pendiente | null;
};

// Lista de producción de la ficha: los registros del servidor (o de la copia) más los pendientes (marcados)
// y los enviados que esa lista todavía no trae, del más reciente al más antiguo.
export function registrosParaFicha(args: { animalId: string; registros: RegistroProduccion[]; pendientes: Pendiente[]; enviados: Enviado[] }): FilaFicha[] {
  const delServidor: FilaFicha[] = args.registros.map((r) => ({ id: r.id, fecha: r.fecha, turno: r.turno, marca: null, registro: r, pendiente: null }));
  const ids = new Set(args.registros.map((r) => r.id));
  const extras: FilaFicha[] = [];
  for (const p of args.pendientes) {
    if (p.tipo !== 'LITROS' || p.animalId !== args.animalId) continue; // los demás tipos son de la 011
    const d = datosLitros(p);
    extras.push({ id: p.id, fecha: d.fecha, turno: d.turno, marca: p.estado === 'rechazado' ? 'rechazado' : 'pendiente', registro: null, pendiente: p });
  }
  for (const e of args.enviados) {
    if (e.tipo !== 'LITROS' || !e.registro || e.animalId !== args.animalId || ids.has(e.id)) continue;
    extras.push({ id: e.id, fecha: e.registro.fecha, turno: e.registro.turno, marca: 'enviado', registro: e.registro, pendiente: null });
  }
  // sort es estable: a igual fecha y turno quedan primero los extras, después los del servidor.
  return [...extras, ...delServidor].sort((a, b) => (clave(a) < clave(b) ? 1 : clave(a) > clave(b) ? -1 : 0));
}

// Margen para dar por incluido un enviado en una copia nueva aunque no figure en la lista (por ejemplo, si
// alguien lo anuló o quedó fuera del tope de 200 registros por ficha): evita que quede "enviado" para siempre.
const MARGEN_ENVIADO_MS = 10 * 60 * 1000;

// Tras actualizar la copia: se quitan los enviados de litros que la copia ya incluye (RF-34). Los enviados de los
// demás tipos los limpia reflejo.ts (T3 de la spec 010); acá no se tocan.
export async function limpiarEnviadosIncluidos(almacen: Almacen, persona: Persona): Promise<void> {
  const meta = await almacen.leerMeta();
  if (!meta) return;
  const enviados = (await enviadosDe(almacen, persona)).filter((e) => e.tipo === 'LITROS' && e.registro !== null);
  if (enviados.length === 0) return;
  const animales = await almacen.leerAnimales();
  const generada = Date.parse(meta.generadaEn);
  const incluidos = enviados.filter((e) => {
    const animal = animales.find((a) => a.ficha.id === e.animalId);
    if (!animal) return true; // ya no está en la copia (por ejemplo, se vendió): nada que mostrar
    if (animal.produccion.registros.some((r) => r.id === e.id)) return true;
    return generada - Date.parse(e.registro!.registradoEn) > MARGEN_ENVIADO_MS;
  });
  if (incluidos.length > 0) await almacen.borrarEnviados(incluidos.map((e) => e.id));
}
