import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import { prisma } from '../db.js';

export const COOKIE_SESION = 'sesion';
const DURACION_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

const opcionesCookie: CookieOptions = {
  httpOnly: true, // JavaScript del navegador no puede leerla (protege contra XSS)
  sameSite: 'lax', // no se envía en pedidos POST desde otros sitios (protege contra CSRF)
  secure: process.env.NODE_ENV === 'production', // solo por HTTPS en producción
  path: '/',
};

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

// Crea una sesión para el usuario y deja el token en una cookie.
export async function iniciarSesion(res: Response, usuarioId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiraEn = new Date(Date.now() + DURACION_MS);

  await prisma.sesion.create({ data: { usuarioId, tokenHash: hashToken(token), expiraEn } });
  res.cookie(COOKIE_SESION, token, { ...opcionesCookie, expires: expiraEn });
}

// Busca la sesión de un token. Devuelve null si no existe, venció o el usuario está inactivo.
export async function buscarSesion(token: string) {
  const sesion = await prisma.sesion.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { usuario: true },
  });

  if (!sesion || sesion.expiraEn < new Date() || !sesion.usuario.activo) return null;
  return sesion;
}

export async function cerrarSesion(res: Response, token: string | undefined) {
  if (token) await prisma.sesion.deleteMany({ where: { tokenHash: hashToken(token) } });
  res.clearCookie(COOKIE_SESION, opcionesCookie);
}
