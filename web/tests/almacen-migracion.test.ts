import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlmacenIndexedDb } from '../src/sinconexion/almacenIndexedDb';
import { clasificarRespuesta } from '../src/sinconexion/clasificar';
import { restablecerEnviando } from '../src/sinconexion/cola';
import { migrarEnviado009, migrarPendiente009 } from '../src/sinconexion/formatoAlmacen';
import { crearSincronizador } from '../src/sinconexion/sincronizar';
import { persona } from './ayudas';

// Migración de IndexedDB 2 -> 3 (spec 010, RF-13), con fake-indexeddb. Se arma una base con el formato LITERAL
// de la spec 009 (sin tipo ni datos), se abre con el almacén nuevo y se comprueba que no se perdió nada.

const NOMBRE_BD = 'cowregister-local';

// Registros tal como los guardaba la 009.
const pend009 = (id: string, orden: number, extra: Record<string, unknown> = {}) => ({
  id,
  usuarioId: persona.usuarioId,
  establecimientoId: persona.establecimientoId,
  animalId: `vaca-${id}`,
  numero: String(orden),
  fecha: '2026-11-11',
  turno: 'tarde',
  litros: '9.5',
  cargadoEnDispositivo: '2026-11-11T17:30:00-03:00',
  orden,
  estado: 'esperando',
  motivo: null,
  codigoRechazo: null,
  intentos: 0,
  proximoIntento: null,
  ...extra,
});

const env009 = {
  id: 'env1',
  usuarioId: persona.usuarioId,
  establecimientoId: persona.establecimientoId,
  animalId: 'vaca-env1',
  numero: '40',
  registro: {
    id: 'env1',
    animalId: 'vaca-env1',
    fecha: '2026-11-10',
    turno: 'manana',
    litros: 12.5,
    loteNombre: 'Ordeñe',
    registradoPor: 'Dueño',
    registradoEn: '2026-11-10T11:20:00.000Z',
    anulado: null,
  },
};

const meta009 = { generadaEn: '2026-11-12T11:00:00.000Z', totalAnimales: 0, lotes: [], propietario: persona };

// Crea una base versión 2 como la dejaba la 009 y la cierra.
async function crearBase009(pendientes: object[], enviados: object[]): Promise<void> {
  const bd = await new Promise<IDBDatabase>((resolver, rechazar) => {
    const pedido = indexedDB.open(NOMBRE_BD, 2);
    pedido.onupgradeneeded = () => {
      const d = pedido.result;
      d.createObjectStore('animales', { keyPath: 'ficha.id' });
      d.createObjectStore('meta');
      d.createObjectStore('pendientes', { keyPath: 'id' });
      d.createObjectStore('enviados', { keyPath: 'id' });
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
  });
  const tx = bd.transaction(['pendientes', 'enviados', 'meta'], 'readwrite');
  for (const p of pendientes) tx.objectStore('pendientes').put(p);
  for (const e of enviados) tx.objectStore('enviados').put(e);
  tx.objectStore('meta').put(meta009, 'copia');
  await new Promise<void>((resolver, rechazar) => {
    tx.oncomplete = () => resolver();
    tx.onerror = () => rechazar(tx.error);
  });
  bd.close(); // sin esto la actualización quedaría bloqueada
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('base versión 2 de la 009 abierta con la versión 3', () => {
  const pendientes009 = () => [
    pend009('esp', 3),
    pend009('env', 1, { estado: 'enviando', intentos: 1, motivo: 'sin red', proximoIntento: 5_000 }),
    pend009('rech', 2, { estado: 'rechazado', motivo: 'Ya hay una carga de esta vaca', codigoRechazo: 409 }),
  ];

  it('conserva todos los litros sin perder ni duplicar, en el mismo orden, ahora con tipo y datos', async () => {
    await crearBase009(pendientes009(), [env009]);
    const almacen = new AlmacenIndexedDb();

    const lista = (await almacen.listarPendientes()).sort((a, b) => a.orden - b.orden);
    expect(lista.map((p) => p.id)).toEqual(['env', 'rech', 'esp']); // orden de carga 1, 2, 3
    for (const p of lista) {
      const viejo = pendientes009().find((v) => v.id === p.id)!;
      const { fecha, turno, litros, ...resto } = viejo;
      expect(p).toEqual({ ...resto, tipo: 'LITROS', datos: { fecha, turno, litros } });
    }
    expect(lista.find((p) => p.id === 'rech')).toMatchObject({ estado: 'rechazado', codigoRechazo: 409 });
  });

  it('migra el enviado con su registro y la hora del servidor, y la copia queda intacta', async () => {
    await crearBase009([], [env009]);
    const almacen = new AlmacenIndexedDb();
    const [e] = await almacen.listarEnviados();
    expect(e).toEqual({
      ...env009,
      tipo: 'LITROS',
      datos: { fecha: '2026-11-10', turno: 'manana', litros: '12.5' },
      aceptadoEn: Date.parse('2026-11-10T11:20:00.000Z'),
    });
    expect(await almacen.leerMeta()).toEqual(meta009);
    expect(await almacen.listarAvisos()).toEqual([]); // el almacén nuevo existe y está vacío
  });

  it('una segunda apertura no los vuelve a migrar ni cambia nada', async () => {
    await crearBase009(pendientes009(), [env009]);
    const primera = new AlmacenIndexedDb();
    const antesP = await primera.listarPendientes();
    const antesE = await primera.listarEnviados();
    const bd = await (primera as unknown as { conexion(): Promise<IDBDatabase> }).conexion();
    bd.close();

    const segunda = new AlmacenIndexedDb();
    expect(await segunda.listarPendientes()).toEqual(antesP);
    expect(await segunda.listarEnviados()).toEqual(antesE);
  });

  it('lo que estaba enviando sigue pudiendo restablecerse a esperando', async () => {
    await crearBase009(pendientes009(), []);
    const almacen = new AlmacenIndexedDb();
    await restablecerEnviando(almacen, persona);
    const estados = Object.fromEntries((await almacen.listarPendientes()).map((p) => [p.id, p.estado]));
    expect(estados).toEqual({ env: 'esperando', rech: 'rechazado', esp: 'esperando' });
  });

  it('el sincronizador los envía con el cuerpo de litros de la 009', async () => {
    await crearBase009([pend009('esp', 1)], []);
    const almacen = new AlmacenIndexedDb();
    const cuerpos: unknown[] = [];
    const sinc = crearSincronizador({
      almacen,
      persona,
      ahora: () => 1_000_000,
      bloqueo: (fn) => fn(),
      enviar: (p) => {
        // Lo mismo que arma envio.ts: id, fecha, turno, litros y la hora de la tablet.
        cuerpos.push({ id: p.id, ...p.datos, cargadoEnDispositivo: p.cargadoEnDispositivo });
        return {
          estado: 201,
          cuerpo: { id: p.id, animalId: p.animalId, fecha: '2026-11-11', turno: 'tarde', litros: 9.5, loteNombre: 'Ordeñe', registradoPor: 'Dueño', registradoEn: '2026-11-12T11:20:00.000Z', anulado: null },
        };
      },
    });
    const r = await sinc.sincronizar();
    expect(r.aceptados).toBe(1);
    expect(cuerpos).toEqual([{ id: 'esp', fecha: '2026-11-11', turno: 'tarde', litros: '9.5', cargadoEnDispositivo: '2026-11-11T17:30:00-03:00' }]);
    expect(await almacen.listarPendientes()).toEqual([]);
    expect(await almacen.listarEnviados()).toHaveLength(1);
  });

  it('la clasificación de la 009 sigue aceptando el litro migrado', async () => {
    await crearBase009([pend009('esp', 1)], []);
    const [p] = await new AlmacenIndexedDb().listarPendientes();
    const respuesta = { estado: 201, cuerpo: { id: 'esp', animalId: 'vaca-esp', fecha: '2026-11-11', turno: 'tarde', litros: 9.5 } };
    expect(clasificarRespuesta(respuesta, p!).tipo).toBe('aceptado');
  });

  it('una base nueva se crea con todos los almacenes, el de avisos incluido', async () => {
    const almacen = new AlmacenIndexedDb();
    expect(await almacen.listarPendientes()).toEqual([]);
    expect(await almacen.listarAvisos()).toEqual([]);
  });
});

describe('funciones puras de migración (idempotentes)', () => {
  it('un registro que ya tiene tipo no se toca', () => {
    const nuevo = { id: 'x', tipo: 'PARTO', datos: { fecha: '2026-11-12' } };
    expect(migrarPendiente009(nuevo)).toBe(nuevo);
    const env = { id: 'x', tipo: 'TACTO', datos: {}, aceptadoEn: 1, registro: null };
    expect(migrarEnviado009(env)).toBe(env);
  });

  it('un enviado con fecha ilegible queda con aceptadoEn 0 y no inventa una hora', () => {
    const r = migrarEnviado009({ id: 'x', registro: { fecha: '2026-11-10', turno: 'manana', litros: 3, registradoEn: 'basura' } }) as { aceptadoEn: number };
    expect(r.aceptadoEn).toBe(0);
  });

  it('lo que no es un objeto se deja como está', () => {
    expect(migrarPendiente009(null)).toBeNull();
    expect(migrarEnviado009('texto')).toBe('texto');
  });
});
