import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../errores.js';
import { requiereSesion, usuarioActual } from '../auth/middleware.js';
import { hoyArgentina } from '../animales/reglas.js';
import { ahora } from '../reloj.js';
import { topeHistorial } from '../topes.js';
import { leerEventos } from '../reproduccion/eventos.js';
import { armarHistorial } from '../historial/historial.js';

// Historial único de un animal (spec 007, RF-1 a RF-5). Solo lectura, los tres roles; la sesión
// también se controla en app.ts antes de los parsers. Todo se filtra por el establecimientoId de
// la sesión (cualquier otro que venga en la query se ignora).
const NO_ENCONTRADO = 'Animal no encontrado';

// Un id mal formado responde 404, igual que uno inexistente, ajeno o del otro contexto.
function idAnimal(texto: string | string[] | undefined): string {
  const id = z.uuid().safeParse(texto);
  if (!id.success) throw new HttpError(404, NO_ENCONTRADO);
  return id.data;
}

// Lee eventos y cambios manuales del animal y arma la respuesta. Se usa en las dos rutas.
async function leerHistorial(animalId: string, establecimientoId: string) {
  const tope = topeHistorial();
  const donde = { animalId, establecimientoId };
  const [filas, totalCambios, cambios] = await Promise.all([
    leerEventos(prisma, animalId, establecimientoId),
    prisma.cambioAnimal.count({ where: donde }),
    // Solo los `tope` más nuevos: uno más viejo nunca entraría en las `tope` entradas más recientes.
    // Select explícito: nunca el id del usuario.
    prisma.cambioAnimal.findMany({
      where: donde,
      orderBy: [{ creadoEn: 'desc' }, { campo: 'asc' }, { id: 'asc' }],
      take: tope,
      select: { id: true, campo: true, valorAnterior: true, valorNuevo: true, usuarioNombre: true, creadoEn: true },
    }),
  ]);
  return armarHistorial(filas, cambios, totalCambios, hoyArgentina(ahora()), tope);
}

// GET /api/animales/:id/historial — animal ACTIVO (hembra o macho). 404 si es de baja, ajeno, inexistente o mal formado.
export const rutasHistorialAnimal = Router();
rutasHistorialAnimal.use(requiereSesion);
rutasHistorialAnimal.get('/:id/historial', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const animalId = idAnimal(req.params.id);
  const animal = await prisma.animal.findFirst({ where: { id: animalId, establecimientoId, estado: { not: 'BAJA' } }, select: { id: true } });
  if (!animal) throw new HttpError(404, NO_ENCONTRADO);
  res.json(await leerHistorial(animalId, establecimientoId));
});

// GET /api/bajas/:id/historial — animal dado de baja por venta o muerte (misma condición que la ficha de baja).
export const rutasHistorialBaja = Router();
rutasHistorialBaja.use(requiereSesion);
rutasHistorialBaja.get('/:id/historial', async (req, res) => {
  const { establecimientoId } = usuarioActual(req);
  const animalId = idAnimal(req.params.id);
  const animal = await prisma.animal.findFirst({
    where: { id: animalId, establecimientoId, estado: 'BAJA', motivoBaja: { in: ['VENTA', 'MUERTE'] } },
    select: { id: true },
  });
  if (!animal) throw new HttpError(404, NO_ENCONTRADO);
  res.json(await leerHistorial(animalId, establecimientoId));
});
