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
  // Spec 006 (RF-14): el número perteneció a un animal de baja por venta o muerte. Es un aviso, no un error.
  avisoNumeroDeBaja: AvisoNumeroDeBaja | null;
};

// Baja más reciente (venta o muerte) del número que se acaba de usar. fecha = AAAA-MM-DD.
export type AvisoNumeroDeBaja = { motivo: 'venta' | 'muerte'; fecha: string };

// Respuesta de GET /api/animales/:id. Las fechas vienen como AAAA-MM-DD.
export type AnimalFicha = {
  id: string;
  numero: string;
  sexo: Sexo;
  estado: EstadoAnimal;
  fechaNacimiento: string | null;
  lote: { id: string; nombre: string } | null;
  // motivoBaja: si la madre está de baja, "venta" o "muerte" tienen ficha de baja; "parto_anulado" no.
  madre: { id: string; numero: string; activa: boolean; motivoBaja?: 'venta' | 'muerte' | 'parto_anulado' | null } | null;
  crias: { id: string; numero: string }[];
  // Crías de baja (spec 006): con ficha de baja si el motivo es venta o muerte.
  criasDeBaja?: { id: string; numero: string; motivo: 'venta' | 'muerte' | 'parto_anulado' }[];
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
  // Spec 006: la fila es correcta, pero su número perteneció a un animal de baja (aviso, no error).
  avisoNumeroDeBaja?: AvisoNumeroDeBaja | null;
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
  avisosDeNumero?: { fila: number; numero: string; avisoNumeroDeBaja: AvisoNumeroDeBaja }[];
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
  // motivoBaja (spec 006): "venta" o "muerte" tienen ficha de baja; "parto_anulado" no.
  animal: { id: string; numero: string; activo: boolean; motivoBaja?: 'venta' | 'muerte' | 'parto_anulado' | null } | null;
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

// ─── Historial único (spec 007) ───

// Entrada del historial: un evento (ya armado como en /eventos) o un cambio manual.
// `fecha` es AAAA-MM-DD (la del evento, o el día argentino en que se guardó el cambio).
export type EntradaHistorial =
  | { clase: 'EVENTO'; fecha: string; registradoEn: string; evento: EventoReproductivo }
  | {
      clase: 'CAMBIO';
      fecha: string;
      registradoEn: string;
      cambio: { id: string; campo: CampoCambio; valorAnterior: string | null; valorNuevo: string | null; usuarioNombre: string };
    };

// Respuesta de GET /api/animales/:id/historial y /api/bajas/:id/historial.
export type RespuestaHistorial = {
  total: number;
  truncado: boolean;
  tope: number;
  // Único evento anulable (aunque quede fuera de las entradas por el tope).
  ultimoEventoNoAnuladoId: string | null;
  entradas: EntradaHistorial[];
};

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

// ─── Informes (spec 007) ───

export type ResultadoServicio = 'PRENADA_TACTO' | 'PRENADA_PARTO' | 'VACIA' | 'SIN_TACTO';

// Un animal como lo manda un informe: con lo necesario para armar el enlace a su ficha.
// activo = ficha en /animales/:id; si no, ficha de baja en /bajas/:id.
export type AnimalDeInforme = { id: string; numero: string; activo: boolean; motivoBaja: 'venta' | 'muerte' | 'parto_anulado' | null };

export type ResumenServicios = {
  total: number;
  prenadas: number;
  vacias: number;
  sinTacto: number;
  base: number; // preñadas + vacías: sobre lo que se calcula el porcentaje
  porcentajePrenez: number | null; // null = "—" (no hay base)
};

// GET /api/informes/inseminacion?desde&hasta. En `porSemen`, `semen: null` es "No especificado".
export type InformeInseminacion = {
  periodo: { desde: string; hasta: string };
  resumen: ResumenServicios;
  porSemen: (ResumenServicios & { semen: { id: string; nombre: string } | null })[];
  detalle: {
    servicioId: string;
    fecha: string;
    tipoServicio: TipoServicio;
    semen: { id: string; nombre: string } | null;
    resultado: ResultadoServicio;
    animal: AnimalDeInforme;
  }[];
  totalDetalle: number;
  truncado: boolean;
  tope: number;
};

// GET /api/informes/natalidad?desde&hasta
export type InformeNatalidad = {
  periodo: { desde: string; hasta: string };
  resumen: {
    partos: number;
    criasVivas: { total: number; hembras: number; machos: number };
    criasMuertas: { total: number; hembras: number; machos: number };
    mellizos: number;
    porcentajeNacidasMuertas: number | null;
  };
  detalle: {
    partoId: string;
    fecha: string;
    vaca: AnimalDeInforme;
    crias: { orden: number; sexo: Sexo; nacidaMuerta: boolean; animal: AnimalDeInforme | null }[];
  }[];
  totalDetalle: number;
  truncado: boolean;
  tope: number;
};

// ─── Producción: litros por vaca (spec 008) ───

export type TurnoOrdeno = 'manana' | 'tarde';

// Un registro de producción. `litros` es un número con un decimal; `anulado` null = vigente.
export type RegistroProduccion = {
  id: string;
  animalId: string;
  fecha: string; // AAAA-MM-DD
  turno: TurnoOrdeno;
  litros: number;
  loteNombre: string | null; // null = "Sin lote"
  registradoPor: string;
  registradoEn: string;
  anulado: { por: string | null; en: string; motivo: string | null } | null;
};

// GET /api/animales/:id/produccion y /api/bajas/:id/produccion. `sugerencia` solo viene en la ficha activa.
export type FichaProduccion = {
  registros: RegistroProduccion[];
  total: number;
  mostrados: number;
  truncado: boolean;
  tope: number;
  promedio30Dias: number | null; // null = "—"
  ultimoRegistro: { fecha: string; turno: TurnoOrdeno; litros: number } | null;
  sugerencia?: { fecha: string; turno: TurnoOrdeno };
};

// GET /api/informes/leche?desde&hasta (spec 008). Litros y promedios con un decimal; null = "—".
export type InformeLeche = {
  periodo: { desde: string; hasta: string };
  resumen: {
    totalLitros: number;
    ordenos: number;
    vacas: number;
    vacaDias: number;
    promedioPorVacaDia: number | null;
    promedioPorOrdeno: number | null;
  };
  porLote: { loteId: string | null; nombre: string | null; litros: number; vacas: number; vacaDias: number; promedioPorVacaDia: number | null }[]; // nombre null = "Sin lote"
  porVaca: { animal: AnimalDeInforme; litros: number; dias: number; promedioPorVacaDia: number | null }[];
  totalVacas: number;
  truncado: boolean;
  tope: number;
  porDia: { fecha: string; litros: number; vacas: number; litrosManana: number; litrosTarde: number }[];
};

// ─── Copia local del tambo para el modo sin conexión (spec 009) ───

// Un animal activo con todo lo que muestra su ficha, igual a lo que dan las rutas individuales
// (`/animales/:id`, `/eventos`, `/historial` y `/produccion`; esta última sin `sugerencia`).
export type AnimalCopia = {
  ficha: AnimalFicha;
  eventos: RespuestaEventos;
  historial: RespuestaHistorial;
  produccion: Omit<FichaProduccion, 'sugerencia'>;
};

// Respuesta de GET /api/copia-local: foto del tambo en un único instante (`generadaEn`, reloj del servidor).
export type CopiaLocal = {
  generadaEn: string; // instante ISO
  totalAnimales: number;
  lotes: Lote[];
  animales: AnimalCopia[];
};
