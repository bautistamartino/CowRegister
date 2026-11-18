// Adaptador de la ficha (spec 011, RF-18 a RF-24). Lógica pura, sin React.
//
// Con la copia de una vaca MÁS sus pendientes y enviados (la vista local de la spec 010) arma las MISMAS formas de
// datos que hoy leen la ficha, la sección de reproducción y el historial (las de la API). Así las pantallas casi no
// cambian: solo cambia de dónde salen los datos.
//
// Qué fuente manda (decidirFuente):
//   - sin conexión                                  -> la vista local;
//   - con conexión y la vaca SIN eventos sin aceptar -> el servidor (los enviados ya están allá);
//   - con conexión y la vaca CON eventos sin aceptar -> la vista local (el servidor todavía no los conoce).
//
// Lo que NO se proyecta: el lote (un parto o secado pendiente cambia el estado pero no el lote) ni lo calculado por
// el servidor al aceptar (lote anterior, genética): en un evento pendiente quedan en `null` y la pantalla escribe
// "Se completa al sincronizar".

import type {
  AnimalCopia,
  AnimalFicha,
  CriaDeParto,
  EntradaHistorial,
  EventoReproductivo,
  LocalesFicha,
  LoteAnterior,
  RespuestaEventos,
  RespuestaHistorial,
  SemenCopia,
  SituacionReproductiva,
  TipoServicio,
} from '../compartido/api';
import type { Enviado, Pendiente } from './almacen';
import { estadoVisible } from './dependencias';
import { marcaDePendiente, MARCA_ENVIADO } from './marcasHistorial';
import { normalizarNumero } from './numeros';
import { resumenPendiente } from './resumenPendiente';
import { construirVista, entradasValidas, type Entrada, type EventoVista } from './vistaLocal';

export type FuenteFicha = 'local' | 'servidor';

// Los pendientes de EVENTO de la vaca (los litros no cuentan: no frenan a nadie ni cambian la ficha).
const eventosDe = (animalId: string, pendientes: Pendiente[]) => pendientes.filter((p) => p.animalId === animalId && p.tipo !== 'LITROS');

// Cuántos eventos de la vaca siguen sin aceptar (esperando, enviando, en espera o rechazados).
export function contarSinAceptar(animalId: string, pendientes: Pendiente[]): number {
  return eventosDe(animalId, pendientes).length;
}

export function decidirFuente(args: { enLinea: boolean; animalId: string; pendientes: Pendiente[]; enviados?: Enviado[] }): FuenteFicha {
  if (!args.enLinea) return 'local';
  if (contarSinAceptar(args.animalId, args.pendientes) > 0) return 'local';
  // Una baja ENVIADA que la copia todavía no refleja: el servidor ya la aceptó y para un animal de baja la ficha
  // activa da 404, así que seguimos con la vista local ("Baja enviada: se confirma al actualizar", RF-23).
  // Los demás enviados no desvían: el servidor sí conoce esos eventos.
  if ((args.enviados ?? []).some((e) => e.animalId === args.animalId && e.tipo === 'BAJA')) return 'local';
  return 'servidor';
}

export type ArgsFichaLocal = {
  copia: AnimalCopia;
  // Los pendientes y enviados del usuario y tambo de la sesión (de cualquier vaca: acá se filtra por la de la copia).
  pendientes: Pendiente[];
  enviados: Enviado[];
  semen: SemenCopia[]; // catálogo activo de la copia, para el semen de un servicio pendiente
  usuarioNombre: string; // quien "registró" los eventos pendientes: el usuario de la sesión
  hoy: string; // AAAA-MM-DD de Argentina
};

export type FichaLocal = { ficha: AnimalFicha; eventos: RespuestaEventos; historial: RespuestaHistorial };

// Hora ISO de un texto con huso ("2026-11-12T08:15:00-03:00"); si no se puede leer, el mediodía de `respaldo`.
function aIso(texto: string, respaldo: string): string {
  const ms = Date.parse(texto);
  return Number.isNaN(ms) ? `${respaldo}T12:00:00.000Z` : new Date(ms).toISOString();
}

type DatosCria = { sexo?: unknown; nacidaMuerta?: unknown; numero?: unknown; observaciones?: unknown };

// Las crías de un parto pendiente: van DENTRO del parto, sin enlace (todavía no existen como animales).
function criasDe(datos: Record<string, unknown>): CriaDeParto[] {
  const crias = Array.isArray(datos.crias) ? (datos.crias as DatosCria[]) : [];
  return crias.map((c, i) => {
    const muerta = c.nacidaMuerta === true;
    return {
      orden: i + 1,
      sexo: c.sexo === 'MACHO' ? 'MACHO' : 'HEMBRA',
      nacidaMuerta: muerta,
      observaciones: typeof c.observaciones === 'string' && c.observaciones.trim() !== '' ? c.observaciones.trim() : null,
      animal: null,
      numeroPendiente: muerta || typeof c.numero !== 'string' ? null : normalizarNumero(c.numero),
    };
  });
}

export function armarFichaLocal(args: ArgsFichaLocal): FichaLocal {
  const { copia, pendientes, enviados, semen, usuarioNombre, hoy } = args;
  const animalId = copia.ficha.id;
  const entradas = entradasValidas(pendientes, enviados);
  const vista = construirVista(copia, entradas, hoy);
  const delAnimal = entradas.filter((e) => e.animalId === animalId && e.tipo !== 'LITROS');
  const entradaPorId = new Map<string, Entrada>(delAnimal.map((e) => [e.id, e]));
  const originales = new Map(copia.eventos.eventos.map((e) => [e.id, e]));

  // Estado de la vaca justo ANTES de cada evento nuevo (para "Estaba en ordeñe"): se repasan en orden de carga.
  const estadoAntes = new Map<string, AnimalFicha['estado']>();
  let estadoActual = copia.ficha.estado;
  for (const e of delAnimal) {
    if (e.tipo === 'ANULACION' || originales.has(e.id)) continue;
    estadoAntes.set(e.id, estadoActual);
    if (e.tipo === 'PARTO') estadoActual = 'EN_ORDENE';
    else if (e.tipo === 'SECADO') estadoActual = 'SECA';
    else if (e.tipo === 'BAJA') estadoActual = 'BAJA';
  }

  // Anulaciones pendientes o enviadas que la copia todavía no refleja: id del evento anulado -> quién y cuándo.
  const anulaciones = new Map<string, { motivo: string; en: string }>();
  for (const e of delAnimal) {
    if (e.tipo !== 'ANULACION') continue;
    const en = 'orden' in e ? aIso(e.cargadoEnDispositivo, hoy) : new Date(e.aceptadoEn).toISOString();
    anulaciones.set(String(e.datos.eventoId), { motivo: String(e.datos.motivo ?? ''), en });
  }

  // Ids de eventos con una anulación SIN ACEPTAR (esperando o enviando): llevan la marca "Anulación pendiente" (spec 012).
  // Una anulación ya enviada no entra: el evento se ve como "Anulado".
  const conAnulacionPendiente = new Set(delAnimal.filter((e) => e.tipo === 'ANULACION' && 'orden' in e).map((e) => String(e.datos.eventoId)));

  const anulacionDe = (id: string): EventoReproductivo['anulacion'] => {
    const a = anulaciones.get(id);
    return a ? { motivo: a.motivo, por: usuarioNombre, en: a.en } : null;
  };

  // Arma un evento de la API desde un pendiente o enviado (spec 012: se extrajo para poder armar también los
  // rechazados y "en espera", que no pasan por la vista). Todo sale de `datos`; `antes` es el estado previo de la vaca
  // y `fechaProbable` la del tacto ya calculada por la vista (null si no se tiene).
  const eventoDesdeEntrada = (
    entrada: Entrada, // nunca una ANULACION ni LITROS: quien llama las descarta antes
    anulado: boolean,
    antes: AnimalFicha['estado'],
    fechaProbable: string | null,
  ): EventoReproductivo => {
    const datos = entrada.datos;
    const fecha = String(datos.fecha ?? '');
    // Un Pendiente tiene `orden`; un Enviado, `aceptadoEn` (se pregunta en línea para que TypeScript distinga el tipo).
    const pendiente = 'orden' in entrada;
    const registradoEn = 'orden' in entrada ? aIso(entrada.cargadoEnDispositivo, fecha) : new Date(entrada.aceptadoEn).toISOString();
    const evento: EventoReproductivo = {
      id: entrada.id,
      tipo: entrada.tipo as EventoReproductivo['tipo'],
      fecha,
      registradoPor: usuarioNombre,
      registradoEn,
      cargadoEnDispositivo: 'orden' in entrada ? entrada.cargadoEnDispositivo : null,
      anulacion: anulado ? anulacionDe(entrada.id) : null,
      servicio: null,
      tacto: null,
      parto: null,
      secado: null,
      baja: null,
      // Marca (spec 012): el servidor todavía no confirmó este evento.
      marca: 'orden' in entrada ? marcaDePendiente(entrada, pendientes) : MARCA_ENVIADO,
    };
    if (pendiente) evento.pendiente = true;
    if (conAnulacionPendiente.has(entrada.id)) evento.anulacionPendiente = true;
    if (entrada.tipo === 'SERVICIO') {
      const toro = typeof datos.semenId === 'string' ? semen.find((s) => s.id === datos.semenId) : undefined;
      evento.servicio = { tipoServicio: String(datos.tipo ?? '') as TipoServicio, semen: toro ? { id: toro.id, nombre: toro.nombre } : null };
    } else if (entrada.tipo === 'TACTO') {
      evento.tacto = {
        resultado: datos.resultado === 'PRENADA' ? 'PRENADA' : 'VACIA',
        fechaProbableIndicada: typeof datos.fechaProbableParto === 'string' && datos.fechaProbableParto !== '' ? datos.fechaProbableParto : null,
        fechaProbable,
        anomalias: typeof datos.anomalias === 'string' && datos.anomalias.trim() !== '' ? datos.anomalias.trim() : null,
      };
    } else if (entrada.tipo === 'PARTO') {
      evento.parto = { estadoAnterior: antes, loteAnterior: null, genetica: null, crias: criasDe(datos) };
    } else if (entrada.tipo === 'SECADO') {
      evento.secado = { estadoAnterior: antes, loteAnterior: null };
    } else if (entrada.tipo === 'BAJA') {
      const lote: LoteAnterior = copia.ficha.lote ? { id: copia.ficha.lote.id, nombre: copia.ficha.lote.nombre } : 'SIN_LOTE';
      evento.baja = {
        motivo: datos.motivo === 'muerte' ? 'muerte' : 'venta',
        observaciones: typeof datos.observaciones === 'string' && datos.observaciones.trim() !== '' ? datos.observaciones.trim() : null,
        estadoAnterior: antes,
        loteAnterior: lote,
      };
    }
    return evento;
  };

  const armarEvento = (e: EventoVista): EventoReproductivo | null => {
    if (e.origen === 'copia') {
      const original = originales.get(e.id);
      if (!original) return null;
      // Un evento de la copia con una anulación que el servidor todavía no conoce se ve como anulado.
      const base = e.anulado && original.anulacion === null ? { ...original, anulacion: anulacionDe(e.id) } : original;
      return conAnulacionPendiente.has(e.id) ? { ...base, anulacionPendiente: true } : base;
    }
    const entrada = entradaPorId.get(e.id);
    if (!entrada || entrada.tipo === 'ANULACION' || entrada.tipo === 'LITROS') return null;
    return eventoDesdeEntrada(entrada, e.anulado, estadoAntes.get(e.id) ?? copia.ficha.estado, vista.situacion.fechasTactos.get(e.id) ?? null);
  };

  // La vista ordena de más antiguo a más reciente; la API (y las pantallas) van del más reciente al más antiguo.
  const eventosAsc = vista.eventos.flatMap((e) => {
    const armado = armarEvento(e);
    return armado ? [{ vista: e, evento: armado }] : [];
  });
  const eventos = [...eventosAsc].reverse().map((x) => x.evento);
  const porId = new Map(eventos.map((e) => [e.id, e]));

  // Situación reproductiva en la forma de la API. Los machos no tienen (como en la copia).
  const s = vista.situacion;
  const situacion: SituacionReproductiva | null =
    copia.ficha.sexo === 'MACHO'
      ? null
      : {
          estado: s.estado,
          ultimoServicio: s.ultimoServicio
            ? {
                id: s.ultimoServicio.id,
                fecha: s.ultimoServicio.fecha,
                tipoServicio: porId.get(s.ultimoServicio.id)?.servicio?.tipoServicio ?? null,
                semen: porId.get(s.ultimoServicio.id)?.servicio?.semen ?? null,
                cicloAnterior: s.ultimoServicioCicloAnterior,
              }
            : null,
          ultimoTacto: s.ultimoTacto
            ? {
                id: s.ultimoTacto.id,
                fecha: s.ultimoTacto.fecha,
                resultado: porId.get(s.ultimoTacto.id)?.tacto?.resultado ?? null,
                anomalias: porId.get(s.ultimoTacto.id)?.tacto?.anomalias ?? null,
                cicloAnterior: s.ultimoTactoCicloAnterior,
              }
            : null,
          fechaProbableParto: s.fechaProbableParto,
          fechaReferencia: s.fechaReferencia,
        };

  // Historial: las entradas de la copia (con los eventos ya adaptados) y, intercaladas, las de los eventos nuevos.
  const entradasHistorial: EntradaHistorial[] = copia.historial.entradas.map((h) => (h.clase === 'EVENTO' ? { ...h, evento: porId.get(h.evento.id) ?? h.evento } : h));
  const idsCopia = new Set(originales.keys());
  let nuevos = 0;
  // De más antiguo a más reciente: a igual fecha, cada nuevo va ANTES que lo que ya está (se cargó después).
  for (const { evento } of eventosAsc) {
    if (idsCopia.has(evento.id) || evento.tipo === 'BAJA') continue;
    const nueva: EntradaHistorial = { clase: 'EVENTO', fecha: evento.fecha, registradoEn: evento.registradoEn, evento };
    const i = entradasHistorial.findIndex((h) => h.fecha <= nueva.fecha);
    entradasHistorial.splice(i === -1 ? entradasHistorial.length : i, 0, nueva);
    nuevos += 1;
  }
  // Rechazados y "en espera del anterior" (spec 012, RF-1 y RF-3): no cuentan en la vista (no cambian estado, situación
  // ni el último no anulado), pero el historial los muestra con su marca. Se agregan acá, por fuera de la vista, en
  // orden de carga. Las anulaciones rechazadas no son un evento: quedan solo en "Pendientes" y en la nota de la ficha.
  const fueraDeVista = eventosDe(animalId, pendientes)
    .filter((p) => p.tipo !== 'ANULACION' && ['rechazado', 'enEspera'].includes(estadoVisible(p, pendientes)))
    .sort((a, b) => a.orden - b.orden);
  for (const p of fueraDeVista) {
    const evento = eventoDesdeEntrada(p, false, copia.ficha.estado, null);
    const nueva: EntradaHistorial = { clase: 'EVENTO', fecha: evento.fecha, registradoEn: evento.registradoEn, evento };
    const i = entradasHistorial.findIndex((h) => h.fecha <= nueva.fecha);
    entradasHistorial.splice(i === -1 ? entradasHistorial.length : i, 0, nueva);
    nuevos += 1;
  }

  const historial: RespuestaHistorial = {
    ...copia.historial,
    total: copia.historial.total + nuevos,
    ultimoEventoNoAnuladoId: vista.ultimoNoAnulado?.id ?? null,
    entradas: entradasHistorial,
  };

  // Notas de la ficha.
  const locales: LocalesFicha = {
    // Rechazados y "en espera del anterior": no cuentan en la vista pero hay que avisarlos (RF-24).
    sinAceptar: eventosDe(animalId, pendientes).filter((p) => ['rechazado', 'enEspera'].includes(estadoVisible(p, pendientes))).length,
    avisoLotePendiente: vista.eventos.some((e) => e.tipo === 'PARTO' && !e.anulado && e.origen !== 'copia'),
  };
  const bajas = eventosDe(animalId, pendientes)
    .filter((p) => p.tipo === 'BAJA' && estadoVisible(p, pendientes) !== 'rechazado')
    .sort((a, b) => b.orden - a.orden);
  const bajaEnviada = enviados.find((e) => e.animalId === animalId && e.tipo === 'BAJA');
  if (bajas[0]) {
    const b = bajas[0];
    // estadoVisible ya descartó 'rechazado' arriba: queda esperando, enviando o enEspera.
    locales.bajaPendiente = { id: b.id, estado: estadoVisible(b, pendientes) as 'esperando' | 'enviando' | 'enEspera', fecha: String(b.datos.fecha ?? ''), resumen: resumenPendiente('BAJA', b.datos) };
  } else if (bajaEnviada) {
    locales.bajaPendiente = { id: bajaEnviada.id, estado: 'enviada', fecha: String(bajaEnviada.datos.fecha ?? ''), resumen: resumenPendiente('BAJA', bajaEnviada.datos) };
  }

  return {
    ficha: { ...copia.ficha, estado: vista.estado, locales },
    eventos: copia.ficha.sexo === 'MACHO' ? copia.eventos : { situacion, eventos },
    historial,
  };
}
