// Cliente HTTP para hablar con la API. Todas las llamadas pasan por acá.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detalles: { campo: string; mensaje: string }[] = [],
  ) {
    super(message);
  }
}

// ─── Sesión vencida (RF-29) ───
// Si la sesión vence (o se borra) mientras el usuario usa la app, la API responde 401
// a cualquier pedido. En vez de revisar eso en cada pantalla, este módulo avisa a una
// única función registrada (la registra AuthProvider, que saca al usuario al login).
let manejadorSesionVencida: (() => void) | null = null;

// Registra la función a llamar cuando la sesión vence. Devuelve otra función que la
// des-registra (sirve como "limpieza" de un useEffect).
export function alVencerSesion(fn: () => void): () => void {
  manejadorSesionVencida = fn;
  return () => {
    if (manejadorSesionVencida === fn) manejadorSesionVencida = null;
  };
}

// En estas rutas un 401 es una respuesta normal, no una sesión vencida:
// /auth/yo responde 401 al abrir la app sin sesión y /auth/login con datos incorrectos.
const rutasSin401Global = ['/auth/yo', '/auth/login'];

export async function api<T>(ruta: string, opciones: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${ruta}`, {
      method: opciones.method ?? 'GET',
      headers: opciones.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
      credentials: 'same-origin', // envía la cookie de sesión
    });
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Revisá tu conexión.');
  }

  if (res.status === 204) return undefined as T;

  const datos = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !rutasSin401Global.includes(ruta)) manejadorSesionVencida?.();
    throw new ApiError(res.status, datos?.error ?? `Error ${res.status}`, datos?.detalles ?? []);
  }
  return datos as T;
}

// Tipos que devuelve la API
export type Rol = 'DUENO' | 'ENCARGADO' | 'VETERINARIO';

export type Perfil = {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  establecimiento: { id: string; nombre: string };
};

// ─── Lotes (spec 001) ───

// Estados que pueden tener un lote destino. BAJA nunca tiene destino (RF-16).
export type EstadoConDestino = 'RECIEN_NACIDO' | 'VAQUILLONA' | 'EN_ORDENE' | 'SECA';

// Respuesta de GET /api/lotes (y de POST/PATCH de un lote).
export type Lote = {
  id: string;
  nombre: string;
  descripcion: string | null;
  cantidadAnimales: number; // solo animales activos (los dados de baja no cuentan)
  destinoDe: EstadoConDestino[]; // estados de los que este lote es destino
};

// Un elemento de GET /api/reglas-lote: siempre vienen los 4 estados,
// con `lote: null` cuando el estado no tiene destino.
export type ReglaLote = {
  estado: EstadoConDestino;
  lote: { id: string; nombre: string } | null;
};

// ─── Animales (spec 002) ───

export type EstadoAnimal = EstadoConDestino | 'BAJA';
export type Sexo = 'HEMBRA' | 'MACHO';

// Un elemento de GET /api/animales.
export type Animal = {
  id: string;
  numero: string;
  sexo: Sexo;
  estado: EstadoAnimal;
  lote: { nombre: string } | null;
};

// Respuesta de GET /api/animales: `truncado` es true si hay más de los que se muestran.
export type ListadoAnimales = {
  total: number;
  mostrados: number;
  truncado: boolean;
  animales: Animal[];
};

// Respuesta de POST /api/animales. `avisoSinLote` viene cuando el estado no tiene lote destino.
export type AltaAnimal = {
  animal: { id: string; numero: string; sexo: Sexo; estado: EstadoAnimal; fechaNacimiento: string | null; lote: { nombre: string } | null };
  avisoSinLote: { estado: EstadoAnimal } | null;
};

// Respuesta de GET /api/animales/:id. Las fechas vienen como AAAA-MM-DD.
export type AnimalFicha = {
  id: string;
  numero: string;
  sexo: Sexo;
  estado: EstadoAnimal;
  fechaNacimiento: string | null;
  lote: { id: string; nombre: string } | null;
  madre: { id: string; numero: string; activa: boolean } | null;
  crias: { id: string; numero: string }[];
  // Parto del que nació (spec 004). null si el animal no nació de un parto cargado.
  parto: { eventoId: string; fecha: string; genetica: Genetica | null } | null;
};

// ─── Carga desde planilla (spec 002) ───

export type FilaPlanilla = {
  fila: number; // número de fila en el texto pegado (cuenta encabezado y filas vacías)
  ok: boolean;
  numero: string | null;
  sexo: Sexo | null;
  estado: EstadoAnimal | null;
  fechaNacimiento: string | null;
  madre: string | null;
  motivo?: string; // solo cuando ok es false
};

export type SinLotePorEstado = { estado: EstadoAnimal; cantidad: number };

// Respuesta de POST /api/animales/planilla/vista-previa.
export type VistaPreviaPlanilla = {
  filas: FilaPlanilla[];
  resumen: { total: number; correctas: number; conError: number; sinLotePorEstado: SinLotePorEstado[] };
};

// Respuesta de POST /api/animales/planilla/confirmar.
export type ResultadoPlanilla = {
  guardados: number;
  quedaronAfuera: { fila: number; motivo: string }[];
  sinLotePorEstado: SinLotePorEstado[];
};

// ─── Semen y toros, servicios y tactos (spec 003) ───

// Un elemento de GET /api/semen (y de POST/PATCH).
export type SemenToro = { id: string; nombre: string; raza: string | null; activo: boolean };

export type TipoServicio = 'INSEMINACION' | 'MONTA_NATURAL';
export type ResultadoTacto = 'PRENADA' | 'VACIA';
export type EstadoReproductivo = 'SIN_SERVICIO' | 'SERVIDA' | 'PRENADA' | 'VACIA';

// Un evento de GET /api/animales/:id/eventos (del más reciente al más antiguo).
// Los detalles que no corresponden al tipo vienen en null.
export type EventoReproductivo = {
  id: string;
  tipo: 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO' | 'BAJA';
  fecha: string; // AAAA-MM-DD
  registradoPor: string;
  registradoEn: string;
  anulacion: { motivo: string | null; por: string | null; en: string } | null;
  servicio: { tipoServicio: TipoServicio; semen: { id: string; nombre: string } | null } | null;
  tacto: { resultado: ResultadoTacto; fechaProbableIndicada: string | null; fechaProbable: string | null; anomalias: string | null } | null;
  parto: { estadoAnterior: EstadoAnimal; loteAnterior: LoteAnterior; genetica: Genetica | null; crias: CriaDeParto[] } | null;
  secado: { estadoAnterior: EstadoAnimal; loteAnterior: LoteAnterior } | null;
  // Baja por venta o muerte (spec 006). Solo aparece en la ficha de baja o, anulada, tras revertirla.
  baja: { motivo: MotivoBaja; observaciones: string | null; estadoAnterior: EstadoAnimal; loteAnterior: LoteAnterior } | null;
};

// ─── Partos y secados (spec 004) ───

// Lote de la vaca justo antes del parto o secado.
export type LoteAnterior = 'SIN_LOTE' | 'ELIMINADO' | { id: string; nombre: string };

// Servicio del que nació el parto. semen null = "sin dato".
export type Genetica = { fechaServicio: string; semen: { id: string; nombre: string } | null };

// Cría de un parto. animal null = nació muerta; activo false = "dada de baja" (sin ficha).
export type CriaDeParto = {
  orden: number;
  sexo: Sexo;
  nacidaMuerta: boolean;
  observaciones: string | null;
  animal: { id: string; numero: string; activo: boolean } | null;
};

// Aviso de la operación recién hecha (no persiste: se muestra una sola vez).
export type Aviso = { codigo: string; mensaje: string };

// Respuesta de POST /animales/:id/partos y /secados.
export type RespuestaRegistro = { evento: EventoReproductivo; avisos: Aviso[] };

export type SituacionReproductiva = {
  estado: EstadoReproductivo;
  // `cicloAnterior`: es de antes del último parto (RF-40).
  ultimoServicio: { id: string; fecha: string; tipoServicio: TipoServicio | null; semen: { id: string; nombre: string } | null; cicloAnterior: boolean } | null;
  ultimoTacto: { id: string; fecha: string; resultado: ResultadoTacto | null; anomalias: string | null; cicloAnterior: boolean } | null;
  // `dias` es positivo si faltan y negativo si ya pasó la fecha.
  fechaProbableParto: { fecha: string; dias: number; vencida: boolean } | null;
  fechaReferencia: { fecha: string; dias: number } | null;
};

// Machos: situacion null y lista vacía.
export type RespuestaEventos = { situacion: SituacionReproductiva | null; eventos: EventoReproductivo[] };

// ─── Editar animal y mover de lote (spec 005) ───

export type CampoCambio = 'NUMERO' | 'SEXO' | 'FECHA_NACIMIENTO' | 'MADRE' | 'LOTE';

// Un cambio manual del historial. Los valores son texto copiado en ese momento
// (null = "sin dato" o "sin lote"); `creadoEn` es un instante ISO.
export type CambioManual = {
  id: string;
  campo: CampoCambio;
  valorAnterior: string | null;
  valorNuevo: string | null;
  usuarioId: string;
  usuarioNombre: string;
  creadoEn: string;
};

// Respuesta de GET /api/animales/:id/cambios: los últimos 100 y el total.
export type RespuestaCambios = { total: number; cambios: CambioManual[] };

// ─── Bajas por venta o muerte (spec 006) ───

// Los motivos que se pueden pedir, en minúsculas como los habla la API.
export type MotivoBaja = 'venta' | 'muerte';

// Respuesta de POST /api/animales/:id/baja (201). `animalId` es el que usa la ficha de baja.
export type BajaRegistrada = {
  id: string;
  animalId: string;
  numero: string;
  motivo: MotivoBaja;
  fecha: string; // AAAA-MM-DD
  observaciones: string | null;
  estadoAnterior: EstadoAnimal;
  registradoPor: string;
  registradoEn: string;
};

// Respuesta de POST /api/animales/:id/revertir-baja: la ficha del animal activo y los avisos de lote.
export type BajaRevertida = AnimalFicha & { avisos: string[] };

// Un elemento de GET /api/bajas. `id` es el id del animal.
export type FilaBaja = { id: string; numero: string; sexo: Sexo; fecha: string; motivo: MotivoBaja };

export type ListadoBajas = { total: number; mostrados: number; truncado: boolean; bajas: FilaBaja[] };

// Respuesta de GET /api/bajas/:id (ficha de baja, solo lectura). `motivoBaja` de la madre y de las
// crías de baja dice si hay acceso a su ficha de baja ("venta" o "muerte") o no ("parto_anulado").
export type FichaBaja = {
  id: string;
  numero: string;
  sexo: Sexo;
  fechaNacimiento: string | null;
  estadoAnterior: EstadoAnimal;
  baja: {
    eventoId: string;
    motivo: MotivoBaja;
    fecha: string;
    observaciones: string | null;
    registradoPor: string;
    registradoEn: string;
  };
  madre: { id: string; numero: string; activa: boolean; motivoBaja: MotivoBaja | 'parto_anulado' | null } | null;
  crias: { id: string; numero: string }[];
  criasDeBaja: { id: string; numero: string; motivo: MotivoBaja | 'parto_anulado' }[];
  eventos: EventoReproductivo[];
  cambios: RespuestaCambios;
};
