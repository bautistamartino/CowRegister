import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from './generated/prisma/client.js';

// Error con código HTTP, para cortar un pedido con un mensaje claro.
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ¿El error es uno conocido de Prisma con este código? Por ejemplo:
// - P2002: violación de un índice único (nombre de lote repetido).
// - P2003: violación de una clave foránea.
// Sirve para traducir esos errores a mensajes concretos en cada ruta,
// en vez del mensaje genérico del manejador central.
export function esErrorPrisma(err: unknown, codigo: string): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === codigo;
}

// Manejador central de errores: convierte cualquier error en una respuesta JSON.
// Express 5 envía acá también los errores de funciones async.
export const manejarErrores: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    // Los errores de un campo van en "detalles" (la web los muestra debajo de cada campo).
    // Los de todo el pedido (sin campo, por ejemplo "Indicá el nombre o la descripción
    // a cambiar") van como mensaje principal, porque no hay un campo donde mostrarlos.
    const deCampo = err.issues.filter((i) => i.path.length > 0);
    const generales = err.issues.filter((i) => i.path.length === 0);
    res.status(400).json({
      error: generales[0]?.message ?? 'Datos inválidos',
      detalles: deCampo.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
    });
    return;
  }

  // Violación de un índice único (por ejemplo, email ya registrado)
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ error: 'Ya existe un registro con esos datos' });
    return;
  }

  // JSON mal formado en el cuerpo del pedido
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'El cuerpo del pedido no es un JSON válido' });
    return;
  }

  // Cuerpo del pedido más grande que el límite del parser (100 kb en general, 1 MB en la planilla)
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'El pedido es demasiado grande' });
    return;
  }

  // Error inesperado: se registra en el servidor pero no se muestran detalles al cliente.
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
};

// Error de validación de un campo, con el mismo formato (400 con "detalles") que los errores
// de zod: la web lo muestra debajo del campo correspondiente. Sirve para reglas que se
// controlan después de leer la base (fecha contra el estado del animal, semen inexistente).
export function errorDeCampo(campo: string, mensaje: string): ZodError {
  return new ZodError([{ code: 'custom', path: [campo], message: mensaje, input: undefined }]);
}
