// Cifras de la carga de litros sin conexión (spec 009). Están juntas para poder cambiarlas en un solo lugar
// y para que los tests las reemplacen por valores chicos.

// Máximo de pendientes (esperando, enviando o rechazados) en la tablet (RF-22).
export const MAX_PENDIENTES = 500;

// Con señal, cuánto se espera la confirmación del servidor antes de dejar la carga como pendiente (RF-24).
export const ESPERA_CARGA_MS = 10_000;

// Tiempo máximo de un envío en segundo plano de un pendiente. Es más holgado que el anterior: nadie
// está esperando mirando la pantalla, y cortar de más solo genera reintentos innecesarios.
export const ESPERA_ENVIO_MS = 30_000;

// Esperas crecientes entre reintentos automáticos de un pendiente que no se pudo enviar (RF-32):
// 5 s, 15 s, 45 s, 2 min y 5 min (tope).
const ESPERAS_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

// Cuánto esperar antes del próximo intento, según cuántos envíos fallaron ya (1 = el primero que falló).
export function esperaTrasFallo(intentos: number): number {
  const posicion = Math.min(Math.max(intentos, 1), ESPERAS_MS.length) - 1;
  return ESPERAS_MS[posicion]!;
}
