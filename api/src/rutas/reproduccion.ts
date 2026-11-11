import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, errorDeCampo } from '../errores.js';
import { anomaliasSchema } from '../validacion.js';
import { requiereSesion, usuarioActual } from '../auth/middleware.js';
import { esFechaValida, fechaADate, hoyArgentina } from '../animales/reglas.js';
import { ahora } from '../reloj.js';
import { puedeRecibirEventoReproductivo } from '../reproduccion/aptitud.js';
import { bloquearAnimal, siguienteRegistro } from '../reproduccion/bloqueo.js';
import { armarRespuesta, eventoPorId, leerEventos } from '../reproduccion/eventos.js';
import { DIAS_GESTACION, fechaEventoSchema, sumarDias, validarFechaEvento } from '../reproduccion/fechas.js';
import { calcularSituacion, resolverFechaProbable, ultimoNoAnulado } from '../reproduccion/situacion.js';

// Servicios, tactos y situación reproductiva de un animal (spec 003, RF-7 a RF-18, RF-22 a RF-27).
// Los tres roles pueden consultar, registrar servicios y registrar tactos (tabla de permisos), pero
// igual hace falta sesión: la guarda también está en app.ts ANTES de los parsers de JSON, para
// que un pedido sin sesión reciba 401 aunque el JSON venga roto.
//
// Orden de controles: sesión (401) → cuerpo (400) → id del animal (404) → [dentro de la transacción,
// con el animal bloqueado] animal inexistente (404) → semen del cuerpo (400) → reglas de fecha (400)
// → conflictos con el estado (409). Todo se filtra por el establecimientoId de la sesión.
export const rutasReproduccion = Router();
rutasReproduccion.use(requiereSesion);

const NO_ENCONTRADO = 'Animal no encontrado';

// La web puede mandar un campo opcional vacío (""): se trata como "no vino".
const vacioANulo = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const servicioSchema = z.object({
  fecha: fechaEventoSchema,
  tipo: z.enum(['INSEMINACION', 'MONTA_NATURAL'], { error: 'El tipo de servicio tiene que ser inseminación o monta natural' }),
  // Un semenId con formato inválido es 400 con mensaje (no 404); "No especificado" llega como null, vacío o ausente.
  semenId: z.preprocess(vacioANulo, z.uuid({ error: 'El semen o toro indicado no es válido' }).nullish()),
  // Cualquier otro campo (por ejemplo un establecimientoId) se descarta: z.object ignora lo no declarado.
});

const tactoSchema = z
  .object({
    fecha: fechaEventoSchema,
    resultado: z.enum(['PRENADA', 'VACIA'], { error: 'El resultado del tacto tiene que ser preñada o vacía' }),
    fechaProbableParto: z.preprocess(vacioANulo, z.string({ error: 'La fecha probable de parto tiene que ser un texto AAAA-MM-DD' }).nullish()),
    anomalias: anomaliasSchema,
  })
  // Reglas que solo dependen del cuerpo (RF-14): se controlan acá, antes de buscar el animal.
  .superRefine((d, ctx) => {
    if (!d.fechaProbableParto) return;
    const campo = ['fechaProbableParto'];
    if (d.resultado === 'VACIA') {
      ctx.addIssue({ code: 'custom', path: campo, message: 'Un tacto "vacía" no lleva fecha probable de parto' });
    } else if (!esFechaValida(d.fechaProbableParto)) {
      ctx.addIssue({ code: 'custom', path: campo, message: 'La fecha probable de parto no es válida: usá el formato AAAA-MM-DD con un día que exista' });
    } else if (esFechaValida(d.fecha)) {
      if (d.fechaProbableParto <= d.fecha) {
        ctx.addIssue({ code: 'custom', path: campo, message: 'La fecha probable de parto tiene que ser posterior a la fecha del tacto' });
      } else if (d.fechaProbableParto > sumarDias(d.fecha, DIAS_GESTACION)) {
        ctx.addIssue({ code: 'custom', path: campo, message: `La fecha probable de parto no puede superar los ${DIAS_GESTACION} días después del tacto` });
      }
    }
  });

// Un id de animal mal formado responde 404, igual que uno inexistente o de otro tambo.
function idAnimal(texto: string | string[] | undefined): string {
  const id = z.uuid().safeParse(texto);
  if (!id.success) throw new HttpError(404, NO_ENCONTRADO);
  return id.data;
}

// Primeros pasos de todo registro, dentro de la transacción: bloquea el animal (404 si no hay)
// y lee sus eventos. Devuelve lo necesario para las reglas.
async function abrirRegistro(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], animalId: string, establecimientoId: string) {
  const animal = await bloquearAnimal(tx, animalId, establecimientoId);
  if (!animal) throw new HttpError(404, NO_ENCONTRADO);
  const filas = await leerEventos(tx, animalId, establecimientoId);
  const hoy = hoyArgentina(ahora());
  return { animal, filas, hoy };
}

// GET /api/animales/:id/eventos — situación reproductiva y lista de eventos (RF-23 a RF-27).
rutasReproduccion.get('/:id/eventos', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const animalId = idAnimal(req.params.id);
  const animal = await prisma.animal.findFirst({
    where: { id: animalId, establecimientoId, estado: { not: 'BAJA' } },
    select: { sexo: true },
  });
  if (!animal) throw new HttpError(404, NO_ENCONTRADO);
  // A los machos no se les muestra nada reproductivo.
  if (animal.sexo === 'MACHO') {
    res.json({ situacion: null, eventos: [] });
    return;
  }
  const filas = await leerEventos(prisma, animalId, establecimientoId);
  res.json(armarRespuesta(filas, hoyArgentina(ahora())));
});

// POST /api/animales/:id/servicios — registra un servicio (RF-7 a RF-11, RF-18).
rutasReproduccion.post('/:id/servicios', async (req, res) => {
  const { establecimientoId, id: usuarioId } = usuarioActual(req);
  const datos = servicioSchema.parse(req.body);
  const animalId = idAnimal(req.params.id);

  const evento = await prisma.$transaction(
    async (tx) => {
      const { animal, filas, hoy } = await abrirRegistro(tx, animalId, establecimientoId);

      // Semen o toro del cuerpo: inexistente o de otro tambo = 400 con el mismo mensaje.
      let semen: { activo: boolean } | null = null;
      if (datos.semenId) {
        semen = await tx.semenToro.findFirst({ where: { id: datos.semenId, establecimientoId }, select: { activo: true } });
        if (!semen) throw errorDeCampo('semenId', 'El semen o toro indicado no existe');
      }

      // Reglas de fecha contra el estado del animal (RF-18).
      const errorFecha = validarFechaEvento(datos.fecha, {
        hoy,
        nacimiento: animal.nacimiento,
        ultimoEvento: ultimoNoAnulado(filas)?.fecha ?? null,
      });
      if (errorFecha) throw errorDeCampo('fecha', errorFecha);

      // Conflictos con el estado (409), en este orden.
      const aptitud = puedeRecibirEventoReproductivo(animal.sexo, animal.estado);
      if (!aptitud.ok) throw new HttpError(409, aptitud.motivo);
      if (calcularSituacion(filas, hoy).estado === 'PRENADA') {
        throw new HttpError(409, 'La vaca tiene una preñez vigente: primero registrá un tacto "vacía"');
      }
      if (semen && !semen.activo) throw new HttpError(409, 'El semen o toro está desactivado: elegí otro o reactivalo');

      // Inserción: el evento común y su detalle, con ids generados acá (constitución §5).
      const id = randomUUID();
      await tx.evento.create({
        data: {
          id,
          establecimientoId,
          animalId,
          tipo: 'SERVICIO',
          fecha: fechaADate(datos.fecha),
          registradoPorId: usuarioId,
          creadoEn: await siguienteRegistro(tx, animalId),
        },
      });
      await tx.servicio.create({
        data: { eventoId: id, establecimientoId, tipo: 'SERVICIO', tipoServicio: datos.tipo, semenId: datos.semenId ?? null },
      });
      return eventoPorId(await leerEventos(tx, animalId, establecimientoId), id, hoy);
    },
    { timeout: 15_000 },
  );
  res.status(201).json(evento);
});

// POST /api/animales/:id/tactos — registra un tacto (RF-12 a RF-18).
rutasReproduccion.post('/:id/tactos', async (req, res) => {
  const { establecimientoId, id: usuarioId } = usuarioActual(req);
  const datos = tactoSchema.parse(req.body);
  const animalId = idAnimal(req.params.id);

  const evento = await prisma.$transaction(
    async (tx) => {
      const { animal, filas, hoy } = await abrirRegistro(tx, animalId, establecimientoId);

      // Reglas de fecha contra el estado del animal (RF-18).
      const errorFecha = validarFechaEvento(datos.fecha, {
        hoy,
        nacimiento: animal.nacimiento,
        ultimoEvento: ultimoNoAnulado(filas)?.fecha ?? null,
      });
      if (errorFecha) throw errorDeCampo('fecha', errorFecha);

      // Un tacto "preñada" tiene que tener de dónde sacar la fecha probable (RF-13): la indicada,
      // una conservada del ciclo o el servicio base + 283. Si no, se exige; nunca se inventa.
      const indicada = datos.fechaProbableParto ?? null;
      if (datos.resultado === 'PRENADA' && resolverFechaProbable(filas, indicada) === null) {
        throw errorDeCampo('fechaProbableParto', 'Indicá la fecha probable de parto: no hay un servicio del que calcularla');
      }

      // Conflicto con el estado (409): macho o recién nacida.
      const aptitud = puedeRecibirEventoReproductivo(animal.sexo, animal.estado);
      if (!aptitud.ok) throw new HttpError(409, aptitud.motivo);

      const id = randomUUID();
      await tx.evento.create({
        data: {
          id,
          establecimientoId,
          animalId,
          tipo: 'TACTO',
          fecha: fechaADate(datos.fecha),
          registradoPorId: usuarioId,
          creadoEn: await siguienteRegistro(tx, animalId),
        },
      });
      await tx.tacto.create({
        data: {
          eventoId: id,
          establecimientoId,
          tipo: 'TACTO',
          resultado: datos.resultado,
          // Solo se guarda lo que escribió el usuario; la fecha resuelta se calcula al leer.
          fechaProbableIndicada: indicada ? fechaADate(indicada) : null,
          anomalias: datos.anomalias,
        },
      });
      return eventoPorId(await leerEventos(tx, animalId, establecimientoId), id, hoy);
    },
    { timeout: 15_000 },
  );
  res.status(201).json(evento);
});
