import { Router, type Request } from 'express';
import { HttpError } from '../errores.js';
import { requiereSesion, usuarioActual } from '../auth/middleware.js';
import { hoyArgentina } from '../animales/reglas.js';
import { ahora } from '../reloj.js';
import { periodoSchema, validarPeriodo } from '../informes/periodo.js';
import { informeInseminacion } from '../informes/inseminacion.js';
import { informeNatalidad } from '../informes/natalidad.js';
import { informeLeche } from '../informes/leche.js';

// Informes del tambo (spec 007). Solo lectura, los tres roles. Orden de controles: sesión (401,
// también en app.ts antes de los parsers) y después período (400). Todo se filtra por el
// establecimientoId de la sesión; el que venga en la query se descarta con el resto.
export const rutasInformes = Router();
rutasInformes.use(requiereSesion);

// Lee y valida ?desde&hasta. Falta o repetido: 400; fecha inválida o fuera de reglas: 400.
function periodoDeLaQuery(req: Request): { desde: string; hasta: string } {
  const parseado = periodoSchema.safeParse(req.query);
  if (!parseado.success) throw new HttpError(400, parseado.error.issues[0]?.message ?? 'El período no es válido');
  const { desde, hasta } = parseado.data;
  const error = validarPeriodo(desde, hasta, hoyArgentina(ahora()));
  if (error) throw new HttpError(400, error);
  return { desde, hasta };
}

// GET /api/informes/inseminacion?desde&hasta
rutasInformes.get('/inseminacion', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const { desde, hasta } = periodoDeLaQuery(req);
  res.json(await informeInseminacion(establecimientoId, desde, hasta));
});

// GET /api/informes/leche?desde&hasta (spec 008)
rutasInformes.get('/leche', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const { desde, hasta } = periodoDeLaQuery(req);
  res.json(await informeLeche(establecimientoId, desde, hasta));
});

// GET /api/informes/natalidad?desde&hasta
rutasInformes.get('/natalidad', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const { desde, hasta } = periodoDeLaQuery(req);
  res.json(await informeNatalidad(establecimientoId, desde, hasta));
});
