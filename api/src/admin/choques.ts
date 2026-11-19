import { prisma } from '../db.js';
import { HttpError, esErrorPrisma } from '../errores.js';

export const MENSAJE_EMAIL_REPETIDO = 'Ya existe una cuenta con ese email';
export const MENSAJE_NOMBRE_REPETIDO = 'Ya existe un tambo con ese nombre';

// ¿Hay una cuenta (usuario de un tambo o administrador) con este email?
export async function emailEnUso(email: string): Promise<boolean> {
  const [usuario, admin] = await Promise.all([
    prisma.usuario.findUnique({ where: { email }, select: { id: true } }),
    prisma.administrador.findUnique({ where: { email }, select: { id: true } }),
  ]);
  return usuario !== null || admin !== null;
}

// ¿Hay un tambo con este nombre? Misma clave que el índice único de la base: sin distinguir
// mayúsculas y con los espacios colapsados.
// OJO: en una plantilla etiquetada, un `\s` suelto se lee como la letra "s". Por eso se escribe `\\s`:
// así llega a Postgres como \s (cualquier espacio en blanco) y también colapsa los espacios del medio.
export async function nombreTamboEnUso(nombre: string): Promise<boolean> {
  const filas = await prisma.$queryRaw<{ existe: number }[]>`
    SELECT 1 AS existe FROM establecimientos
    WHERE lower(regexp_replace(btrim(nombre), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim(${nombre}), '\\s+', ' ', 'g'))
    LIMIT 1`;
  return filas.length > 0;
}

/**
 * Traduce un choque de unicidad de la base (P2002) a un 409 con el mensaje que corresponde.
 * Prisma entrega el error del índice de nombre y el del disparador de email (23505) igual, sin
 * decir cuál fue; por eso, después de la transacción que falló, se vuelve a consultar qué chocó.
 * Si el error no es un P2002 lo vuelve a lanzar tal cual; si no se puede determinar qué chocó, se
 * lanza el error original y el manejador central responde el 409 genérico.
 * Siempre lanza: no devuelve nada.
 */
export async function traducirChoque(err: unknown, datos: { email?: string; nombreTambo?: string }): Promise<never> {
  if (!esErrorPrisma(err, 'P2002')) throw err;
  if (datos.email !== undefined && (await emailEnUso(datos.email))) throw new HttpError(409, MENSAJE_EMAIL_REPETIDO);
  if (datos.nombreTambo !== undefined && (await nombreTamboEnUso(datos.nombreTambo))) {
    throw new HttpError(409, MENSAJE_NOMBRE_REPETIDO);
  }
  throw err;
}
