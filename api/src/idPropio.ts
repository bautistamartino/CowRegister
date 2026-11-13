import { z } from 'zod';

// `id` propio opcional del cuerpo de las cinco cargas de eventos (spec 010, RF-4): un UUID que genera
// la tablet para poder reenviar sin duplicar. Se normaliza a minúsculas (como en los litros, spec 008).
// Vive en su propio archivo (y no en reproduccion/idempotencia.ts) para evitar un import circular con
// bajas/validacion.ts, que lo usa al armar su esquema.
export const idPropioSchema = z
  .uuid({ error: 'El identificador del registro tiene que ser un UUID válido' })
  .transform((id) => id.toLowerCase())
  .optional();
