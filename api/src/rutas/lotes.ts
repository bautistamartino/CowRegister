import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, esErrorPrisma } from '../errores.js';
import { descripcionLoteSchema, nombreLoteSchema } from '../validacion.js';
import { requiereRol, requiereSesion, usuarioActual } from '../auth/middleware.js';
import { ESTADOS_CON_DESTINO } from '../lotes/estados.js';
import type { EstadoAnimal } from '../generated/prisma/client.js';

// Lotes del tambo. Todos los usuarios pueden verlos; solo dueño y encargado
// pueden modificarlos (RF-21, RF-22). Toda consulta se filtra por el
// establecimientoId de la sesión (RF-20).
export const rutasLotes = Router();
rutasLotes.use(requiereSesion);

// Solo para las rutas de modificación. Se pone como middleware de la ruta,
// ANTES del handler, así el rol se controla antes de leer el id o el cuerpo:
// un veterinario recibe 403 aunque el lote no exista o los datos sean inválidos,
// y la respuesta no revela nada (RF-22).
const soloAdministra = requiereRol('DUENO', 'ENCARGADO');

const crearSchema = z.object({
  nombre: nombreLoteSchema,
  descripcion: descripcionLoteSchema.optional(),
  // Cualquier otro campo (por ejemplo un establecimientoId) se descarta:
  // z.object ignora las claves que no declara.
});

// Qué se lee de la base para armar la respuesta de un lote.
const seleccionLote = {
  id: true,
  nombre: true,
  descripcion: true,
  // Cuenta solo los animales activos: los dados de baja no son "del lote" (RF-1).
  _count: { select: { animales: { where: { estado: { not: 'BAJA' } } } } },
  // Estados de los que este lote es destino.
  reglas: { select: { estado: true } },
} as const;

type LoteLeido = {
  id: string;
  nombre: string;
  descripcion: string | null;
  _count: { animales: number };
  reglas: { estado: EstadoAnimal }[];
};

// Arma la respuesta pública: { id, nombre, descripcion, cantidadAnimales, destinoDe }.
// destinoDe sigue siempre el orden de pantalla (recién nacido, vaquillona, en ordeñe, seca).
function aRespuesta(lote: LoteLeido) {
  const estados = lote.reglas.map((r) => r.estado);
  return {
    id: lote.id,
    nombre: lote.nombre,
    descripcion: lote.descripcion,
    cantidadAnimales: lote._count.animales,
    destinoDe: ESTADOS_CON_DESTINO.filter((estado) => estados.includes(estado)),
  };
}

// Un id que no es UUID responde 404 igual que uno inexistente (RF-20): así no
// se distingue "mal formado" de "no existe" o "es de otro tambo".
// (En /api/usuarios un id mal formado da 400; acá la spec pide 404.)
function idDeLote(valor: unknown): string {
  const resultado = z.uuid().safeParse(valor);
  if (!resultado.success) throw new HttpError(404, 'Lote no encontrado');
  return resultado.data;
}

// GET /api/lotes — lotes del tambo ordenados por nombre sin distinguir mayúsculas.
rutasLotes.get('/', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const lotes = await prisma.lote.findMany({ where: { establecimientoId }, select: seleccionLote });

  // Se ordena en JavaScript: el orderBy de Prisma usa la collation de la base,
  // que puede poner las mayúsculas antes. sensitivity 'base' ignora mayúsculas
  // y tildes al comparar.
  lotes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  res.json(lotes.map(aRespuesta));
});

// GET /api/lotes/:id — un lote del tambo.
rutasLotes.get('/:id', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const id = idDeLote(req.params.id);

  // findFirst con id Y establecimientoId: un lote de otro tambo no se encuentra.
  const lote = await prisma.lote.findFirst({ where: { id, establecimientoId }, select: seleccionLote });
  if (!lote) throw new HttpError(404, 'Lote no encontrado');
  res.json(aRespuesta(lote));
});

// POST /api/lotes — dueño o encargado crea un lote en su tambo.
rutasLotes.post('/', soloAdministra, async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const datos = crearSchema.parse(req.body);

  try {
    const lote = await prisma.lote.create({
      data: {
        establecimientoId, // siempre el tambo de la sesión, nunca uno enviado por el cliente
        nombre: datos.nombre,
        descripcion: datos.descripcion ?? null,
      },
      select: seleccionLote,
    });
    res.status(201).json(aRespuesta(lote));
  } catch (err) {
    // El nombre repetido (sin distinguir mayúsculas) lo detecta el índice único
    // de la base, no una consulta previa: así tampoco pasan dos altas simultáneas (RF-6).
    if (esErrorPrisma(err, 'P2002')) throw new HttpError(409, 'Ya existe un lote con ese nombre');
    throw err;
  }
});
