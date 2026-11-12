import { Router } from 'express';
import { z, ZodError } from 'zod';
import { prisma } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError, esErrorPrisma } from '../errores.js';
import { normalizarNumero, numeroSchema } from '../validacion.js';
import { requiereRol, requiereSesion, usuarioActual } from '../auth/middleware.js';
import { ESTADOS_INICIALES, hoyArgentina, puedeTenerEstado, validarFechaNacimiento, fechaADate } from '../animales/reglas.js';
import { compararNumeros } from '../animales/orden.js';
import { analizarTexto, confirmarPlanilla, filaPublica } from '../animales/carga.js';
import { buscarBajasPorNumero } from '../bajas/numero-de-baja.js';
import { motivoATexto } from '../bajas/validacion.js';

// Animales del tambo (spec 002). Todos los usuarios pueden consultar; solo dueño y
// encargado pueden dar de alta (RF-40). Toda consulta se filtra por el
// establecimientoId de la sesión y nunca se acepta uno enviado por el cliente (RF-37).
// Orden de controles: sesión (401) → rol (403) → validación (400) → búsqueda (404).
export const rutasAnimales = Router();
rutasAnimales.use(requiereSesion);

// Middleware de la ruta de alta: va ANTES de leer el cuerpo, así el veterinario
// recibe 403 aunque los datos sean inválidos (RF-40).
const soloCarga = requiereRol('DUENO', 'ENCARGADO');

const MAX_LISTADO = 2000; // RF-26

// "Activo" = cualquier estado menos BAJA. Los dados de baja no se listan ni se buscan (spec 002).
const ACTIVO = { not: 'BAJA' } as const;

// Fecha AAAA-MM-DD a partir de una columna @db.Date (que Prisma entrega como Date UTC).
const aTextoFecha = (fecha: Date | null) => (fecha ? fecha.toISOString().slice(0, 10) : null);

// Error de validación de un campo, con el mismo formato (400 con "detalles") que
// los errores de zod, así la web lo muestra debajo del campo correspondiente.
function errorDeCampo(campo: string, mensaje: string): ZodError {
  return new ZodError([{ code: 'custom', path: [campo], message: mensaje, input: undefined }]);
}

// La web puede mandar un campo opcional vacío (""): se trata como "no vino".
const opcionalVacioANulo = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const altaSchema = z
  .object({
    numero: numeroSchema,
    sexo: z.enum(['HEMBRA', 'MACHO'], { error: 'El sexo tiene que ser hembra o macho' }),
    estado: z.enum(ESTADOS_INICIALES, {
      error: 'El estado tiene que ser recién nacido, vaquillona, en ordeñe o seca',
    }),
    fechaNacimiento: z.preprocess(
      opcionalVacioANulo,
      z.string({ error: 'La fecha de nacimiento tiene que ser un texto AAAA-MM-DD' }).nullish(),
    ),
    madre: z.preprocess(opcionalVacioANulo, z.string({ error: 'El número de la madre tiene que ser un texto' }).nullish()),
    // Cualquier otro campo (por ejemplo un establecimientoId) se descarta: z.object ignora lo que no declara.
  })
  // Un macho solo puede ser recién nacido (RF-5).
  .refine((d) => puedeTenerEstado(d.sexo, d.estado), {
    path: ['estado'],
    error: 'Un macho solo puede tener el estado recién nacido',
  });

// Qué se lee del animal para armar las respuestas.
const seleccionAnimal = {
  id: true,
  numero: true,
  sexo: true,
  estado: true,
  fechaNacimiento: true,
  lote: { select: { id: true, nombre: true } },
} as const;

// POST /api/animales — alta manual (RF-1 a RF-9).
rutasAnimales.post('/', soloCarga, async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const datos = altaSchema.parse(req.body);

  try {
    // Con madre, todo va en una transacción para que la madre quede BLOQUEADA hasta crear a la cría: si
    // en ese momento otra persona da de baja a la madre, espera (y la cría ya quedó vinculada) o la
    // cría se rechaza porque la madre ya no es activa (spec 006, RF-15 d y RF-16). Sin madre no hay
    // nada que bloquear y se usa el cliente directo.
    const hacerAlta = async (tx: Pick<Prisma.TransactionClient, 'animal' | 'reglaLote' | '$queryRaw'>) => {
        // Madre (RF-7): hembra activa del mismo tambo y distinta del propio animal. Todos
        // los casos inválidos dan el mismo mensaje, sin revelar nada de otros tambos.
        let madre: { id: string; fechaNacimiento: string | null } | null = null;
        if (datos.madre) {
          const numeroMadre = normalizarNumero(datos.madre);
          const mensaje = `No hay una hembra activa con el número ${numeroMadre ?? datos.madre.trim()}`;
          if (numeroMadre === null || numeroMadre === datos.numero) throw errorDeCampo('madre', mensaje);
          // FOR UPDATE: si la fila ya está tomada por una baja, espera y la vuelve a evaluar (si ya es de baja, no aparece).
          const filas = await tx.$queryRaw<{ id: string; fechaNacimiento: string | null }[]>`
            SELECT "id"::text AS "id", "fechaNacimiento"::text AS "fechaNacimiento"
            FROM "animales"
            WHERE "establecimientoId" = ${establecimientoId}::uuid AND "numero" = ${numeroMadre}
              AND "sexo" = 'HEMBRA' AND "estado" <> 'BAJA'
            FOR UPDATE`;
          madre = filas[0] ?? null;
          if (!madre) throw errorDeCampo('madre', mensaje);
        }

        // Fecha de nacimiento (RF-6): hoy según la hora de Argentina y, si la madre tiene fecha, posterior.
        if (datos.fechaNacimiento) {
          const error = validarFechaNacimiento(datos.fechaNacimiento, hoyArgentina(), madre?.fechaNacimiento ?? null);
          if (error) throw errorDeCampo('fechaNacimiento', error);
        }

        // Lote destino del estado (RF-1). Sin regla, el animal queda sin lote (RF-8).
        const regla = await tx.reglaLote.findFirst({
          where: { establecimientoId, estado: datos.estado },
          select: { loteId: true },
        });

        const creado = await tx.animal.create({
          data: {
            establecimientoId, // siempre el tambo de la sesión
            numero: datos.numero,
            sexo: datos.sexo,
            estado: datos.estado,
            fechaNacimiento: datos.fechaNacimiento ? fechaADate(datos.fechaNacimiento) : null,
            madreId: madre?.id ?? null,
            loteId: regla?.loteId ?? null,
          },
          select: seleccionAnimal,
        });
        return { creado, sinRegla: !regla };
    };
    const alta = datos.madre ? await prisma.$transaction((tx) => hacerAlta(tx), { timeout: 15_000 }) : await hacerAlta(prisma);

    // Aviso (RF-14): el número perteneció a un animal dado de baja. No se guarda en ningún lado.
    const previa = (await buscarBajasPorNumero(prisma, establecimientoId, [datos.numero])).get(datos.numero);
    res.status(201).json({
      animal: { ...alta.creado, fechaNacimiento: aTextoFecha(alta.creado.fechaNacimiento) },
      avisoSinLote: alta.sinRegla ? { estado: datos.estado } : null,
      avisoNumeroDeBaja: previa ?? null,
    });
  } catch (err) {
    // Los dos choques los detecta la base (así valen también con operaciones simultáneas):
    // P2002 = el índice único del número entre activos (RF-3, RF-4);
    // P2003 = la clave foránea compuesta del lote: se eliminó justo antes (RF-9).
    if (esErrorPrisma(err, 'P2002')) throw new HttpError(409, 'Ya existe un animal activo con ese número');
    if (esErrorPrisma(err, 'P2003')) throw new HttpError(409, 'El lote destino ya no existe, volvé a intentar');
    throw err;
  }
});

// Cuerpo de la carga desde planilla: el texto pegado, tal cual.
const planillaSchema = z.object({ texto: z.string({ error: 'El texto de la planilla es obligatorio' }) });

// POST /api/animales/planilla/vista-previa — analiza el texto y NO guarda nada (RF-11, RF-20).
// `soloCarga` va antes de leer el cuerpo: el veterinario recibe 403 aunque los datos sean inválidos (RF-40).
// Se declara antes de /:id (que es solo GET) por claridad.
rutasAnimales.post('/planilla/vista-previa', soloCarga, async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const { texto } = planillaSchema.parse(req.body);
  const { filas, sinLotePorEstado, bajasPorNumero } = await analizarTexto(texto, establecimientoId);
  const correctas = filas.filter((f) => f.ok).length;
  res.json({
    filas: filas.map((f) => filaPublica(f, bajasPorNumero)),
    resumen: { total: filas.length, correctas, conError: filas.length - correctas, sinLotePorEstado },
  });
});

// POST /api/animales/planilla/confirmar — revalida el texto crudo y guarda las filas correctas (RF-18, RF-19, RF-21).
rutasAnimales.post('/planilla/confirmar', soloCarga, async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const { texto } = planillaSchema.parse(req.body);
  res.json(await confirmarPlanilla(texto, establecimientoId));
});

// GET /api/animales?estado=&loteId= — activos del tambo (RF-23 a RF-26).
rutasAnimales.get('/', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);

  // Estado: uno de los 4 activos. Cualquier otro valor (incluido BAJA o vacío) da 400.
  let estado: (typeof ESTADOS_INICIALES)[number] | undefined;
  if (req.query.estado !== undefined) {
    const r = z.enum(ESTADOS_INICIALES).safeParse(req.query.estado);
    if (!r.success) throw new HttpError(400, 'El estado tiene que ser recién nacido, vaquillona, en ordeñe o seca');
    estado = r.data;
  }

  // Lote: un UUID de un lote del tambo o "sin-lote". Mal formado, inexistente o de
  // otro tambo dan el mismo 404, sin distinguir (RF-25).
  let loteId: string | null | undefined;
  if (req.query.loteId !== undefined) {
    if (req.query.loteId === 'sin-lote') {
      loteId = null;
    } else {
      const uuid = z.uuid().safeParse(req.query.loteId);
      const lote = uuid.success
        ? await prisma.lote.findFirst({ where: { id: uuid.data, establecimientoId }, select: { id: true } })
        : null;
      if (!lote) throw new HttpError(404, 'Lote no encontrado');
      loteId = lote.id;
    }
  }

  const animales = await prisma.animal.findMany({
    where: { establecimientoId, estado: estado ?? ACTIVO, ...(loteId !== undefined && { loteId }) },
    select: { id: true, numero: true, sexo: true, estado: true, lote: { select: { nombre: true } } },
  });

  // Orden natural en JavaScript (la base ordenaría "10" antes que "9"), y recién
  // después el recorte: el total se cuenta antes (RF-26).
  animales.sort((a, b) => compararNumeros(a.numero, b.numero));
  const mostrados = animales.slice(0, MAX_LISTADO);
  res.json({ total: animales.length, mostrados: mostrados.length, truncado: animales.length > MAX_LISTADO, animales: mostrados });
});

// GET /api/animales/buscar?numero= — búsqueda exacta para el buscador y el bastón (RF-33 a RF-36).
// Se declara ANTES de /:id, si no Express tomaría "buscar" como un id.
rutasAnimales.get('/buscar', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);

  // Ausente, repetido o vacío al limpiar los extremos: 400 (el buscador no llama en ese caso).
  if (typeof req.query.numero !== 'string' || req.query.numero.trim() === '') {
    throw new HttpError(400, 'Indicá el número a buscar');
  }
  // Un número con caracteres no permitidos recibe la misma respuesta que uno inexistente.
  const numero = normalizarNumero(req.query.numero);
  const animal = numero
    ? await prisma.animal.findFirst({
        where: { establecimientoId, numero, estado: ACTIVO },
        select: { id: true, numero: true },
      })
    : null;
  if (!animal) throw new HttpError(404, 'No hay un animal activo con ese número');
  res.json(animal);
});

// Ficha de un animal activo del tambo (la usan GET /:id y la edición, spec 005). Devuelve `null` si
// no existe, es de otro tambo o está de baja: el llamador responde siempre el mismo 404.
export async function leerFicha(
  cliente: Pick<typeof prisma, 'animal'>,
  id: string,
  establecimientoId: string,
) {
  const animal = await cliente.animal.findFirst({
    where: { id, establecimientoId, estado: ACTIVO },
    select: {
      ...seleccionAnimal,
      madre: { select: { id: true, numero: true, estado: true, motivoBaja: true } },
      // Todas las crías: las activas con acceso y las de baja con su marca según el motivo (spec 006).
      crias: { select: { id: true, numero: true, estado: true, motivoBaja: true } },
      // Parto del que nació (spec 004): su fecha y la genética (servicio y semen o toro).
      criaDeParto: {
        select: {
          parto: {
            select: {
              evento: { select: { id: true, fecha: true } },
              servicio: { select: { fecha: true, servicio: { select: { semen: { select: { id: true, nombre: true } } } } } },
            },
          },
        },
      },
    },
  });
  if (!animal) return null;
  return {
    id: animal.id,
    numero: animal.numero,
    sexo: animal.sexo,
    estado: animal.estado,
    fechaNacimiento: aTextoFecha(animal.fechaNacimiento),
    lote: animal.lote,
    // La madre puede haber sido dada de baja: se muestra el número con la marca "dada de baja". `motivoBaja`
    // dice si hay acceso a su ficha de baja ("venta" o "muerte") o no ("parto_anulado"); null si está activa.
    madre: animal.madre
      ? {
          id: animal.madre.id,
          numero: animal.madre.numero,
          activa: animal.madre.estado !== 'BAJA',
          motivoBaja: animal.madre.estado === 'BAJA' ? motivoATexto(animal.madre.motivoBaja ?? 'PARTO_ANULADO') : null,
        }
      : null,
    crias: animal.crias
      .filter((c) => c.estado !== 'BAJA')
      .map((c) => ({ id: c.id, numero: c.numero }))
      .sort((a, b) => compararNumeros(a.numero, b.numero)),
    // Crías dadas de baja, con su motivo (acceso a su ficha de baja solo si "venta" o "muerte").
    criasDeBaja: animal.crias
      .filter((c) => c.estado === 'BAJA')
      .map((c) => ({ id: c.id, numero: c.numero, motivo: motivoATexto(c.motivoBaja ?? 'PARTO_ANULADO') }))
      .sort((a, b) => compararNumeros(a.numero, b.numero)),
    // null si el animal no nació de un parto cargado. `genetica` es null si el parto no vinculó servicio;
    // con servicio sin semen o toro, `semen` es null ("sin dato").
    parto: animal.criaDeParto
      ? {
          eventoId: animal.criaDeParto.parto.evento.id,
          fecha: aTextoFecha(animal.criaDeParto.parto.evento.fecha),
          genetica: animal.criaDeParto.parto.servicio
            ? {
                fechaServicio: aTextoFecha(animal.criaDeParto.parto.servicio.fecha),
                semen: animal.criaDeParto.parto.servicio.servicio?.semen ?? null,
              }
            : null,
        }
      : null,
  };
}

// GET /api/animales/:id — ficha (RF-28 a RF-30, RF-38).
rutasAnimales.get('/:id', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);

  // Mal formado, inexistente, de otro tambo o dado de baja: siempre el mismo 404.
  const id = z.uuid().safeParse(req.params.id);
  const ficha = id.success ? await leerFicha(prisma, id.data, establecimientoId) : null;
  if (!ficha) throw new HttpError(404, 'Animal no encontrado');
  res.json(ficha);
});
