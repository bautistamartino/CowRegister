import { Router, type Response } from 'express';
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
import { darDeBajaTambo, reactivarTambo, type ResultadoCambioTambo } from '../admin/estadoTambo.js';

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

// GET /api/admin/tambos?estado=todos|activos|baja — los tambos como cuentas, ordenados por nombre.
// Sin parámetro, todos. Un valor inválido da 400 (spec 015, RF-3).
rutasAdmin.get('/tambos', async (req, res) => {
  const estado = z
    .enum(['todos', 'activos', 'baja'], { error: 'Estado inválido: usá todos, activos o baja' })
    .default('todos')
    .parse(req.query.estado);
  res.json(await listarTambos(estado));
});

// Motivo de la baja (spec 015, RF-5): se recorta y tiene de 1 a 200 CARACTERES (no bytes: Array.from
// cuenta cada emoji como uno).
const MENSAJE_MOTIVO = 'Indicá el motivo de la baja (hasta 200 caracteres)';
const bajaSchema = z.object({
  motivo: z
    .string({ error: MENSAJE_MOTIVO })
    .trim()
    .refine((m) => Array.from(m).length >= 1 && Array.from(m).length <= 200, { error: MENSAJE_MOTIVO }),
});

// Traduce el resultado de un cambio de estado a HTTP: el id del tambo sale SOLO de la ruta.
async function responderCambioDeEstado(
  res: Response,
  id: string,
  resultado: ResultadoCambioTambo,
  mensajeConflicto: string,
) {
  if (resultado === 'no_existe') throw new HttpError(404, 'Tambo no encontrado');
  if (resultado === 'estado_incorrecto') throw new HttpError(409, mensajeConflicto);
  res.json(await detalleTambo(id));
}

// Un id de ruta mal formado se trata igual que uno inexistente (404).
function idDeRuta(valor: unknown): string | null {
  const id = z.uuid().safeParse(valor);
  return id.success ? id.data : null;
}

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

// POST /api/admin/tambos/:id/baja — da de baja un tambo activo (spec 015, RF-4, 5, 7, 12, 13).
// Orden de rechazos: 400 (motivo) → 404 (tambo) → 409 (ya dado de baja).
rutasAdmin.post('/tambos/:id/baja', async (req, res) => {
  const { motivo } = bajaSchema.parse(req.body);
  const id = idDeRuta(req.params.id);
  if (!id) throw new HttpError(404, 'Tambo no encontrado');
  const resultado = await darDeBajaTambo(id, motivo, req.administrador!.id);
  await responderCambioDeEstado(res, id, resultado, 'El tambo ya está dado de baja');
});

// POST /api/admin/tambos/:id/reactivar — reactiva un tambo dado de baja, sin motivo (RF-14).
rutasAdmin.post('/tambos/:id/reactivar', async (req, res) => {
  const id = idDeRuta(req.params.id);
  if (!id) throw new HttpError(404, 'Tambo no encontrado');
  const resultado = await reactivarTambo(id, req.administrador!.id);
  await responderCambioDeEstado(res, id, resultado, 'El tambo no está dado de baja');
});
