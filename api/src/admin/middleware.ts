import type { RequestHandler } from 'express';
import { HttpError } from '../errores.js';
import { COOKIE_SESION, buscarSesion } from '../auth/sesiones.js';
import { COOKIE_ADMIN, buscarSesionAdmin } from './sesionAdmin.js';

// Datos del administrador logueado, disponibles en req.administrador.
export type AdministradorSesion = { id: string; nombre: string; email: string };

declare global {
  namespace Express {
    interface Request {
      administrador?: AdministradorSesion;
    }
  }
}

// ÚNICO control de acceso de /api/admin (se monta una sola vez en app.ts).
// Solo mira la cookie del administrador:
//  - válida: pasa.
//  - no hay, pero la cookie de un usuario de tambo es válida: 403 (está logueado, pero no es admin).
//  - nada: 401.
// Las rutas del tambo usan requiereSesion, que solo mira la cookie `sesion`: por eso rechazan (401)
// la del administrador.
export const requiereAdmin: RequestHandler = async (req, _res, next) => {
  const tokenAdmin: unknown = req.cookies?.[COOKIE_ADMIN];
  const sesionAdmin = typeof tokenAdmin === 'string' ? await buscarSesionAdmin(tokenAdmin) : null;
  if (sesionAdmin) {
    const { id, nombre, email } = sesionAdmin.administrador;
    req.administrador = { id, nombre, email };
    next();
    return;
  }

  const tokenTambo: unknown = req.cookies?.[COOKIE_SESION];
  const sesionTambo = typeof tokenTambo === 'string' ? await buscarSesion(tokenTambo) : null;
  if (sesionTambo) throw new HttpError(403, 'No tenés permiso para hacer esto');
  throw new HttpError(401, 'Tenés que iniciar sesión');
};
