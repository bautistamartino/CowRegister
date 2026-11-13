import { prisma } from '../db.js';
import { hoyArgentina } from '../animales/reglas.js';
import { compararNumeros } from '../animales/orden.js';
import { armarHistorial } from '../historial/historial.js';
import { armarFichaProduccion } from '../produccion/leer.js';
import { armarRespuesta, leerEventosDeAnimales } from '../reproduccion/eventos.js';
import { sumarDias } from '../reproduccion/fechas.js';
import { armarFicha, SELECCION_FICHA } from '../rutas/animales.js';
import { leerLotes } from '../rutas/lotes.js';
import { ahora } from '../reloj.js';
import { topeCopia, topeHistorial, topeProduccionFicha } from '../topes.js';
import { leerCambiosDeTambo, leerProduccionDeTambo } from './lecturasMasivas.js';

// Copia completa del tambo para el modo sin conexión (spec 009, RF-4, RF-6, RF-8).
//
// Todo se lee dentro de UNA transacción con aislamiento REPEATABLE READ: la base toma una "foto"
// del tambo en el primer SELECT y todas las lecturas siguientes ven ESA foto, aunque otra persona
// cargue o cambie algo mientras tanto. Así la copia nunca mezcla momentos distintos (un animal en
// el listado pero no en sus lotes, por ejemplo). Es solo lectura, así que no bloquea a nadie.

// Gancho de PRUEBA (como `fijarTopes` y `fijarReloj`): una función que se ejecuta entre dos lecturas
// para que el test haga un cambio "en el medio" y compruebe que no aparece. En producción es null.
type Gancho = (etapa: string) => Promise<void>;
let gancho: Gancho | null = null;
export function fijarGanchoCopia(fn: Gancho | null): void {
  gancho = fn;
}

export type ResultadoCopia =
  | { excedido: true; totalAnimales: number; tope: number }
  | { excedido: false; copia: Awaited<ReturnType<typeof leerCopia>> };

export async function armarCopiaLocal(establecimientoId: string): Promise<ResultadoCopia> {
  return prisma.$transaction(
    async (tx) => {
      // Primero se CUENTA: si el tambo no entra en la tablet, no se lee nada más (RF-8).
      const total = await tx.animal.count({ where: { establecimientoId, estado: { not: 'BAJA' } } });
      const tope = topeCopia();
      if (total > tope) return { excedido: true as const, totalAnimales: total, tope };
      return { excedido: false as const, copia: await leerCopia(tx, establecimientoId) };
    },
    { isolationLevel: 'RepeatableRead', timeout: 60_000, maxWait: 10_000 },
  );
}

type Transaccion = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function leerCopia(tx: Transaccion, establecimientoId: string) {
  const generadaEn = ahora().toISOString();
  const hoy = hoyArgentina(ahora());
  const topeHist = topeHistorial();
  const topeProd = topeProduccionFicha();

  // 1. Fichas de todos los animales activos (el mismo select y el mismo armado que la ficha individual).
  const filas = await tx.animal.findMany({
    where: { establecimientoId, estado: { not: 'BAJA' } },
    select: SELECCION_FICHA,
  });
  await gancho?.('fichas');

  // 2. Lotes (iguales a GET /api/lotes).
  const lotes = await leerLotes(tx, establecimientoId);
  await gancho?.('lotes');

  // 3. Eventos de todos los animales en una lectura (misma función que la ficha individual).
  const eventos = await leerEventosDeAnimales(tx, filas.map((f) => f.id), establecimientoId);
  await gancho?.('eventos');

  // 4. Cambios manuales (los más nuevos y el total de cada animal).
  const { cambios, totales } = await leerCambiosDeTambo(tx, establecimientoId, topeHist);
  await gancho?.('cambios');

  // 5. Producción (registros recientes, total, promedio de 30 días y último registro).
  const produccion = await leerProduccionDeTambo(tx, establecimientoId, topeProd, sumarDias(hoy, -29), hoy);

  // 6. Semen y toros ACTIVOS del tambo (spec 010, RF-8), en la misma foto. No tienen tope propio ni cuentan
  //    para el de los animales; los desactivados no viajan. Ordenados por nombre sin distinguir mayúsculas.
  const filasSemen = await tx.semenToro.findMany({
    where: { establecimientoId, activo: true },
    select: { id: true, nombre: true, raza: true },
  });
  await gancho?.('semen');
  const semen = filasSemen.sort(
    (a, b) => a.nombre.toLowerCase().localeCompare(b.nombre.toLowerCase(), 'es') || (a.id < b.id ? -1 : 1),
  );

  // Orden natural por número (A2 antes que A10): la tablet lo puede cambiar, pero así sale estable.
  const ordenadas = [...filas].sort((a, b) => compararNumeros(a.numero, b.numero));
  const animales = ordenadas.map((fila) => {
    const filasEvento = eventos.get(fila.id) ?? [];
    const p = produccion.get(fila.id);
    return {
      ficha: armarFicha(fila),
      // A los machos no se les muestra nada reproductivo (igual que GET /:id/eventos).
      eventos: fila.sexo === 'MACHO' ? { situacion: null, eventos: [] } : armarRespuesta(filasEvento, hoy),
      historial: armarHistorial(filasEvento, cambios.get(fila.id) ?? [], totales.get(fila.id) ?? 0, hoy, topeHist),
      produccion: armarFichaProduccion({
        filas: p?.filas ?? [],
        total: p?.total ?? 0,
        sumaDecimas: p?.sumaDecimas ?? 0,
        dias: p?.dias ?? 0,
        ultimo: p?.ultimo ?? null,
        tope: topeProd,
      }),
    };
  });

  return { generadaEn, totalAnimales: animales.length, lotes, semen, animales };
}
