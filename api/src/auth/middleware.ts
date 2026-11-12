import type { RequestHandler } from 'express';
import type { Rol } from '../generated/prisma/client.js';
import { HttpError } from '../errores.js';
import { COOKIE_SESION, buscarSesion } from './sesiones.js';

// Datos del usuario logueado, disponibles en req.usuario en las rutas protegidas.
export type UsuarioSesion = {
  id: string;
  establecimientoId: string;
  nombre: string;
  email: string;
  rol: Rol;
};

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioSesion;
    }
  }
}

// Exige una sesión válida. Sin sesión responde 401.
export const requiereSesion: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[COOKIE_SESION];
  const sesion = typeof token === 'string' ? await buscarSesion(token) : null;
  if (!sesion) throw new HttpError(401, 'Tenés que iniciar sesión');

  const { id, establecimientoId, nombre, email, rol } = sesion.usuario;
  req.usuario = { id, establecimientoId, nombre, email, rol };
  next();
};

// Exige que el usuario tenga alguno de los roles indicados. Va después de requiereSesion.
export function requiereRol(...roles: Rol[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      throw new HttpError(403, 'No tenés permiso para hacer esto');
    }
    next();
  };
}

// Solo dueño y encargado, con el mensaje que pide la spec 008 (RF-27) para cargar y anular producción.
export const requiereDuenoOEncargado: RequestHandler = (req, _res, next) => {
  if (!req.usuario || (req.usuario.rol !== 'DUENO' && req.usuario.rol !== 'ENCARGADO')) {
    throw new HttpError(403, 'Esta acción la tiene que hacer un dueño o encargado');
  }
  next();
};

// Devuelve el usuario logueado. Usar solo en rutas que pasaron por requiereSesion.
export function usuarioActual(req: Express.Request): UsuarioSesion {
  if (!req.usuario) throw new HttpError(401, 'Tenés que iniciar sesión');
  return req.usuario;
}
