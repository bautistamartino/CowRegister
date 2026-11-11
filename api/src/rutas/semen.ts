import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, esErrorPrisma } from '../errores.js';
import { nombreSemenSchema, razaSemenSchema } from '../validacion.js';
import { requiereRol, requiereSesion, usuarioActual } from '../auth/middleware.js';

// Catálogo de semen y toros del tambo (spec 003, RF-1 a RF-6). Todos los usuarios lo ven;
// solo dueño y encargado lo modifican (RF-28). Toda consulta se filtra por el
// establecimientoId de la sesión (RF-27).
export const rutasSemen = Router();
rutasSemen.use(requiereSesion);

// El rol de POST y PATCH se controla en app.ts ANTES de los parsers de JSON (así un
// veterinario recibe 403 aunque el JSON venga roto). Acá se repite como defensa.
const soloAdministra = requiereRol('DUENO', 'ENCARGADO');

const MENSAJE_REPETIDO = 'Ya existe un semen o toro con ese nombre';

// Qué se devuelve de cada entrada.
const seleccion = { id: true, nombre: true, raza: true, activo: true } as const;

const crearSchema = z.object({
  nombre: nombreSemenSchema,
  raza: razaSemenSchema.optional(),
  // Cualquier otro campo (por ejemplo un establecimientoId) se descarta: z.object ignora lo no declarado.
});

// Al editar todo es opcional, pero tiene que venir al menos un campo.
// raza: null o un texto vacío la borra.
const editarSchema = z
  .object({
    nombre: nombreSemenSchema.optional(),
    raza: razaSemenSchema.optional(),
    activo: z.boolean({ error: 'activo debe ser verdadero o falso' }).optional(),
  })
  .refine((d) => d.nombre !== undefined || d.raza !== undefined || d.activo !== undefined, {
    error: 'Indicá el nombre, la raza o si está activa',
  });

// GET /api/semen — entradas del tambo (activas y desactivadas) por nombre, sin distinguir mayúsculas.
rutasSemen.get('/', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const entradas = await prisma.semenToro.findMany({ where: { establecimientoId }, select: seleccion });
  // En JavaScript (como los lotes): el orderBy de la base puede poner las mayúsculas antes.
  entradas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  res.json(entradas);
});

// POST /api/semen — dueño o encargado crea una entrada activa en su tambo.
rutasSemen.post('/', soloAdministra, async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const datos = crearSchema.parse(req.body);
  try {
    const entrada = await prisma.semenToro.create({
      data: { establecimientoId, nombre: datos.nombre, raza: datos.raza ?? null },
      select: seleccion,
    });
    res.status(201).json(entrada);
  } catch (err) {
    // El índice único sobre lower(nombre) de la base detecta el repetido (también con
    // dos altas simultáneas y contra las desactivadas).
    if (esErrorPrisma(err, 'P2002')) throw new HttpError(409, MENSAJE_REPETIDO);
    throw err;
  }
});

// PATCH /api/semen/:id — cambia nombre, raza y/o activo (desactivar y reactivar son esto mismo).
// Orden de controles: sesión, rol, cuerpo (400), id (404).
rutasSemen.patch('/:id', soloAdministra, async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const datos = editarSchema.parse(req.body);
  // Un id mal formado responde 404 igual que uno inexistente o de otro tambo.
  const idValido = z.uuid().safeParse(req.params.id);
  if (!idValido.success) throw new HttpError(404, 'Semen o toro no encontrado');
  const id = idValido.data;

  try {
    // updateMany para filtrar también por establecimientoId: de otro tambo o inexistente = 0 filas.
    const { count } = await prisma.semenToro.updateMany({
      where: { id, establecimientoId },
      data: { nombre: datos.nombre, raza: datos.raza, activo: datos.activo }, // undefined = no se toca
    });
    if (count === 0) throw new HttpError(404, 'Semen o toro no encontrado');
  } catch (err) {
    if (esErrorPrisma(err, 'P2002')) throw new HttpError(409, MENSAJE_REPETIDO);
    throw err;
  }

  const entrada = await prisma.semenToro.findFirst({ where: { id, establecimientoId }, select: seleccion });
  if (!entrada) throw new HttpError(404, 'Semen o toro no encontrado');
  res.json(entrada);
});
