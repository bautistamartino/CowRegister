import { hoyArgentina } from '../animales/reglas.js';

// Fecha y turno que la pantalla propone al cargar (spec 008, RF-30). Lo calcula la API (y no el
// navegador) para no depender de la zona horaria del dispositivo y poder probarlo con el reloj
// inyectable: la fecha es el hoy argentino; mañana antes de las 14:00 (hora de Argentina) y tarde
// desde las 14:00.
export const HORA_CAMBIO_TURNO = 14;

export function sugerirOrdeno(instante: Date): { fecha: string; turno: 'manana' | 'tarde' } {
  const hora = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hourCycle: 'h23' }).format(instante),
  );
  return { fecha: hoyArgentina(instante), turno: hora < HORA_CAMBIO_TURNO ? 'manana' : 'tarde' };
}
