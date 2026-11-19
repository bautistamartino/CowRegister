import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { emailSchema, nombreSchema, passwordSchema } from '../validacion.js';
import { hashearPassword } from '../auth/password.js';
import { bloquearTambo } from '../admin/estadoTambo.js';
import { emailEnUso, traducirChoque, MENSAJE_EMAIL_REPETIDO } from '../admin/choques.js';
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

  // El email no puede ser ni de otro usuario ni del administrador (spec 014, RF-7).
  if (await emailEnUso(datos.email)) throw new HttpError(409, MENSAJE_EMAIL_REPETIDO);

  // El hash va antes de la transacción (argon2 es lento). Dentro, el tambo se lee con FOR SHARE: si una
  // baja se cruza, el alta o queda antes de ella o se rechaza; no queda un usuario nuevo en un tambo
  // de baja (spec 015, RF-12).
  const passwordHash = await hashearPassword(datos.password);
  const usuario = await prisma
    .$transaction(async (tx) => {
      if ((await bloquearTambo(tx, establecimientoId)) !== 'ACTIVO') {
        throw new HttpError(401, 'Tenés que iniciar sesión');
      }
      return tx.usuario.create({
        data: {
          establecimientoId, // siempre el tambo de la sesión, nunca uno enviado por el cliente
          nombre: datos.nombre,
          email: datos.email,
          passwordHash,
          rol: datos.rol,
        },
        select: camposPublicos,
      });
    })
    .catch((err: unknown) => traducirChoque(err, { email: datos.email }));
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
