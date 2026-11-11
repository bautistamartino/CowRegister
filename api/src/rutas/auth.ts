import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { emailSchema, nombreSchema, passwordSchema } from '../validacion.js';
import { hashearPassword, verificarPassword, verificarPasswordFalso } from '../auth/password.js';
import { COOKIE_SESION, cerrarSesion, iniciarSesion } from '../auth/sesiones.js';
import { requiereSesion, usuarioActual } from '../auth/middleware.js';

export const rutasAuth = Router();

// Máximo 10 intentos de login/registro cada 15 minutos por IP (frena la fuerza bruta).
// LIMITE_INTENTOS_LOGIN permite cambiarlo (los tests lo suben para no bloquearse).
const limiteIntentos = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: () => Number(process.env.LIMITE_INTENTOS_LOGIN ?? 10),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' },
});

const registroSchema = z.object({
  nombreEstablecimiento: nombreSchema,
  nombre: nombreSchema,
  email: emailSchema,
  password: passwordSchema,
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'La contraseña es obligatoria' }).max(128),
});

// POST /api/auth/registro — crea un tambo nuevo junto con su usuario dueño.
rutasAuth.post('/registro', limiteIntentos, async (req, res) => {
  const datos = registroSchema.parse(req.body);

  const existe = await prisma.usuario.findUnique({ where: { email: datos.email } });
  if (existe) throw new HttpError(409, 'Ya existe una cuenta con ese email');

  const passwordHash = await hashearPassword(datos.password);

  // Transacción: se crean los dos registros o ninguno.
  const usuario = await prisma.$transaction(async (tx) => {
    const establecimiento = await tx.establecimiento.create({
      data: { nombre: datos.nombreEstablecimiento },
    });
    return tx.usuario.create({
      data: {
        establecimientoId: establecimiento.id,
        nombre: datos.nombre,
        email: datos.email,
        passwordHash,
        rol: 'DUENO',
      },
    });
  });

  await iniciarSesion(res, usuario.id);
  res.status(201).json(await perfil(usuario.id));
});

// POST /api/auth/login
rutasAuth.post('/login', limiteIntentos, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  const ok = usuario
    ? await verificarPassword(usuario.passwordHash, password)
    : await verificarPasswordFalso(password);

  // Mismo mensaje si falla el email o la contraseña: no revela qué emails existen.
  if (!usuario || !ok || !usuario.activo) {
    throw new HttpError(401, 'Email o contraseña incorrectos');
  }

  await iniciarSesion(res, usuario.id);
  res.json(await perfil(usuario.id));
});

// POST /api/auth/logout
rutasAuth.post('/logout', async (req, res) => {
  const token: unknown = req.cookies?.[COOKIE_SESION];
  await cerrarSesion(res, typeof token === 'string' ? token : undefined);
  res.status(204).end();
});

// GET /api/auth/yo — datos del usuario logueado y su tambo.
rutasAuth.get('/yo', requiereSesion, async (req, res) => {
  res.json(await perfil(usuarioActual(req).id));
});

// Datos públicos del usuario: nunca incluye el hash de la contraseña.
function perfil(usuarioId: string) {
  return prisma.usuario.findUniqueOrThrow({
    where: { id: usuarioId },
    select: {
      id: true,
      nombre: true,
      email: true,
      rol: true,
      establecimiento: { select: { id: true, nombre: true } },
    },
  });
}
