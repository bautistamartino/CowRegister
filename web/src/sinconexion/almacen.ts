// Interfaz del "almacén" de datos locales de la tablet (spec 009).
//
// La lógica (copia.ts y, en las próximas tareas, la cola de pendientes) habla solo con esta
// interfaz. Hay dos implementaciones:
//   - almacenIndexedDb.ts: la real, en el navegador.
//   - almacenMemoria.ts: la de los tests (sin navegador).
// Así toda la lógica se prueba con Vitest sin tocar IndexedDB.

import type { AnimalCopia, CopiaLocal, Lote, Perfil, RegistroProduccion, TurnoOrdeno } from '../compartido/api';

// Se lanza cuando el navegador no tiene espacio para guardar (QuotaExceededError en IndexedDB).
export class ErrorSinEspacio extends Error {
  constructor() {
    super('No hay espacio en la tablet para guardar los datos sin conexión');
  }
}

// Dueño de la copia: el usuario y el tambo para los que se descargó. Nunca se muestra una copia
// a otro usuario o tambo (RF-17, RF-46).
export type Propietario = { usuarioId: string; establecimientoId: string };

// Datos "chicos" de la copia: todo menos las fichas de los animales (que son la parte pesada).
export type MetaCopia = {
  generadaEn: string; // "Datos al día de…": instante de la foto del servidor
  totalAnimales: number;
  lotes: Lote[];
  propietario: Propietario;
};

// ─── Litros pendientes de sincronizar (spec 009, RF-18 a RF-40) ───

// Estados de un pendiente. "Aceptado" no es un estado: al aceptarse el pendiente se borra y pasa a
// la lista de "enviados recientes" (ver `Enviado`).
//   esperando = todavía no lo aceptó el servidor (se reintenta solo, o con "Reintentar ahora").
//   enviando  = hay un envío en curso.
//   rechazado = el servidor dijo que no por una regla del negocio; solo sale con "Reintentar" o "Descartar".
export type EstadoPendiente = 'esperando' | 'enviando' | 'rechazado';

export type Pendiente = {
  id: string; // UUID generado en la tablet: reenviarlo no duplica el registro (spec 008, RF-34)
  usuarioId: string; // quién lo cargó: un pendiente solo lo ve y lo envía su dueño (RF-17, RF-46)
  establecimientoId: string;
  animalId: string;
  numero: string; // número de la vaca (para mostrarlo sin buscar la ficha)
  fecha: string; // AAAA-MM-DD
  turno: TurnoOrdeno;
  litros: string; // texto con punto y un decimal como máximo ("12.5"): se manda tal cual, sin coma flotante
  cargadoEnDispositivo: string; // hora de la tablet con -03:00: solo informativa (RF-26)
  orden: number; // orden de carga: se envían de a uno en este orden
  estado: EstadoPendiente;
  motivo: string | null; // rechazo, o por qué sigue esperando
  codigoRechazo: number | null; // código HTTP del rechazo (409 = duplicado, por ejemplo)
  intentos: number; // envíos que fallaron sin ser un rechazo
  proximoIntento: number | null; // milisegundos (Date.now) a partir de los cuales se reintenta solo
};

// Litro que el servidor ya aceptó pero que todavía no está en la copia local: se sigue viendo en la
// ficha como "Enviado: se confirma al actualizar" hasta que una copia nueva lo incluya (RF-34).
export type Enviado = {
  id: string;
  usuarioId: string;
  establecimientoId: string;
  animalId: string;
  numero: string;
  registro: RegistroProduccion; // tal como lo devolvió el servidor
};

export interface Almacen {
  // Meta de la copia guardada, o null si no hay copia.
  leerMeta(): Promise<MetaCopia | null>;
  // Todos los animales de la copia (vacío si no hay copia).
  leerAnimales(): Promise<AnimalCopia[]>;
  // Reemplaza la copia ENTERA en una sola operación atómica: o queda la nueva completa o, si algo
  // falla (incluida la falta de espacio, ErrorSinEspacio), queda la anterior intacta (RF-7, RF-9).
  reemplazarCopia(copia: CopiaLocal, propietario: Propietario): Promise<void>;
  // Borra solo la copia (animales y meta), no el perfil. Se usa cuando la copia guardada es de otro
  // usuario o tambo y hay que descargar la propia (la confirmación explícita llega en la T5).
  borrarCopia(): Promise<void>;
  // Último perfil con el que se entró (para abrir la app sin conexión).
  leerPerfil(): Promise<Perfil | null>;
  guardarPerfil(perfil: Perfil): Promise<void>;
  // Borra TODO lo local (copia, perfil, pendientes y enviados): cierre de sesión (RF-43).
  borrarTodo(): Promise<void>;

  // ── Pendientes y enviados recientes ──
  // Todos los pendientes guardados (de cualquier usuario: el filtro por dueño lo hace la lógica).
  listarPendientes(): Promise<Pendiente[]>;
  // Agrega o reemplaza un pendiente. Lanza ErrorSinEspacio si no hay lugar: nada se confirma como guardado (RF-22).
  guardarPendiente(pendiente: Pendiente): Promise<void>;
  borrarPendiente(id: string): Promise<void>;
  // El servidor lo aceptó: en UNA operación se borra el pendiente y se guarda el enviado reciente.
  aceptarPendiente(id: string, enviado: Enviado): Promise<void>;
  listarEnviados(): Promise<Enviado[]>;
  guardarEnviado(enviado: Enviado): Promise<void>;
  borrarEnviados(ids: string[]): Promise<void>;
}
