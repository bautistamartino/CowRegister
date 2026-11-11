// Orden natural de números de animal (RF-23): los tramos de dígitos se comparan
// como números ("9" antes que "10", "A2" antes que "A10"). Si empatan, se
// desempata alfabéticamente por el texto ("01" antes que "1").
const colador = new Intl.Collator('es', { numeric: true });

export function compararNumeros(a: string, b: string): number {
  return colador.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
