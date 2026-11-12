// Hora de Argentina calculada desde el reloj del dispositivo (spec 009, RF-21).
//
// Sin conexión no hay servidor que proponga la fecha y el turno del ordeño, así que se calculan con la
// hora de la tablet. Argentina no tiene horario de verano: es siempre UTC-3, y por eso la cuenta es una
// resta fija (más simple y más fácil de probar que depender del huso del navegador).

const MS_UNA_HORA = 60 * 60 * 1000;
const DESFASE_ARGENTINA_MS = -3 * MS_UNA_HORA;
export const HORA_CORTE_TARDE = 14; // mañana antes de las 14:00, tarde desde las 14:00 (spec 008)

// "Reloj de pared" argentino: un Date cuyos campos UTC (getUTCHours, etc.) son la hora de Argentina.
function relojArgentino(ahora: Date): Date {
  return new Date(ahora.getTime() + DESFASE_ARGENTINA_MS);
}

const dos = (n: number) => String(n).padStart(2, '0');

// Fecha (AAAA-MM-DD) y turno propuestos para cargar litros ahora.
export function fechaYTurnoArgentina(ahora: Date): { fecha: string; turno: 'manana' | 'tarde' } {
  const r = relojArgentino(ahora);
  const fecha = `${r.getUTCFullYear()}-${dos(r.getUTCMonth() + 1)}-${dos(r.getUTCDate())}`;
  return { fecha, turno: r.getUTCHours() < HORA_CORTE_TARDE ? 'manana' : 'tarde' };
}

// Hora de la tablet como la espera la API en `cargadoEnDispositivo`: "2026-11-12T08:15:00-03:00".
// Es solo informativa (RF-26): el servidor guarda aparte su propia hora.
export function horaParaApi(ahora: Date): string {
  const r = relojArgentino(ahora);
  return `${r.getUTCFullYear()}-${dos(r.getUTCMonth() + 1)}-${dos(r.getUTCDate())}T${dos(r.getUTCHours())}:${dos(r.getUTCMinutes())}:${dos(r.getUTCSeconds())}-03:00`;
}
