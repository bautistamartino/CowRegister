// Qué enviados ya refleja la copia local (spec 010, RF-19). Lógica pura, más la limpieza tras actualizar la copia.
//
// Un pendiente que el servidor aceptó pasa a ser un ENVIADO y se sigue viendo en la vista local (vistaLocal.ts)
// hasta que una copia nueva lo trae: así no desaparece de la pantalla en el medio. Recién entonces se quita:
//
//   servicio, tacto, parto y secado : la copia trae el evento con su `id`.
//   anulación                       : la copia trae ese evento ya anulado.
//   baja                            : la copia ya no incluye al animal (la copia solo trae animales activos, así
//                                     que un animal ausente significa baja).
//   litros                          : la copia trae el registro con su `id`, como en la 009.
//
// Además se quita cuando el animal ya no está en la copia (cualquiera sea el tipo) o cuando la copia es de un
// momento POSTERIOR a la aceptación y no lo trae (por ejemplo, otro dispositivo revirtió la baja y el animal volvió
// a estar activo). "Posterior" se mide con un margen de 10 minutos: la copia toma su foto un instante antes de
// poner su `generadaEn`, y sin margen un evento aceptado en esa ventana se daría por reflejado sin estarlo. La
// comparación es entre dos horas del SERVIDOR (`aceptadoEn` y `generadaEn`): el reloj de la tablet no interviene.

import type { AnimalCopia } from '../compartido/api';
import type { Almacen, Enviado } from './almacen';
import { enviadosDe, type Persona } from './cola';

export const MARGEN_REFLEJO_MS = 10 * 60 * 1000;

export type CopiaParaReflejo = { generadaEn: string; animales: AnimalCopia[] };

// ¿La copia ya refleja este enviado (o ya no tiene sentido mostrarlo)?
export function estaReflejado(enviado: Enviado, copia: CopiaParaReflejo): boolean {
  const animal = copia.animales.find((a) => a.ficha.id === enviado.animalId);
  // Ya no está entre los activos (por ejemplo, se vendió): no hay nada que mostrar. Para una baja es justo el criterio.
  if (!animal) return true;

  switch (enviado.tipo) {
    case 'SERVICIO':
    case 'TACTO':
    case 'PARTO':
    case 'SECADO':
      if (animal.eventos.eventos.some((e) => e.id === enviado.id)) return true;
      break;
    case 'ANULACION':
      if (animal.eventos.eventos.some((e) => e.id === enviado.datos.eventoId && e.anulacion !== null)) return true;
      break;
    case 'LITROS':
      if (animal.produccion.registros.some((r) => r.id === enviado.id)) return true;
      break;
    case 'BAJA':
      break; // el animal está en la copia: no se refleja todavía (salvo por antigüedad)
  }
  // No lo trae, pero la copia es bastante posterior a su aceptación: otro dispositivo lo revirtió o quedó fuera.
  return Date.parse(copia.generadaEn) - enviado.aceptadoEn > MARGEN_REFLEJO_MS;
}

// Los enviados que la copia ya refleja.
export function enviadosReflejados(enviados: Enviado[], copia: CopiaParaReflejo): Enviado[] {
  return enviados.filter((e) => estaReflejado(e, copia));
}

// Tras actualizar la copia: quita del almacén los enviados de la persona que la copia nueva ya refleja.
export async function limpiarEnviadosReflejados(almacen: Almacen, persona: Persona): Promise<void> {
  const meta = await almacen.leerMeta();
  if (!meta) return;
  const enviados = await enviadosDe(almacen, persona);
  if (enviados.length === 0) return;
  const animales = await almacen.leerAnimales();
  const quitar = enviadosReflejados(enviados, { generadaEn: meta.generadaEn, animales });
  if (quitar.length > 0) await almacen.borrarEnviados(quitar.map((e) => e.id));
}
