// Reloj inyectable (spec 003). Solo gobierna el "hoy" de las reglas de fecha ("no futura",
// días que faltan para el parto): en producción es la hora real; los tests lo fijan con
// fijarReloj() para probar, por ejemplo, las 22:00 de Argentina (que ya es otro día en UTC).
// Las marcas de registro y de anulación NO usan este reloj: siempre son la hora real.
// No hay forma de cambiarlo desde la API (una cabecera o variable de entorno abriría un hueco
// para saltarse la regla de fechas en producción).
let fijo: Date | null = null;

export function ahora(): Date {
  return fijo ?? new Date();
}

// Fija el instante "actual" (o lo suelta con null). Solo para tests.
export function fijarReloj(fecha: Date | null): void {
  fijo = fecha;
}
