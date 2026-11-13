// Vista local de una vaca (spec 010, RF-18, RF-21 y RF-24). Lógica pura.
//
// La vista es la copia de la vaca MÁS los pendientes que el servidor todavía no refleja, aplicados en orden de
// carga: lo que la tablet "cree" que va a pasar cuando se sincronice. Las reglas locales (reglasLocales.ts) se
// evalúan sobre esta vista.
//
// Qué cuenta:
//   - los pendientes `esperando` y `enviando` que NO estén "en espera del anterior";
//   - los enviados (aceptados por el servidor) que la copia todavía no refleja.
// No cuentan los rechazados ni los "en espera del anterior": si un pendiente no cuenta, tampoco cuentan los que
// dependen de él, porque es justo lo que están esperando (RF-18).
//
// Una ANULACION pendiente marca el evento como anulado (así el "último no anulado" retrocede), pero NO revierte el
// estado ni el lote que había dejado un parto o un secado: el lote no se proyecta (fuera de alcance de la 010).

import type { AnimalCopia, EstadoAnimal, Sexo } from '../compartido/api';
import type { Enviado, Pendiente } from './almacen';
import { estadoVisible } from './dependencias';
import { normalizarNumero } from './numeros';
import { calcularSituacion, eventosDeCopia, ordenarEventos, ultimoNoAnulado, type EventoCalculo, type Situacion } from './situacionLocal';

// Un pendiente o un enviado: lo que la vista aplica sobre la copia.
export type Entrada = Pendiente | Enviado;

// Orden de carga de una entrada. Los enviados no guardan su orden: ya fueron aceptados, así que van antes que
// cualquier pendiente (la cola envía en orden de carga). Sirve para decidir qué bajas son "anteriores" (RF-21).
export const ordenDe = (e: Entrada): number => ('orden' in e ? e.orden : -1);

// Un evento de la vista: los de la copia y los que vienen de un pendiente o enviado.
export type EventoVista = EventoCalculo & {
  origen: 'copia' | 'pendiente' | 'enviado';
  tipoServicio?: string; // solo servicios cargados sin conexión
};

// Una cría de un parto pendiente: se ve DENTRO del parto, no como animal del listado ni del buscador (RF-18).
export type CriaPendiente = { partoId: string; orden: number; sexo: string; nacidaMuerta: boolean; numero: string | null };

export type VistaAnimal = {
  animalId: string;
  numero: string;
  sexo: Sexo;
  estado: EstadoAnimal; // 'BAJA' si hay una baja pendiente o enviada que la copia todavía no refleja
  nacimiento: string | null;
  eventos: EventoVista[]; // todos (anulados incluidos), en el orden de la copia y luego de la cola
  situacion: Situacion<EventoVista>;
  ultimoNoAnulado: EventoVista | null; // el único que se puede anular
  ultimaFechaNoAnulada: string | null; // fecha del último evento no anulado que no es una baja (regla de fecha de la baja)
  criasPendientes: CriaPendiente[];
  puedeLitros: boolean; // solo una hembra "en ordeñe" según la vista (RF-24)
};

type DatosCrias = { crias?: { sexo?: unknown; nacidaMuerta?: unknown; numero?: unknown }[] };

// Entradas que cuentan para la vista, en orden de carga. Recibe los pendientes del usuario y del tambo de la
// sesión (YA filtrados por dueño, como en dependencias.ts) y sus enviados. Un pendiente cuenta si su estado
// visible es esperando o enviando: no los rechazados ni los "en espera del anterior".
export function entradasValidas(pendientes: Pendiente[], enviados: Enviado[]): Entrada[] {
  const vigentes = pendientes
    .filter((p) => {
      const visible = estadoVisible(p, pendientes);
      return visible === 'esperando' || visible === 'enviando';
    })
    .sort((a, b) => a.orden - b.orden);
  const aceptados = [...enviados].sort((a, b) => a.aceptadoEn - b.aceptadoEn);
  return [...aceptados, ...vigentes];
}

/**
 * La vista de una vaca: su copia + las entradas que le tocan, en orden. `hoy` es el "hoy" de Argentina (solo para
 * los días que faltan del parto). Las entradas de otras vacas y los litros no se aplican.
 */
export function construirVista(animal: AnimalCopia, entradas: Entrada[], hoy: string): VistaAnimal {
  const eventos: EventoVista[] = eventosDeCopia(animal.eventos.eventos).map((e) => ({ ...e, origen: 'copia' as const }));
  let estado: EstadoAnimal = animal.ficha.estado;
  const partosPendientes: { id: string; crias: CriaPendiente[] }[] = [];

  // Los eventos pendientes quedan SIEMPRE después de los de la copia a igual fecha: el servidor los va a aceptar
  // más tarde. Se les da un momento de registro creciente a partir del último de la copia.
  let reloj = eventos.reduce((m, e) => Math.max(m, e.creadoEn), 0);

  for (const entrada of entradas) {
    if (entrada.animalId !== animal.ficha.id || entrada.tipo === 'LITROS') continue;
    const origen = 'orden' in entrada ? 'pendiente' : 'enviado';
    const datos = entrada.datos;
    const existente = eventos.find((e) => e.id === entrada.id);

    if (entrada.tipo === 'ANULACION') {
      // Marca como anulado el evento que se anula (si ya lo está, no pasa nada).
      const objetivo = eventos.find((e) => e.id === datos.eventoId);
      if (objetivo) objetivo.anulado = true;
      continue;
    }
    // Un enviado que la copia ya refleja (todavía no se limpió) ya está entre los eventos: no se repite.
    if (existente) continue;

    if (entrada.tipo === 'BAJA') {
      estado = 'BAJA';
      continue;
    }
    reloj += 1;
    const evento: EventoVista = {
      id: entrada.id,
      tipo: entrada.tipo,
      fecha: String(datos.fecha ?? ''),
      creadoEn: reloj,
      anulado: false,
      resultado: null,
      fechaProbableIndicada: null,
      origen,
    };
    if (entrada.tipo === 'SERVICIO') evento.tipoServicio = String(datos.tipo ?? '');
    if (entrada.tipo === 'TACTO') {
      evento.resultado = datos.resultado === 'PRENADA' ? 'PRENADA' : 'VACIA';
      evento.fechaProbableIndicada = typeof datos.fechaProbableParto === 'string' && datos.fechaProbableParto !== '' ? datos.fechaProbableParto : null;
    }
    if (entrada.tipo === 'SECADO') estado = 'SECA';
    if (entrada.tipo === 'PARTO') {
      estado = 'EN_ORDENE';
      const crias = ((datos as DatosCrias).crias ?? []).map((c, i) => ({
        partoId: entrada.id,
        orden: i + 1,
        sexo: String(c.sexo ?? ''),
        nacidaMuerta: c.nacidaMuerta === true,
        numero: c.nacidaMuerta === true || typeof c.numero !== 'string' ? null : normalizarNumero(c.numero),
      }));
      partosPendientes.push({ id: entrada.id, crias });
    }
    eventos.push(evento);
  }

  const ordenados = ordenarEventos(eventos);
  const ultimo = ultimoNoAnulado(ordenados);
  const noAnulados = ordenados.filter((e) => !e.anulado && e.tipo !== 'BAJA');
  const sexo = animal.ficha.sexo;
  return {
    animalId: animal.ficha.id,
    numero: animal.ficha.numero,
    sexo,
    estado,
    nacimiento: animal.ficha.fechaNacimiento,
    eventos: ordenados,
    situacion: calcularSituacion(ordenados, hoy),
    ultimoNoAnulado: ultimo,
    ultimaFechaNoAnulada: noAnulados.reduce<string | null>((m, e) => (m === null || e.fecha > m ? e.fecha : m), null),
    // Las crías de un parto pendiente que ya fue anulado (por otra entrada) dejan de existir.
    criasPendientes: partosPendientes
      .filter((p) => eventos.find((e) => e.id === p.id)?.anulado !== true)
      .flatMap((p) => p.crias),
    puedeLitros: sexo === 'HEMBRA' && estado === 'EN_ORDENE',
  };
}

/**
 * Números que no se pueden usar para una cría nueva (RF-21): los de los animales activos de la copia, más las
 * crías vivas de los partos pendientes o enviados que la copia todavía no trae. El número de un animal con una
 * baja pendiente o enviada queda LIBRE, pero solo para lo cargado después de esa baja: `ordenNuevo` es el orden
 * de carga de lo que se está validando (por omisión, uno nuevo: queda al final de la cola y todas las bajas son
 * anteriores). Los números salen normalizados (mayúsculas).
 */
export function numerosEnUso(animales: AnimalCopia[], entradas: Entrada[], ordenNuevo = Number.POSITIVE_INFINITY): Set<string> {
  const liberados = new Set(
    entradas.filter((e) => e.tipo === 'BAJA' && ordenDe(e) < ordenNuevo).map((e) => e.numero),
  );
  const ocupados = new Set(animales.map((a) => a.ficha.numero).filter((n) => !liberados.has(n)));

  // Un parto anulado por otra entrada (una anulación pendiente) ya no reserva los números de sus crías.
  const anulados = new Set(entradas.filter((e) => e.tipo === 'ANULACION').map((e) => String(e.datos.eventoId)));
  for (const entrada of entradas) {
    if (entrada.tipo !== 'PARTO' || anulados.has(entrada.id)) continue;
    // Un parto ya reflejado en la copia ya tiene a sus crías entre los animales: sumarlas de nuevo no cambia nada.
    for (const cria of (entrada.datos as DatosCrias).crias ?? []) {
      if (cria.nacidaMuerta === true || typeof cria.numero !== 'string') continue;
      const numero = normalizarNumero(cria.numero);
      if (numero) ocupados.add(numero);
    }
  }
  return ocupados;
}
