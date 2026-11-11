import type { EstadoAnimal } from '../generated/prisma/client.js';

// Estados que pueden tener un lote destino (ReglaLote). BAJA queda afuera:
// un animal vendido o muerto sale de los lotes (la base lo garantiza con el
// CHECK "reglas_lote_sin_baja"). El orden es el que se muestra en pantalla.
export const ESTADOS_CON_DESTINO = ['RECIEN_NACIDO', 'VAQUILLONA', 'EN_ORDENE', 'SECA'] as const;

export type EstadoConDestino = (typeof ESTADOS_CON_DESTINO)[number];

// Nombre en español de cada estado, para los mensajes al usuario
// (por ejemplo "El lote es destino de En ordeñe").
export const NOMBRE_ESTADO: Record<EstadoAnimal, string> = {
  RECIEN_NACIDO: 'Recién nacido',
  VAQUILLONA: 'Vaquillona',
  EN_ORDENE: 'En ordeñe',
  SECA: 'Seca',
  BAJA: 'Baja',
};
