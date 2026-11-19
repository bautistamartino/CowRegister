import { prisma } from '../db.js';
import { SELECT_USUARIO_DETALLE } from './listaBlanca.js';

// Lectura de los tambos COMO CUENTAS para el administrador (spec 014, RF-16 a RF-20; spec 015 suma
// el estado y el último ingreso). Lo único que se consulta del trabajo del tambo es el conteo de
// animales activos.

export type FiltroEstado = 'todos' | 'activos' | 'baja';

// La baja o reactivación vigente: la fila más reciente del registro del tambo.
export interface CambioEstado {
  tipo: 'BAJA' | 'REACTIVACION';
  por: string; // nombre del administrador
  en: Date;
  motivo: string | null; // nulo en las reactivaciones
}

export interface ItemTambo {
  id: string;
  nombre: string;
  creadoEn: Date;
  dueno: { nombre: string; email: string } | null;
  duenosAdicionales: number;
  usuariosActivos: number;
  animalesActivos: number;
  estado: 'ACTIVO' | 'BAJA';
  ultimoCambioEstado: CambioEstado | null;
  ultimoIngreso: Date | null;
}

export interface UsuarioDetalle {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  ultimoIngreso: Date | null;
}

export interface DetalleTambo extends ItemTambo {
  usuarios: UsuarioDetalle[];
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

type UsuarioLeido = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
  ultimoIngresoEn: Date | null;
};

type TamboLeido = {
  id: string;
  nombre: string;
  creadoEn: Date;
  estado: 'ACTIVO' | 'BAJA';
  registrosEstado: { tipo: 'BAJA' | 'REACTIVACION'; motivo: string | null; creadoEn: Date; administrador: { nombre: string } }[];
};

// Arma el ítem del listado a partir de los usuarios del tambo (ya ordenados del más antiguo al más nuevo).
function armarItem(tambo: TamboLeido, usuarios: UsuarioLeido[], animalesActivos: number): ItemTambo {
  const duenos = usuarios.filter((u) => u.rol === 'DUENO');
  const cambio = tambo.registrosEstado[0];
  // El último ingreso del tambo es el más reciente de todos sus usuarios, activos o no.
  const ingresos = usuarios.flatMap((u) => (u.ultimoIngresoEn ? [u.ultimoIngresoEn.getTime()] : []));
  return {
    id: tambo.id,
    nombre: tambo.nombre,
    creadoEn: tambo.creadoEn,
    dueno: duenos[0] ? { nombre: duenos[0].nombre, email: duenos[0].email } : null,
    duenosAdicionales: Math.max(duenos.length - 1, 0),
    usuariosActivos: usuarios.filter((u) => u.activo).length,
    animalesActivos,
    estado: tambo.estado,
    ultimoCambioEstado: cambio
      ? { tipo: cambio.tipo, por: cambio.administrador.nombre, en: cambio.creadoEn, motivo: cambio.motivo }
      : null,
    ultimoIngreso: ingresos.length > 0 ? new Date(Math.max(...ingresos)) : null,
  };
}

// Orden de usuarios: del más antiguo al más nuevo (el id desempata; es UUID v7 y crece con el tiempo).
const ORDEN_USUARIOS = [{ creadoEn: 'asc' as const }, { id: 'asc' as const }];

const SELECT_TAMBO = {
  id: true,
  nombre: true,
  creadoEn: true,
  estado: true,
  usuarios: { select: SELECT_USUARIO_DETALLE, orderBy: ORDEN_USUARIOS },
  // Solo la fila más reciente del registro: la baja o reactivación vigente.
  registrosEstado: {
    select: { tipo: true, motivo: true, creadoEn: true, administrador: { select: { nombre: true } } },
    orderBy: [{ creadoEn: 'desc' as const }, { id: 'desc' as const }] as [{ creadoEn: 'desc' }, { id: 'desc' }],
    take: 1,
  },
} as const;

// Listado completo, ordenado por nombre y sin paginación (RF-17). El filtro de estado se resuelve en
// la consulta (spec 015, RF-3), no en memoria.
export async function listarTambos(filtro: FiltroEstado = 'todos'): Promise<ItemTambo[]> {
  const tambos = await prisma.establecimiento.findMany({
    where: filtro === 'todos' ? {} : { estado: filtro === 'baja' ? 'BAJA' : 'ACTIVO' },
    select: SELECT_TAMBO,
  });
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
    // Se arma cada usuario con las claves de la lista blanca (sin creadoEn ni ultimoIngresoEn crudo).
    usuarios: tambo.usuarios.map((u) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
      ultimoIngreso: u.ultimoIngresoEn,
    })),
  };
}

// Un solo tambo con la forma del listado (lo que devuelve el alta).
export async function itemTambo(id: string): Promise<ItemTambo | null> {
  const detalle = await detalleTambo(id);
  if (!detalle) return null;
  const { usuarios: _usuarios, ...item } = detalle;
  return item;
}
