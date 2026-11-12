// Acceso a la copia local para `api()` (spec 009). Lee del almacén y guarda las fichas en
// memoria, así mirar una ficha tras otra no relee todo IndexedDB cada vez.
//
// La memoria se descarta sola cuando cambia la fecha de la copia ("al día de"): una copia nueva,
// o ninguna (cierre de sesión), invalida lo guardado.

import type { Almacen, Propietario } from './almacen';
import type { CopiaEnMemoria } from './copiaLocal';
import { obtenerAlmacen } from './almacenIndexedDb';

// Usuario y tambo de la sesión actual. Solo se muestra una copia que sea de ESTE usuario y tambo
// (RF-17); la registra el SinConexionProvider al haber sesión.
let propietarioActual: Propietario | null = null;

export function fijarPropietarioLocal(propietario: Propietario | null): void {
  propietarioActual = propietario;
  memoria = null; // al cambiar de sesión no se reutiliza nada
}

let memoria: CopiaEnMemoria | null = null;

// Devuelve la copia de la sesión actual, o null si no hay o es de otro usuario o tambo.
export async function leerCopiaLocal(almacen: Almacen = obtenerAlmacen()): Promise<CopiaEnMemoria | null> {
  if (!propietarioActual) return null;
  const meta = await almacen.leerMeta().catch(() => null);
  if (!meta) {
    memoria = null;
    return null;
  }
  if (meta.propietario.usuarioId !== propietarioActual.usuarioId || meta.propietario.establecimientoId !== propietarioActual.establecimientoId) {
    return null;
  }
  if (memoria && memoria.generadaEn === meta.generadaEn) return memoria;
  const animales = await almacen.leerAnimales();
  memoria = { generadaEn: meta.generadaEn, lotes: meta.lotes, animales };
  return memoria;
}
