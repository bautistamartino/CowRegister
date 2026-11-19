import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import { prisma } from '../db.js';

export const COOKIE_ADMIN = 'sesion_admin';

// Configuración de la sesión del administrador. Es un objeto (y no constantes sueltas) para que los
// tests puedan adelantar el reloj sin esperar 8 horas de verdad.
export const configSesionAdmin = {
  duracionMs: 8 * 60 * 60 * 1000, // 8 horas FIJAS: usar la sesión no la renueva
  ahora: () => Date.now(),
};

// La cookie solo viaja a /api/admin: el navegador ni la envía a las rutas del tambo.
// sameSite strict: tampoco se manda en pedidos que vienen de otros sitios.
const opcionesCookie: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  path: '/api/admin',
};

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

// Crea una sesión del administrador con un token NUEVO en cada ingreso y deja el token en la cookie.
// En la base se guarda solo el hash: si alguien leyera la tabla no podría usar las sesiones.
export async function iniciarSesionAdmin(res: Response, administradorId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiraEn = new Date(configSesionAdmin.ahora() + configSesionAdmin.duracionMs);

  await prisma.sesionAdmin.create({ data: { administradorId, tokenHash: hashToken(token), expiraEn } });
  res.cookie(COOKIE_ADMIN, token, { ...opcionesCookie, expires: expiraEn });
}

// Busca la sesión de un token. Devuelve null si no existe o ya venció.
export async function buscarSesionAdmin(token: string) {
  const sesion = await prisma.sesionAdmin.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { administrador: true },
  });
  if (!sesion || sesion.expiraEn.getTime() < configSesionAdmin.ahora()) return null;
  return sesion;
}

export async function cerrarSesionAdmin(res: Response, token: string | undefined) {
  if (token) await prisma.sesionAdmin.deleteMany({ where: { tokenHash: hashToken(token) } });
  res.clearCookie(COOKIE_ADMIN, opcionesCookie);
}
