import { describe, expect, it } from 'vitest';
import type { Animal, AnimalCopia } from '../src/compartido/api';
import type { Enviado, Pendiente } from '../src/sinconexion/almacen';
import { animalConBajaEnviada, animalesConBajaPendiente, completarConBajasEnviadas, marcarListado } from '../src/sinconexion/marcasListado';
import { enviado, pendiente, vacaCopia } from './ayudas';

// Baja pendiente en el listado y el buscador (spec 012, RF-5 a RF-7). Lógica pura.

let n = 0;
function pend(tipo: Pendiente['tipo'], datos: Record<string, unknown>, cambios: Partial<Pendiente> = {}): Pendiente {
  n += 1;
  return pendiente({ id: `p-${n}`, tipo, datos, orden: n, ...cambios });
}
const baja = (cambios: Partial<Pendiente> = {}) => pend('BAJA', { fecha: '2026-11-12', motivo: 'venta' }, cambios);
const env = (p: Pendiente): Enviado => ({ ...enviado(p), tipo: p.tipo, datos: p.datos, registro: null });

const fila = (id: string, numero: string, extra: Partial<Animal> = {}): Animal => ({ id, numero, sexo: 'HEMBRA', estado: 'EN_ORDENE', lote: null, ...extra });

describe('animalesConBajaPendiente (RF-5)', () => {
  it('una baja esperando o enviando marca al animal', () => {
    expect(animalesConBajaPendiente([baja({ animalId: 'a1' }), baja({ animalId: 'a2', estado: 'enviando' })], [])).toEqual(new Set(['a1', 'a2']));
  });

  it('una baja enviada que la copia todavía no refleja marca al animal', () => {
    expect(animalesConBajaPendiente([], [env(baja({ animalId: 'a3' }))])).toEqual(new Set(['a3']));
  });

  it('una baja rechazada o "en espera del anterior" NO marca (no cuenta en la vista local)', () => {
    const rechazada = baja({ animalId: 'a1', estado: 'rechazado', motivo: 'x' });
    const delante = pend('SERVICIO', { fecha: '2026-11-01' }, { animalId: 'a2', estado: 'rechazado', motivo: 'x' });
    const enEspera = baja({ animalId: 'a2' });
    expect(animalesConBajaPendiente([rechazada, delante, enEspera], [])).toEqual(new Set());
  });

  it('servicio, tacto, parto, secado, anulación y litros NO marcan (RF-6)', () => {
    const otros = [
      pend('SERVICIO', { fecha: '2026-11-01' }, { animalId: 'a1' }),
      pend('TACTO', { fecha: '2026-11-02', resultado: 'PRENADA' }, { animalId: 'a1' }),
      pend('PARTO', { fecha: '2026-11-03', crias: [{ sexo: 'HEMBRA' }] }, { animalId: 'a1' }),
      pend('SECADO', { fecha: '2026-11-04' }, { animalId: 'a1' }),
      pend('ANULACION', { eventoId: 'x', tipoEvento: 'SERVICIO', motivo: 'm' }, { animalId: 'a1' }),
      pendiente({ id: 'l-1', animalId: 'a1', orden: 99 }),
    ];
    expect(animalesConBajaPendiente(otros, otros.map(env))).toEqual(new Set());
  });
});

describe('marcarListado (RF-5, RF-6, RF-7)', () => {
  it('marca solo las filas indicadas y no toca las demás', () => {
    const lista = [fila('a1', '10'), fila('a2', '11')];
    const r = marcarListado(lista, new Set(['a2']));
    expect(r[0]).toEqual(lista[0]);
    expect(r[0]!.bajaPendiente).toBeUndefined();
    expect(r[1]).toEqual({ ...lista[1], bajaPendiente: true });
  });

  it('no repite filas: las crías pendientes no figuran y un número reutilizado queda en una fila', () => {
    // El animal con baja pendiente conserva su fila; la cría pendiente (mismo número) no está en el listado.
    const lista = [fila('a1', '10')];
    const parto = pend('PARTO', { fecha: '2026-11-13', crias: [{ sexo: 'HEMBRA', numero: '10' }] }, { animalId: 'a9' });
    const r = marcarListado(lista, animalesConBajaPendiente([baja({ animalId: 'a1' }), parto], []));
    expect(r).toHaveLength(1);
    expect(r[0]!.bajaPendiente).toBe(true);
  });

  it('al descartar la baja (ya no hay pendiente) la marca desaparece', () => {
    const lista = [fila('a1', '10')];
    const con = marcarListado(lista, animalesConBajaPendiente([baja({ animalId: 'a1' })], []));
    const sin = marcarListado(lista, animalesConBajaPendiente([], []));
    expect(con[0]!.bajaPendiente).toBe(true);
    expect(sin[0]!.bajaPendiente).toBeUndefined();
  });
});

describe('completarConBajasEnviadas (RF-5, RF-7)', () => {
  const copia = (id: string, numero: string, extra: { estado?: AnimalCopia['ficha']['estado']; lote?: { id: string; nombre: string } | null } = {}): AnimalCopia => {
    const v = vacaCopia(id, numero);
    return { ...v, ficha: { ...v.ficha, estado: extra.estado ?? 'EN_ORDENE', lote: extra.lote ?? null } };
  };
  const todos = { estado: '', loteId: '' };

  it('con señal el servidor ya no trae al animal: se suma desde la copia, marcado y en orden numérico', () => {
    const b = env(baja({ animalId: 'a2' }));
    const r = completarConBajasEnviadas([fila('a1', '10'), fila('a3', '30')], [b], [copia('a1', '10'), copia('a2', '20'), copia('a3', '30')], todos);
    expect(r.map((a) => a.numero)).toEqual(['10', '20', '30']);
    expect(r[1]).toEqual({ id: 'a2', numero: '20', sexo: 'HEMBRA', estado: 'EN_ORDENE', lote: null, bajaPendiente: true });
  });

  it('si el listado ya trae al animal no lo duplica', () => {
    const r = completarConBajasEnviadas([fila('a2', '20')], [env(baja({ animalId: 'a2' }))], [copia('a2', '20')], todos);
    expect(r).toHaveLength(1);
  });

  it('respeta los filtros de estado y de lote', () => {
    const b = env(baja({ animalId: 'a2' }));
    const c = copia('a2', '20', { estado: 'SECA', lote: { id: 'l1', nombre: 'Secas' } });
    expect(completarConBajasEnviadas([], [b], [c], { estado: 'EN_ORDENE', loteId: '' })).toEqual([]);
    expect(completarConBajasEnviadas([], [b], [c], { estado: 'SECA', loteId: '' })).toHaveLength(1);
    expect(completarConBajasEnviadas([], [b], [c], { estado: '', loteId: 'l1' })).toHaveLength(1);
    expect(completarConBajasEnviadas([], [b], [c], { estado: '', loteId: 'l2' })).toEqual([]);
    expect(completarConBajasEnviadas([], [b], [c], { estado: '', loteId: 'sin-lote' })).toEqual([]);
    expect(completarConBajasEnviadas([], [b], [copia('a2', '20')], { estado: '', loteId: 'sin-lote' })).toHaveLength(1);
  });

  it('cuando la copia nueva ya no trae al animal, la fila desaparece (RF-7)', () => {
    const b = env(baja({ animalId: 'a2' }));
    expect(completarConBajasEnviadas([], [b], [copia('a1', '10')], todos)).toEqual([]);
  });

  it('solo las bajas enviadas suman; un servicio enviado no', () => {
    const s = env(pend('SERVICIO', { fecha: '2026-11-01' }, { animalId: 'a2' }));
    expect(completarConBajasEnviadas([], [s], [copia('a2', '20')], todos)).toEqual([]);
  });
});

describe('animalConBajaEnviada (buscador, RF-5)', () => {
  const b = env(baja({ animalId: 'a2', numero: 'AB12' }));

  it('encuentra el número (normalizado) entre las bajas enviadas', () => {
    expect(animalConBajaEnviada('AB12', [b])).toBe('a2');
    expect(animalConBajaEnviada('ab12', [b])).toBe('a2');
  });

  it('devuelve null si no hay o si el enviado no es una baja', () => {
    expect(animalConBajaEnviada('99', [b])).toBeNull();
    expect(animalConBajaEnviada('12', [env(pend('SERVICIO', { fecha: '2026-11-01' }, { numero: '12' }))])).toBeNull();
    expect(animalConBajaEnviada('', [b])).toBeNull();
  });
});
