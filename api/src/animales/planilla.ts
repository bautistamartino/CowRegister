import { HttpError } from '../errores.js';
import { normalizarNumero, numeroSchema } from '../validacion.js';
import { ESTADOS_INICIALES, puedeTenerEstado, validarFechaNacimiento } from './reglas.js';

// Carga del rodeo pegando desde una planilla (spec 002, RF-11 a RF-22).
// Este archivo son funciones PURAS (no usan la base ni Express), así se prueban solas:
//  - leerPlanilla: del texto pegado a filas de celdas.
//  - analizarPlanilla: valida cada fila y resuelve madres, duplicados y ciclos.
//  - sinLotePorEstado: cuenta los animales que quedarían sin lote.
// La parte que consulta y guarda en la base está en `carga.ts`.

export const MAX_CARACTERES = 100_000;
export const MAX_FILAS = 500;
const COLUMNAS = 5;

export const MENSAJE_SIN_TABULACIONES =
  'Las columnas tienen que estar separadas por tabulación: copiá las celdas desde Excel o Google Sheets';

// Un error general de la planilla corta todo el pedido con 400 (RF-14, RF-17).
const errorGeneral = (mensaje: string) => new HttpError(400, mensaje);

// ---------------------------------------------------------------------------
// Lectura del texto
// ---------------------------------------------------------------------------

export interface FilaCruda {
  fila: number; // número de fila en la planilla pegada: cuenta el encabezado y las filas vacías
  celdas: string[];
}

// Compara sin mayúsculas, sin tildes y con los espacios repetidos como uno.
function simplificar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita las tildes (marcas combinables)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Nombres aceptados para el encabezado, columna por columna (RF-15).
const ENCABEZADO: string[][] = [
  ['numero', 'caravana'],
  ['sexo'],
  ['fecha de nacimiento', 'fecha nacimiento', 'nacimiento'],
  ['estado'],
  ['madre', 'numero de la madre', 'numero madre'],
];

// Es encabezado solo si las CINCO celdas coinciden, cada una con su columna.
function esEncabezado(celdas: string[]): boolean {
  return celdas.length === COLUMNAS && celdas.every((c, i) => ENCABEZADO[i]!.includes(simplificar(c)));
}

/**
 * Separa el texto pegado en filas y celdas (RF-14). Máquina de estados de caracteres:
 * - la celda se separa por tabulación y la fila por salto de línea (LF, CRLF o CR);
 * - una celda que empieza con comillas dobles es texto de una sola celda, aunque tenga
 *   tabulaciones o saltos de línea (así copia Excel); adentro, "" es una comilla.
 * Devuelve solo las filas con datos (sin encabezado ni vacías), conservando su número
 * de fila original. Lanza HttpError 400 con un mensaje en español en los casos de RF-14 y RF-17.
 */
export function leerPlanilla(texto: string): { filas: FilaCruda[] } {
  if (texto.trim() === '') throw errorGeneral('Pegá las filas de la planilla para continuar');
  if (texto.length > MAX_CARACTERES) {
    throw errorGeneral('El texto pegado supera los 100.000 caracteres: cargá el rodeo en tandas más chicas');
  }

  const registros: string[][] = [];
  let celdas: string[] = [];
  let celda = '';
  let entreComillas = false;
  let comillasDesde = 0; // fila donde se abrieron las comillas que siguen abiertas

  const cerrarCelda = () => {
    celdas.push(celda.trim());
    celda = '';
  };
  const cerrarFila = () => {
    cerrarCelda();
    registros.push(celdas);
    celdas = [];
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"'; // "" adentro de las comillas = una comilla
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        celda += c; // incluye tabulaciones y saltos de línea
      }
    } else if (c === '"' && celda.trim() === '') {
      entreComillas = true; // comillas al comienzo de la celda
      comillasDesde = registros.length + 1;
      celda = '';
    } else if (c === '\t') {
      cerrarCelda();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++; // CRLF cuenta como un solo salto
      cerrarFila();
    } else {
      celda += c;
    }
  }
  if (entreComillas) {
    throw errorGeneral(`Hay comillas sin cerrar: empezaron en la fila ${comillasDesde}. Revisá que cada celda entre comillas termine con comillas`);
  }
  cerrarFila(); // la última fila (si el texto termina con salto, queda vacía y se ignora)

  const filas: FilaCruda[] = [];
  registros.forEach((c, i) => {
    if (c.every((x) => x === '')) return; // fila vacía: se ignora sin error
    filas.push({ fila: i + 1, celdas: c });
  });

  if (filas.length === 0) throw errorGeneral('Pegá las filas de la planilla para continuar');

  // Mensaje específico si ninguna fila tiene tabulaciones (se copió de un PDF, por ejemplo).
  if (!filas.some((f) => f.celdas.length > 1)) throw errorGeneral(MENSAJE_SIN_TABULACIONES);

  // El encabezado es la primera fila no vacía, si coincide por completo (RF-15).
  if (esEncabezado(filas[0]!.celdas)) filas.shift();

  if (filas.length === 0) throw errorGeneral('La planilla no tiene filas con datos: pegá también las filas de los animales');
  if (filas.length > MAX_FILAS) {
    throw errorGeneral('La planilla tiene más de 500 filas con datos: cargala en tandas de hasta 500 animales');
  }
  return { filas };
}

// ---------------------------------------------------------------------------
// Análisis de las filas
// ---------------------------------------------------------------------------

type Sexo = 'HEMBRA' | 'MACHO';
type Estado = (typeof ESTADOS_INICIALES)[number];

// Un animal activo del tambo que aparece en la planilla (como número o como madre).
export interface Existente {
  id: string;
  sexo: Sexo;
  fechaNacimiento: string | null; // AAAA-MM-DD
}

export interface ContextoPlanilla {
  hoy: string; // AAAA-MM-DD, hora de Argentina
  existentes: Map<string, Existente>; // por número normalizado
}

// A quién se vincula la madre de una fila: un animal que ya existe o otra fila de la planilla.
export type Vinculo = { tipo: 'existente'; id: string } | { tipo: 'fila'; fila: number };

export interface FilaAnalizada {
  fila: number;
  ok: boolean;
  // Lo que se entendió de cada columna; si la celda no se pudo interpretar, el texto original (o null si vino vacía).
  numero: string | null;
  sexo: string | null;
  estado: string | null;
  fechaNacimiento: string | null;
  madre: string | null;
  motivo?: string; // solo si ok es false
  vinculo?: Vinculo; // solo si ok es true y la fila tiene madre (dato interno para guardar)
}

const NOMBRE_ESTADO: Record<string, Estado> = {
  'recien nacido': 'RECIEN_NACIDO',
  vaquillona: 'VAQUILLONA',
  'en ordene': 'EN_ORDENE',
  seca: 'SECA',
};

const MSG_FECHA_FORMATO = 'La fecha de nacimiento tiene que ser día/mes/año con año de cuatro dígitos (5/3/2021) o AAAA-MM-DD';
const MSG_MADRE_ANTERIOR = 'La fecha de nacimiento tiene que ser posterior a la de la madre';
const msgSinMadre = (numero: string) => `No hay una hembra activa con el número ${numero}`;

// Estado de trabajo de una fila mientras se analiza.
interface Trabajo {
  cruda: FilaCruda;
  numero?: string;
  sexo?: Sexo;
  estado?: Estado;
  fecha?: string;
  madre?: string; // número normalizado de la madre
  error?: string;
  vinculo?: Vinculo;
}

// Paso 1: valida los campos propios de la fila, sin mirar otras filas ni la base.
function validarPropios(cruda: FilaCruda, hoy: string): Trabajo {
  const t: Trabajo = { cruda };
  const c = cruda.celdas;

  // El número se interpreta siempre que se pueda, aunque la fila tenga otro error, así
  // otras filas pueden nombrarla como madre ("la madre (fila N) tiene error").
  if (c[0] !== undefined) {
    const n = numeroSchema.safeParse(c[0]);
    if (n.success) t.numero = n.data;
    else t.error = n.error.issues[0]!.message;
  }

  if (c.length !== COLUMNAS) {
    t.error ??= `La fila tiene ${c.length} columnas y tienen que ser ${COLUMNAS}`;
    return t;
  }
  const [, celdaSexo, celdaFecha, celdaEstado, celdaMadre] = c as [string, string, string, string, string];

  // Sexo (RF-16)
  const sexo = simplificar(celdaSexo);
  if (sexo === 'hembra' || sexo === 'h') t.sexo = 'HEMBRA';
  else if (sexo === 'macho' || sexo === 'm') t.sexo = 'MACHO';
  else t.error ??= sexo === '' ? 'El sexo es obligatorio' : 'El sexo tiene que ser hembra, macho, H o M';

  // Estado (RF-16): BAJA no es un estado de alta.
  const estado = NOMBRE_ESTADO[simplificar(celdaEstado)];
  if (estado) t.estado = estado;
  else {
    t.error ??= celdaEstado === '' ? 'El estado es obligatorio' : 'El estado tiene que ser recién nacido, vaquillona, en ordeñe o seca';
  }

  if (t.sexo && t.estado && !puedeTenerEstado(t.sexo, t.estado)) {
    t.error ??= 'Un macho solo puede tener el estado recién nacido';
  }

  // Fecha (RF-16, RF-6): día/mes/año con año de 4 dígitos, o AAAA-MM-DD.
  if (celdaFecha !== '') {
    const dma = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(celdaFecha);
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(celdaFecha);
    const fecha = dma ? `${dma[3]}-${dma[2]!.padStart(2, '0')}-${dma[1]!.padStart(2, '0')}` : iso ? celdaFecha : null;
    if (!fecha) t.error ??= MSG_FECHA_FORMATO;
    else {
      const error = validarFechaNacimiento(fecha, hoy);
      if (error) t.error ??= error;
      else t.fecha = fecha;
    }
  }

  // Madre: acá solo el formato y que no sea la propia fila (RF-13); el resto en el paso 3.
  if (celdaMadre !== '') {
    const madre = normalizarNumero(celdaMadre);
    if (madre === null) t.error ??= msgSinMadre(celdaMadre);
    else if (madre === t.numero) t.error ??= 'Un animal no puede ser su propia madre';
    else t.madre = madre;
  }
  return t;
}

/**
 * Valida todas las filas (RF-12, RF-13). Pasos:
 * 1. campos propios de cada fila;
 * 2. duplicados contra filas anteriores y contra activos del tambo;
 * 3. madre de cada fila (animal del tambo, fila de la planilla o error);
 * 4. ciclos de madres: todas las filas del ciclo tienen error;
 * 5. el error se propaga a las crías hasta que no haya cambios.
 * No valida en orden de aparición, así una madre puede estar en una fila posterior.
 */
export function analizarPlanilla(filas: FilaCruda[], contexto: ContextoPlanilla): FilaAnalizada[] {
  const w = filas.map((f) => validarPropios(f, contexto.hoy));

  // Paso 2. `primera` guarda, por número, la primera fila de la planilla que lo usa (tenga o no error).
  const primera = new Map<string, number>();
  w.forEach((x, i) => {
    if (!x.numero) return;
    const previa = primera.get(x.numero);
    if (previa !== undefined) {
      x.error ??= `El número ${x.numero} ya aparece en la fila ${w[previa]!.cruda.fila}`;
      return;
    }
    primera.set(x.numero, i);
    if (contexto.existentes.has(x.numero)) x.error ??= `Ya existe un animal activo con el número ${x.numero}`;
  });

  // Paso 3. Se prefiere siempre el animal existente del tambo sobre una fila con el mismo número.
  w.forEach((x) => {
    if (x.error || !x.madre) return;
    const existente = contexto.existentes.get(x.madre);
    let fechaMadre: string | null | undefined;
    if (existente) {
      if (existente.sexo !== 'HEMBRA') {
        x.error = msgSinMadre(x.madre);
        return;
      }
      x.vinculo = { tipo: 'existente', id: existente.id };
      fechaMadre = existente.fechaNacimiento;
    } else {
      const j = primera.get(x.madre);
      if (j === undefined) {
        x.error = msgSinMadre(x.madre);
        return;
      }
      const madre = w[j]!;
      if (madre.sexo === 'MACHO') {
        x.error = msgSinMadre(x.madre);
        return;
      }
      x.vinculo = { tipo: 'fila', fila: madre.cruda.fila };
      fechaMadre = madre.fecha;
    }
    // Si ambas tienen fecha, la de la madre debe ser anterior (RF-13).
    if (x.fecha && fechaMadre && x.fecha <= fechaMadre) x.error = MSG_MADRE_ANTERIOR;
  });

  // Índice de cada fila por su número de fila, para seguir los vínculos.
  const indicePorFila = new Map(w.map((x, i) => [x.cruda.fila, i]));
  const sigue = (i: number): number | undefined => {
    const x = w[i]!;
    return !x.error && x.vinculo?.tipo === 'fila' ? indicePorFila.get(x.vinculo.fila) : undefined;
  };

  // Paso 4. Cada fila apunta a lo sumo a una madre, así que alcanza con seguir la cadena
  // desde cada fila: si se vuelve a una fila de la cadena actual, hay un ciclo.
  const visita = new Array<0 | 1 | 2>(w.length).fill(0); // 0 sin ver, 1 en la cadena actual, 2 ya resuelta
  const siguientes = w.map((_, i) => sigue(i)); // se calcula antes de marcar errores
  for (let inicio = 0; inicio < w.length; inicio++) {
    const cadena: number[] = [];
    let actual: number | undefined = inicio;
    while (actual !== undefined && visita[actual] === 0) {
      visita[actual] = 1;
      cadena.push(actual);
      actual = siguientes[actual];
    }
    if (actual !== undefined && visita[actual] === 1) {
      const ciclo = cadena.slice(cadena.indexOf(actual));
      const lista = ciclo.map((i) => w[i]!.cruda.fila).sort((a, b) => a - b);
      for (const i of ciclo) w[i]!.error = `Las filas ${lista.join(', ')} se declaran madre una de otra (ciclo)`;
    }
    for (const i of cadena) visita[i] = 2;
  }

  // Paso 5. Una cría cuya madre (fila de la planilla) tiene error también tiene error.
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const x of w) {
      if (x.error || x.vinculo?.tipo !== 'fila') continue;
      const madre = w[indicePorFila.get(x.vinculo.fila)!]!;
      if (madre.error) {
        x.error = `La madre (fila ${madre.cruda.fila}) tiene error`;
        cambio = true;
      }
    }
  }

  return w.map((x) => {
    const c = x.cruda.celdas;
    const base = {
      fila: x.cruda.fila,
      // Se muestra lo interpretado y, si no se pudo, lo que vino escrito.
      numero: x.numero ?? (c[0] || null),
      sexo: x.sexo ?? (c[1] || null),
      estado: x.estado ?? (c[3] || null),
      fechaNacimiento: x.fecha ?? (c[2] || null),
      madre: x.madre ?? (c[4] || null),
    };
    return x.error ? { ...base, ok: false, motivo: x.error } : { ...base, ok: true, ...(x.vinculo && { vinculo: x.vinculo }) };
  });
}

/**
 * Cuántos animales de las filas correctas quedarían sin lote, por estado (RF-19).
 * `reglas` es estado → loteId de las reglas del tambo. Los estados salen en el orden de ESTADOS_INICIALES.
 */
export function sinLotePorEstado(
  filas: FilaAnalizada[],
  reglas: Map<string, string>,
): { estado: Estado; cantidad: number }[] {
  const cuenta = new Map<string, number>();
  for (const f of filas) {
    if (f.ok && f.estado && !reglas.has(f.estado)) cuenta.set(f.estado, (cuenta.get(f.estado) ?? 0) + 1);
  }
  return ESTADOS_INICIALES.filter((e) => cuenta.has(e)).map((estado) => ({ estado, cantidad: cuenta.get(estado)! }));
}
