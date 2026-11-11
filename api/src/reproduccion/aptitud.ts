import type { EstadoAnimal, Sexo } from '../generated/prisma/client.js';
import { NOMBRE_ESTADO } from '../lotes/estados.js';

export type Aptitud = { ok: true } | { ok: false; motivo: string };

// ¿Puede el animal recibir un servicio o un tacto? Solo hembras en estado vaquillona, en
// ordeñe o seca (RF-10, RF-12). Si no, devuelve el motivo en español para el 409.
export function puedeRecibirEventoReproductivo(sexo: Sexo, estado: EstadoAnimal): Aptitud {
  if (sexo === 'MACHO') return { ok: false, motivo: 'Un macho no admite servicios ni tactos' };
  if (estado === 'RECIEN_NACIDO') {
    return { ok: false, motivo: 'Una recién nacida todavía no admite servicios ni tactos' };
  }
  if (estado === 'BAJA') return { ok: false, motivo: 'Un animal dado de baja no admite servicios ni tactos' };
  return { ok: true };
}

// ¿Puede el animal parir? Solo hembras en estado vaquillona, en ordeñe o seca (spec 004, RF-9).
// Una recién nacida todavía no es madre posible, y un macho nunca.
export function puedeParir(sexo: Sexo, estado: EstadoAnimal): Aptitud {
  if (sexo === 'MACHO') return { ok: false, motivo: 'Un macho no admite partos' };
  if (estado === 'RECIEN_NACIDO') return { ok: false, motivo: 'Una recién nacida todavía no admite partos' };
  if (estado === 'BAJA') return { ok: false, motivo: 'Un animal dado de baja no admite partos' };
  return { ok: true };
}

// ¿Puede secarse? Solo una hembra "en ordeñe" (RF-19). El motivo dice el estado actual.
export function puedeSecarse(sexo: Sexo, estado: EstadoAnimal): Aptitud {
  if (sexo === 'MACHO') return { ok: false, motivo: 'Un macho no admite secados' };
  if (estado !== 'EN_ORDENE') {
    return { ok: false, motivo: `Solo se puede secar una vaca en ordeñe: esta está en estado «${NOMBRE_ESTADO[estado].toLowerCase()}»` };
  }
  return { ok: true };
}
