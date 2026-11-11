import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../errores.js';
import { motivoAnulacionSchema } from '../validacion.js';
import { requiereRol, requiereSesion, usuarioActual } from '../auth/middleware.js';
import { anularEvento } from '../reproduccion/anular.js';

// Anulación de partos y secados (spec 004, RF-22 a RF-30). Solo dueño y encargado: el veterinario
// recibe 403. El permiso se controla en app.ts ANTES de los parsers de JSON (así un JSON roto da
// 403 y no 400) y acá otra vez como defensa. Una ruta por tipo: un id de otro tipo es "no encontrado".
// Orden de controles: sesión (401) → rol (403) → motivo (400) → búsqueda (404) → conflictos (409).
// La respuesta es { evento, avisos }: los avisos 6 y 7 (la vaca volvió sin lote) viajan solo acá.
function rutasAnulacion(tipo: 'PARTO' | 'SECADO') {
  const router = Router();
  router.use(requiereSesion, requiereRol('DUENO', 'ENCARGADO'));

  router.post('/:id/anular', async (req, res) => {
    const { establecimientoId, id: usuarioId, rol } = usuarioActual(req);
    const { motivo } = z.object({ motivo: motivoAnulacionSchema }).parse(req.body);
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, 'Evento no encontrado');

    res.json(await anularEvento({ tipo, id: id.data, establecimientoId, usuarioId, rol, motivo }));
  });
  return router;
}

export const rutasAnulacionPartos = rutasAnulacion('PARTO');
export const rutasAnulacionSecados = rutasAnulacion('SECADO');
