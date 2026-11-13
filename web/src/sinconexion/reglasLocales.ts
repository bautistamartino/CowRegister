// Reglas locales de las cargas y anulaciones de eventos (spec 010, RF-20 a RF-23). Lógica pura.
//
// Son las MISMAS validaciones y los MISMOS mensajes que la API (api/src/rutas/reproduccion.ts, partos.ts,
// bajas.ts, api/src/reproduccion/anular.ts, aptitud.ts, fechas.ts y bajas/validacion.ts), evaluadas sobre la
// vista local de la vaca (vistaLocal.ts). La web no importa código de la API: la paridad la garantiza la tabla de
// casos compartida (compartido/casos-reglas-eventos.json), que corren los tests de la API contra las rutas reales
// y los de la web contra este archivo.
//
// El orden de los controles es el de la API: permiso por rol (403) -> forma del pedido (400, el equivalente a
// zod) -> la vaca ya no está (404) -> fechas (400) -> conflictos con el estado (409), informando el PRIMERO.
//
// Lo que solo puede decidir el servidor NO se porta: un número de cría ocupado después de la última copia, un
// semen desactivado después, anular un parto cuyas crías ya tienen eventos, la baja de la vaca desde otro
// dispositivo, el lote destino y los datos de otros tambos.

import type { Rol, SemenCopia } from '../compartido/api';
import type { TipoPendiente } from './almacen';
import { mensajeSinPermiso, puedeRegistrar } from './permisos';
import { aFechaCorta, DIAS_GESTACION, esFechaValida, FECHA_MINIMA, resolverFechaProbable, sumarDias, validarSeparacionPartos } from './situacionLocal';
import { normalizarNumero } from './numeros';
import type { EventoVista, VistaAnimal } from './vistaLocal';

export type ResultadoRegla = { ok: true } | { ok: false; codigo: number; mensaje: string; campo?: string };

// Lo que se quiere cargar: el tipo y los datos que se mandarían a la API (sin `id` ni la hora de la tablet).
export type Carga = { tipo: Exclude<TipoPendiente, 'LITROS'>; datos: Record<string, unknown> };

export type ContextoReglas = {
  hoy: string; // el "hoy" de Argentina según la tablet
  rol: Rol; // el rol del usuario de la sesión local (RF-22)
  // Semen y toros ACTIVOS de la copia. Si falta (una copia anterior a la 010), la regla de "semen activo" no se
  // aplica y decide el servidor.
  semen?: SemenCopia[] | undefined;
  // Números que no se pueden usar para una cría (ver `numerosEnUso` en vistaLocal.ts).
  numeros: ReadonlySet<string>;
};

const OK: ResultadoRegla = { ok: true };
const rechazo = (codigo: number, mensaje: string, campo?: string): ResultadoRegla => ({ ok: false, codigo, mensaje, ...(campo !== undefined && { campo }) });

const NO_ENCONTRADO_ANIMAL = 'Animal no encontrado';
const NO_ENCONTRADO_EVENTO = 'Evento no encontrado';
const MENSAJE_FORMATO_FECHA = 'La fecha no es válida: usá el formato AAAA-MM-DD con un día que exista';
const MENSAJE_NUMERO_EXISTENTE = 'Ya existe un animal activo con ese número';

// Largo en "letras" (code points), igual que en la API.
const largo = (texto: string) => [...texto].length;

type Datos = Record<string, unknown>;

// ─── Forma del pedido (lo que en la API hace zod) ───
// Cada función devuelve el primer problema (en el orden de los campos) o null.

// Fecha del evento: obligatoria, AAAA-MM-DD y existente.
function errorFormatoFecha(datos: Datos): ResultadoRegla | null {
  if (typeof datos.fecha !== 'string') return rechazo(400, 'La fecha es obligatoria', 'fecha');
  if (!esFechaValida(datos.fecha)) return rechazo(400, MENSAJE_FORMATO_FECHA, 'fecha');
  return null;
}

// Texto opcional de hasta 200 caracteres sin contar los extremos (anomalías, observaciones).
function errorTextoOpcional(valor: unknown, campo: string, mensajeTipo: string, mensajeLargo: string): ResultadoRegla | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') return rechazo(400, mensajeTipo, campo);
  if (largo(valor.normalize('NFC').trim()) > 200) return rechazo(400, mensajeLargo, campo);
  return null;
}

// Un campo opcional vacío ("") cuenta como "no vino".
const vacioANulo = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

// Fecha del evento contra el estado de la vaca (validarFechaEvento de la API). Devuelve el mensaje o null si está bien.
function errorFechaEvento(fecha: string, hoy: string, nacimiento: string | null, ultimoEvento: string | null): string | null {
  if (fecha > hoy) return 'La fecha no puede ser futura';
  if (fecha < FECHA_MINIMA) return 'La fecha no puede ser anterior al 01/01/2000';
  if (nacimiento && fecha < nacimiento) return 'La fecha no puede ser anterior al nacimiento del animal';
  if (ultimoEvento && fecha < ultimoEvento) {
    return `La fecha no puede ser anterior a la del último evento (${aFechaCorta(ultimoEvento)}). Si falta cargar un evento anterior, primero anulá los posteriores`;
  }
  return null;
}

// Fecha de la baja (validarFechaBaja de la API). Compara con el último evento que no sea una baja.
function errorFechaBaja(fecha: string, hoy: string, nacimiento: string | null, ultimoEvento: string | null): string | null {
  if (fecha > hoy) return `La fecha de la baja no puede ser futura (hoy es ${aFechaCorta(hoy)})`;
  if (fecha < FECHA_MINIMA) return 'La fecha de la baja no puede ser anterior al 01/01/2000';
  if (nacimiento && fecha < nacimiento) return `La fecha de la baja no puede ser anterior al nacimiento del animal (${aFechaCorta(nacimiento)})`;
  if (ultimoEvento && fecha < ultimoEvento) return `La fecha de la baja no puede ser anterior a la del último evento del animal (${aFechaCorta(ultimoEvento)})`;
  return null;
}

// ─── Aptitud (api/src/reproduccion/aptitud.ts) ───

const NOMBRE_ESTADO: Record<string, string> = { RECIEN_NACIDO: 'recién nacido', VAQUILLONA: 'vaquillona', EN_ORDENE: 'en ordeñe', SECA: 'seca', BAJA: 'baja' };

function aptitudEventoReproductivo(vista: VistaAnimal): string | null {
  if (vista.sexo === 'MACHO') return 'Un macho no admite servicios ni tactos';
  if (vista.estado === 'RECIEN_NACIDO') return 'Una recién nacida todavía no admite servicios ni tactos';
  if (vista.estado === 'BAJA') return 'Un animal dado de baja no admite servicios ni tactos';
  return null;
}

function aptitudParto(vista: VistaAnimal): string | null {
  if (vista.sexo === 'MACHO') return 'Un macho no admite partos';
  if (vista.estado === 'RECIEN_NACIDO') return 'Una recién nacida todavía no admite partos';
  if (vista.estado === 'BAJA') return 'Un animal dado de baja no admite partos';
  return null;
}

function aptitudSecado(vista: VistaAnimal): string | null {
  if (vista.sexo === 'MACHO') return 'Un macho no admite secados';
  if (vista.estado !== 'EN_ORDENE') return `Solo se puede secar una vaca en ordeñe: esta está en estado «${NOMBRE_ESTADO[vista.estado]}»`;
  return null;
}

// ─── Servicio (api/src/rutas/reproduccion.ts) ───

function validarServicio(datos: Datos, vista: VistaAnimal, ctx: ContextoReglas): ResultadoRegla {
  const formato = errorFormatoFecha(datos);
  if (formato) return formato;
  if (datos.tipo !== 'INSEMINACION' && datos.tipo !== 'MONTA_NATURAL') {
    return rechazo(400, 'El tipo de servicio tiene que ser inseminación o monta natural', 'tipo');
  }
  const fecha = datos.fecha as string;
  const semenId = vacioANulo(datos.semenId);

  if (vista.estado === 'BAJA') return rechazo(404, NO_ENCONTRADO_ANIMAL);

  const errorFecha = errorFechaEvento(fecha, ctx.hoy, vista.nacimiento, vista.ultimoNoAnulado?.fecha ?? null);
  if (errorFecha) return rechazo(400, errorFecha, 'fecha');

  const aptitud = aptitudEventoReproductivo(vista);
  if (aptitud) return rechazo(409, aptitud);
  if (vista.situacion.estado === 'PRENADA') return rechazo(409, 'La vaca tiene una preñez vigente: primero registrá un tacto "vacía"');

  // La copia solo trae el semen ACTIVO: uno que no está ahí se desactivó antes de la copia (si fue después, o si
  // nunca existió, lo decide el servidor).
  if (typeof semenId === 'string' && ctx.semen && !ctx.semen.some((s) => s.id === semenId)) {
    return rechazo(409, 'El semen o toro está desactivado: elegí otro o reactivalo');
  }
  return OK;
}

// ─── Tacto ───

function validarTacto(datos: Datos, vista: VistaAnimal, ctx: ContextoReglas): ResultadoRegla {
  const formato = errorFormatoFecha(datos);
  if (formato) return formato;
  if (datos.resultado !== 'PRENADA' && datos.resultado !== 'VACIA') return rechazo(400, 'El resultado del tacto tiene que ser preñada o vacía', 'resultado');
  const fecha = datos.fecha as string;
  const resultado = datos.resultado;

  const probable = vacioANulo(datos.fechaProbableParto);
  if (probable !== undefined && probable !== null && typeof probable !== 'string') {
    return rechazo(400, 'La fecha probable de parto tiene que ser un texto AAAA-MM-DD', 'fechaProbableParto');
  }
  const errorAnomalias = errorTextoOpcional(datos.anomalias, 'anomalias', 'Las anomalías tienen que ser un texto', 'Las anomalías no pueden superar los 200 caracteres');
  if (errorAnomalias) return errorAnomalias;

  // Reglas que solo dependen del cuerpo (RF-14 de la 003).
  const indicada = (probable as string | null | undefined) || null;
  if (indicada) {
    if (resultado === 'VACIA') return rechazo(400, 'Un tacto "vacía" no lleva fecha probable de parto', 'fechaProbableParto');
    if (!esFechaValida(indicada)) return rechazo(400, 'La fecha probable de parto no es válida: usá el formato AAAA-MM-DD con un día que exista', 'fechaProbableParto');
    if (indicada <= fecha) return rechazo(400, 'La fecha probable de parto tiene que ser posterior a la fecha del tacto', 'fechaProbableParto');
    if (indicada > sumarDias(fecha, DIAS_GESTACION)) {
      return rechazo(400, `La fecha probable de parto no puede superar los ${DIAS_GESTACION} días después del tacto`, 'fechaProbableParto');
    }
  }

  if (vista.estado === 'BAJA') return rechazo(404, NO_ENCONTRADO_ANIMAL);

  const errorFecha = errorFechaEvento(fecha, ctx.hoy, vista.nacimiento, vista.ultimoNoAnulado?.fecha ?? null);
  if (errorFecha) return rechazo(400, errorFecha, 'fecha');

  // Un tacto "preñada" tiene que tener de dónde sacar la fecha probable: la indicada, una del ciclo o servicio + 283.
  if (resultado === 'PRENADA' && resolverFechaProbable(vista.eventos, indicada) === null) {
    return rechazo(400, 'Indicá la fecha probable de parto: no hay un servicio del que calcularla', 'fechaProbableParto');
  }
  const aptitud = aptitudEventoReproductivo(vista);
  if (aptitud) return rechazo(409, aptitud);
  return OK;
}

// ─── Parto (api/src/rutas/partos.ts y criasPartoSchema de api/src/validacion.ts) ───

type CriaNormalizada = { numero: string | undefined; nacidaMuerta: boolean };

// Valida la lista de crías como lo hace zod. Devuelve el problema o las crías con el número ya normalizado.
function validarCrias(crias: unknown): { error: ResultadoRegla } | { crias: CriaNormalizada[] } {
  if (!Array.isArray(crias)) return { error: rechazo(400, 'Las crías tienen que ser una lista', 'crias') };
  if (crias.length < 1) return { error: rechazo(400, 'El parto necesita al menos una cría', 'crias') };
  if (crias.length > 2) return { error: rechazo(400, 'Un parto puede tener como máximo dos crías', 'crias') };

  const normalizadas: CriaNormalizada[] = [];
  for (const [i, cria] of crias.entries()) {
    const campo = (nombre: string) => `crias.${i}.${nombre}`;
    const c = (typeof cria === 'object' && cria !== null ? cria : {}) as Datos;
    if (c.sexo !== 'HEMBRA' && c.sexo !== 'MACHO') return { error: rechazo(400, 'El sexo de la cría tiene que ser hembra o macho', campo('sexo')) };
    if (c.nacidaMuerta !== undefined && typeof c.nacidaMuerta !== 'boolean') {
      return { error: rechazo(400, '«Nació muerta» tiene que ser verdadero o falso', campo('nacidaMuerta')) };
    }
    const nacidaMuerta = c.nacidaMuerta === true;

    // El número: "" o null cuentan como "no vino". Un texto se valida con las reglas de la spec 002.
    let numero: string | undefined;
    const bruto = c.numero === null || (typeof c.numero === 'string' && c.numero.trim() === '') ? undefined : c.numero;
    if (bruto !== undefined) {
      if (typeof bruto !== 'string') return { error: rechazo(400, 'El número del animal es obligatorio', campo('numero')) };
      const limpio = bruto.trim();
      if (limpio.length > 20) return { error: rechazo(400, 'El número del animal no puede superar los 20 caracteres', campo('numero')) };
      numero = normalizarNumero(limpio) ?? undefined;
      if (numero === undefined) return { error: rechazo(400, 'El número solo puede tener letras sin tildes, números, guion y punto (sin espacios)', campo('numero')) };
    }
    const errorObservaciones = errorTextoOpcional(c.observaciones, campo('observaciones'), 'Las observaciones tienen que ser un texto', 'Las observaciones no pueden superar los 200 caracteres');
    if (errorObservaciones) return { error: errorObservaciones };

    if (nacidaMuerta && numero !== undefined) return { error: rechazo(400, 'Una cría nacida muerta no lleva número', campo('numero')) };
    if (!nacidaMuerta && numero === undefined) return { error: rechazo(400, 'El número de la cría viva es obligatorio', campo('numero')) };
    normalizadas.push({ numero, nacidaMuerta });
  }

  // Dos crías vivas del mismo parto no pueden repetir número.
  const vistos = new Set<string>();
  for (const [i, c] of normalizadas.entries()) {
    if (c.nacidaMuerta || c.numero === undefined) continue;
    if (vistos.has(c.numero)) return { error: rechazo(400, 'Las dos crías no pueden tener el mismo número', `crias.${i}.numero`) };
    vistos.add(c.numero);
  }
  return { crias: normalizadas };
}

function validarParto(datos: Datos, vista: VistaAnimal, ctx: ContextoReglas): ResultadoRegla {
  const formato = errorFormatoFecha(datos);
  if (formato) return formato;
  const validadas = validarCrias(datos.crias);
  if ('error' in validadas) return validadas.error;
  const fecha = datos.fecha as string;

  if (vista.estado === 'BAJA') return rechazo(404, NO_ENCONTRADO_ANIMAL);

  // Fechas (400): las comunes y, además, estrictamente posterior al nacimiento de la madre.
  const errorFecha = errorFechaEvento(fecha, ctx.hoy, vista.nacimiento, vista.ultimoNoAnulado?.fecha ?? null);
  if (errorFecha) return rechazo(400, errorFecha, 'fecha');
  if (vista.nacimiento && fecha <= vista.nacimiento) return rechazo(400, 'La fecha del parto tiene que ser posterior al nacimiento de la madre', 'fecha');

  // Conflictos (409), en este orden: madre no apta, separación de 200 días y número de cría ocupado.
  const aptitud = aptitudParto(vista);
  if (aptitud) return rechazo(409, aptitud);
  const separacion = validarSeparacionPartos(vista.eventos, fecha);
  if (separacion) return rechazo(409, separacion);
  // Se informa la primera cría (en el orden en que vinieron) con el número ocupado.
  const ocupada = validadas.crias.findIndex((c) => !c.nacidaMuerta && c.numero !== undefined && ctx.numeros.has(c.numero));
  if (ocupada >= 0) return rechazo(409, MENSAJE_NUMERO_EXISTENTE, `crias.${ocupada}.numero`);
  return OK;
}

// ─── Secado ───

function validarSecado(datos: Datos, vista: VistaAnimal, ctx: ContextoReglas): ResultadoRegla {
  const formato = errorFormatoFecha(datos);
  if (formato) return formato;
  if (vista.estado === 'BAJA') return rechazo(404, NO_ENCONTRADO_ANIMAL);
  const errorFecha = errorFechaEvento(datos.fecha as string, ctx.hoy, vista.nacimiento, vista.ultimoNoAnulado?.fecha ?? null);
  if (errorFecha) return rechazo(400, errorFecha, 'fecha');
  const aptitud = aptitudSecado(vista);
  if (aptitud) return rechazo(409, aptitud);
  return OK;
}

// ─── Baja (api/src/bajas/baja.ts y validacion.ts) ───

function validarBaja(datos: Datos, vista: VistaAnimal, ctx: ContextoReglas): ResultadoRegla {
  if (datos.motivo !== 'venta' && datos.motivo !== 'muerte') return rechazo(400, 'El motivo tiene que ser venta o muerte', 'motivo');
  const formato = errorFormatoFecha(datos);
  if (formato) return formato;
  const errorObservaciones = errorTextoOpcional(datos.observaciones, 'observaciones', 'Las observaciones tienen que ser un texto', 'Las observaciones no pueden superar los 200 caracteres');
  if (errorObservaciones) return errorObservaciones;

  if (vista.estado === 'BAJA') return rechazo(404, NO_ENCONTRADO_ANIMAL);
  // El último evento que cuenta para la fecha no incluye a las bajas.
  const errorFecha = errorFechaBaja(datos.fecha as string, ctx.hoy, vista.nacimiento, vista.ultimaFechaNoAnulada);
  if (errorFecha) return rechazo(400, errorFecha, 'fecha');
  return OK;
}

// ─── Anulación (api/src/reproduccion/anular.ts) ───

const NOMBRE_TIPO = { SERVICIO: 'servicio', TACTO: 'tacto', PARTO: 'parto', SECADO: 'secado', BAJA: 'baja' } as const;
const ESTADO_QUE_DEJA = { PARTO: 'EN_ORDENE', SECADO: 'SECA' } as const;

// "tacto del 05/11/2026": nombra un evento en los mensajes.
const textoEvento = (tipo: EventoVista['tipo'], fecha: string) => `${NOMBRE_TIPO[tipo]} del ${aFechaCorta(fecha)}`;

function validarAnulacion(datos: Datos, vista: VistaAnimal, rol: Rol): ResultadoRegla {
  const tipoEvento = datos.tipoEvento;
  if (tipoEvento !== 'SERVICIO' && tipoEvento !== 'TACTO' && tipoEvento !== 'PARTO' && tipoEvento !== 'SECADO') return rechazo(404, NO_ENCONTRADO_EVENTO);

  // Motivo: obligatorio, hasta 200 caracteres sin contar los extremos.
  const motivo = typeof datos.motivo === 'string' ? largo(datos.motivo.normalize('NFC').trim()) : 0;
  if (motivo < 1) return rechazo(400, 'El motivo de la anulación es obligatorio', 'motivo');
  if (motivo > 200) return rechazo(400, 'El motivo no puede superar los 200 caracteres', 'motivo');

  // El evento tiene que ser de la vaca y del tipo que se anula.
  const evento = vista.eventos.find((e) => e.id === datos.eventoId && e.tipo === tipoEvento);
  if (!evento) return rechazo(404, NO_ENCONTRADO_EVENTO);
  // Ya anulado: la API acepta la repetición del mismo usuario y motivo; la tablet no sabe quién lo anuló, así que
  // lo trata como un choque (anular un evento anulado se resuelve descartando la anulación pendiente).
  if (evento.anulado) return rechazo(409, `Este ${NOMBRE_TIPO[tipoEvento]} ya fue anulado`);
  if (vista.estado === 'BAJA') return rechazo(404, NO_ENCONTRADO_EVENTO);

  // Solo se anula el último evento no anulado.
  const ultimo = vista.ultimoNoAnulado;
  if (ultimo && ultimo.id !== evento.id) {
    // Un veterinario no puede anular partos ni secados: el mensaje se lo dice.
    if (rol === 'VETERINARIO' && (ultimo.tipo === 'PARTO' || ultimo.tipo === 'SECADO')) {
      return rechazo(409, `Primero hay que anular el ${textoEvento(ultimo.tipo, ultimo.fecha)}; lo tiene que hacer un dueño o encargado`);
    }
    return rechazo(409, `Primero tenés que anular el ${textoEvento(ultimo.tipo, ultimo.fecha)}`);
  }
  // La vaca tiene que seguir en el estado que dejó el evento.
  const esperado = tipoEvento === 'PARTO' || tipoEvento === 'SECADO' ? ESTADO_QUE_DEJA[tipoEvento] : undefined;
  if (esperado && vista.estado !== esperado) {
    return rechazo(
      409,
      `No se puede anular el ${textoEvento(tipoEvento, evento.fecha)}: la vaca ya no está en estado «${NOMBRE_ESTADO[esperado]}», ahora está «${NOMBRE_ESTADO[vista.estado]}»`,
    );
  }
  return OK;
}

/**
 * Controla una carga o anulación contra la vista local de la vaca. Devuelve `{ ok: true }` o el primer rechazo,
 * con el código que daría la API, su mensaje y el campo (si el problema es de un campo). Los litros tienen sus
 * propias reglas (cola.ts) y no pasan por acá.
 */
export function validarCarga(carga: Carga, vista: VistaAnimal, ctx: ContextoReglas): ResultadoRegla {
  const { tipo, datos } = carga;

  // 1. Permiso por rol (403), antes de mirar nada más: como en la API, donde va antes de los parsers.
  const tipoEvento = tipo === 'ANULACION' ? String(datos.tipoEvento) : undefined;
  // Una anulación de un tipo que no existe no tiene ruta: se informa como "no encontrado".
  if (tipo === 'ANULACION' && !['SERVICIO', 'TACTO', 'PARTO', 'SECADO'].includes(tipoEvento!)) return rechazo(404, NO_ENCONTRADO_EVENTO);
  if (!puedeRegistrar(ctx.rol, tipo, tipoEvento)) return rechazo(403, mensajeSinPermiso(tipo));

  switch (tipo) {
    case 'SERVICIO':
      return validarServicio(datos, vista, ctx);
    case 'TACTO':
      return validarTacto(datos, vista, ctx);
    case 'PARTO':
      return validarParto(datos, vista, ctx);
    case 'SECADO':
      return validarSecado(datos, vista, ctx);
    case 'BAJA':
      return validarBaja(datos, vista, ctx);
    case 'ANULACION':
      return validarAnulacion(datos, vista, ctx.rol);
  }
}
