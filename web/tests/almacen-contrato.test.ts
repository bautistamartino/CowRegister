import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CopiaLocal } from '../src/compartido/api';
import { ErrorSinEspacio, type Almacen, type AvisoGuardado, type Enviado, type TipoPendiente } from '../src/sinconexion/almacen';
import { AlmacenIndexedDb } from '../src/sinconexion/almacenIndexedDb';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import { enviado, pendiente, persona, vacaCopia } from './ayudas';

// Contrato del almacén (spec 010, RF-12, RF-14): lo mismo se le exige al de memoria y al de IndexedDB
// (este último con fake-indexeddb, un IndexedDB simulado que corre en Node).

const implementaciones: [string, () => Almacen][] = [
  ['memoria', () => new AlmacenMemoria()],
  [
    'IndexedDB (falso)',
    () => {
      globalThis.indexedDB = new IDBFactory(); // una base vacía y nueva por cada test
      return new AlmacenIndexedDb();
    },
  ],
];

const copia: CopiaLocal = { generadaEn: '2026-11-12T11:00:00.000Z', totalAnimales: 1, lotes: [], animales: [vacaCopia('a1', '12')] };

const avisosDe = (id: string): AvisoGuardado => ({
  id,
  usuarioId: persona.usuarioId,
  establecimientoId: persona.establecimientoId,
  animalId: 'a1',
  numero: '12',
  tipo: 'PARTO',
  avisos: [{ codigo: 'LOTE', mensaje: 'La vaca pasó al lote Ordeñe' }],
});

const TIPOS: TipoPendiente[] = ['LITROS', 'SERVICIO', 'TACTO', 'PARTO', 'SECADO', 'BAJA', 'ANULACION'];

describe.each(implementaciones)('almacén %s', (_nombre, crear) => {
  let almacen: Almacen;
  beforeEach(() => {
    almacen = crear();
  });

  it('guarda un pendiente de cada tipo con todos sus datos y lo devuelve igual', async () => {
    const datos = { fecha: '2026-11-12', crias: [{ sexo: 'HEMBRA', numero: '7' }], anidado: { a: [1, 2] } };
    for (const [i, tipo] of TIPOS.entries()) await almacen.guardarPendiente(pendiente({ id: `p${i}`, orden: i + 1, tipo, datos }));
    const guardados = (await almacen.listarPendientes()).sort((a, b) => a.orden - b.orden);
    expect(guardados.map((p) => p.tipo)).toEqual(TIPOS);
    expect(guardados[3]).toEqual(pendiente({ id: 'p3', orden: 4, tipo: 'PARTO', datos }));
  });

  it('guardar el mismo id lo reemplaza (no duplica)', async () => {
    await almacen.guardarPendiente(pendiente({ id: 'x' }));
    await almacen.guardarPendiente(pendiente({ id: 'x', estado: 'rechazado', motivo: 'no', codigoRechazo: 409 }));
    const lista = await almacen.listarPendientes();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ estado: 'rechazado', motivo: 'no', codigoRechazo: 409 });
  });

  it('borrar un pendiente solo borra ese', async () => {
    await almacen.guardarPendiente(pendiente({ id: 'a' }));
    await almacen.guardarPendiente(pendiente({ id: 'b', animalId: 'a2' }));
    await almacen.borrarPendiente('a');
    expect((await almacen.listarPendientes()).map((p) => p.id)).toEqual(['b']);
  });

  it('aceptarPendiente borra el pendiente y guarda el enviado y los avisos en una sola operación', async () => {
    const p = pendiente({ id: 'parto1', tipo: 'PARTO', datos: { fecha: '2026-11-12', crias: [] } });
    await almacen.guardarPendiente(p);
    const e: Enviado = { ...enviado(p), tipo: 'PARTO', datos: p.datos, registro: null, aceptadoEn: 1_794_000_000_000 };
    await almacen.aceptarPendiente('parto1', e, avisosDe('parto1'));
    expect(await almacen.listarPendientes()).toEqual([]);
    expect(await almacen.listarEnviados()).toEqual([e]);
    expect(await almacen.listarAvisos()).toEqual([avisosDe('parto1')]);
  });

  it('aceptarPendiente sin avisos no guarda ninguno', async () => {
    const p = pendiente({ id: 'l1' });
    await almacen.guardarPendiente(p);
    await almacen.aceptarPendiente('l1', enviado(p), null);
    expect(await almacen.listarEnviados()).toHaveLength(1);
    expect(await almacen.listarAvisos()).toEqual([]);
  });

  it('los avisos sobreviven a la limpieza del enviado y solo se borran al cerrarlos', async () => {
    const p = pendiente({ id: 'x' });
    await almacen.guardarPendiente(p);
    await almacen.aceptarPendiente('x', enviado(p), avisosDe('x'));
    await almacen.borrarEnviados(['x']);
    expect(await almacen.listarEnviados()).toEqual([]);
    expect(await almacen.listarAvisos()).toHaveLength(1);
    await almacen.guardarAvisos(avisosDe('y'));
    await almacen.borrarAvisos(['x']);
    expect((await almacen.listarAvisos()).map((a) => a.id)).toEqual(['y']);
  });

  it('guarda y lista enviados y los borra por id', async () => {
    await almacen.guardarEnviado(enviado(pendiente({ id: 'e1' })));
    await almacen.guardarEnviado(enviado(pendiente({ id: 'e2' })));
    await almacen.borrarEnviados(['e1']);
    const lista = await almacen.listarEnviados();
    expect(lista.map((e) => e.id)).toEqual(['e2']);
    expect(lista[0]).toMatchObject({ tipo: 'LITROS', aceptadoEn: Date.parse('2026-11-12T11:20:00.000Z') });
  });

  it('borrarTodo limpia copia, perfil, pendientes, enviados y avisos', async () => {
    await almacen.reemplazarCopia(copia, persona);
    await almacen.guardarPendiente(pendiente({ id: 'p' }));
    await almacen.guardarEnviado(enviado(pendiente({ id: 'e' })));
    await almacen.guardarAvisos(avisosDe('p'));
    await almacen.borrarTodo();
    expect(await almacen.leerMeta()).toBeNull();
    expect(await almacen.leerAnimales()).toEqual([]);
    expect(await almacen.listarPendientes()).toEqual([]);
    expect(await almacen.listarEnviados()).toEqual([]);
    expect(await almacen.listarAvisos()).toEqual([]);
  });

  it('la copia se guarda y se lee igual', async () => {
    await almacen.reemplazarCopia(copia, persona);
    expect(await almacen.leerMeta()).toMatchObject({ generadaEn: copia.generadaEn, totalAnimales: 1, propietario: persona });
    expect((await almacen.leerAnimales()).map((a) => a.ficha.id)).toEqual(['a1']);
  });

  // Spec 010, RF-8: el semen activo viaja con la copia y se guarda en la meta (la regla local de "semen activo" lo usa).
  it('guarda el semen de la copia en la meta, y una copia sin semen no lo inventa', async () => {
    const semen = [{ id: 'sm1', nombre: 'Toro Alfa', raza: 'Holando' }, { id: 'sm2', nombre: 'Toro Beta', raza: null }];
    await almacen.reemplazarCopia({ ...copia, semen }, persona);
    expect((await almacen.leerMeta())?.semen).toEqual(semen);
    await almacen.reemplazarCopia(copia, persona);
    expect((await almacen.leerMeta())?.semen).toBeUndefined();
  });
});

describe('falta de espacio (memoria)', () => {
  it('el pendiente que no entra lanza ErrorSinEspacio y no queda guardado', async () => {
    const almacen = new AlmacenMemoria();
    almacen.configurar({ capacidadPendientes: 1 });
    await almacen.guardarPendiente(pendiente({ id: 'a' }));
    await expect(almacen.guardarPendiente(pendiente({ id: 'b', animalId: 'a2' }))).rejects.toBeInstanceOf(ErrorSinEspacio);
    expect(await almacen.listarPendientes()).toHaveLength(1);
  });
});
