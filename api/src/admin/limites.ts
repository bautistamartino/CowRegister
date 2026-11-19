import { rateLimit } from 'express-rate-limit';

// Límite COMPARTIDO de las cuatro acciones sensibles del administrador (spec 015, RF-33): dar de baja
// y reactivar un tambo, restablecer una contraseña y reactivar un usuario. Un único contador por
// administrador (30 por hora; LIMITE_ACCIONES_SENSIBLES lo cambia en los tests). Se pone como primer
// manejador de cada ruta, antes de validar: cuenta todo pedido con sesión válida, también los que
// terminan en 400, 404 o 409. Es una instancia aparte del límite de crear tambos.
export const limiteAccionesSensibles = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: () => Number(process.env.LIMITE_ACCIONES_SENSIBLES ?? 30),
  // requiereAdmin ya dejó al administrador en req.administrador.
  keyGenerator: (req) => req.administrador!.id,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' },
  validate: { keyGeneratorIpFallback: false },
});
