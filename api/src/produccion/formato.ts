// Litros y décimas (spec 008, RF-37). Los litros se guardan y se suman como ENTEROS en décimas
// (12,5 L = 125): con enteros no hay errores de coma flotante (0,1 + 0,2 da exactamente 0,3).

// Décimas enteras -> litros con un decimal (125 -> 12.5). Dividir un entero chico por 10 da el
// double más cercano al valor decimal, que JSON muestra con un solo decimal.
export function decimasALitros(decimas: number): number {
  return decimas / 10;
}

/**
 * Promedio `suma / base` redondeado a una décima, con el medio punto hacia arriba, calculado solo
 * con enteros: floor((2·suma + base) / (2·base)). Devuelve décimas (se muestra con
 * `decimasALitros`) o `null` si no hay base de cálculo ("—", nunca 0).
 * Ejemplo: 24,5 L en 2 vaca-días = 245 décimas / 2 -> 122,5 -> 123 (12,3 L).
 */
export function redondearDecimas(sumaDecimas: number, base: number): number | null {
  if (base <= 0) return null;
  return Math.floor((2 * sumaDecimas + base) / (2 * base));
}
