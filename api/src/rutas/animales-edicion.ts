import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, esErrorPrisma } from '../errores.js';
import { normalizarNumero } from '../validacion.js';
import { requiereRol, requiereSesion, usuarioActual } from '../auth/middleware.js';
import { fechaADate, hoyArgentina } from '../animales/reglas.js';
import {
  evaluarEdicion,
  interpretarCuerpo,
  type AnimalParaEditar,
  type MadreEncontrada,
} from '../animales/edicion.js';
import { ahora } from '../reloj.js';
import { siguienteRegistro } from '../reproduccion/bloqueo.js';
import { bloquearLoteDestino, MENSAJE_LOTE_DESAPARECIO } from '../animales/mover.js';
import { leerFicha } from './animales.js';
import { buscarBajasPorNumero, textoAvisoNumeroDeBaja } from '../bajas/numero-de-baja.js';

// Editar un animal y leer su historial de cambios manuales (spec 005).
// Orden de controles: sesión (401) → rol (403) → formato del cuerpo (400) → animal (404) →
// [dentro de la transacción, con bloqueos] "sin cambios" (400) → reglas de datos (400) →
// conflictos (409) → se guarda todo junto (RF-16). Todo se filtra por el establecimientoId de la
// sesión. La sesión y el rol también se controlan en app.ts ANTES de los parsers de JSON.
export const rutasAnimalesEdicion = Router();
rutasAnimalesEdicion.use(requiereSesion);

const soloEdicion = requiereRol('DUENO', 'ENCARGADO');
const NO_ENCONTRADO = 'Animal no encontrado';
const TOPE_HISTORIAL = 100;

// Un id mal formado responde 404, igual que uno inexistente, ajeno o de baja.
function idAnimal(texto: string | string[] | undefined): string {
  const id = z.uuid().safeParse(texto);
  if (!id.success) throw new HttpError(404, NO_ENCONTRADO);
  return id.data;
}

// Error con el mensaje como texto principal (la web lo muestra tal cual) y, si se conoce el campo,
// también en `detalles` para marcarlo junto a su campo.
const errorConCampo = (estado: number, mensaje: string, campo?: string) =>
  new HttpError(estado, mensaje, campo ? [{ campo, mensaje }] : undefined);

// Fila cruda del animal leída con `FOR UPDATE` (textos casteados en SQL para recibir strings).
type FilaAnimal = {
  id: string;
  numero: string;
  sexo: 'HEMBRA' | 'MACHO';
  estado: AnimalParaEditar['estado'];
  fechaNacimiento: string | null;
  madreId: string | null;
  madreNumero: string | null;
  madreFecha: string | null;
};

// PATCH /api/animales/:id — edita número, sexo, fecha de nacimiento y madre (RF-1 a RF-8, RF-14).
// Devuelve la ficha actualizada.
rutasAnimalesEdicion.patch('/:id', soloEdicion, async (req, res) => {
  const { establecimientoId, id: usuarioId, nombre: usuarioNombre } = usuarioActual(req);

  // 1) Formato del cuerpo (400), antes de buscar el animal.
  const interpretado = interpretarCuerpo(req.body);
  if ('rechazo' in interpretado) {
    const { mensaje, campo } = interpretado.rechazo;
    throw errorConCampo(400, mensaje, campo);
  }
  const datos = interpretado.datos;
  const animalId = idAnimal(req.params.id);
  const hoy = hoyArgentina(ahora());
  let numeroCambiado = false; // para el aviso de número de un animal de baja (RF-14)

  try {
    await prisma.$transaction(
      async (tx) => {
        // 2) Madre pedida (solo si el pedido trae un número de madre).
        let madreNueva: MadreEncontrada | null | undefined;
        if (typeof datos.madre === 'string') {
          // Serializa todas las ediciones de madre del mismo tambo: así dos pedidos que juntos
          // cerrarían un ciclo (A→B y B→A, o de tres) no se pisan, y el segundo ve al primero.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${establecimientoId}, 0))`;

          const numero = normalizarNumero(datos.madre);
          madreNueva = null; // genérico: no existe, es de otro tambo o está de baja
          if (numero) {
            const candidata = await tx.animal.findFirst({
              where: { establecimientoId, numero, estado: { not: 'BAJA' } },
              select: { id: true },
            });
            if (candidata) {
              // Se bloquea la madre ANTES que el animal (mismo orden que la anulación del parto,
              // que bloquea a la vaca y después a su cría): así no hay interbloqueos entre ambas.
              const filas = await tx.$queryRaw<MadreEncontrada[]>`
                SELECT "id"::text AS "id", "numero", "sexo"::text AS "sexo", "fechaNacimiento"::text AS "fechaNacimiento"
                FROM "animales"
                WHERE "id" = ${candidata.id}::uuid AND "establecimientoId" = ${establecimientoId}::uuid
                  AND "estado" <> 'BAJA' AND "numero" = ${numero}
                FOR UPDATE`;
              // Releída con el bloqueo: si mientras tanto cambió de número o se dio de baja, ya no es ella.
              madreNueva = filas[0] ?? null;
            }
          }
        }

        // 3) El animal, bloqueado y releído con sus datos firmes (404 si no existe, es ajeno o de baja).
        const filas = await tx.$queryRaw<FilaAnimal[]>`
          SELECT a."id"::text AS "id", a."numero", a."sexo"::text AS "sexo", a."estado"::text AS "estado",
                 a."fechaNacimiento"::text AS "fechaNacimiento", a."madreId"::text AS "madreId",
                 m."numero" AS "madreNumero", m."fechaNacimiento"::text AS "madreFecha"
          FROM "animales" a LEFT JOIN "animales" m ON m."id" = a."madreId"
          WHERE a."id" = ${animalId}::uuid AND a."establecimientoId" = ${establecimientoId}::uuid
            AND a."estado" <> 'BAJA'
          FOR UPDATE OF a`;
        const fila = filas[0];
        if (!fila) throw new HttpError(404, NO_ENCONTRADO);

        // 4) Lo demás que necesitan las reglas, ya con el animal bloqueado.
        const [criaParto, eventos, crias] = await Promise.all([
          tx.criaParto.count({ where: { animalId } }),
          // La baja no cuenta como "evento registrado" (spec 006): solo existe con el animal de baja.
          tx.evento.count({ where: { animalId, anuladoEn: null, tipo: { not: 'BAJA' } } }),
          tx.animal.count({ where: { madreId: animalId } }), // crías de cualquier estado
        ]);
        const animal: AnimalParaEditar = {
          id: fila.id,
          numero: fila.numero,
          sexo: fila.sexo,
          estado: fila.estado,
          fechaNacimiento: fila.fechaNacimiento,
          madre: fila.madreId ? { id: fila.madreId, numero: fila.madreNumero!, fechaNacimiento: fila.madreFecha } : null,
          esCriaDeParto: criaParto > 0,
          tieneEventosOCrias: eventos > 0 || crias > 0,
        };

        // ¿La madre pedida es descendiente del animal? Se sube por madreId desde ella: si se llega al
        // animal, asignarla cerraría un ciclo. UNION (sin ALL) corta solo si hubiera un ciclo ajeno.
        let esDescendiente = false;
        if (madreNueva) {
          const sube = await tx.$queryRaw<{ id: string }[]>`
            WITH RECURSIVE sube(id) AS (
              SELECT ${madreNueva.id}::uuid
              UNION
              SELECT a."madreId" FROM "animales" a JOIN sube s ON a."id" = s."id" WHERE a."madreId" IS NOT NULL)
            SELECT "id"::text AS "id" FROM sube WHERE "id" = ${animalId}::uuid`;
          esDescendiente = sube.length > 0;
        }

        // ¿Otro animal activo del tambo ya tiene el número nuevo? (La base lo vuelve a controlar
        // con el índice único: si dos ediciones simultáneas llegan acá a la vez, una da P2002.)
        let numeroOcupado = false;
        if (datos.numero !== undefined && datos.numero !== animal.numero) {
          const otro = await tx.animal.findFirst({
            where: { establecimientoId, numero: datos.numero, estado: { not: 'BAJA' }, id: { not: animalId } },
            select: { id: true },
          });
          numeroOcupado = otro !== null;
        }

        // 5) Reglas puras: devuelven el primer rechazo (RF-16) o los cambios a guardar.
        const resultado = evaluarEdicion(datos, { animal, hoy, madreNueva, esDescendiente, numeroOcupado });
        if ('rechazo' in resultado) {
          const { estado, mensaje, campo } = resultado.rechazo;
          throw errorConCampo(estado, mensaje, campo);
        }

        // 6) Escritura: el animal y una fila de historial por dato, todo en la misma transacción (RF-8, RF-14).
        const cambios = resultado.cambios;
        const campos = new Set(cambios.map((c) => c.campo));
        numeroCambiado = campos.has('NUMERO');
        await tx.animal.update({
          where: { id: animalId },
          data: {
            ...(campos.has('NUMERO') && { numero: datos.numero }),
            ...(campos.has('SEXO') && { sexo: datos.sexo }),
            ...(campos.has('FECHA_NACIMIENTO') && {
              fechaNacimiento: datos.fechaNacimiento ? fechaADate(datos.fechaNacimiento) : null,
            }),
            ...(campos.has('MADRE') && { madreId: madreNueva ? madreNueva.id : null }),
          },
        });
        // Todos los registros de un guardado comparten el mismo momento, que nunca es anterior al
        // del último evento del animal (así "movimiento posterior al evento" es confiable, RF-13).
        const creadoEn = await siguienteRegistro(tx, animalId);
        await tx.cambioAnimal.createMany({
          data: cambios.map((c) => ({ establecimientoId, animalId, usuarioId, usuarioNombre, creadoEn, ...c })),
        });
      },
      { timeout: 15_000 },
    );
  } catch (err) {
    // El índice único de número entre activos es la garantía final cuando dos ediciones (o una
    // edición y un alta o parto) simultáneas buscan el mismo número.
    if (esErrorPrisma(err, 'P2002')) throw new HttpError(409, 'Ya existe un animal activo con ese número');
    throw err;
  }

  const ficha = await leerFicha(prisma, animalId, establecimientoId);
  if (!ficha) throw new HttpError(404, NO_ENCONTRADO);
  // Aviso (RF-14): si se cambió el número y pertenecía a un animal de baja, se avisa una sola vez (no persiste).
  const avisos: string[] = [];
  if (numeroCambiado) {
    const previa = (await buscarBajasPorNumero(prisma, establecimientoId, [ficha.numero])).get(ficha.numero);
    if (previa) avisos.push(textoAvisoNumeroDeBaja(ficha.numero, previa));
  }
  res.json({ ...ficha, avisos });
});

// PATCH /api/animales/:id/lote — mueve el animal a otro lote o lo deja sin lote (RF-9 a RF-14).
// Cuerpo: { loteId: uuid | null }. No toca el estado. Devuelve la ficha actualizada.
// Orden: formato 400 → animal 404 → lote 404 → [transacción] mismo lote 400 → lote desaparecido 409.
rutasAnimalesEdicion.patch('/:id/lote', soloEdicion, async (req, res) => {
  const { establecimientoId, id: usuarioId, nombre: usuarioNombre } = usuarioActual(req);

  // 1) Formato (400): solo se admite `loteId` (string o null); `establecimientoId` se ignora.
  const cuerpo: unknown = req.body;
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
    throw new HttpError(400, 'El pedido tiene que ser un objeto con el lote');
  }
  const c = cuerpo as Record<string, unknown>;
  for (const clave of Object.keys(c)) {
    if (clave === 'loteId' || clave === 'establecimientoId') continue;
    if (clave === 'estado') throw new HttpError(400, 'El estado no se cambia a mano: lo cambian los eventos');
    throw new HttpError(400, `El dato «${clave}» no se puede editar`);
  }
  if (!('loteId' in c)) throw new HttpError(400, 'Falta indicar el lote (o null para dejar al animal sin lote)');
  if (c.loteId !== null && typeof c.loteId !== 'string') {
    throw new HttpError(400, 'El lote tiene que ser un identificador o null');
  }
  const loteId = c.loteId;
  const animalId = idAnimal(req.params.id);

  // 2) Búsquedas sin bloqueo (404). Lote ajeno, inexistente y mal formado dan el mismo 404.
  const animal = await prisma.animal.findFirst({
    where: { id: animalId, establecimientoId, estado: { not: 'BAJA' } },
    select: { id: true },
  });
  if (!animal) throw new HttpError(404, NO_ENCONTRADO);
  if (loteId !== null) {
    const idLote = z.uuid().safeParse(loteId);
    const lote = idLote.success
      ? await prisma.lote.findFirst({ where: { id: idLote.data, establecimientoId }, select: { id: true } })
      : null;
    if (!lote) throw new HttpError(404, 'Lote no encontrado');
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        // 3) El animal, bloqueado y releído (puede haber cambiado de lote o de baja mientras tanto).
        const filas = await tx.$queryRaw<{ loteId: string | null; loteNombre: string | null }[]>`
          SELECT a."loteId"::text AS "loteId", l."nombre" AS "loteNombre"
          FROM "animales" a LEFT JOIN "lotes" l ON l."id" = a."loteId"
          WHERE a."id" = ${animalId}::uuid AND a."establecimientoId" = ${establecimientoId}::uuid
            AND a."estado" <> 'BAJA'
          FOR UPDATE OF a`;
        const actual = filas[0];
        if (!actual) throw new HttpError(404, NO_ENCONTRADO);

        // 4) Mismo lote (400), antes del conflicto del lote desaparecido (409).
        if (actual.loteId === loteId) {
          throw new HttpError(400, loteId === null ? 'El animal ya está sin lote' : 'El animal ya está en ese lote');
        }

        // 5) El lote destino, con FOR SHARE: si ya no existe, 409 sin guardar nada.
        const destino = loteId === null ? null : await bloquearLoteDestino(tx, establecimientoId, loteId);

        // 6) Escritura: el animal y su fila de historial (con el nombre copiado), todo junto.
        await tx.animal.update({ where: { id: animalId }, data: { loteId: destino ? destino.id : null } });
        await tx.cambioAnimal.create({
          data: {
            establecimientoId,
            animalId,
            campo: 'LOTE',
            valorAnterior: actual.loteNombre,
            valorNuevo: destino ? destino.nombre : null,
            usuarioId,
            usuarioNombre,
            // Nunca anterior al último evento del animal: así "movimiento posterior al evento" es confiable (RF-13).
            creadoEn: await siguienteRegistro(tx, animalId),
          },
        });
      },
      { timeout: 15_000 },
    );
  } catch (err) {
    // La clave foránea (ON DELETE RESTRICT) es la garantía final si alguien elimina el lote justo ahora.
    if (esErrorPrisma(err, 'P2003')) throw new HttpError(409, MENSAJE_LOTE_DESAPARECIO);
    throw err;
  }

  const ficha = await leerFicha(prisma, animalId, establecimientoId);
  if (!ficha) throw new HttpError(404, NO_ENCONTRADO);
  res.json(ficha);
});

// GET /api/animales/:id/cambios — los últimos 100 cambios manuales y el total (RF-15, RF-18).
// Lo ven los tres roles.
rutasAnimalesEdicion.get('/:id/cambios', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const animalId = idAnimal(req.params.id);
  const animal = await prisma.animal.findFirst({
    where: { id: animalId, establecimientoId, estado: { not: 'BAJA' } },
    select: { id: true },
  });
  if (!animal) throw new HttpError(404, NO_ENCONTRADO);

  const donde = { animalId, establecimientoId };
  const [total, cambios] = await Promise.all([
    prisma.cambioAnimal.count({ where: donde }),
    prisma.cambioAnimal.findMany({
      where: donde,
      // Más nuevo primero; dentro de un mismo guardado, el orden del enum (número, sexo, fecha, madre, lote).
      orderBy: [{ creadoEn: 'desc' }, { campo: 'asc' }],
      take: TOPE_HISTORIAL,
      select: { id: true, campo: true, valorAnterior: true, valorNuevo: true, usuarioId: true, usuarioNombre: true, creadoEn: true },
    }),
  ]);
  res.json({ total, cambios });
});
