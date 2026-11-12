// Almacén real de la tablet: IndexedDB directo (sin librerías). Spec 009.
//
// Base "cowregister-local", con estas "tablas" (object stores):
//   - animales: un registro por animal de la copia (la clave es el id de la ficha).
//   - meta: pares clave-valor: "copia" (generadaEn, total, lotes, propietario) y "perfil".
//   - pendientes: litros cargados que el servidor todavía no aceptó (clave: su id).
//   - enviados: litros aceptados que la copia local todavía no trae (clave: su id).

import type { AnimalCopia, CopiaLocal, Perfil } from '../compartido/api';
import { ErrorSinEspacio, type Almacen, type Enviado, type MetaCopia, type Pendiente, type Propietario } from './almacen';

const NOMBRE_BD = 'cowregister-local';
const VERSION = 2; // la 2 suma las tablas de pendientes y enviados (spec 009, T4)
const ANIMALES = 'animales';
const META = 'meta';
const PENDIENTES = 'pendientes';
const ENVIADOS = 'enviados';

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open(NOMBRE_BD, VERSION);
    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      // La clave de un animal es el id de su ficha ("ficha.id": ruta dentro del objeto).
      if (!bd.objectStoreNames.contains(ANIMALES)) bd.createObjectStore(ANIMALES, { keyPath: 'ficha.id' });
      if (!bd.objectStoreNames.contains(META)) bd.createObjectStore(META);
      if (!bd.objectStoreNames.contains(PENDIENTES)) bd.createObjectStore(PENDIENTES, { keyPath: 'id' });
      if (!bd.objectStoreNames.contains(ENVIADOS)) bd.createObjectStore(ENVIADOS, { keyPath: 'id' });
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
  });
}

// Convierte el error de IndexedDB: la falta de espacio se distingue del resto.
function traducir(error: DOMException | Error | null | undefined): Error {
  if (error && error.name === 'QuotaExceededError') return new ErrorSinEspacio();
  return error instanceof Error ? error : new Error('Error del almacenamiento local');
}

// Espera a que termine una transacción (completa = confirmada; error/abort = deshecha).
function terminar(tx: IDBTransaction): Promise<void> {
  return new Promise((resolver, rechazar) => {
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(traducir(tx.error));
    tx.onabort = () => rechazar(traducir(tx.error));
  });
}

function leer<T>(pedido: IDBRequest<T>): Promise<T> {
  return new Promise((resolver, rechazar) => {
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(traducir(pedido.error));
  });
}

export class AlmacenIndexedDb implements Almacen {
  private bd: Promise<IDBDatabase> | null = null;

  private conexion(): Promise<IDBDatabase> {
    // Se abre una sola vez; si falla, se reintenta en el próximo uso.
    this.bd ??= abrir().catch((e) => {
      this.bd = null;
      throw e;
    });
    return this.bd;
  }

  async leerMeta(): Promise<MetaCopia | null> {
    const bd = await this.conexion();
    const valor = await leer(bd.transaction(META, 'readonly').objectStore(META).get('copia'));
    return (valor as MetaCopia | undefined) ?? null;
  }

  async leerAnimales(): Promise<AnimalCopia[]> {
    const bd = await this.conexion();
    return leer(bd.transaction(ANIMALES, 'readonly').objectStore(ANIMALES).getAll());
  }

  async reemplazarCopia(copia: CopiaLocal, propietario: Propietario): Promise<void> {
    const bd = await this.conexion();
    // UNA sola transacción sobre las dos tablas: se vacían los animales, se escribe uno por
    // registro y se escribe la meta. Si algo falla (o no hay espacio: QuotaExceededError), el
    // navegador deshace TODO y queda la copia anterior completa (RF-7, RF-9).
    const tx = bd.transaction([ANIMALES, META], 'readwrite');
    const terminada = terminar(tx);
    try {
      const animales = tx.objectStore(ANIMALES);
      animales.clear();
      for (const animal of copia.animales) animales.put(animal);
      const meta: MetaCopia = { generadaEn: copia.generadaEn, totalAnimales: copia.totalAnimales, lotes: copia.lotes, propietario };
      tx.objectStore(META).put(meta, 'copia');
    } catch (e) {
      // Una excepción síncrona (por ejemplo, un dato que no se puede clonar): se cancela todo.
      try {
        tx.abort();
      } catch {
        /* ya estaba cancelada */
      }
      await terminada.catch(() => undefined);
      throw traducir(e as Error);
    }
    await terminada;
  }

  async borrarCopia(): Promise<void> {
    const bd = await this.conexion();
    const tx = bd.transaction([ANIMALES, META], 'readwrite');
    tx.objectStore(ANIMALES).clear();
    tx.objectStore(META).delete('copia');
    await terminar(tx);
  }

  async leerPerfil(): Promise<Perfil | null> {
    const bd = await this.conexion();
    const valor = await leer(bd.transaction(META, 'readonly').objectStore(META).get('perfil'));
    return (valor as Perfil | undefined) ?? null;
  }

  async guardarPerfil(perfil: Perfil): Promise<void> {
    const bd = await this.conexion();
    const tx = bd.transaction(META, 'readwrite');
    tx.objectStore(META).put(perfil, 'perfil');
    await terminar(tx);
  }

  async borrarTodo(): Promise<void> {
    const bd = await this.conexion();
    const tx = bd.transaction([ANIMALES, META, PENDIENTES, ENVIADOS], 'readwrite');
    tx.objectStore(ANIMALES).clear();
    tx.objectStore(META).clear();
    tx.objectStore(PENDIENTES).clear();
    tx.objectStore(ENVIADOS).clear();
    await terminar(tx);
  }

  // ── Pendientes y enviados recientes ──

  async listarPendientes(): Promise<Pendiente[]> {
    const bd = await this.conexion();
    return leer(bd.transaction(PENDIENTES, 'readonly').objectStore(PENDIENTES).getAll());
  }

  async guardarPendiente(pendiente: Pendiente): Promise<void> {
    const bd = await this.conexion();
    const tx = bd.transaction(PENDIENTES, 'readwrite');
    const terminada = terminar(tx); // QuotaExceededError llega acá como ErrorSinEspacio
    tx.objectStore(PENDIENTES).put(pendiente);
    await terminada;
  }

  async borrarPendiente(id: string): Promise<void> {
    const bd = await this.conexion();
    const tx = bd.transaction(PENDIENTES, 'readwrite');
    tx.objectStore(PENDIENTES).delete(id);
    await terminar(tx);
  }

  // Una sola transacción: o se borra el pendiente Y se guarda el enviado, o no pasa ninguna de las dos.
  async aceptarPendiente(id: string, enviado: Enviado): Promise<void> {
    const bd = await this.conexion();
    const tx = bd.transaction([PENDIENTES, ENVIADOS], 'readwrite');
    tx.objectStore(ENVIADOS).put(enviado);
    tx.objectStore(PENDIENTES).delete(id);
    await terminar(tx);
  }

  async listarEnviados(): Promise<Enviado[]> {
    const bd = await this.conexion();
    return leer(bd.transaction(ENVIADOS, 'readonly').objectStore(ENVIADOS).getAll());
  }

  async guardarEnviado(enviado: Enviado): Promise<void> {
    const bd = await this.conexion();
    const tx = bd.transaction(ENVIADOS, 'readwrite');
    tx.objectStore(ENVIADOS).put(enviado);
    await terminar(tx);
  }

  async borrarEnviados(ids: string[]): Promise<void> {
    const bd = await this.conexion();
    const tx = bd.transaction(ENVIADOS, 'readwrite');
    for (const id of ids) tx.objectStore(ENVIADOS).delete(id);
    await terminar(tx);
  }
}

// Un único almacén para toda la app.
let almacenDelNavegador: Almacen | null = null;
export function obtenerAlmacen(): Almacen {
  almacenDelNavegador ??= new AlmacenIndexedDb();
  return almacenDelNavegador;
}
