import { prisma } from '../db.js';
import { SELECT_USUARIO_DETALLE } from './listaBlanca.js';

// Lectura de los tambos COMO CUENTAS para el administrador (spec 014, RF-16 a RF-20).
// Lo único que se consulta del trabajo del tambo es el conteo de animales activos.

export interface ItemTambo {
  id: string;
  nombre: string;
  creadoEn: Date;
  dueno: { nombre: string; email: string } | null;
  duenosAdicionales: number;
  usuariosActivos: number;
  animalesActivos: number;
}

export interface DetalleTambo extends ItemTambo {
  usuarios: { nombre: string; email: string; rol: string; activo: boolean }[];
}

/**
 * ÚNICA consulta sobre datos del tambo permitida al administrador: cuántos animales activos
 * (estado distinto de BAJA) tiene cada tambo. Devuelve un mapa tambo -> cantidad (los tambos sin
 * animales no aparecen: quien lo usa toma 0).
 */
export async function contarAnimalesActivos(establecimientoIds: string[]): Promise<Map<string, number>> {
  const filas = await prisma.animal.groupBy({
    by: ['establecimientoId'],
    where: { establecimientoId: { in: establecimientoIds }, estado: { not: 'BAJA' } },
    _count: { _all: true },
  });
  return new Map(filas.map((f) => [f.establecimientoId, f._count._all]));
}

type UsuarioLeido = { nombre: string; email: string; rol: string; activo: boolean };

// Arma el ítem del listado a partir de los usuarios del tambo (ya ordenados del más antiguo al más nuevo).
function armarItem(
  tambo: { id: string; nombre: string; creadoEn: Date },
  usuarios: UsuarioLeido[],
  animalesActivos: number,
): ItemTambo {
  const duenos = usuarios.filter((u) => u.rol === 'DUENO');
  return {
    id: tambo.id,
    nombre: tambo.nombre,
    creadoEn: tambo.creadoEn,
    dueno: duenos[0] ? { nombre: duenos[0].nombre, email: duenos[0].email } : null,
    duenosAdicionales: Math.max(duenos.length - 1, 0),
    usuariosActivos: usuarios.filter((u) => u.activo).length,
    animalesActivos,
  };
}

// Orden de usuarios: del más antiguo al más nuevo (el id desempata; es UUID v7 y crece con el tiempo).
const ORDEN_USUARIOS = [{ creadoEn: 'asc' as const }, { id: 'asc' as const }];

const SELECT_TAMBO = {
  id: true,
  nombre: true,
  creadoEn: true,
  usuarios: { select: SELECT_USUARIO_DETALLE, orderBy: ORDEN_USUARIOS },
} as const;

// Listado completo, ordenado por nombre y sin paginación (RF-17).
export async function listarTambos(): Promise<ItemTambo[]> {
  const tambos = await prisma.establecimiento.findMany({ select: SELECT_TAMBO });
  const animales = await contarAnimalesActivos(tambos.map((t) => t.id));
  return tambos
    .map((t) => armarItem(t, t.usuarios, animales.get(t.id) ?? 0))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

// Detalle de un tambo con todos sus usuarios (activos o no). null si no existe.
export async function detalleTambo(id: string): Promise<DetalleTambo | null> {
  const tambo = await prisma.establecimiento.findUnique({ where: { id }, select: SELECT_TAMBO });
  if (!tambo) return null;
  const animales = await contarAnimalesActivos([id]);
  return {
    ...armarItem(tambo, tambo.usuarios, animales.get(id) ?? 0),
    // Se arma cada usuario con las 4 claves de la lista blanca (sin creadoEn).
    usuarios: tambo.usuarios.map(({ nombre, email, rol, activo }) => ({ nombre, email, rol, activo })),
  };
}

// Un solo tambo con la forma del listado (lo que devuelve el alta).
export async function itemTambo(id: string): Promise<ItemTambo | null> {
  const detalle = await detalleTambo(id);
  if (!detalle) return null;
  const { usuarios: _usuarios, ...item } = detalle;
  return item;
}
