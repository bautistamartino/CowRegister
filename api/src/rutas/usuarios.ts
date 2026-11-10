import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { emailSchema, nombreSchema, passwordSchema } from '../validacion.js';
import { hashearPassword } from '../auth/password.js';
import { requiereRol, requiereSesion, usuarioActual } from '../auth/middleware.js';

// Gestión de los usuarios del tambo. Solo el dueño puede usar estas rutas.
export const rutasUsuarios = Router();
rutasUsuarios.use(requiereSesion, requiereRol('DUENO'));

const camposPublicos = { id: true, nombre: true, email: true, rol: true, activo: true, creadoEn: true } as const;

const crearSchema = z.object({
  nombre: nombreSchema,
  email: emailSchema,
  password: passwordSchema,
  rol: z.enum(['DUENO', 'ENCARGADO', 'VETERINARIO'], { error: 'Rol inválido' }),
});

const actualizarSchema = z.object({
  activo: z.boolean({ error: 'activo debe ser true o false' }),
});

// GET /api/usuarios — usuarios del tambo del dueño logueado.
rutasUsuarios.get('/', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const usuarios = await prisma.usuario.findMany({
    where: { establecimientoId },
    select: camposPublicos,
    orderBy: { nombre: 'asc' },
  });
  res.json(usuarios);
});

// POST /api/usuarios — el dueño crea un usuario para su tambo.
rutasUsuarios.post('/', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const datos = crearSchema.parse(req.body);

  const existe = await prisma.usuario.findUnique({ where: { email: datos.email } });
  if (existe) throw new HttpError(409, 'Ya existe una cuenta con ese email');

  const usuario = await prisma.usuario.create({
    data: {
      establecimientoId, // siempre el tambo de la sesión, nunca uno enviado por el cliente
      nombre: datos.nombre,
      email: datos.email,
      passwordHash: await hashearPassword(datos.password),
      rol: datos.rol,
    },
    select: camposPublicos,
  });
  res.status(201).json(usuario);
});

// PATCH /api/usuarios/:id — activar o desactivar un usuario.
rutasUsuarios.patch('/:id', async (req, res) => {
  const yo = usuarioActual(req);
  const { activo } = actualizarSchema.parse(req.body);
  const id = z.uuid({ error: 'Id inválido' }).parse(req.params.id);

  if (id === yo.id && !activo) throw new HttpError(400, 'No podés desactivar tu propio usuario');

  // Filtrar por establecimiento: un dueño no puede tocar usuarios de otro tambo.
  const usuario = await prisma.usuario.findFirst({ where: { id, establecimientoId: yo.establecimientoId } });
  if (!usuario) throw new HttpError(404, 'Usuario no encontrado');

  const actualizado = await prisma.$transaction(async (tx) => {
    // Al desactivar, se cierran todas sus sesiones en todos los dispositivos.
    if (!activo) await tx.sesion.deleteMany({ where: { usuarioId: id } });
    return tx.usuario.update({ where: { id }, data: { activo }, select: camposPublicos });
  });
  res.json(actualizado);
});
