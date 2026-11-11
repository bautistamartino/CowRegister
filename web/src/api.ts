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
  lote: { nombre: string } | null;
  madre: { id: string; numero: string; activa: boolean } | null;
  crias: { id: string; numero: string }[];
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
