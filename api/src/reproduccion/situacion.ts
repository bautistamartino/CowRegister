import { DIAS_GESTACION, diasEntre, sumarDias } from './fechas.js';

// Situación reproductiva y fecha probable de parto (spec 003). Son funciones PURAS (sin base
// ni Express): reciben la lista de eventos del animal y calculan. Nada derivado se guarda:
// al anular un evento, el cálculo se rehace solo (RF-19, RF-21).
//
// La spec 004 (partos y secados) cambió solo esto: `cicloActual` (el ciclo empieza también
// después del último parto) y el estado reproductivo (un parto vuelve a "sin servicio" y el
// secado no cuenta). Todo lo demás se apoya en esas funciones.

export type EventoCalculo = {
  id: string;
  tipo: 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO';
  fecha: string; // AAAA-MM-DD
  creadoEn: Date; // momento de registro: desempata el orden a igual fecha
  anulado: boolean;
  resultado: 'PRENADA' | 'VACIA' | null; // solo en tactos
  fechaProbableIndicada: string | null; // la que escribió el usuario en el tacto
};

export type EstadoReproductivo = 'SIN_SERVICIO' | 'SERVIDA' | 'PRENADA' | 'VACIA';

// Orden total: por fecha y, a igual fecha, por momento de registro. Devuelve una copia.
export function ordenarEventos<T extends EventoCalculo>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
    return a.creadoEn.getTime() - b.creadoEn.getTime();
  });
}

// Último evento no anulado en el orden total (o null).
export function ultimoNoAnulado<T extends EventoCalculo>(lista: readonly T[]): T | null {
  const vigentes = ordenarEventos(lista).filter((e) => !e.anulado);
  return vigentes[vigentes.length - 1] ?? null;
}

const esVacia = (e: EventoCalculo) => e.tipo === 'TACTO' && e.resultado === 'VACIA';

// Ciclo actual: los eventos no anulados posteriores al último tacto "vacía" o al último
// parto no anulado (el que sea posterior), en orden. El secado NO corta el ciclo.
export function cicloActual<T extends EventoCalculo>(lista: readonly T[]): T[] {
  const vigentes = ordenarEventos(lista).filter((e) => !e.anulado);
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
 * Fecha probable de parto que corresponde a un tacto "preñada" nuevo (RF-13).
 * `lista` son los eventos ya existentes (el tacto nuevo todavía no está). En orden:
 *  1. la fecha que indica el tacto;
 *  2. la última fecha indicada por un tacto "preñada" no anulado del mismo ciclo;
 *  3. la fecha del servicio base + 283 días;
 *  4. null: no hay de dónde sacarla y la API tiene que exigirla (400). Nunca se inventa.
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
  // true si ese servicio o tacto es anterior al último parto no anulado: se muestra
  // rotulado "del ciclo anterior" (RF-40). Sin parto, siempre false.
  ultimoServicioCicloAnterior: boolean;
  ultimoTactoCicloAnterior: boolean;
  // Solo si está "preñada". `dias` es positivo si faltan y negativo si ya pasó.
  fechaProbableParto: { fecha: string; dias: number; vencida: boolean } | null;
  // Solo si está "servida (sin tacto)": servicio + 283 días como referencia.
  fechaReferencia: { fecha: string; dias: number } | null;
  // Fecha probable resuelta de cada tacto "preñada" no anulado (id → fecha), para la lista.
  fechasTactos: Map<string, string>;
};

/**
 * Calcula la situación reproductiva a partir de TODOS los eventos del animal (los anulados
 * se ignoran) y del "hoy" de Argentina.
 */
export function calcularSituacion<T extends EventoCalculo>(lista: readonly T[], hoy: string): Situacion<T> {
  const ordenados = ordenarEventos(lista);
  const vigentes = ordenados.filter((e) => !e.anulado);

  // Fecha resuelta de cada tacto "preñada", repitiendo el cálculo en orden: cada uno se
  // resuelve con los eventos no anulados que tenía antes (así lo vio al registrarse).
  const fechasTactos = new Map<string, string>();
  vigentes.forEach((e, i) => {
    if (e.tipo === 'TACTO' && e.resultado === 'PRENADA') {
      const fecha = resolverFechaProbable(vigentes.slice(0, i), e.fechaProbableIndicada);
      if (fecha) fechasTactos.set(e.id, fecha);
    }
  });

  // El estado reproductivo sale del último evento no anulado entre servicio, tacto y parto:
  // el secado no lo cambia (decisión del usuario, spec 004). Si el último es un parto, el
  // estado queda en 'SIN_SERVICIO': el ciclo se reinició.
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
