import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { normalizarNumero } from '../validacion.js';
import { requiereRol, requiereSesion, usuarioActual } from '../auth/middleware.js';
import { compararNumeros } from '../animales/orden.js';
import { hoyArgentina } from '../animales/reglas.js';
import { ahora } from '../reloj.js';
import { registrarBaja } from '../bajas/baja.js';
import { revertirBaja } from '../bajas/revertir.js';
import { bajaSchema, motivoABase, motivoATexto, reversionSchema } from '../bajas/validacion.js';
import { armarRespuesta, leerEventos } from '../reproduccion/eventos.js';

// Bajas por venta o muerte (spec 006). Orden de controles: sesión (401) → rol (403) → cuerpo (400) →
// animal (404) → [dentro de la transacción] fecha (400) → conflictos (409). La sesión y el rol también
// se controlan en app.ts ANTES de los parsers de JSON (un JSON roto del veterinario da 403, no 400).
// Todo se filtra por el establecimientoId de la sesión; el del cuerpo se ignora.

const NO_ENCONTRADO = 'Animal no encontrado';
const MAX_LISTADO = 2000;
const TOPE_HISTORIAL = 100;
const BAJAS_DE_NEGOCIO = ['VENTA', 'MUERTE'] as const; // "parto anulado" no tiene evento ni lectura

const aTextoFecha = (fecha: Date | null) => (fecha ? fecha.toISOString().slice(0, 10) : null);

// Un id mal formado responde 404, igual que uno inexistente, ajeno o activo.
function idAnimal(texto: string | string[] | undefined): string {
  const id = z.uuid().safeParse(texto);
  if (!id.success) throw new HttpError(404, NO_ENCONTRADO);
  return id.data;
}

// ─── Dar de baja y revertir: se montan bajo /api/animales ────────────────────────────────────

export const rutasBajasAnimal = Router();
rutasBajasAnimal.use(requiereSesion);
const soloBajas = requiereRol('DUENO', 'ENCARGADO');

// POST /api/animales/:id/baja — { motivo: "venta"|"muerte", fecha, observaciones?, id?, cargadoEnDispositivo? }. 201 con la baja.
rutasBajasAnimal.post('/:id/baja', soloBajas, async (req, res) => {
  const { establecimientoId, id: usuarioId, nombre: usuarioNombre } = usuarioActual(req);
  const datos = bajaSchema.parse(req.body); // 400 antes de buscar al animal, aunque no exista
  const animalId = idAnimal(req.params.id);
  // 201 al crear la baja; 200 con { evento, avisos, yaExistia: true } si es el reenvío de una ya guardada (spec 010).
  const resultado = await registrarBaja({ animalId, establecimientoId, usuarioId, usuarioNombre, ...datos });
  res.status(resultado.status).json(resultado.cuerpo);
});

// POST /api/animales/:id/revertir-baja — { motivoReversion }. 200 con la ficha activa y `avisos`.
rutasBajasAnimal.post('/:id/revertir-baja', soloBajas, async (req, res) => {
  const { establecimientoId, id: usuarioId } = usuarioActual(req);
  const { motivoReversion } = reversionSchema.parse(req.body);
  const animalId = idAnimal(req.params.id);
  res.json(await revertirBaja({ animalId, establecimientoId, usuarioId, motivoReversion }));
});

// ─── Listado y ficha de bajas: /api/bajas (los tres roles) ───────────────────────────────────

export const rutasBajas = Router();
rutasBajas.use(requiereSesion);

// GET /api/bajas?motivo=&numero= — bajas VIGENTES por venta o muerte del tambo (RF-12): la más
// reciente primero (fecha de baja y, a igual fecha, momento de registro), con tope de 2.000 y total.
rutasBajas.get('/', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);

  // Motivo: solo "venta" o "muerte". Cualquier otro valor (incluido vacío o repetido) da 400.
  let motivo: 'VENTA' | 'MUERTE' | undefined;
  if (req.query.motivo !== undefined) {
    const m = z.enum(['venta', 'muerte']).safeParse(req.query.motivo);
    if (!m.success) throw new HttpError(400, 'El motivo tiene que ser venta o muerte');
    motivo = motivoABase(m.data);
  }

  // Número: coincidencia exacta del número normalizado, solo entre las bajas. Vacío = sin filtro;
  // un número con caracteres no permitidos no puede coincidir con ninguno (lista vacía).
  let numero: string | undefined;
  if (req.query.numero !== undefined) {
    if (typeof req.query.numero !== 'string') throw new HttpError(400, 'El número tiene que ser un texto');
    if (req.query.numero.trim() !== '') numero = normalizarNumero(req.query.numero) ?? '#sin-coincidencia'; // "#" no es válido en un número: no coincide con ninguno
  }

  const donde = {
    establecimientoId,
    tipo: 'BAJA' as const,
    anuladoEn: null,
    baja: { is: { vigente: true, motivo: motivo ?? { in: [...BAJAS_DE_NEGOCIO] } } },
    animal: { estado: 'BAJA' as const, ...(numero !== undefined && { numero }) },
  };
  const [total, filas] = await Promise.all([
    prisma.evento.count({ where: donde }),
    prisma.evento.findMany({
      where: donde,
      orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }, { id: 'asc' }],
      take: MAX_LISTADO,
      select: { fecha: true, animal: { select: { id: true, numero: true, sexo: true } }, baja: { select: { motivo: true } } },
    }),
  ]);
  const bajas = filas.map((f) => ({
    id: f.animal.id, // el id del animal: es lo que usa la ficha de baja
    numero: f.animal.numero,
    sexo: f.animal.sexo,
    fecha: aTextoFecha(f.fecha),
    motivo: motivoATexto(f.baja!.motivo),
  }));
  res.json({ total, mostrados: bajas.length, truncado: total > MAX_LISTADO, bajas });
});

// GET /api/bajas/:id — ficha de baja de un animal (el id es el del animal), solo lectura (RF-13).
// 404 idéntico si no es una baja vigente por venta o muerte del tambo (activa, ajena, inexistente,
// mal formada o "parto anulado").
rutasBajas.get('/:id', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const animalId = idAnimal(req.params.id);

  const animal = await prisma.animal.findFirst({
    where: { id: animalId, establecimientoId, estado: 'BAJA', motivoBaja: { in: [...BAJAS_DE_NEGOCIO] } },
    select: {
      id: true,
      numero: true,
      sexo: true,
      fechaNacimiento: true,
      madre: { select: { id: true, numero: true, estado: true, motivoBaja: true } },
      // Todas las crías: las activas con acceso, las de baja con su marca según el motivo.
      crias: { select: { id: true, numero: true, estado: true, motivoBaja: true } },
    },
  });
  if (!animal) throw new HttpError(404, NO_ENCONTRADO);

  const donde = { animalId, establecimientoId };
  const [filas, total, cambios] = await Promise.all([
    leerEventos(prisma, animalId, establecimientoId),
    prisma.cambioAnimal.count({ where: donde }),
    prisma.cambioAnimal.findMany({
      where: donde,
      orderBy: [{ creadoEn: 'desc' }, { campo: 'asc' }],
      take: TOPE_HISTORIAL,
      select: { id: true, campo: true, valorAnterior: true, valorNuevo: true, usuarioId: true, usuarioNombre: true, creadoEn: true },
    }),
  ]);

  // La baja vigente: su evento (fecha, quién y cuándo) y su detalle. Tiene que existir (la base lo garantiza).
  const eventoBaja = await prisma.evento.findFirst({
    where: { animalId, establecimientoId, tipo: 'BAJA', anuladoEn: null, baja: { is: { vigente: true } } },
    select: { id: true, fecha: true, creadoEn: true, registradoPor: { select: { nombre: true } }, baja: { select: { motivo: true, observaciones: true, estadoAnterior: true } } },
  });
  if (!eventoBaja?.baja) throw new HttpError(404, NO_ENCONTRADO);

  const { eventos } = armarRespuesta(filas, hoyArgentina(ahora()));
  res.json({
    id: animal.id,
    numero: animal.numero,
    sexo: animal.sexo,
    fechaNacimiento: aTextoFecha(animal.fechaNacimiento),
    estadoAnterior: eventoBaja.baja.estadoAnterior,
    baja: {
      eventoId: eventoBaja.id,
      motivo: motivoATexto(eventoBaja.baja.motivo),
      fecha: aTextoFecha(eventoBaja.fecha),
      observaciones: eventoBaja.baja.observaciones, // null = "sin observaciones"
      registradoPor: eventoBaja.registradoPor.nombre,
      registradoEn: eventoBaja.creadoEn,
    },
    // Madre y crías, con las reglas de vínculos: `activa` y `motivoBaja` dicen si hay acceso a su ficha
    // (activa, o de baja por venta o muerte; las de "parto anulado" se muestran sin acceso).
    madre: animal.madre
      ? {
          id: animal.madre.id,
          numero: animal.madre.numero,
          activa: animal.madre.estado !== 'BAJA',
          motivoBaja: animal.madre.motivoBaja ? motivoATexto(animal.madre.motivoBaja) : null,
        }
      : null,
    crias: animal.crias
      .filter((c) => c.estado !== 'BAJA')
      .map((c) => ({ id: c.id, numero: c.numero }))
      .sort((a, b) => compararNumeros(a.numero, b.numero)),
    criasDeBaja: animal.crias
      .filter((c) => c.estado === 'BAJA')
      .map((c) => ({ id: c.id, numero: c.numero, motivo: motivoATexto(c.motivoBaja ?? 'PARTO_ANULADO') }))
      .sort((a, b) => compararNumeros(a.numero, b.numero)),
    eventos,
    cambios: { total, cambios },
  });
});
