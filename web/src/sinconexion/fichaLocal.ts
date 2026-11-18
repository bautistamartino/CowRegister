// Decide si una lectura de la ficha sale de la VISTA LOCAL (copia + pendientes) o del servidor (spec 011, RF-18).
// Lógica pura: sin React, sin red ni almacén. `api.ts` le pasa lo que leyó y esta función responde con los datos
// (en la misma forma que la API) o con `null` cuando la lectura NO es de este tipo o tiene que ir al servidor.
//
// Las tres lecturas que pasan por acá:
//   GET /animales/:id            ficha
//   GET /animales/:id/eventos    situación reproductiva y eventos
//   GET /animales/:id/historial  historial
// El listado, el buscador, la producción y las bajas siguen como en la spec 009.

import type { AnimalCopia } from '../compartido/api';
import type { Enviado, Pendiente, SemenCopia } from './almacen';
import { armarFichaLocal, decidirFuente } from './adaptadorFicha';
import { fechaIsoArgentina } from './horaArgentina';

export type ContextoFicha = {
  animales: AnimalCopia[]; // los de la copia
  pendientes: Pendiente[]; // solo los del usuario y tambo de la sesión
  enviados: Enviado[];
  semen: SemenCopia[];
  usuarioNombre: string;
};

export type RutaDeFicha = { animalId: string; parte: 'ficha' | 'eventos' | 'historial' };

// Reconoce las tres rutas. `/animales/buscar` NO es una ficha.
export function rutaDeFicha(metodo: string, ruta: string): RutaDeFicha | null {
  if (metodo.toUpperCase() !== 'GET') return null;
  const tramos = new URL(ruta, 'http://local').pathname.split('/').filter((t) => t !== '');
  if (tramos[0] !== 'animales' || tramos.length < 2 || tramos.length > 3 || tramos[1] === 'buscar') return null;
  let animalId: string;
  try {
    animalId = decodeURIComponent(tramos[1]!);
  } catch {
    animalId = tramos[1]!;
  }
  if (tramos.length === 2) return { animalId, parte: 'ficha' };
  if (tramos[2] === 'eventos') return { animalId, parte: 'eventos' };
  if (tramos[2] === 'historial') return { animalId, parte: 'historial' };
  return null;
}

export function resolverFichaLocal(metodo: string, ruta: string, enLinea: boolean, ctx: ContextoFicha, ahora: Date): unknown | null {
  const r = rutaDeFicha(metodo, ruta);
  if (!r) return null;
  if (decidirFuente({ enLinea, animalId: r.animalId, pendientes: ctx.pendientes }) === 'servidor') return null;
  // Un animal que no está en la copia no tiene vista local: lo resuelve el camino de siempre (error "no está en la tablet").
  const copia = ctx.animales.find((a) => a.ficha.id === r.animalId);
  if (!copia) return null;
  const vista = armarFichaLocal({
    copia,
    pendientes: ctx.pendientes,
    enviados: ctx.enviados,
    semen: ctx.semen,
    usuarioNombre: ctx.usuarioNombre,
    hoy: fechaIsoArgentina(ahora),
  });
  return r.parte === 'ficha' ? vista.ficha : r.parte === 'eventos' ? vista.eventos : vista.historial;
}
