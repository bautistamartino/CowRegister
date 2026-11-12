import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, esErrorPrisma } from '../errores.js';
import { descripcionLoteSchema, nombreLoteSchema } from '../validacion.js';
import { requiereRol, requiereSesion, usuarioActual } from '../auth/middleware.js';
import { ESTADOS_CON_DESTINO, NOMBRE_ESTADO } from '../lotes/estados.js';
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

// Lotes del tambo ya armados y ordenados. Lo usan GET /api/lotes y la copia local (spec 009), que
// pasa su cliente de transacción para leer los lotes dentro de la misma foto.
export async function leerLotes(cliente: Pick<typeof prisma, 'lote'>, establecimientoId: string) {
  const lotes = await cliente.lote.findMany({ where: { establecimientoId }, select: seleccionLote });
  // Se ordena en JavaScript: el orderBy de Prisma usa la collation de la base,
  // que puede poner las mayúsculas antes. sensitivity 'base' ignora mayúsculas
  // y tildes al comparar.
  lotes.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  return lotes.map(aRespuesta);
}

// GET /api/lotes — lotes del tambo ordenados por nombre sin distinguir mayúsculas.
rutasLotes.get('/', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  res.json(await leerLotes(prisma, establecimientoId));
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

// Al editar, los dos campos son opcionales, pero tiene que venir al menos uno.
// descripcion: null o un texto vacío la borra (RF-27).
const editarSchema = z
  .object({
    nombre: nombreLoteSchema.optional(),
    descripcion: descripcionLoteSchema.optional(),
  })
  .refine((datos) => datos.nombre !== undefined || datos.descripcion !== undefined, {
    error: 'Indicá el nombre o la descripción a cambiar',
  });

// PATCH /api/lotes/:id — dueño o encargado cambia el nombre y/o la descripción.
// No toca los animales ni los destinos del lote (RF-3).
rutasLotes.patch('/:id', soloAdministra, async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const id = idDeLote(req.params.id);
  const datos = editarSchema.parse(req.body);

  try {
    // updateMany (y no update) para poder filtrar también por establecimientoId:
    // si el lote es de otro tambo, no existe o ya se eliminó, actualiza 0 filas
    // y respondemos 404 sin distinguir el motivo (RF-20, RF-32).
    const { count } = await prisma.lote.updateMany({
      where: { id, establecimientoId },
      // Si un campo no vino (undefined), Prisma no lo cambia.
      data: { nombre: datos.nombre, descripcion: datos.descripcion },
    });
    if (count === 0) throw new HttpError(404, 'Lote no encontrado');
  } catch (err) {
    // Otro lote del tambo ya tiene ese nombre (sin distinguir mayúsculas).
    // Renombrar "Secas" a "secas" no choca: el índice compara contra las OTRAS filas.
    if (esErrorPrisma(err, 'P2002')) throw new HttpError(409, 'Ya existe un lote con ese nombre');
    throw err;
  }

  // Se vuelve a leer para devolver el lote completo (cantidad de animales y destinos).
  const lote = await prisma.lote.findFirst({ where: { id, establecimientoId }, select: seleccionLote });
  if (!lote) throw new HttpError(404, 'Lote no encontrado'); // se eliminó justo entre las dos consultas
  res.json(aRespuesta(lote));
});

// Une una lista en español: ["A"] → "A", ["A","B"] → "A y B", ["A","B","C"] → "A, B y C".
function unirConY(partes: string[]): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

// Arma el mensaje de por qué no se puede eliminar un lote (RF-8, RF-9), o null
// si se puede. Ejemplos:
//   "El lote tiene 3 animales" · "El lote tiene 1 animal"
//   "El lote es destino de En ordeñe y Seca"
//   "El lote tiene 3 animales y es destino de En ordeñe"
function motivoDeBloqueo(cantidadAnimales: number, estados: EstadoAnimal[]): string | null {
  const motivos: string[] = [];
  if (cantidadAnimales > 0) {
    motivos.push(`tiene ${cantidadAnimales} ${cantidadAnimales === 1 ? 'animal' : 'animales'}`);
  }
  // Los estados se nombran en el orden de pantalla, no en el que vienen de la base.
  const nombres = ESTADOS_CON_DESTINO.filter((e) => estados.includes(e)).map((e) => NOMBRE_ESTADO[e]);
  if (nombres.length > 0) motivos.push(`es destino de ${unirConY(nombres)}`);

  return motivos.length === 0 ? null : `El lote ${motivos.join(' y ')}`;
}

// Lee de la base lo necesario para decidir si se puede eliminar.
// Recibe `tx` para poder usarse dentro de la transacción o fuera de ella.
async function leerBloqueo(tx: Pick<typeof prisma, 'lote'>, id: string, establecimientoId: string) {
  const lote = await tx.lote.findFirst({ where: { id, establecimientoId }, select: seleccionLote });
  if (!lote) return { existe: false as const };
  return {
    existe: true as const,
    motivo: motivoDeBloqueo(
      lote._count.animales,
      lote.reglas.map((r) => r.estado),
    ),
  };
}

// DELETE /api/lotes/:id — dueño o encargado elimina un lote sin animales
// activos y que no sea destino de ningún estado (RF-7 a RF-9).
rutasLotes.delete('/:id', soloAdministra, async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const id = idDeLote(req.params.id);

  try {
    // La revisión y el borrado van juntos en una transacción.
    await prisma.$transaction(async (tx) => {
      const estado = await leerBloqueo(tx, id, establecimientoId);
      if (!estado.existe) throw new HttpError(404, 'Lote no encontrado');
      if (estado.motivo) throw new HttpError(409, estado.motivo);

      // Ya no hace falta desasignar animales de baja: la base garantiza que un animal de
      // baja no tiene lote (CHECK animales_baja_sin_lote, spec 004). Y si el lote figura
      // como lote previo de un parto o secado, la base lo deja como "eliminado" sola
      // (ON DELETE SET NULL en la clave partos_loteAnterior_fkey / secados_loteAnterior_fkey).
      const { count } = await tx.lote.deleteMany({ where: { id, establecimientoId } });
      if (count === 0) throw new HttpError(404, 'Lote no encontrado'); // otro usuario lo eliminó recién
    });
  } catch (err) {
    // P2003: entre la revisión y el borrado otro usuario eligió este lote como
    // destino, y la clave foránea de reglas_lote (ON DELETE RESTRICT) frenó el
    // borrado. Se vuelve a consultar para responder con el motivo real (RF-31).
    if (esErrorPrisma(err, 'P2003')) {
      const estado = await leerBloqueo(prisma, id, establecimientoId);
      if (!estado.existe) throw new HttpError(404, 'Lote no encontrado');
      throw new HttpError(409, estado.motivo ?? 'El lote no se puede eliminar');
    }
    throw err;
  }

  res.status(204).end();
});
