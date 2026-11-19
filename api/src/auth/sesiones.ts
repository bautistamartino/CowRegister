import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { bloquearTambo } from '../admin/estadoTambo.js';

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

// Ingreso con email y contraseña correctos (spec 015, RF-10, 20, 21). En UNA transacción: lee el
// estado del tambo con bloqueo (FOR SHARE), si está de baja rechaza con 403 y no crea nada; si no,
// crea la sesión y registra la hora del ingreso. La cookie se escribe después de confirmar.
export async function iniciarSesionDeIngreso(res: Response, usuario: { id: string; establecimientoId: string }) {
  const token = randomBytes(32).toString('base64url');
  const expiraEn = new Date(Date.now() + DURACION_MS);

  await prisma.$transaction(async (tx) => {
    if ((await bloquearTambo(tx, usuario.establecimientoId)) !== 'ACTIVO') {
      throw new HttpError(
        403,
        'Tu tambo está dado de baja. Consultá con el administrador de la plataforma.',
        undefined,
        'TAMBO_DE_BAJA',
      );
    }
    await tx.sesion.create({ data: { usuarioId: usuario.id, tokenHash: hashToken(token), expiraEn } });
    await tx.usuario.update({ where: { id: usuario.id }, data: { ultimoIngresoEn: new Date() } });
  });
  res.cookie(COOKIE_SESION, token, { ...opcionesCookie, expires: expiraEn });
}

// Busca la sesión de un token. Devuelve null si no existe, venció, el usuario está inactivo o su tambo
// está dado de baja. El estado del tambo se mira ACÁ, en un solo lugar, porque todo pedido con sesión
// pasa por esta función (spec 015, RF-8 y RF-9): una ruta nueva no puede olvidarse del chequeo.
export async function buscarSesion(token: string) {
  const sesion = await prisma.sesion.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { usuario: { include: { establecimiento: { select: { estado: true } } } } },
  });

  if (!sesion || sesion.expiraEn < new Date() || !sesion.usuario.activo) return null;
  if (sesion.usuario.establecimiento.estado === 'BAJA') return null;
  return sesion;
}

export async function cerrarSesion(res: Response, token: string | undefined) {
  if (token) await prisma.sesion.deleteMany({ where: { tokenHash: hashToken(token) } });
  res.clearCookie(COOKIE_SESION, opcionesCookie);
}
