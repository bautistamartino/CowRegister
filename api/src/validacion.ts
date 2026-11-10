import { z } from 'zod';

// Reglas de validación compartidas por varias rutas.

export const emailSchema = z
  .string({ error: 'El email es obligatorio' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'El email no es válido' }));

export const passwordSchema = z
  .string({ error: 'La contraseña es obligatoria' })
  .min(10, { error: 'La contraseña debe tener al menos 10 caracteres' })
  .max(128, { error: 'La contraseña es demasiado larga' });

export const nombreSchema = z
  .string({ error: 'El nombre es obligatorio' })
  .trim()
  .min(1, { error: 'El nombre es obligatorio' })
  .max(100, { error: 'El nombre es demasiado largo' });
