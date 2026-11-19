import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { emailSchema, nombreSchema, passwordSchema } from '../validacion.js';
import { hashearPassword, verificarPassword, verificarPasswordFalso } from '../auth/password.js';
import { COOKIE_SESION, cerrarSesion, iniciarSesion, iniciarSesionDeIngreso } from '../auth/sesiones.js';
import { requiereSesion, usuarioActual } from '../auth/middleware.js';
import { crearTamboConDueno } from '../auth/registro.js';
import { emailEnUso, traducirChoque, MENSAJE_EMAIL_REPETIDO } from '../admin/choques.js';
import { iniciarSesionAdmin } from '../admin/sesionAdmin.js';

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

  // El email no puede ser ni de un usuario ni del administrador (spec 014, RF-7).
  if (await emailEnUso(datos.email)) throw new HttpError(409, MENSAJE_EMAIL_REPETIDO);

  const passwordHash = await hashearPassword(datos.password);

  // Tambo, lotes iniciales con sus destinos y dueño: todo o nada (RF-18).
  // Si la base rechaza el alta por un nombre o email repetido (también cuando dos pedidos llegan a
  // la vez), se traduce a un 409 con el mensaje que corresponde.
  const usuario = await crearTamboConDueno({
    nombreEstablecimiento: datos.nombreEstablecimiento,
    nombre: datos.nombre,
    email: datos.email,
    passwordHash,
  }).catch((err: unknown) =>
    traducirChoque(err, { email: datos.email, nombreTambo: datos.nombreEstablecimiento }),
  );

  await iniciarSesion(res, usuario.id);
  res.status(201).json(await perfil(usuario.id));
});

// POST /api/auth/login — ingreso de TODAS las cuentas (usuarios de un tambo y administrador).
// Un solo endpoint y un solo contador de intentos por IP. Se busca el email en las dos tablas y se
// hace UNA sola verificación de contraseña (contra el hash encontrado o contra uno falso), así
// tarda parecido y no revela qué emails existen ni si uno es del administrador.
rutasAuth.post('/login', limiteIntentos, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const admin = await prisma.administrador.findUnique({ where: { email } });
  const usuario = admin ? null : await prisma.usuario.findUnique({ where: { email } });
  const hashGuardado = admin?.passwordHash ?? usuario?.passwordHash;
  const ok = hashGuardado ? await verificarPassword(hashGuardado, password) : await verificarPasswordFalso(password);

  // Mismo mensaje en todos los fallos: no revela qué emails existen.
  const fallo = () => new HttpError(401, 'Email o contraseña incorrectos');

  if (admin) {
    if (!ok) {
      // Se audita el intento fallido; nunca la contraseña.
      await prisma.auditoriaAdmin.create({ data: { accion: 'INGRESO_FALLIDO', administradorId: admin.id } });
      throw fallo();
    }
    await prisma.auditoriaAdmin.create({ data: { accion: 'INGRESO', administradorId: admin.id } });
    await iniciarSesionAdmin(res, admin.id);
    res.json({ rol: 'ADMIN', id: admin.id, nombre: admin.nombre, email: admin.email });
    return;
  }

  if (!usuario || !ok || !usuario.activo) throw fallo();

  // Con el tambo dado de baja responde 403 TAMBO_DE_BAJA sin crear sesión (spec 015, RF-10).
  await iniciarSesionDeIngreso(res, usuario);
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
