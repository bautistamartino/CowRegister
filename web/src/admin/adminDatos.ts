// Tipos, llamadas y lógica pura de las pantallas del administrador (spec 014).
// Las formas de las respuestas son la lista blanca de la API (api/src/admin/listaBlanca.ts).
// IMPORTANTE: acá no se importa nada de `sinconexion/` salvo la hora de Argentina (función pura):
// el administrador no usa la copia local.

import { api } from '../compartido/api';
import { fechaIsoArgentina } from '../sinconexion/horaArgentina';

export type DuenoTambo = { nombre: string; email: string };

export type ItemTambo = {
  id: string;
  nombre: string;
  creadoEn: string;
  dueno: DuenoTambo | null;
  duenosAdicionales: number;
  usuariosActivos: number;
  animalesActivos: number;
};

export type UsuarioTambo = { nombre: string; email: string; rol: 'DUENO' | 'ENCARGADO' | 'VETERINARIO'; activo: boolean };
export type DetalleTambo = ItemTambo & { usuarios: UsuarioTambo[] };

export type DatosTamboNuevo = { nombreEstablecimiento: string; nombre: string; email: string; password: string };

export const listarTambos = () => api<ItemTambo[]>('/admin/tambos');
export const obtenerTambo = (id: string) => api<DetalleTambo>(`/admin/tambos/${encodeURIComponent(id)}`);
export const crearTambo = (datos: DatosTamboNuevo) => api<ItemTambo>('/admin/tambos', { method: 'POST', body: datos });

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
