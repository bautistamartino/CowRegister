import type { CampoCambio, EstadoAnimal, Sexo } from '../generated/prisma/client.js';
import { normalizarNumero, numeroSchema } from '../validacion.js';
import { puedeTenerEstado, validarFechaNacimiento } from './reglas.js';

// Reglas de la edición de un animal (spec 005). Son funciones puras: no tocan la base ni
// Express, así se prueban solas. La ruta lee los datos (con bloqueos), arma el `ContextoEdicion`
// y le pregunta a `evaluarEdicion` si el pedido se puede guardar y qué cambios hay que registrar.

// Campo y mensaje de un rechazo. `estado` es el código HTTP (400 dato inválido, 409 conflicto).
export type RechazoEdicion = {
  estado: 400 | 409;
  mensaje: string;
  campo?: 'numero' | 'sexo' | 'fechaNacimiento' | 'madre';
};

// Datos del pedido de edición. Omitido = no se toca; `null` solo se admite en fecha y madre.
// El número ya viene normalizado; la madre va tal cual (se busca después, por su número).
export type DatosEdicion = {
  numero?: string;
  sexo?: Sexo;
  fechaNacimiento?: string | null;
  madre?: string | null;
};

// Orden fijo de los campos en el historial (RF-15): es el orden del enum `CampoCambio`.
export const ORDEN_CAMPOS: readonly CampoCambio[] = ['NUMERO', 'SEXO', 'FECHA_NACIMIENTO', 'MADRE', 'LOTE'];

// Ordena cambios (o filas del historial de un mismo guardado) con el orden fijo de campo.
export function ordenarCambios<T extends { campo: CampoCambio }>(cambios: T[]): T[] {
  return [...cambios].sort((a, b) => ORDEN_CAMPOS.indexOf(a.campo) - ORDEN_CAMPOS.indexOf(b.campo));
}

// ─── Formato del pedido (400, antes de buscar el animal) ────────────

const MENSAJE_ESTADO = 'El estado no se cambia a mano: lo cambian los eventos';
const MENSAJE_LOTE = 'Para cambiar de lote usá «Mover de lote»';

/**
 * Revisa el formato del cuerpo (RF-2): qué campos se admiten y qué forma tiene cada uno.
 * `establecimientoId` se ignora sin error (constitución §1: el tambo sale de la sesión).
 * Un cuerpo vacío (`{}`) es de formato válido: se rechaza más tarde como "sin cambios",
 * porque eso se informa después de la búsqueda del animal (RF-16).
 */
export function interpretarCuerpo(cuerpo: unknown): { datos: DatosEdicion } | { rechazo: RechazoEdicion } {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
    return { rechazo: { estado: 400, mensaje: 'El pedido tiene que ser un objeto con los datos a editar' } };
  }
  const c = cuerpo as Record<string, unknown>;

  // 1) Campos que no se pueden editar, con su mensaje (en el orden en que vienen).
  for (const clave of Object.keys(c)) {
    if (clave === 'establecimientoId' || ['numero', 'sexo', 'fechaNacimiento', 'madre'].includes(clave)) continue;
    if (clave === 'estado') return { rechazo: { estado: 400, mensaje: MENSAJE_ESTADO } };
    if (clave === 'loteId' || clave === 'lote') return { rechazo: { estado: 400, mensaje: MENSAJE_LOTE } };
    return { rechazo: { estado: 400, mensaje: `El dato «${clave}» no se puede editar` } };
  }

  // 2) Forma de cada dato, en el orden número, sexo, fecha, madre.
  const datos: DatosEdicion = {};
  if ('numero' in c) {
    const r = numeroSchema.safeParse(c.numero);
    if (!r.success) return { rechazo: { estado: 400, campo: 'numero', mensaje: r.error.issues[0]?.message ?? 'El número no es válido' } };
    datos.numero = r.data;
  }
  if ('sexo' in c) {
    if (c.sexo !== 'HEMBRA' && c.sexo !== 'MACHO') {
      return { rechazo: { estado: 400, campo: 'sexo', mensaje: 'El sexo tiene que ser hembra o macho' } };
    }
    datos.sexo = c.sexo;
  }
  if ('fechaNacimiento' in c) {
    if (c.fechaNacimiento !== null && typeof c.fechaNacimiento !== 'string') {
      return { rechazo: { estado: 400, campo: 'fechaNacimiento', mensaje: 'La fecha de nacimiento tiene que ser un texto AAAA-MM-DD' } };
    }
    datos.fechaNacimiento = c.fechaNacimiento;
  }
  if ('madre' in c) {
    if (c.madre !== null && typeof c.madre !== 'string') {
      return { rechazo: { estado: 400, campo: 'madre', mensaje: 'El número de la madre tiene que ser un texto' } };
    }
    datos.madre = c.madre;
  }
  return { datos };
}

// ─── Reglas de datos y conflictos ───────────────────────────────────

// Lo que la ruta sabe del animal, ya leído con los bloqueos tomados.
export type AnimalParaEditar = {
  id: string;
  numero: string;
  sexo: Sexo;
  estado: EstadoAnimal;
  fechaNacimiento: string | null; // AAAA-MM-DD
  madre: { id: string; numero: string; fechaNacimiento: string | null } | null; // la actual
  esCriaDeParto: boolean; // dada de alta por un parto (spec 004)
  tieneEventosOCrias: boolean; // eventos no anulados o crías de cualquier estado (RF-4)
};

// Madre pedida, tal como la encontró la ruta (hembra o macho activo del tambo).
export type MadreEncontrada = { id: string; numero: string; sexo: Sexo; fechaNacimiento: string | null };

export type ContextoEdicion = {
  animal: AnimalParaEditar;
  hoy: string; // AAAA-MM-DD según la hora de Argentina
  // `undefined`: el pedido no trae madre (o la trae en null). `null`: la trae pero no hay un
  // animal activo del tambo con ese número (inexistente, de otro tambo o de baja).
  madreNueva: MadreEncontrada | null | undefined;
  esDescendiente: boolean; // la madre nueva es cría o descendiente del animal (consulta recursiva)
  numeroOcupado: boolean; // otro animal activo del tambo ya tiene el número nuevo
};

// Un dato modificado, listo para guardarse en el historial (texto copiado, RF-14).
export type CambioCalculado = { campo: CampoCambio; valorAnterior: string | null; valorNuevo: string | null };

export type ResultadoEdicion = { rechazo: RechazoEdicion } | { cambios: CambioCalculado[] };

const rechazo = (estado: 400 | 409, mensaje: string, campo?: RechazoEdicion['campo']): { rechazo: RechazoEdicion } => ({
  rechazo: campo ? { estado, mensaje, campo } : { estado, mensaje },
});

// El historial guarda el sexo como texto legible.
const textoSexo = (sexo: Sexo) => (sexo === 'HEMBRA' ? 'hembra' : 'macho');

/**
 * Decide si el pedido se puede guardar. Devuelve el PRIMER rechazo según el orden de RF-16:
 * "sin cambios" 400 → reglas de datos 400 (número, sexo, fecha, madre) → conflictos 409
 * (cría de parto, sexo con eventos o crías, número repetido). Si todo está bien, devuelve los
 * cambios (uno por dato modificado) en el orden fijo de campo.
 */
export function evaluarEdicion(datos: DatosEdicion, ctx: ContextoEdicion): ResultadoEdicion {
  const { animal } = ctx;

  // ¿Qué datos cambian de verdad respecto de los actuales?
  const cambiaNumero = datos.numero !== undefined && datos.numero !== animal.numero;
  const cambiaSexo = datos.sexo !== undefined && datos.sexo !== animal.sexo;
  const cambiaFecha = datos.fechaNacimiento !== undefined && datos.fechaNacimiento !== animal.fechaNacimiento;
  let cambiaMadre = false;
  if (datos.madre === null) cambiaMadre = animal.madre !== null;
  else if (typeof datos.madre === 'string') cambiaMadre = !(ctx.madreNueva && ctx.madreNueva.id === animal.madre?.id);

  // 1) Sin cambios (400).
  if (!cambiaNumero && !cambiaSexo && !cambiaFecha && !cambiaMadre) {
    return rechazo(400, 'No hay cambios para guardar');
  }

  // Madre que tendrá el animal al terminar (para validar la fecha contra ella).
  const fechaMadreFinal =
    datos.madre === undefined
      ? (animal.madre?.fechaNacimiento ?? null)
      : datos.madre === null
        ? null
        : (ctx.madreNueva?.fechaNacimiento ?? null);
  // Fecha que tendrá el animal al terminar (para validar la de la madre contra ella).
  const fechaFinal = datos.fechaNacimiento === undefined ? animal.fechaNacimiento : datos.fechaNacimiento;

  // 2) Reglas de datos (400), en el orden número, sexo, fecha, madre.
  // (El formato del número ya se revisó en `interpretarCuerpo`.)
  if (cambiaSexo && !puedeTenerEstado(datos.sexo!, animal.estado)) {
    return rechazo(400, 'Un macho solo puede tener el estado recién nacido: este animal no puede pasar a macho', 'sexo');
  }
  if (cambiaFecha && datos.fechaNacimiento !== null) {
    const error = validarFechaNacimiento(datos.fechaNacimiento!, ctx.hoy, fechaMadreFinal);
    if (error) return rechazo(400, error, 'fechaNacimiento');
  }
  if (cambiaMadre && typeof datos.madre === 'string') {
    const pedido = normalizarNumero(datos.madre) ?? datos.madre.trim();
    const madre = ctx.madreNueva;
    // Mensaje genérico: no revela si el número existe en otro tambo o está de baja.
    if (!madre) return rechazo(400, `No hay una hembra activa con el número ${pedido}`, 'madre');
    if (madre.id === animal.id) return rechazo(400, 'Un animal no puede ser su propia madre', 'madre');
    if (madre.sexo === 'MACHO') return rechazo(400, `El animal ${madre.numero} es un macho: la madre tiene que ser una hembra`, 'madre');
    if (ctx.esDescendiente) return rechazo(400, `${madre.numero} ya es descendiente de este animal`, 'madre');
    if (madre.fechaNacimiento && fechaFinal && madre.fechaNacimiento >= fechaFinal) {
      return rechazo(400, 'La fecha de nacimiento de la madre tiene que ser anterior a la del animal', 'madre');
    }
  }

  // 3) Conflictos (409), en este orden: cría de parto, sexo con eventos o crías, número repetido.
  // Una cría de parto trae sexo, fecha y madre del parto: con cualquier valor (aun null) se rechaza.
  if (animal.esCriaDeParto && (datos.sexo !== undefined || datos.fechaNacimiento !== undefined || datos.madre !== undefined)) {
    return rechazo(409, 'El sexo, la fecha de nacimiento y la madre de esta cría vienen del parto: solo se puede cambiar el número');
  }
  if (cambiaSexo && animal.tieneEventosOCrias) {
    return rechazo(409, 'No se puede cambiar el sexo: el animal tiene eventos registrados o crías', 'sexo');
  }
  if (cambiaNumero && ctx.numeroOcupado) {
    return rechazo(409, 'Ya existe un animal activo con ese número', 'numero');
  }

  // 4) Todo bien: un cambio por dato modificado, en el orden fijo de campo.
  const cambios: CambioCalculado[] = [];
  if (cambiaNumero) cambios.push({ campo: 'NUMERO', valorAnterior: animal.numero, valorNuevo: datos.numero! });
  if (cambiaSexo) cambios.push({ campo: 'SEXO', valorAnterior: textoSexo(animal.sexo), valorNuevo: textoSexo(datos.sexo!) });
  if (cambiaFecha) cambios.push({ campo: 'FECHA_NACIMIENTO', valorAnterior: animal.fechaNacimiento, valorNuevo: datos.fechaNacimiento! });
  if (cambiaMadre) {
    cambios.push({
      campo: 'MADRE',
      valorAnterior: animal.madre?.numero ?? null,
      valorNuevo: typeof datos.madre === 'string' ? (ctx.madreNueva?.numero ?? null) : null,
    });
  }
  return { cambios: ordenarCambios(cambios) };
}
