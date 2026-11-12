// Topes de lectura (spec 007): cuántas entradas del historial y cuántas filas de detalle de un
// informe se devuelven como máximo. Siguen el mismo esquema que `reloj.ts`: valores fijos en
// producción y un setter SOLO para los tests, para probar el corte sin crear miles de filas.
// No se lee de una variable de entorno ni de la petición: así no hay forma de cambiarlos desde
// afuera en producción.
const HISTORIAL = 500;
const INFORME = 2000;
const PRODUCCION_FICHA = 200; // registros de producción en la ficha de una vaca (spec 008)

type Topes = { historial?: number; informe?: number; produccionFicha?: number };
let fijos: Topes | null = null;

// Máximo de entradas del historial de un animal.
export function topeHistorial(): number {
  return fijos?.historial ?? HISTORIAL;
}

// Máximo de filas del detalle de un informe.
export function topeInforme(): number {
  return fijos?.informe ?? INFORME;
}

// Máximo de registros de producción que muestra la ficha de una vaca (los más recientes).
export function topeProduccionFicha(): number {
  return fijos?.produccionFicha ?? PRODUCCION_FICHA;
}

// Fija los topes (o los suelta con null). Solo para tests.
export function fijarTopes(topes: Topes | null): void {
  fijos = topes;
}
