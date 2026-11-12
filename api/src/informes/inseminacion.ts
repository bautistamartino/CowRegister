import { prisma } from '../db.js';
import { fechaADate } from '../animales/reglas.js';
import { motivoATexto, type MotivoBajaCompleto } from '../bajas/validacion.js';
import { topeInforme } from '../topes.js';
import { porcentajeEntero } from './porcentaje.js';
import { resultadoDeServicio, type EventoResultado, type ResultadoServicio } from './resultado-servicio.js';

// Informe de resultado de inseminación (spec 007, RF-7 a RF-10, RF-16). Se calcula al leer: nada
// se guarda, así que anular un tacto, un servicio o un parto cambia el siguiente cálculo solo.

type Semen = { id: string; nombre: string };

// Un evento (servicio, tacto o parto) NO anulado, tal como sale de la base.
export type EventoLeido = EventoResultado & {
  animalId: string;
  servicio: { tipoServicio: 'INSEMINACION' | 'MONTA_NATURAL'; semen: Semen | null } | null;
};

export type ResumenServicios = {
  total: number;
  prenadas: number;
  vacias: number;
  sinTacto: number;
  base: number; // preñadas + vacías: sobre lo que se calcula el porcentaje
  porcentajePrenez: number | null; // null = "—" (no hay base)
};

type ServicioCalculado = {
  servicioId: string;
  animalId: string;
  fecha: string;
  creadoEn: Date;
  tipoServicio: 'INSEMINACION' | 'MONTA_NATURAL';
  semen: Semen | null; // null = "No especificado"
  resultado: ResultadoServicio;
};

const aTexto = (fecha: Date) => fecha.toISOString().slice(0, 10);

// Cuenta una lista de resultados. Los "sin tacto" no entran en la base del porcentaje.
function resumir(resultados: readonly ResultadoServicio[]): ResumenServicios {
  const prenadas = resultados.filter((r) => r === 'PRENADA_TACTO' || r === 'PRENADA_PARTO').length;
  const vacias = resultados.filter((r) => r === 'VACIA').length;
  const base = prenadas + vacias;
  return {
    total: resultados.length,
    prenadas,
    vacias,
    sinTacto: resultados.length - base,
    base,
    porcentajePrenez: porcentajeEntero(prenadas, base),
  };
}

/**
 * Parte PURA del informe: de los eventos del tambo desde `desde` (sin tope superior, porque el
 * resultado se mide a hoy) saca los servicios del período con su resultado, el resumen y el
 * desglose por semen. No corta nada: el corte del detalle lo hace quien llama.
 */
export function calcularInseminacion(eventos: readonly EventoLeido[], desde: string, hasta: string) {
  // Los eventos de cada vaca, juntos, para resolver el resultado de sus servicios.
  const porVaca = new Map<string, EventoLeido[]>();
  for (const e of eventos) {
    const lista = porVaca.get(e.animalId);
    if (lista) lista.push(e);
    else porVaca.set(e.animalId, [e]);
  }

  const servicios: ServicioCalculado[] = eventos
    .filter((e) => e.tipo === 'SERVICIO' && !e.anulado && e.fecha >= desde && e.fecha <= hasta)
    .map((e) => ({
      servicioId: e.id,
      animalId: e.animalId,
      fecha: e.fecha,
      creadoEn: e.creadoEn,
      tipoServicio: e.servicio?.tipoServicio ?? 'INSEMINACION',
      semen: e.servicio?.semen ?? null,
      resultado: resultadoDeServicio(e, porVaca.get(e.animalId) ?? []),
    }))
    // Del más reciente al más antiguo; a igual fecha, el registrado después primero.
    .sort((a, b) => (a.fecha !== b.fecha ? (a.fecha < b.fecha ? 1 : -1) : b.creadoEn.getTime() - a.creadoEn.getTime()));

  // Desglose por semen o toro, por identidad (con el nombre ACTUAL). Sin semen: "No especificado".
  const grupos = new Map<string, { semen: Semen | null; resultados: ResultadoServicio[] }>();
  for (const s of servicios) {
    const clave = s.semen?.id ?? 'sin-semen';
    const grupo = grupos.get(clave);
    if (grupo) grupo.resultados.push(s.resultado);
    else grupos.set(clave, { semen: s.semen, resultados: [s.resultado] });
  }
  const nombre = (g: { semen: Semen | null }) => g.semen?.nombre ?? 'No especificado';
  const porSemen = [...grupos.values()]
    .sort((a, b) => b.resultados.length - a.resultados.length || nombre(a).localeCompare(nombre(b), 'es'))
    .map((g) => ({ semen: g.semen, ...resumir(g.resultados) }));

  return { servicios, resumen: resumir(servicios.map((s) => s.resultado)), porSemen };
}

// GET /api/informes/inseminacion: lee de la base y arma la respuesta. Todo filtrado por tambo.
export async function informeInseminacion(establecimientoId: string, desde: string, hasta: string) {
  // UNA sola lectura de los servicios, tactos y partos NO anulados del tambo con fecha >= desde y
  // sin tope superior: un tacto o parto posterior al fin del período también cuenta (RF-16).
  const filas = await prisma.evento.findMany({
    where: { establecimientoId, tipo: { in: ['SERVICIO', 'TACTO', 'PARTO'] }, anuladoEn: null, fecha: { gte: fechaADate(desde) } },
    select: {
      id: true,
      animalId: true,
      tipo: true,
      fecha: true,
      creadoEn: true,
      servicio: { select: { tipoServicio: true, semen: { select: { id: true, nombre: true } } } },
      tacto: { select: { resultado: true } },
      parto: { select: { servicioId: true } },
    },
  });
  const eventos: EventoLeido[] = filas.map((f) => ({
    id: f.id,
    animalId: f.animalId,
    tipo: f.tipo as EventoLeido['tipo'], // la consulta solo trae servicio, tacto o parto
    fecha: aTexto(f.fecha),
    creadoEn: f.creadoEn,
    resultado: f.tacto?.resultado ?? null,
    servicioDelParto: f.parto?.servicioId ?? null,
    servicio: f.servicio,
  }));

  const { servicios, resumen, porSemen } = calcularInseminacion(eventos, desde, hasta);

  // Detalle: solo las filas más recientes hasta el tope; los totales de arriba cuentan todo.
  const tope = topeInforme();
  const filasDetalle = servicios.slice(0, tope);
  const ids = [...new Set(filasDetalle.map((s) => s.animalId))];
  const animales = ids.length
    ? await prisma.animal.findMany({ where: { establecimientoId, id: { in: ids } }, select: { id: true, numero: true, estado: true, motivoBaja: true } })
    : [];
  const datosAnimal = new Map(
    animales.map((a): [string, { id: string; numero: string; activo: boolean; motivoBaja: MotivoBajaCompleto | null }] => [
      a.id,
      { id: a.id, numero: a.numero, activo: a.estado !== 'BAJA', motivoBaja: a.estado === 'BAJA' ? motivoATexto(a.motivoBaja ?? 'PARTO_ANULADO') : null },
    ]),
  );

  return {
    periodo: { desde, hasta },
    resumen,
    porSemen,
    detalle: filasDetalle.map((s) => ({
      servicioId: s.servicioId,
      fecha: s.fecha,
      tipoServicio: s.tipoServicio,
      semen: s.semen,
      resultado: s.resultado,
      animal: datosAnimal.get(s.animalId)!, // el servicio es de un animal del mismo tambo: existe
    })),
    totalDetalle: servicios.length,
    truncado: servicios.length > tope,
    tope,
  };
}
