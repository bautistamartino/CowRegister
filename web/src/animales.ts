import type { EstadoAnimal, Rol, Sexo } from './api';

// Nombres en español y utilidades del lado del cliente para los animales.

export const NOMBRE_ESTADO: Record<EstadoAnimal, string> = {
  RECIEN_NACIDO: 'Recién nacido',
  VAQUILLONA: 'Vaquillona',
  EN_ORDENE: 'En ordeñe',
  SECA: 'Seca',
  BAJA: 'Baja',
};

export const NOMBRE_SEXO: Record<Sexo, string> = { HEMBRA: 'Hembra', MACHO: 'Macho' };

// Estados con los que se puede dar de alta un animal (BAJA nunca).
export const ESTADOS_INICIALES: EstadoAnimal[] = ['RECIEN_NACIDO', 'VAQUILLONA', 'EN_ORDENE', 'SECA'];

// Solo dueño y encargado cargan animales. La API es la que decide de verdad (403);
// acá solo se esconden los controles.
export function puedeCargar(rol: Rol): boolean {
  return rol !== 'VETERINARIO';
}

// Igual que normalizarNumero de la API (copia a propósito: son pocas líneas y la API
// siempre vuelve a validar). Devuelve null si el número no es válido.
// Se valida sobre el texto original y recién después se pasan las letras a mayúsculas.
export function normalizarNumero(texto: string): string | null {
  const limpio = texto.trim();
  if (limpio.length < 1 || limpio.length > 20) return null;
  if (!/^[A-Za-z0-9.-]+$/.test(limpio)) return null;
  return limpio.toUpperCase();
}

// "2024-03-05" -> "05/03/2024" (sin pasar por Date, para evitar corrimientos de zona horaria).
export function formatearFecha(iso: string | null): string {
  if (!iso) return 'sin dato';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// "1 animal" / "3 animales".
export function textoAnimales(cantidad: number): string {
  return `${cantidad} ${cantidad === 1 ? 'animal' : 'animales'}`;
}

// Mensaje de la spec 006 (RF-21) cuando dar de baja o revertir responde 404.
export const TEXTO_NO_DISPONIBLE =
  'El animal ya no está disponible para esta acción: otra persona pudo haberlo dado de baja o revertido. Se actualizó la pantalla.';

// "venta" -> "Venta", "muerte" -> "Muerte" (el motivo de las bajas viene en minúsculas).
export function nombreMotivo(motivo: string): string {
  return motivo === 'venta' ? 'Venta' : motivo === 'muerte' ? 'Muerte' : motivo;
}
