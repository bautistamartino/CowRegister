// Situación reproductiva calculada en la tablet (spec 010, RF-18 y RF-20). Lógica pura.
//
// Son COPIAS de las funciones de la API (api/src/reproduccion/situacion.ts, fechas.ts y partos.ts): la web no
// importa código de la API. Los dos lados dan el mismo resultado: lo comprueba la tabla de casos compartida
// (compartido/casos-reglas-eventos.json) que corren los tests de la API y los de la web.
//
// Los eventos se ordenan por FECHA y, a igual fecha, por momento de registro (`creadoEn`, en milisegundos).
// La hora de la tablet nunca ordena nada.

import type { EventoReproductivo } from '../compartido/api';

// ─── Fechas (api/src/reproduccion/fechas.ts) ───

export const DIAS_GESTACION = 283; // fecha probable de parto = servicio + 283 días (constitución §4)
export const FECHA_MINIMA = '2000-01-01';
const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Texto AAAA-MM-DD -> milisegundos en UTC a medianoche (evita corrimientos por huso u horario de verano).
const aMs = (texto: string) => Date.parse(`${texto}T00:00:00.000Z`);

// ¿Es un texto AAAA-MM-DD que existe en el calendario? ("2021-02-31" no.)
export function esFechaValida(texto: unknown): texto is string {
  if (typeof texto !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Date.UTC "desborda" los días inexistentes (31/02 pasa a marzo): se compara de vuelta.
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

// Suma (o resta, con n negativo) días a una fecha.
export function sumarDias(fecha: string, n: number): string {
  return new Date(aMs(fecha) + n * MS_POR_DIA).toISOString().slice(0, 10);
}

// Días desde `desde` hasta `hasta`: positivo si `hasta` es posterior.
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aMs(hasta) - aMs(desde)) / MS_POR_DIA);
}

// AAAA-MM-DD -> dd/mm/aaaa, como se muestra en los mensajes.
export function aFechaCorta(fecha: string): string {
  const [a, m, d] = fecha.split('-');
  return `${d}/${m}/${a}`;
}

// ─── Situación (api/src/reproduccion/situacion.ts) ───

export type EventoCalculo = {
  id: string;
  // 'BAJA' figura en la lista pero NO cuenta para ningún cálculo: lo filtran las funciones de abajo.
  tipo: 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO' | 'BAJA';
  fecha: string; // AAAA-MM-DD
  creadoEn: number; // momento de registro en milisegundos: desempata el orden a igual fecha
  anulado: boolean;
  resultado: 'PRENADA' | 'VACIA' | null; // solo en tactos
  fechaProbableIndicada: string | null; // la que escribió el usuario en el tacto
};

export type EstadoReproductivo = 'SIN_SERVICIO' | 'SERVIDA' | 'PRENADA' | 'VACIA';

// Orden total: por fecha y, a igual fecha, por momento de registro. Devuelve una copia.
export function ordenarEventos<T extends Pick<EventoCalculo, 'fecha' | 'creadoEn'>>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
    return a.creadoEn - b.creadoEn;
  });
}

// Último evento no anulado en el orden total (o null). La baja no cuenta.
export function ultimoNoAnulado<T extends EventoCalculo>(lista: readonly T[]): T | null {
  const vigentes = ordenarEventos(lista).filter((e) => !e.anulado && e.tipo !== 'BAJA');
  return vigentes[vigentes.length - 1] ?? null;
}

const esVacia = (e: EventoCalculo) => e.tipo === 'TACTO' && e.resultado === 'VACIA';

// Ciclo actual: los eventos no anulados posteriores al último tacto "vacía" o al último parto no anulado, en
// orden. El secado NO corta el ciclo.
export function cicloActual<T extends EventoCalculo>(lista: readonly T[]): T[] {
  const vigentes = ordenarEventos(lista).filter((e) => !e.anulado && e.tipo !== 'BAJA');
  let desde = 0;
  vigentes.forEach((e, i) => {
    if (esVacia(e) || e.tipo === 'PARTO') desde = i + 1;
  });
  return vigentes.slice(desde);
}

// Servicio base: el último servicio del ciclo actual (puede no existir).
export function servicioBase<T extends EventoCalculo>(lista: readonly T[]): T | null {
  const servicios = cicloActual(lista).filter((e) => e.tipo === 'SERVICIO');
  return servicios[servicios.length - 1] ?? null;
}

/**
 * Fecha probable de parto de un tacto "preñada" nuevo. `lista` son los eventos ya existentes. En orden:
 *  1. la fecha que indica el tacto;
 *  2. la última fecha indicada por un tacto "preñada" no anulado del mismo ciclo;
 *  3. la fecha del servicio base + 283 días;
 *  4. null: no hay de dónde sacarla y hay que exigirla. Nunca se inventa.
 */
export function resolverFechaProbable<T extends EventoCalculo>(lista: readonly T[], fechaIndicada: string | null): string | null {
  if (fechaIndicada) return fechaIndicada;
  const indicadas = cicloActual(lista).filter((e) => e.tipo === 'TACTO' && e.resultado === 'PRENADA' && e.fechaProbableIndicada);
  const ultima = indicadas[indicadas.length - 1];
  if (ultima?.fechaProbableIndicada) return ultima.fechaProbableIndicada;
  const base = servicioBase(lista);
  return base ? sumarDias(base.fecha, DIAS_GESTACION) : null;
}

export type Situacion<T extends EventoCalculo> = {
  estado: EstadoReproductivo;
  ultimoServicio: T | null; // último servicio no anulado (de cualquier ciclo)
  ultimoTacto: T | null; // último tacto no anulado
  ultimoServicioCicloAnterior: boolean; // es anterior al último parto no anulado
  ultimoTactoCicloAnterior: boolean;
  // Solo si está "preñada". `dias` es positivo si faltan y negativo si ya pasó.
  fechaProbableParto: { fecha: string; dias: number; vencida: boolean } | null;
  // Solo si está "servida (sin tacto)": servicio + 283 días como referencia.
  fechaReferencia: { fecha: string; dias: number } | null;
  // Fecha probable resuelta de cada tacto "preñada" no anulado (id -> fecha).
  fechasTactos: Map<string, string>;
};

/**
 * Calcula la situación reproductiva a partir de TODOS los eventos del animal (los anulados se ignoran) y del
 * "hoy" de Argentina. Es el mismo cálculo que hace el servidor.
 */
export function calcularSituacion<T extends EventoCalculo>(lista: readonly T[], hoy: string): Situacion<T> {
  const ordenados = ordenarEventos(lista);
  const vigentes = ordenados.filter((e) => !e.anulado && e.tipo !== 'BAJA');

  // Fecha resuelta de cada tacto "preñada", repitiendo el cálculo en orden: cada uno se resuelve con los
  // eventos no anulados que tenía antes (así lo vio al registrarse).
  const fechasTactos = new Map<string, string>();
  vigentes.forEach((e, i) => {
    if (e.tipo === 'TACTO' && e.resultado === 'PRENADA') {
      const fecha = resolverFechaProbable(vigentes.slice(0, i), e.fechaProbableIndicada);
      if (fecha) fechasTactos.set(e.id, fecha);
    }
  });

  // El estado reproductivo sale del último evento no anulado entre servicio, tacto y parto: el secado no lo
  // cambia. Si el último es un parto, el ciclo se reinició ('SIN_SERVICIO').
  const reproductivos = vigentes.filter((e) => e.tipo !== 'SECADO');
  const ultimo = reproductivos[reproductivos.length - 1] ?? null;
  let estado: EstadoReproductivo = 'SIN_SERVICIO';
  if (ultimo?.tipo === 'SERVICIO') estado = 'SERVIDA';
  else if (ultimo?.tipo === 'TACTO') estado = ultimo.resultado === 'PRENADA' ? 'PRENADA' : 'VACIA';

  const soloServicios = vigentes.filter((e) => e.tipo === 'SERVICIO');
  const soloTactos = vigentes.filter((e) => e.tipo === 'TACTO');
  // Posición del último parto no anulado: lo anterior a él es del ciclo anterior.
  const posicionUltimoParto = vigentes.map((e) => e.tipo).lastIndexOf('PARTO');
  const esAnteriorAlParto = (e: T | undefined) => e !== undefined && vigentes.indexOf(e) < posicionUltimoParto;

  let fechaProbableParto: Situacion<T>['fechaProbableParto'] = null;
  if (estado === 'PRENADA' && ultimo) {
    const fecha = fechasTactos.get(ultimo.id);
    if (fecha) {
      const dias = diasEntre(hoy, fecha);
      fechaProbableParto = { fecha, dias, vencida: dias < 0 };
    }
  }

  let fechaReferencia: Situacion<T>['fechaReferencia'] = null;
  if (estado === 'SERVIDA') {
    const base = servicioBase(lista);
    if (base) {
      const fecha = sumarDias(base.fecha, DIAS_GESTACION);
      fechaReferencia = { fecha, dias: diasEntre(hoy, fecha) };
    }
  }

  return {
    estado,
    ultimoServicio: soloServicios[soloServicios.length - 1] ?? null,
    ultimoTacto: soloTactos[soloTactos.length - 1] ?? null,
    ultimoServicioCicloAnterior: esAnteriorAlParto(soloServicios[soloServicios.length - 1]),
    ultimoTactoCicloAnterior: esAnteriorAlParto(soloTactos[soloTactos.length - 1]),
    fechaProbableParto,
    fechaReferencia,
    fechasTactos,
  };
}

// ─── Separación entre partos (api/src/reproduccion/partos.ts) ───

// Separación mínima entre dos partos no anulados de la misma vaca.
export const DIAS_MINIMOS_ENTRE_PARTOS = 200;

/**
 * Devuelve el mensaje de rechazo si ya hay un parto no anulado a menos de 200 días de `fecha`, o `null` si está
 * bien. `lista` son los eventos ya existentes de la vaca.
 */
export function validarSeparacionPartos(lista: readonly EventoCalculo[], fecha: string): string | null {
  const cercano = lista
    .filter((e) => e.tipo === 'PARTO' && !e.anulado)
    .find((e) => Math.abs(diasEntre(e.fecha, fecha)) < DIAS_MINIMOS_ENTRE_PARTOS);
  if (!cercano) return null;
  return `La vaca ya tiene un parto del ${aFechaCorta(cercano.fecha)}: tiene que haber al menos ${DIAS_MINIMOS_ENTRE_PARTOS} días entre dos partos. Si fue un aborto o un parto prematuro, registralo como un tacto "vacía"`;
}

// ─── Eventos de la copia ───

// Los eventos de la ficha de la copia (con la forma de GET /animales/:id/eventos) en la forma del cálculo.
// El momento de registro de la copia es el del servidor; así el orden a igual fecha es el de llegada.
export function eventosDeCopia(eventos: readonly EventoReproductivo[]): EventoCalculo[] {
  return eventos.map((e) => ({
    id: e.id,
    tipo: e.tipo,
    fecha: e.fecha,
    creadoEn: Date.parse(e.registradoEn),
    anulado: e.anulacion !== null,
    resultado: e.tacto?.resultado ?? null,
    fechaProbableIndicada: e.tacto?.fechaProbableIndicada ?? null,
  }));
}
