// Reglas de los números de animal (caravana / botón) para el buscador sin conexión (spec 009, RF-14).
//
// Son COPIAS de las funciones de la API (`normalizarNumero` en api/src/validacion.ts y
// `compararNumeros` en api/src/animales/orden.ts): la web no importa código de la API. Un test
// (web/tests/numeros.test.ts) compara las dos versiones y falla si alguna vez se separan.

const MAX_NUMERO = 20;

// Solo letras ASCII, dígitos, guion y punto.
const FORMATO_NUMERO = /^[A-Za-z0-9.-]+$/;

// Quita los extremos, valida los caracteres sobre el texto ORIGINAL y recién después pasa a
// mayúsculas (toUpperCase() convierte "ß" en "SS": si se pasara antes, entraría como válida).
// Devuelve null si el número no es válido.
export function normalizarNumero(texto: string): string | null {
  const limpio = texto.trim();
  if (limpio.length < 1 || limpio.length > MAX_NUMERO) return null;
  if (!FORMATO_NUMERO.test(limpio)) return null;
  return limpio.toUpperCase();
}

// Orden natural: los tramos de dígitos se comparan como números ("9" antes que "10", "A2" antes que
// "A10"). Si empatan, se desempata por el texto ("01" antes que "1").
const colador = new Intl.Collator('es', { numeric: true });

export function compararNumeros(a: string, b: string): number {
  return colador.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
