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

// Manejador central de errores: convierte cualquier error en una respuesta JSON.
// Express 5 envía acá también los errores de funciones async.
export const manejarErrores: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Datos inválidos',
      detalles: err.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
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

  // Error inesperado: se registra en el servidor pero no se muestran detalles al cliente.
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
};
