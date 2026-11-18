// Acceso a la copia local para `api()` (spec 009). Lee del almacén y guarda las fichas en
// memoria, así mirar una ficha tras otra no relee todo IndexedDB cada vez.
//
// La memoria se descarta sola cuando cambia la fecha de la copia ("al día de"): una copia nueva,
// o ninguna (cierre de sesión), invalida lo guardado.

import type { Almacen, Propietario, SemenCopia } from './almacen';
import type { CopiaEnMemoria } from './copiaLocal';
import { obtenerAlmacen } from './almacenIndexedDb';
import type { ContextoFicha } from './fichaLocal';

// Usuario y tambo de la sesión actual. Solo se muestra una copia que sea de ESTE usuario y tambo
// (RF-17); la registra el SinConexionProvider al haber sesión.
let propietarioActual: Propietario | null = null;
// Nombre del usuario de la sesión: figura como "registrado por" en los eventos pendientes (spec 011, RF-20).
let nombreUsuarioActual = '';

export function fijarPropietarioLocal(propietario: Propietario | null, usuarioNombre = ''): void {
  propietarioActual = propietario;
  nombreUsuarioActual = usuarioNombre;
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
  memoria = { generadaEn: meta.generadaEn, lotes: meta.lotes, animales, semen: meta.semen };
  return memoria;
}

// Todo lo que necesita el adaptador de la ficha (spec 011): la copia más los pendientes y enviados DEL usuario y tambo
// de la sesión. Devuelve null si no hay sesión o copia utilizable, o si el almacén falla (entonces se usa el camino de siempre).
export async function leerContextoFicha(almacen: Almacen = obtenerAlmacen()): Promise<ContextoFicha | null> {
  const persona = propietarioActual;
  if (!persona) return null;
  try {
    const copia = await leerCopiaLocal(almacen);
    if (!copia) return null;
    const suyo = <T extends Propietario>(x: T) => x.usuarioId === persona.usuarioId && x.establecimientoId === persona.establecimientoId;
    const [pendientes, enviados] = await Promise.all([almacen.listarPendientes(), almacen.listarEnviados()]);
    return {
      animales: copia.animales,
      pendientes: pendientes.filter(suyo).sort((a, b) => a.orden - b.orden),
      enviados: enviados.filter(suyo),
      semen: copia.semen ?? [],
      usuarioNombre: nombreUsuarioActual,
    };
  } catch {
    return null;
  }
}

// Semen y toros ACTIVOS de la copia (para el formulario de servicio sin conexión), o null si no hay copia o es una
// copia vieja que no lo trae. El catálogo completo (/semen) sigue necesitando conexión: por eso no pasa por `api()`.
export async function leerSemenActivoLocal(almacen: Almacen = obtenerAlmacen()): Promise<SemenCopia[] | null> {
  const copia = await leerCopiaLocal(almacen).catch(() => null);
  return copia?.semen ?? null;
}
