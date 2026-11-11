import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, esErrorPrisma } from '../errores.js';
import { requiereRol, requiereSesion, usuarioActual } from '../auth/middleware.js';
import { ESTADOS_CON_DESTINO, type EstadoConDestino } from '../lotes/estados.js';

// Destino de cada estado ("las vacas en estado X van al lote Y").
// El recurso es el ESTADO, no el lote: /api/reglas-lote/:estado (ver Decisiones del plan).
// Todos los usuarios pueden ver los destinos; solo dueño y encargado pueden
// cambiarlos (RF-21, RF-22). Toda consulta se filtra por el tambo de la sesión (RF-20).
export const rutasReglasLote = Router();
rutasReglasLote.use(requiereSesion);

// Va como middleware de la ruta, ANTES del handler: el rol se controla antes de
// mirar el estado o el loteId, así un veterinario recibe 403 aunque el estado sea
// BAJA o el lote sea de otro tambo, y la respuesta no revela nada (RF-22).
const soloAdministra = requiereRol('DUENO', 'ENCARGADO');

// Solo los 4 estados con destino. BAJA y cualquier otro texto (incluso "seca"
// en minúsculas) quedan afuera (RF-16).
const estadoSchema = z.enum(ESTADOS_CON_DESTINO);

function estadoDeRuta(valor: unknown): EstadoConDestino {
  const resultado = estadoSchema.safeParse(valor);
  if (!resultado.success) throw new HttpError(400, 'Estado inválido');
  return resultado.data;
}

// Un loteId ausente, que no es UUID, inexistente o de otro tambo responde
// siempre 404, para no distinguir entre los casos (RF-17, RF-20).
const cuerpoPutSchema = z.object({ loteId: z.uuid() });

function loteIdDelCuerpo(cuerpo: unknown): string {
  const resultado = cuerpoPutSchema.safeParse(cuerpo);
  if (!resultado.success) throw new HttpError(404, 'Lote no encontrado');
  return resultado.data.loteId;
}

// Arma la lista completa de destinos del tambo: siempre 4 elementos, en el
// orden de pantalla, con `lote: null` cuando el estado no tiene destino (RF-11, RF-14).
async function listarDestinos(establecimientoId: string) {
  const reglas = await prisma.reglaLote.findMany({
    where: { establecimientoId },
    select: { estado: true, lote: { select: { id: true, nombre: true } } },
  });
  return ESTADOS_CON_DESTINO.map((estado) => ({
    estado,
    lote: reglas.find((r) => r.estado === estado)?.lote ?? null,
  }));
}

// GET /api/reglas-lote — los 4 estados con su lote destino (o null).
rutasReglasLote.get('/', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  res.json(await listarDestinos(establecimientoId));
});

// PUT /api/reglas-lote/:estado — { loteId }. Elige el lote destino del estado
// y reemplaza el anterior (RF-12). Devuelve la lista completa actualizada, igual
// que el GET, para que la web pueda reemplazar lo que muestra sin otro pedido.
rutasReglasLote.put('/:estado', soloAdministra, async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const estado = estadoDeRuta(req.params.estado);
  const loteId = loteIdDelCuerpo(req.body);

  try {
    // upsert por (establecimientoId, estado): si el estado ya tenía destino lo
    // reemplaza, y si no, lo crea. Elegir el mismo lote no cambia nada (RF-12).
    // El establecimientoId es siempre el de la sesión, nunca uno del cuerpo.
    await prisma.reglaLote.upsert({
      where: { establecimientoId_estado: { establecimientoId, estado } },
      create: { establecimientoId, estado, loteId },
      update: { loteId },
    });
  } catch (err) {
    // No se consulta antes si el lote existe: lo decide la clave foránea
    // compuesta (establecimientoId, loteId) → lotes. Falla (P2003) si el lote
    // no existe, es de otro tambo o se eliminó en paralelo, y en los tres casos
    // respondemos 404. Así nunca queda un destino colgado (RF-17, RF-31).
    if (esErrorPrisma(err, 'P2003')) throw new HttpError(404, 'Lote no encontrado');
    throw err;
  }

  res.json(await listarDestinos(establecimientoId));
});

// DELETE /api/reglas-lote/:estado — deja el estado sin destino (RF-13).
// Es idempotente: si ya no tenía destino, responde 204 igual.
rutasReglasLote.delete('/:estado', soloAdministra, async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const estado = estadoDeRuta(req.params.estado);

  // deleteMany (y no delete) para filtrar por tambo y no fallar si no hay regla.
  await prisma.reglaLote.deleteMany({ where: { establecimientoId, estado } });
  res.status(204).end();
});
