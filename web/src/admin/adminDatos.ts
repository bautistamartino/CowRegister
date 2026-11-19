// Tipos, llamadas y lógica pura de las pantallas del administrador (spec 014).
// Las formas de las respuestas son la lista blanca de la API (api/src/admin/listaBlanca.ts).
// IMPORTANTE: acá no se importa nada de `sinconexion/` salvo la hora de Argentina (función pura):
// el administrador no usa la copia local.

import { api } from '../compartido/api';
import { fechaIsoArgentina, formatearFechaHoraArgentina } from '../sinconexion/horaArgentina';

export type DuenoTambo = { nombre: string; email: string };

// Estado del tambo y su último cambio (spec 015): la baja o reactivación vigente. `motivo` es nulo en reactivaciones.
export type EstadoTambo = 'ACTIVO' | 'BAJA';
export type CambioEstado = { tipo: 'BAJA' | 'REACTIVACION'; por: string; en: string; motivo: string | null };
export type FiltroEstado = 'todos' | 'activos' | 'baja';

export type ItemTambo = {
  id: string;
  nombre: string;
  creadoEn: string;
  dueno: DuenoTambo | null;
  duenosAdicionales: number;
  usuariosActivos: number;
  animalesActivos: number;
  estado: EstadoTambo;
  ultimoCambioEstado: CambioEstado | null;
  ultimoIngreso: string | null;
};

export type UsuarioTambo = {
  id: string;
  nombre: string;
  email: string;
  rol: 'DUENO' | 'ENCARGADO' | 'VETERINARIO';
  activo: boolean;
  ultimoIngreso: string | null;
};
export type DetalleTambo = ItemTambo & { usuarios: UsuarioTambo[] };

export type DatosTamboNuevo = { nombreEstablecimiento: string; nombre: string; email: string; password: string };

// El filtro de estado lo resuelve el servidor (spec 015, RF-3).
export const listarTambos = (estado: FiltroEstado = 'todos') => api<ItemTambo[]>(`/admin/tambos?estado=${estado}`);
export const obtenerTambo = (id: string) => api<DetalleTambo>(`/admin/tambos/${encodeURIComponent(id)}`);
export const crearTambo = (datos: DatosTamboNuevo) => api<ItemTambo>('/admin/tambos', { method: 'POST', body: datos });

// ─── Acciones del administrador (spec 015) ───
// Todas van a la red: sin conexión, api() responde "Esto necesita conexión".
const rutaTambo = (id: string) => `/admin/tambos/${encodeURIComponent(id)}`;
export const darDeBajaTambo = (id: string, motivo: string) =>
  api<DetalleTambo>(`${rutaTambo(id)}/baja`, { method: 'POST', body: { motivo } });
export const reactivarTambo = (id: string) => api<DetalleTambo>(`${rutaTambo(id)}/reactivar`, { method: 'POST' });
export const restablecerContrasena = (id: string, uid: string, password: string) =>
  api<void>(`${rutaTambo(id)}/usuarios/${encodeURIComponent(uid)}/contrasena`, { method: 'POST', body: { password } });
export const reactivarUsuario = (id: string, uid: string) =>
  api<DetalleTambo>(`${rutaTambo(id)}/usuarios/${encodeURIComponent(uid)}/reactivar`, { method: 'POST' });

export const NOMBRE_ROL: Record<UsuarioTambo['rol'], string> = {
  DUENO: 'Dueño',
  ENCARGADO: 'Encargado',
  VETERINARIO: 'Veterinario',
};

// ─── Validación del formulario "Crear tambo" ───
// Mismas reglas y mismos mensajes que la API (api/src/validacion.ts), así el error sale antes de enviar.
// La API vuelve a validar todo: esto es solo comodidad.

export type FormularioTamboNuevo = DatosTamboNuevo & { confirmar: string };
export type ErroresTamboNuevo = Partial<Record<keyof FormularioTamboNuevo, string>>;

// Mismo patrón que usa zod (z.email) en la API.
const EMAIL = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

function errorNombre(valor: string): string | null {
  if (valor.length < 1) return 'El nombre es obligatorio';
  if (valor.length > 100) return 'El nombre es demasiado largo';
  return null;
}

// Devuelve los errores por campo y, si no hay ninguno, los datos listos para enviar (nombres sin espacios
// de más, email en minúsculas; la contraseña no se toca).
export function validarTamboNuevo(f: FormularioTamboNuevo): { errores: ErroresTamboNuevo; datos: DatosTamboNuevo | null } {
  const errores: ErroresTamboNuevo = {};
  const nombreEstablecimiento = f.nombreEstablecimiento.trim();
  const nombre = f.nombre.trim();
  const email = f.email.trim().toLowerCase();

  const eTambo = errorNombre(nombreEstablecimiento);
  if (eTambo) errores.nombreEstablecimiento = eTambo;
  const eNombre = errorNombre(nombre);
  if (eNombre) errores.nombre = eNombre;
  if (!EMAIL.test(email)) errores.email = 'El email no es válido';
  if (f.password.length < 10) errores.password = 'La contraseña debe tener al menos 10 caracteres';
  else if (f.password.length > 128) errores.password = 'La contraseña es demasiado larga';
  else if (f.password !== f.confirmar) errores.confirmar = 'Las contraseñas no coinciden';

  if (Object.keys(errores).length > 0) return { errores, datos: null };
  return { errores, datos: { nombreEstablecimiento, nombre, email, password: f.password } };
}

// ─── Formato ───

// "12/11/2026": fecha de alta en hora de Argentina, sin depender del huso del dispositivo.
export function formatearAlta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const [a, m, dia] = fechaIsoArgentina(d).split('-');
  return `${dia}/${m}/${a}`;
}

// Dueño del listado: "Ana López" o "Ana López +1" si hay más dueños.
export function textoDueno(dueno: DuenoTambo | null, adicionales: number): string {
  if (!dueno) return '—';
  return adicionales > 0 ? `${dueno.nombre} +${adicionales}` : dueno.nombre;
}

export const textoCantidad = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

export const MAX_MOTIVO = 200;
const MENSAJE_MOTIVO = 'Indicá el motivo de la baja (hasta 200 caracteres)';

// Motivo de la baja (RF-5): se recorta y tiene de 1 a 200 CARACTERES (Array.from cuenta un emoji como uno,
// igual que la API). Devuelve el texto ya recortado, listo para enviar.
export function validarMotivo(texto: string): { error: string | null; motivo: string } {
  const motivo = texto.trim();
  const largo = Array.from(motivo).length;
  return { error: largo >= 1 && largo <= MAX_MOTIVO ? null : MENSAJE_MOTIVO, motivo };
}

// Contraseña nueva (RF-25): mismas reglas y mensajes que passwordSchema de la API. No se recorta.
export function validarContrasenaNueva(valor: string): string | null {
  if (valor.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (valor.length > 128) return 'La contraseña es demasiado larga';
  return null;
}

// "12/11/2026 12:05": fecha y hora en horario de Argentina (RF-23); usa la función única de hora de Argentina.
export function formatearFechaHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : formatearFechaHoraArgentina(d);
}

// Último ingreso (RF-22): la fecha y hora, o "nunca ingresó".
export const textoUltimoIngreso = (iso: string | null): string => (iso ? formatearFechaHora(iso) : 'nunca ingresó');
