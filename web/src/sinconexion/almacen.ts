// Interfaz del "almacén" de datos locales de la tablet (spec 009).
//
// La lógica (copia.ts y, en las próximas tareas, la cola de pendientes) habla solo con esta
// interfaz. Hay dos implementaciones:
//   - almacenIndexedDb.ts: la real, en el navegador.
//   - almacenMemoria.ts: la de los tests (sin navegador).
// Así toda la lógica se prueba con Vitest sin tocar IndexedDB.

import type { AnimalCopia, CopiaLocal, Lote, Perfil } from '../compartido/api';

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
  // Borra TODO lo local (copia y perfil): cierre de sesión (RF-43).
  borrarTodo(): Promise<void>;
}
