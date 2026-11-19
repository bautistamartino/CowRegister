import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { emailSchema, nombreSchema, passwordSchema } from '../validacion.js';
import { hashearPassword } from '../auth/password.js';
import { crearTamboConDueno } from '../auth/registro.js';
import { MENSAJE_EMAIL_REPETIDO, emailEnUso, traducirChoque } from '../admin/choques.js';
import { SELECT_PERFIL_ADMIN } from '../admin/listaBlanca.js';
import { COOKIE_ADMIN, cerrarSesionAdmin } from '../admin/sesionAdmin.js';
import { detalleTambo, itemTambo, listarTambos } from '../admin/tambos.js';

// Rutas del administrador de la plataforma. NO aplican el control de acceso acá: lo aplica una sola vez
// `requiereAdmin`, montado en app.ts sobre todo /api/admin (antes de los parsers de JSON).
export const rutasAdmin = Router();

// Límite de creaciones de tambo por hora (RF-28). LIMITE_ACCIONES_ADMIN lo cambia (los tests).
const limiteAdmin = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: () => Number(process.env.LIMITE_ACCIONES_ADMIN ?? 20),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' },
});

// Mismas reglas que el registro de hoy (RF-26). Los campos se llaman igual que en el registro:
// `nombreEstablecimiento` es el tambo y `nombre`, `email` y `password` son del dueño.
const crearTamboSchema = z.object({
  nombreEstablecimiento: nombreSchema,
  nombre: nombreSchema,
  email: emailSchema,
  password: passwordSchema,
});

// GET /api/admin/yo — perfil del administrador logueado (id, nombre, email; nunca el hash).
rutasAdmin.get('/yo', async (req, res) => {
  const administrador = await prisma.administrador.findUniqueOrThrow({
    where: { id: req.administrador!.id },
    select: SELECT_PERFIL_ADMIN,
  });
  res.json(administrador);
});

// POST /api/admin/logout — cierra la sesión del administrador en el servidor y borra su cookie.
rutasAdmin.post('/logout', async (req, res) => {
  const token: unknown = req.cookies?.[COOKIE_ADMIN];
  await cerrarSesionAdmin(res, typeof token === 'string' ? token : undefined);
  res.status(204).end();
});

// GET /api/admin/tambos — todos los tambos como cuentas, ordenados por nombre.
rutasAdmin.get('/tambos', async (_req, res) => {
  res.json(await listarTambos());
});

// GET /api/admin/tambos/:id — un tambo con todos sus usuarios. Id mal formado o inexistente: 404.
// Acá el id del tambo viaja en la ruta (excepción acotada de la constitución: lo envía el administrador).
rutasAdmin.get('/tambos/:id', async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  const tambo = id.success ? await detalleTambo(id.data) : null;
  if (!tambo) throw new HttpError(404, 'Tambo no encontrado');
  res.json(tambo);
});

// POST /api/admin/tambos — crea un tambo con su dueño (lotes y auditoría incluidos, todo o nada).
// No inicia sesión como el dueño ni devuelve la contraseña ni su hash.
rutasAdmin.post('/tambos', limiteAdmin, async (req, res) => {
  const datos = crearTamboSchema.parse(req.body);

  if (await emailEnUso(datos.email)) throw new HttpError(409, MENSAJE_EMAIL_REPETIDO);

  const passwordHash = await hashearPassword(datos.password);
  const dueno = await crearTamboConDueno(
    {
      nombreEstablecimiento: datos.nombreEstablecimiento,
      nombre: datos.nombre,
      email: datos.email,
      passwordHash,
    },
    { administradorId: req.administrador!.id },
  ).catch((err: unknown) => traducirChoque(err, { email: datos.email, nombreTambo: datos.nombreEstablecimiento }));

  res.status(201).json(await itemTambo(dueno.establecimientoId));
});
