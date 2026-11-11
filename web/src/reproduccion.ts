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

// Fecha de hoy de este dispositivo como AAAA-MM-DD (valor inicial de los formularios).
// La API es la que valida de verdad contra la hora de Argentina.
export function hoyIso(): string {
  const h = new Date();
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${h.getFullYear()}-${dos(h.getMonth() + 1)}-${dos(h.getDate())}`;
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
