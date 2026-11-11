import type { EstadoReproductivo, EventoReproductivo, TipoServicio } from './api';
import { formatearFecha } from './animales';

// Textos y utilidades de la parte reproductiva (spec 003).

export const NOMBRE_ESTADO_REPRODUCTIVO: Record<EstadoReproductivo, string> = {
  SIN_SERVICIO: 'Sin servicio',
  SERVIDA: 'Servida (sin tacto)',
  PRENADA: 'Preñada',
  VACIA: 'Vacía',
};

export const NOMBRE_TIPO_SERVICIO: Record<TipoServicio, string> = {
  INSEMINACION: 'Inseminación',
  MONTA_NATURAL: 'Monta natural',
};

// "faltan 12 días", "es hoy", "venció hace 3 días".
export function textoDias(dias: number): string {
  if (dias === 0) return 'es hoy';
  const n = Math.abs(dias);
  const d = `${n} ${n === 1 ? 'día' : 'días'}`;
  return dias > 0 ? `faltan ${d}` : `venció hace ${d}`;
}

const ZONA = 'America/Argentina/Buenos_Aires';

// AAAA-MM-DD de un instante en hora de Argentina (el locale en-CA ya da ese formato).
export function fechaArgentinaIso(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Hoy en Argentina como AAAA-MM-DD (valor inicial y tope de los formularios).
// La API es la que valida de verdad.
export function hoyIso(): string {
  return fechaArgentinaIso(new Date());
}

// Cota mínima de las fechas de servicio y tacto (RF de validación de la spec).
export const FECHA_MINIMA = '2000-01-01';

// Suma días a una fecha AAAA-MM-DD (en UTC, sin corrimientos de zona).
export function sumarDiasIso(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Resumen de una línea de un evento para la lista.
export function resumenEvento(e: EventoReproductivo): string {
  if (e.servicio) {
    const tipo = NOMBRE_TIPO_SERVICIO[e.servicio.tipoServicio];
    return `Servicio · ${tipo} · ${e.servicio.semen ? e.servicio.semen.nombre : 'semen no especificado'}`;
  }
  if (e.tacto) {
    const base = `Tacto · ${e.tacto.resultado === 'PRENADA' ? 'Preñada' : 'Vacía'}`;
    return e.tacto.resultado === 'PRENADA' && e.tacto.fechaProbable
      ? `${base} · parto probable ${formatearFecha(e.tacto.fechaProbable)}`
      : base;
  }
  return e.tipo;
}
