import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, errorDeCampo, esErrorPrisma } from '../errores.js';
import { criasPartoSchema } from '../validacion.js';
import { requiereRol, usuarioActual } from '../auth/middleware.js';
import { fechaADate, hoyArgentina } from '../animales/reglas.js';
import { ahora } from '../reloj.js';
import { puedeParir, puedeSecarse } from '../reproduccion/aptitud.js';
import {
  avisoSinGeneticaFueraDeRango,
  avisoSinGeneticaSinServicio,
  avisoSinLoteCria,
  avisoSinLoteMadre,
  type Aviso,
} from '../reproduccion/avisos.js';
import { bloquearAnimal, siguienteRegistro } from '../reproduccion/bloqueo.js';
import { resolverLotesDestino } from '../reproduccion/destinos.js';
import { eventoPorId, leerEventos } from '../reproduccion/eventos.js';
import { fechaEventoSchema, validarFechaEvento } from '../reproduccion/fechas.js';
import { evaluarGenetica, servicioParaGenetica } from '../reproduccion/genetica.js';
import { validarSeparacionPartos } from '../reproduccion/partos.js';
import { ultimoNoAnulado } from '../reproduccion/situacion.js';

// Registrar un parto (con el alta de las crías vivas) y un secado (spec 004, RF-1 a RF-21).
// Solo dueño y encargado (el veterinario recibe 403): el permiso se controla en app.ts ANTES de los
// parsers de JSON, así un JSON roto da 403 y no 400, y acá otra vez en cada ruta como defensa.
//
// Orden de controles: sesión (401) → rol (403) → cuerpo (400) → id del animal (404) → [dentro de la
// transacción, con el animal bloqueado] animal inexistente (404) → fechas (400) → conflictos (409,
// en el orden de la spec) → se guarda todo junto. Todo se filtra por el establecimientoId de la sesión.
export const rutasPartos = Router();
const soloCarga = requiereRol('DUENO', 'ENCARGADO');

const NO_ENCONTRADO = 'Animal no encontrado';
const MENSAJE_NUMERO_EXISTENTE = 'Ya existe un animal activo con ese número';
const MENSAJE_LOTE_INEXISTENTE = 'El lote destino ya no existe, volvé a intentar';

// Cualquier otro campo del cuerpo (por ejemplo un establecimientoId) se descarta: z.object ignora lo no declarado.
const partoSchema = z.object({ fecha: fechaEventoSchema, crias: criasPartoSchema });
const secadoSchema = z.object({ fecha: fechaEventoSchema });

// Un id de animal mal formado responde 404, igual que uno inexistente o de otro tambo.
function idAnimal(texto: string | string[] | undefined): string {
  const id = z.uuid().safeParse(texto);
  if (!id.success) throw new HttpError(404, NO_ENCONTRADO);
  return id.data;
}

// 409 de número repetido. `detalles` dice en qué cría (0 = la primera) para que la pantalla lo marque.
const errorNumeroExistente = (indice: number) =>
  new HttpError(409, MENSAJE_NUMERO_EXISTENTE, [{ campo: `crias.${indice}.numero`, mensaje: MENSAJE_NUMERO_EXISTENTE }]);

// POST /api/animales/:id/partos — { fecha, crias: [{ sexo, nacidaMuerta?, numero?, observaciones? }] }.
// 201 con { evento, avisos }.
rutasPartos.post('/:id/partos', soloCarga, async (req, res) => {
  const { establecimientoId, id: usuarioId } = usuarioActual(req);
  const datos = partoSchema.parse(req.body);
  const animalId = idAnimal(req.params.id);

  try {
    const resultado = await prisma.$transaction(
      async (tx) => {
        // 1. Bloqueo del animal: desde acá nadie más registra ni anula nada sobre esta vaca, y
        //    todo lo que se lea es firme hasta el final de la transacción (RF-31).
        const madre = await bloquearAnimal(tx, animalId, establecimientoId);
        if (!madre) throw new HttpError(404, NO_ENCONTRADO);
        const filas = await leerEventos(tx, animalId, establecimientoId);
        const hoy = hoyArgentina(ahora());

        // 2. Fechas (400): las de la 003 y, además, estrictamente posterior al nacimiento de la madre.
        const errorFecha = validarFechaEvento(datos.fecha, {
          hoy,
          nacimiento: madre.nacimiento,
          ultimoEvento: ultimoNoAnulado(filas)?.fecha ?? null,
        });
        if (errorFecha) throw errorDeCampo('fecha', errorFecha);
        if (madre.nacimiento && datos.fecha <= madre.nacimiento) {
          throw errorDeCampo('fecha', 'La fecha del parto tiene que ser posterior al nacimiento de la madre');
        }

        // 3. Conflictos (409), en este orden y se informa el primero (RF-12).
        // (1) madre no apta
        const aptitud = puedeParir(madre.sexo, madre.estado);
        if (!aptitud.ok) throw new HttpError(409, aptitud.motivo);
        // (2) menos de 200 días de otro parto
        const errorSeparacion = validarSeparacionPartos(filas, datos.fecha);
        if (errorSeparacion) throw new HttpError(409, errorSeparacion);
        // (3) número de cría existente entre los activos: se revisan todos con una consulta y se
        //     informa el de la primera cría (el orden en que vinieron).
        const vivas = datos.crias.map((cria, indice) => ({ cria, indice })).filter((x) => !x.cria.nacidaMuerta);
        if (vivas.length > 0) {
          const existentes = await tx.animal.findMany({
            where: { establecimientoId, estado: { not: 'BAJA' }, numero: { in: vivas.map((x) => x.cria.numero!) } },
            select: { numero: true },
          });
          const ocupados = new Set(existentes.map((a) => a.numero));
          const primera = vivas.find((x) => ocupados.has(x.cria.numero!));
          if (primera) throw errorNumeroExistente(primera.indice);
        }
        // (4) lote destino que ya no existe: lo decide resolverLotesDestino (toma FOR SHARE del lote).
        const destinos = await resolverLotesDestino(tx, establecimientoId, vivas.length > 0 ? ['EN_ORDENE', 'RECIEN_NACIDO'] : ['EN_ORDENE']);
        const loteMadre = destinos.get('EN_ORDENE') ?? null;
        const loteCrias = destinos.get('RECIEN_NACIDO') ?? null;

        // 4. Genética (RF-15, RF-16): el servicio que originó el parto, si es coherente.
        const servicio = servicioParaGenetica(filas);
        const genetica = evaluarGenetica(servicio, datos.fecha);

        // 5. Se guarda todo en esta misma transacción. El evento común y el detalle del parto,
        //    con el estado y el lote previos de la madre para poder volver atrás al anularlo.
        const eventoId = randomUUID();
        await tx.evento.create({
          data: {
            id: eventoId,
            establecimientoId,
            animalId,
            tipo: 'PARTO',
            fecha: fechaADate(datos.fecha),
            registradoPorId: usuarioId,
            creadoEn: await siguienteRegistro(tx, animalId),
          },
        });
        await tx.parto.create({
          data: {
            eventoId,
            establecimientoId,
            tipo: 'PARTO',
            madreId: animalId,
            estadoAnterior: madre.estado,
            tuvoLoteAnterior: madre.loteId !== null,
            loteAnteriorId: madre.loteId,
            servicioId: genetica.vinculado ? genetica.servicioId : null,
            servicioTipo: genetica.vinculado ? 'SERVICIO' : null,
          },
        });

        // Las crías vivas se dan de alta. Se insertan en orden de número (no de carga) para que dos
        // partos simultáneos con los mismos números cruzados se bloqueen siempre en el mismo orden
        // y no se produzca un interbloqueo (uno gana y el otro recibe 409).
        const animalDeCria = new Map<number, string>();
        const porNumero = [...vivas].sort((a, b) => (a.cria.numero! < b.cria.numero! ? -1 : 1));
        for (const { cria, indice } of porNumero) {
          const id = randomUUID();
          try {
            await tx.animal.create({
              data: {
                id,
                establecimientoId,
                numero: cria.numero!,
                sexo: cria.sexo,
                estado: 'RECIEN_NACIDO',
                fechaNacimiento: fechaADate(datos.fecha),
                madreId: animalId,
                loteId: loteCrias,
              },
            });
          } catch (err) {
            // Otro usuario ocupó el número entre la consulta de arriba y esta inserción: lo decide
            // el índice único de la base (RF-35). Mismo 409 que el control previo.
            if (esErrorPrisma(err, 'P2002')) throw errorNumeroExistente(indice);
            throw err;
          }
          animalDeCria.set(indice, id);
        }
        // Todas las crías (vivas y muertas) quedan en el parto, en el orden en que vinieron.
        for (const [indice, cria] of datos.crias.entries()) {
          await tx.criaParto.create({
            data: {
              establecimientoId,
              eventoId,
              madreId: animalId,
              orden: indice + 1,
              sexo: cria.sexo,
              nacidaMuerta: cria.nacidaMuerta,
              observaciones: cria.observaciones,
              animalId: animalDeCria.get(indice) ?? null,
            },
          });
        }

        // La madre pasa a "en ordeñe" y a su lote destino, aunque ya estuviera en ordeñe (RF-1).
        await tx.animal.update({
          where: { establecimientoId_id: { establecimientoId, id: animalId } },
          data: { estado: 'EN_ORDENE', loteId: loteMadre },
        });

        // 6. Avisos, siempre en el orden fijo de la spec: 1, 3 (uno por cría viva), 4 o 5.
        const avisos: Aviso[] = [];
        if (!loteMadre) avisos.push(avisoSinLoteMadre('EN_ORDENE'));
        if (!loteCrias) for (const { cria } of vivas) avisos.push(avisoSinLoteCria(cria.numero!));
        if (!genetica.vinculado) {
          avisos.push(
            genetica.motivo === 'SIN_SERVICIO'
              ? avisoSinGeneticaSinServicio(filas.some((f) => f.tipo === 'PARTO' && !f.anulado))
              : avisoSinGeneticaFueraDeRango(genetica.fechaServicio),
          );
        }

        return { evento: eventoPorId(await leerEventos(tx, animalId, establecimientoId), eventoId, hoy), avisos };
      },
      { timeout: 15_000 },
    );
    res.status(201).json(resultado);
  } catch (err) {
    // Defensa: una clave foránea falló al escribir (el lote destino desapareció a último momento).
    if (esErrorPrisma(err, 'P2003')) throw new HttpError(409, MENSAJE_LOTE_INEXISTENTE);
    throw err;
  }
});

// POST /api/animales/:id/secados — { fecha }. 201 con { evento, avisos }.
// Es libre: solo exige que sea una hembra "en ordeñe" (RF-18). No toca la situación reproductiva.
rutasPartos.post('/:id/secados', soloCarga, async (req, res) => {
  const { establecimientoId, id: usuarioId } = usuarioActual(req);
  const datos = secadoSchema.parse(req.body);
  const animalId = idAnimal(req.params.id);

  try {
    const resultado = await prisma.$transaction(
      async (tx) => {
        const vaca = await bloquearAnimal(tx, animalId, establecimientoId);
        if (!vaca) throw new HttpError(404, NO_ENCONTRADO);
        const filas = await leerEventos(tx, animalId, establecimientoId);
        const hoy = hoyArgentina(ahora());

        // Fechas (400) y después conflictos (409).
        const errorFecha = validarFechaEvento(datos.fecha, {
          hoy,
          nacimiento: vaca.nacimiento,
          ultimoEvento: ultimoNoAnulado(filas)?.fecha ?? null,
        });
        if (errorFecha) throw errorDeCampo('fecha', errorFecha);
        const aptitud = puedeSecarse(vaca.sexo, vaca.estado);
        if (!aptitud.ok) throw new HttpError(409, aptitud.motivo);
        const loteSeca = (await resolverLotesDestino(tx, establecimientoId, ['SECA'])).get('SECA') ?? null;

        const eventoId = randomUUID();
        await tx.evento.create({
          data: {
            id: eventoId,
            establecimientoId,
            animalId,
            tipo: 'SECADO',
            fecha: fechaADate(datos.fecha),
            registradoPorId: usuarioId,
            creadoEn: await siguienteRegistro(tx, animalId),
          },
        });
        await tx.secado.create({
          data: {
            eventoId,
            establecimientoId,
            tipo: 'SECADO',
            estadoAnterior: 'EN_ORDENE',
            tuvoLoteAnterior: vaca.loteId !== null,
            loteAnteriorId: vaca.loteId,
          },
        });
        await tx.animal.update({
          where: { establecimientoId_id: { establecimientoId, id: animalId } },
          data: { estado: 'SECA', loteId: loteSeca },
        });

        const avisos: Aviso[] = loteSeca ? [] : [avisoSinLoteMadre('SECA')];
        return { evento: eventoPorId(await leerEventos(tx, animalId, establecimientoId), eventoId, hoy), avisos };
      },
      { timeout: 15_000 },
    );
    res.status(201).json(resultado);
  } catch (err) {
    if (esErrorPrisma(err, 'P2003')) throw new HttpError(409, MENSAJE_LOTE_INEXISTENTE);
    throw err;
  }
});
