// Quién es el dueño de los datos guardados en la tablet y qué hacer cuando ingresa otra persona
// (spec 009, RF-43 a RF-48). Lógica pura (sin React), probada con el almacén en memoria.
//
// Regla de oro: nunca queda a la vista ni enviable un dato de otro usuario o tambo. Por eso, antes de
// mostrar nada, se decide qué hacer con lo que haya guardado.

import type { Perfil } from '../compartido/api';
import type { Almacen, Propietario } from './almacen';

export type DecisionIngreso =
  // Mismo usuario y tambo, o no hay datos guardados: se conserva todo (copia y pendientes) y se sigue (RF-47).
  | { tipo: 'continuar' }
  // Datos de otro usuario o tambo SIN pendientes: se borran y se descarga la copia propia, sin preguntar (RF-46).
  | { tipo: 'reemplazarSinPreguntar' }
  // Datos de otro usuario o tambo CON pendientes: se avisa cuántos se perderían y se pide confirmación (RF-46).
  | { tipo: 'confirmarBorrado'; pendientes: number };

const mismo = (a: Propietario, b: Propietario) => a.usuarioId === b.usuarioId && a.establecimientoId === b.establecimientoId;

// `propietariosLocales`: de quién es cada dato guardado (copia, pendientes, enviados). `pendientes`: cuántos
// litros pendientes hay guardados en total (esperando, enviando o rechazados). Si algún dato es de otro, se
// decide como "otro": al borrar se borra todo, así que nunca se mezclan.
export function decidirIngreso(sesion: Propietario, propietariosLocales: Propietario[], pendientes: number): DecisionIngreso {
  if (propietariosLocales.every((p) => mismo(p, sesion))) return { tipo: 'continuar' };
  return pendientes > 0 ? { tipo: 'confirmarBorrado', pendientes } : { tipo: 'reemplazarSinPreguntar' };
}

// Lee lo guardado y decide (no borra nada: el borrado lo hace quien llama, tras la confirmación si hace falta).
export async function evaluarIngreso(almacen: Almacen, sesion: Propietario): Promise<DecisionIngreso> {
  const [meta, pendientes, enviados] = await Promise.all([almacen.leerMeta(), almacen.listarPendientes(), almacen.listarEnviados()]);
  const duenos: Propietario[] = [
    ...(meta ? [meta.propietario] : []),
    ...pendientes.map((p) => ({ usuarioId: p.usuarioId, establecimientoId: p.establecimientoId })),
    ...enviados.map((e) => ({ usuarioId: e.usuarioId, establecimientoId: e.establecimientoId })),
  ];
  return decidirIngreso(sesion, duenos, pendientes.length);
}

// Entrar sin conexión (la app abre y no llega al servidor): se usa el último perfil guardado, pero solo si los
// datos guardados son de ese mismo usuario y tambo. Si no coinciden no se puede pedir confirmación (hace falta
// el servidor para ingresar), así que no se entra y no se muestra ni se borra nada.
export async function perfilParaEntrarSinConexion(almacen: Almacen): Promise<Perfil | null> {
  const perfil = await almacen.leerPerfil();
  if (!perfil) return null;
  const decision = await evaluarIngreso(almacen, { usuarioId: perfil.id, establecimientoId: perfil.establecimiento.id });
  return decision.tipo === 'continuar' ? perfil : null;
}

// Cierre de sesión: intenta cerrar la del servidor y borra TODO lo local (copia, pendientes, enviados y perfil).
//  - `cerrarServidor` devuelve 'cerrado' o 'sin-red' (no se llegó al servidor, RF-45): en ambos casos se borra.
//  - Si el servidor responde con otro error, no se borra nada y el error sube (la sesión sigue abierta).
//  - Si falla el borrado local, el error sube para avisarlo: no se finge un cierre que no ocurrió.
export async function cerrarSesionLocal(args: {
  almacen: Almacen;
  cerrarServidor: () => Promise<'cerrado' | 'sin-red'>;
}): Promise<{ servidorCerrado: boolean }> {
  const resultado = await args.cerrarServidor();
  await args.almacen.borrarTodo();
  return { servidorCerrado: resultado === 'cerrado' };
}
