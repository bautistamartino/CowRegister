import { prisma } from '../db.js';
import { fechaADate } from '../animales/reglas.js';
import { motivoATexto, type MotivoBajaCompleto } from '../bajas/validacion.js';
import { topeInforme } from '../topes.js';
import { porcentajeEntero } from './porcentaje.js';

// Informe de natalidad (spec 007, RF-11 a RF-13, RF-16). Se calcula al leer, igual que el de
// inseminación: un parto anulado deja de contar en el siguiente pedido.

type Sexo = 'HEMBRA' | 'MACHO';
type DatosAnimal = { id: string; numero: string; activo: boolean; motivoBaja: MotivoBajaCompleto | null };

const aTexto = (fecha: Date) => fecha.toISOString().slice(0, 10);

// Un animal como lo ve la web: con lo necesario para armar el enlace a su ficha (activa o de baja).
function datosAnimal(a: { id: string; numero: string; estado: string; motivoBaja: 'VENTA' | 'MUERTE' | 'PARTO_ANULADO' | null }): DatosAnimal {
  return { id: a.id, numero: a.numero, activo: a.estado !== 'BAJA', motivoBaja: a.estado === 'BAJA' ? motivoATexto(a.motivoBaja ?? 'PARTO_ANULADO') : null };
}

export async function informeNatalidad(establecimientoId: string, desde: string, hasta: string) {
  // Partos NO anulados del tambo con fecha en el período, con la vaca y sus crías.
  const filas = await prisma.evento.findMany({
    where: { establecimientoId, tipo: 'PARTO', anuladoEn: null, fecha: { gte: fechaADate(desde), lte: fechaADate(hasta) } },
    orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }], // del más reciente al más antiguo
    select: {
      id: true,
      fecha: true,
      animal: { select: { id: true, numero: true, estado: true, motivoBaja: true } },
      parto: {
        select: {
          crias: {
            orderBy: { orden: 'asc' },
            select: {
              orden: true,
              sexo: true,
              nacidaMuerta: true,
              animal: { select: { id: true, numero: true, estado: true, motivoBaja: true } },
            },
          },
        },
      },
    },
  });

  // Totales con TODOS los partos (el tope solo corta el detalle). Una cría viva cuenta aunque
  // después se haya vendido o muerto; una cría "viva" nunca es de un parto anulado (no se leen).
  const contar = (muerta: boolean, sexo?: Sexo) =>
    filas.reduce((n, f) => n + (f.parto?.crias ?? []).filter((c) => c.nacidaMuerta === muerta && (!sexo || c.sexo === sexo)).length, 0);
  const vivas = contar(false);
  const muertas = contar(true);

  const tope = topeInforme();
  return {
    periodo: { desde, hasta },
    resumen: {
      partos: filas.length,
      criasVivas: { total: vivas, hembras: contar(false, 'HEMBRA'), machos: contar(false, 'MACHO') },
      criasMuertas: { total: muertas, hembras: contar(true, 'HEMBRA'), machos: contar(true, 'MACHO') },
      mellizos: filas.filter((f) => (f.parto?.crias.length ?? 0) === 2).length,
      porcentajeNacidasMuertas: porcentajeEntero(muertas, vivas + muertas), // null si no hubo crías
    },
    detalle: filas.slice(0, tope).map((f) => ({
      partoId: f.id,
      fecha: aTexto(f.fecha),
      vaca: datosAnimal(f.animal),
      crias: (f.parto?.crias ?? []).map((c) => ({
        orden: c.orden,
        sexo: c.sexo,
        nacidaMuerta: c.nacidaMuerta,
        animal: c.animal ? datosAnimal(c.animal) : null,
      })),
    })),
    totalDetalle: filas.length,
    truncado: filas.length > tope,
    tope,
  };
}
