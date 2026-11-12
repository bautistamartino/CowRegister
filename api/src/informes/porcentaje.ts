// Porcentaje entero con el medio punto hacia arriba (spec 007). `null` si no hay base: la pantalla
// muestra "—" (nunca 0 % ni 100 %).
//
// Se hace con enteros a propósito: floor((200 n + d) / 2 d) = round(100 n / d) con el .5 hacia arriba,
// sin los errores de la coma flotante (1 de 8 = 12,5 % da 13; 2 de 3 = 66,67 % da 67).
export function porcentajeEntero(n: number, d: number): number | null {
  if (d === 0) return null;
  return Math.floor((200 * n + d) / (2 * d));
}
