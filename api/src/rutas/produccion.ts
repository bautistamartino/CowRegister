import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { requiereDuenoOEncargado, requiereSesion, usuarioActual } from '../auth/middleware.js';
import { motivoAnulacionSchema } from '../validacion.js';
import { anularProduccion } from '../produccion/anular.js';
import { cargarProduccion } from '../produccion/cargar.js';
import { NO_ENCONTRADO, idUuid, leerFicha } from '../produccion/leer.js';
import { cargaSchema } from '../produccion/validacion.js';

// Producción: litros por vaca (spec 008). Orden de controles al escribir: sesión (401) → rol (403) →
// cuerpo (400) → animal (404) → [dentro de la transacción] estado (409) → duplicado (409). La sesión
// y el rol también se controlan en app.ts ANTES de los parsers de JSON (un JSON roto del veterinario
// da 403, no 400). Todo se filtra por el establecimientoId de la sesión; el del cuerpo o la query se
// descarta (los esquemas de zod ignoran lo que no declaran).

// ─── Vacas activas: se monta bajo /api/animales ─────────────────────────────────────────────

export const rutasProduccion = Router();
rutasProduccion.use(requiereSesion);

// POST /api/animales/:id/produccion — { fecha, turno: "manana"|"tarde", litros, id? }. 201 con el registro
// (también cuando es la repetición idempotente de una carga con el mismo id).
rutasProduccion.post('/:id/produccion', requiereDuenoOEncargado, async (req, res) => {
  const { establecimientoId, id: usuarioId } = usuarioActual(req);
  const datos = cargaSchema.parse(req.body); // 400 antes de buscar la vaca, aunque no exista
  const animalId = idUuid(req.params.id);
  res.status(201).json(await cargarProduccion({ animalId, establecimientoId, usuarioId, datos }));
});

// POST /api/animales/:id/produccion/:registroId/anular — { motivo }. 200 con el registro anulado.
rutasProduccion.post('/:id/produccion/:registroId/anular', requiereDuenoOEncargado, async (req, res) => {
  const { establecimientoId, id: usuarioId } = usuarioActual(req);
  const { motivo } = z.object({ motivo: motivoAnulacionSchema }).parse(req.body);
  const animalId = idUuid(req.params.id);
  const registroId = idUuid(req.params.registroId);
  res.json(await anularProduccion({ animalId, registroId, establecimientoId, usuarioId, motivo }));
});

// GET /api/animales/:id/produccion — ficha de producción de una vaca ACTIVA (los tres roles), con la
// sugerencia de fecha y turno para cargar. 404 idéntico si no es un animal activo del tambo.
rutasProduccion.get('/:id/produccion', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const animalId = idUuid(req.params.id);
  const animal = await prisma.animal.findFirst({
    where: { id: animalId, establecimientoId, estado: { not: 'BAJA' } },
    select: { id: true },
  });
  if (!animal) throw new HttpError(404, NO_ENCONTRADO);
  res.json(await leerFicha(animalId, establecimientoId, true));
});

// ─── Animales de baja: se monta bajo /api/bajas (solo lectura) ──────────────────────────────

export const rutasProduccionBaja = Router();
rutasProduccionBaja.use(requiereSesion);

// GET /api/bajas/:id/produccion — lo mismo para un animal dado de baja por venta o muerte, sin
// sugerencia (no se carga ni se anula). 404 idéntico si es activo, de "parto anulado", ajeno,
// inexistente o mal formado; igual que el historial de la spec 007.
rutasProduccionBaja.get('/:id/produccion', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const animalId = idUuid(req.params.id);
  const animal = await prisma.animal.findFirst({
    where: { id: animalId, establecimientoId, estado: 'BAJA', motivoBaja: { in: ['VENTA', 'MUERTE'] } },
    select: { id: true },
  });
  if (!animal) throw new HttpError(404, NO_ENCONTRADO);
  res.json(await leerFicha(animalId, establecimientoId, false));
});
