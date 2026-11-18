// Baja pendiente en el listado y el buscador (spec 012, RF-5 a RF-7). Lógica pura.
//
// En el listado y el buscador solo se marca la baja pendiente (decisión del usuario): servicios, tactos, partos,
// secados y anulaciones se ven en la ficha y el historial. Las crías de un parto pendiente no existen como animales
// (ni en la copia ni en el servidor), así que nunca aparecen acá.

import type { Animal, AnimalCopia } from '../compartido/api';
import type { Enviado, Pendiente } from './almacen';
import { estadoVisible } from './dependencias';
import { compararNumeros, normalizarNumero } from './numeros';

// Ids de los animales con una baja que cuenta (esperando o enviando; NO "en espera del anterior" ni rechazada, como
// la vista local de la 010) o con una baja enviada que la copia todavía no refleja. `pendientes` y `enviados` son los
// del usuario y tambo de la sesión.
export function animalesConBajaPendiente(pendientes: Pendiente[], enviados: Enviado[]): Set<string> {
  const ids = new Set<string>();
  for (const p of pendientes) {
    if (p.tipo !== 'BAJA') continue;
    const visible = estadoVisible(p, pendientes);
    if (visible === 'esperando' || visible === 'enviando') ids.add(p.animalId);
  }
  for (const e of enviados) {
    if (e.tipo === 'BAJA') ids.add(e.animalId);
  }
  return ids;
}

// Agrega `bajaPendiente: true` a las filas indicadas; las demás quedan idénticas. Al resolverse la baja (se descarta
// o la copia nueva la refleja) el id deja de estar en el conjunto y la marca se va sola.
export function marcarListado(listado: Animal[], ids: Set<string>): Animal[] {
  return listado.map((a) => (ids.has(a.id) ? { ...a, bajaPendiente: true } : a));
}

// Filtros del listado, tal como los maneja la pantalla: '' = sin filtro; loteId puede ser 'sin-lote'.
export type FiltrosListado = { estado: string; loteId: string };

// Con señal, el servidor ya no trae al animal cuya baja se aceptó (allá ya está de baja). Mientras la copia siga
// trayéndolo, se lo vuelve a sumar desde la copia (respetando los filtros), marcado y en orden numérico, para que
// "Baja pendiente de sincronizar" se vea con y sin conexión (RF-5). Sin señal el listado sale de la copia y ya lo trae.
export function completarConBajasEnviadas(listado: Animal[], enviados: Enviado[], animalesCopia: AnimalCopia[], filtros: FiltrosListado): Animal[] {
  const conBaja = new Set(enviados.filter((e) => e.tipo === 'BAJA').map((e) => e.animalId));
  if (conBaja.size === 0) return listado;
  const yaEstan = new Set(listado.map((a) => a.id));
  const sumados: Animal[] = animalesCopia
    .filter((a) => {
      const f = a.ficha;
      if (!conBaja.has(f.id) || yaEstan.has(f.id)) return false;
      if (filtros.estado !== '' && f.estado !== filtros.estado) return false;
      if (filtros.loteId === 'sin-lote') return f.lote === null;
      return filtros.loteId === '' || f.lote?.id === filtros.loteId;
    })
    .map((a) => ({
      id: a.ficha.id,
      numero: a.ficha.numero,
      sexo: a.ficha.sexo,
      estado: a.ficha.estado,
      lote: a.ficha.lote ? { nombre: a.ficha.lote.nombre } : null,
      bajaPendiente: true,
    }));
  if (sumados.length === 0) return listado;
  return [...listado, ...sumados].sort((a, b) => compararNumeros(a.numero, b.numero));
}

// Buscador: ante un 404 del servidor, el id del animal cuyo número tiene una baja ENVIADA local (para ir a su ficha,
// que ya dice "Baja enviada"). null si el número no es válido o no hay ninguna.
export function animalConBajaEnviada(numero: string, enviados: Enviado[]): string | null {
  const buscado = normalizarNumero(numero);
  if (!buscado) return null;
  const e = enviados.find((x) => x.tipo === 'BAJA' && normalizarNumero(x.numero) === buscado);
  return e ? e.animalId : null;
}
