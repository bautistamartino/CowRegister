// Interfaz del "almacén" de datos locales de la tablet (spec 009).
//
// La lógica (copia.ts y, en las próximas tareas, la cola de pendientes) habla solo con esta
// interfaz. Hay dos implementaciones:
//   - almacenIndexedDb.ts: la real, en el navegador.
//   - almacenMemoria.ts: la de los tests (sin navegador).
// Así toda la lógica se prueba con Vitest sin tocar IndexedDB.

import type { AnimalCopia, Aviso, CopiaLocal, Lote, Perfil, RegistroProduccion, TurnoOrdeno } from '../compartido/api';

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
  // Semen y toros activos del tambo (spec 010, RF-8). Opcional: una copia guardada antes de la 010 no lo tiene;
  // mientras falte, la regla local de "semen activo" no se aplica y decide el servidor. (La copia lo guarda en la T3.)
  semen?: SemenCopia[];
};

export type SemenCopia = { id: string; nombre: string; raza: string | null };

// ─── Pendientes de sincronizar (spec 009 para litros; spec 010 para todos los tipos) ───

// Estados de un pendiente. "Aceptado" no es un estado: al aceptarse el pendiente se borra y pasa a
// la lista de "enviados recientes" (ver `Enviado`). "En espera del anterior" tampoco se guarda: se calcula
// en dependencias.ts a partir de lo que hay delante de la vaca.
//   esperando = todavía no lo aceptó el servidor (se reintenta solo, o con "Reintentar ahora").
//   enviando  = hay un envío en curso.
//   rechazado = el servidor dijo que no por una regla del negocio; solo sale con "Reintentar" o "Descartar".
export type EstadoPendiente = 'esperando' | 'enviando' | 'rechazado';

// Qué se cargó. LITROS es el de la 009; los demás son los eventos de la 010. ANULACION anula un evento.
export type TipoPendiente = 'LITROS' | 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO' | 'BAJA' | 'ANULACION';

// `datos` es lo que se manda al servidor, según el tipo (ver el plan de la spec 010):
//   LITROS: { fecha, turno, litros }      PARTO: { fecha, crias[] }      ANULACION: { eventoId, tipoEvento, motivo }
// Es inmutable: un pendiente no se corrige, solo se reintenta o se descarta (así el reenvío es idempotente).
export type DatosLitros = { fecha: string; turno: TurnoOrdeno; litros: string }; // litros: texto con punto ("12.5")

export type Pendiente = {
  id: string; // UUID generado en la tablet (= id del evento): reenviarlo no duplica el registro
  usuarioId: string; // quién lo cargó: un pendiente solo lo ve y lo envía su dueño
  establecimientoId: string;
  animalId: string;
  numero: string; // número de la vaca (para mostrarlo sin buscar la ficha)
  tipo: TipoPendiente;
  datos: Record<string, unknown>;
  cargadoEnDispositivo: string; // hora de la tablet con -03:00: solo informativa
  orden: number; // orden de carga: se envían en este orden (por vaca)
  estado: EstadoPendiente;
  motivo: string | null; // rechazo, o por qué sigue esperando
  codigoRechazo: number | null; // código HTTP del rechazo (409 = duplicado, por ejemplo)
  intentos: number; // envíos que fallaron sin ser un rechazo
  proximoIntento: number | null; // milisegundos (Date.now) a partir de los cuales se reintenta solo
};

// Lo que el servidor ya aceptó pero la copia local todavía no refleja: se sigue viendo hasta que una copia
// nueva lo incluya.
export type Enviado = {
  id: string;
  usuarioId: string;
  establecimientoId: string;
  animalId: string;
  numero: string;
  tipo: TipoPendiente;
  datos: Record<string, unknown>;
  aceptadoEn: number; // milisegundos, hora del SERVIDOR (registradoEn o anulación.en de la respuesta)
  registro: RegistroProduccion | null; // solo litros, tal como lo devolvió el servidor
};

// Avisos que dio el servidor al aceptar un pendiente. Sobreviven al `Enviado` (que se quita cuando la copia lo
// refleja) y solo se borran cuando el usuario los cierra.
export type AvisoGuardado = {
  id: string; // = id del pendiente
  usuarioId: string;
  establecimientoId: string;
  animalId: string;
  numero: string;
  tipo: TipoPendiente;
  avisos: Aviso[];
};

// Los datos de un pendiente o enviado de litros, ya tipados.
export const datosLitros = (x: { datos: Record<string, unknown> }): DatosLitros => x.datos as DatosLitros;

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
  // Borra TODO lo local (copia, perfil, pendientes, enviados y avisos): cierre de sesión (RF-43).
  borrarTodo(): Promise<void>;

  // ── Pendientes y enviados recientes ──
  // Todos los pendientes guardados (de cualquier usuario: el filtro por dueño lo hace la lógica).
  listarPendientes(): Promise<Pendiente[]>;
  // Agrega o reemplaza un pendiente. Lanza ErrorSinEspacio si no hay lugar: nada se confirma como guardado (RF-22).
  guardarPendiente(pendiente: Pendiente): Promise<void>;
  borrarPendiente(id: string): Promise<void>;
  // El servidor lo aceptó: en UNA operación se borra el pendiente, se guarda el enviado reciente y se guardan
  // los avisos del servidor (null si no hubo ninguno).
  aceptarPendiente(id: string, enviado: Enviado, avisos: AvisoGuardado | null): Promise<void>;
  listarEnviados(): Promise<Enviado[]>;
  guardarEnviado(enviado: Enviado): Promise<void>;
  borrarEnviados(ids: string[]): Promise<void>;

  // ── Avisos del servidor (spec 010, RF-28) ──
  listarAvisos(): Promise<AvisoGuardado[]>;
  guardarAvisos(avisos: AvisoGuardado): Promise<void>;
  borrarAvisos(ids: string[]): Promise<void>;
}
