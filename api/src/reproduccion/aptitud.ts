import type { EstadoAnimal, Sexo } from '../generated/prisma/client.js';

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
