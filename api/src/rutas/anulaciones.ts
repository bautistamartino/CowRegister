import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../errores.js';
import { motivoAnulacionSchema } from '../validacion.js';
import { requiereSesion, usuarioActual } from '../auth/middleware.js';
import { anularEvento } from '../reproduccion/anular.js';

// Anulación de servicios y tactos (spec 003, RF-19 a RF-22). Una ruta por tipo: el tipo sale de la
// ruta, así un id de otro tipo es "no encontrado". Los tres roles pueden anular. Orden de
// controles: sesión (401) → motivo (400) → búsqueda (404) → conflictos (409).
// Se pasa el rol de la sesión solo para el mensaje del veterinario (spec 004, RF-26).
// La respuesta es el evento a secas (sin avisos): no cambió respecto de la 003 (salvo `yaEstabaAnulado` en la repetición, spec 010).
function rutasAnulacion(tipo: 'SERVICIO' | 'TACTO') {
  const router = Router();
  router.use(requiereSesion);

  router.post('/:id/anular', async (req, res) => {
    const { establecimientoId, id: usuarioId, rol } = usuarioActual(req);
    const { motivo } = z.object({ motivo: motivoAnulacionSchema }).parse(req.body);
    // Un id mal formado responde 404, igual que uno inexistente, de otro tambo o de otro tipo.
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, 'Evento no encontrado');

    const { evento, yaEstabaAnulado } = await anularEvento({ tipo, id: id.data, establecimientoId, usuarioId, rol, motivo });
    // Spec 010, RF-7: la repetición de una anulación ya hecha (mismo usuario y motivo) es 200 con la forma
    // de siempre más `yaEstabaAnulado: true`.
    res.json(yaEstabaAnulado ? { ...evento, yaEstabaAnulado: true } : evento);
  });
  return router;
}

export const rutasAnulacionServicios = rutasAnulacion('SERVICIO');
export const rutasAnulacionTactos = rutasAnulacion('TACTO');
