// Aviso de reloj atrasado (spec 012, RF-14 a RF-16). Lógica pura, con el reloj inyectado (no lee la hora real).
//
// Sin conexión la tablet no puede saber su error contra el servidor, salvo comparándose con la hora de la última copia
// (que viene del servidor). Un reloj ADELANTADO no se detecta: lo rechaza el servidor con "La fecha no puede ser futura".

export const MARGEN_RELOJ_MS = 5 * 60 * 1000;

export const TEXTO_RELOJ_ATRASADO = 'El reloj de la tablet parece atrasado: revisá que la fecha sea la correcta';
export const AYUDA_ELEGIR_FECHA = 'Elegí la fecha del evento';

// Verdadero si `ahora` es anterior a la hora de la copia por MÁS de 5 minutos (5 exactos no). Sin copia, no hay aviso.
export function relojAtrasado(ahora: Date, generadaEn: string | null | undefined): boolean {
  if (!generadaEn) return false;
  const copia = Date.parse(generadaEn);
  if (Number.isNaN(copia)) return false;
  return copia - ahora.getTime() > MARGEN_RELOJ_MS;
}

export type OpcionesFecha = {
  valorInicial: string; // lo que trae el campo al abrir el formulario
  max: string | undefined; // máximo del campo (undefined = sin máximo)
  obligatorio: boolean;
  ayuda: string | null;
};

// Qué recibe el campo fecha de un formulario de carga. Con el reloj bien: hoy (y máximo hoy). Atrasado, "hoy" no es
// confiable: el campo queda vacío, obligatorio y sin máximo, y se pide elegir la fecha. El mínimo no cambia.
export function opcionesFecha(atrasado: boolean, hoy: string): OpcionesFecha {
  if (atrasado) return { valorInicial: '', max: undefined, obligatorio: true, ayuda: AYUDA_ELEGIR_FECHA };
  return { valorInicial: hoy, max: hoy, obligatorio: true, ayuda: null };
}

// Qué fecha queda en un formulario cuando cambia el reloj (llegó una copia nueva). Si el usuario ya eligió una fecha
// distinta de la que traía el campo y no está vacía, se respeta; si no (vacía por el atraso, o sin tocar), se aplica
// la nueva por defecto.
export function fechaTrasCambioReloj(actual: string, inicialAnterior: string, inicialNueva: string): string {
  if (actual === '' || actual === inicialAnterior) return inicialNueva;
  return actual;
}
