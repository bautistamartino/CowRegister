import { describe, expect, it } from 'vitest';
import { anterioresDe, estadoVisible, posterioresDe, primeroEnviable, puedeEnviarse } from '../src/sinconexion/dependencias';
import { pendiente } from './ayudas';

// Dependencias entre pendientes de una vaca (spec 010, RF-24 a RF-27): lógica pura, sin almacén.

type Cambios = Parameters<typeof pendiente>[0];
const evento = (id: string, orden: number, cambios: Cambios = {}) => pendiente({ id, orden, tipo: 'SERVICIO', datos: {}, ...cambios });
const litros = (id: string, orden: number, cambios: Cambios = {}) => pendiente({ id, orden, ...cambios });

describe('anteriores y posteriores de una vaca', () => {
  const lista = [evento('a', 1), litros('b', 2), evento('c', 3), evento('otra', 2, { animalId: 'a2' })];

  it('solo cuentan los de la misma vaca, en orden de carga', () => {
    expect(anterioresDe(lista[2]!, lista).map((p) => p.id)).toEqual(['a', 'b']);
    expect(posterioresDe(lista[0]!, lista).map((p) => p.id)).toEqual(['b', 'c']);
    expect(anterioresDe(lista[3]!, lista)).toEqual([]);
    expect(posterioresDe(lista[3]!, lista)).toEqual([]);
  });

  it('no se incluye a sí mismo', () => {
    expect(anterioresDe(lista[0]!, lista)).toEqual([]);
    expect(posterioresDe(lista[2]!, lista)).toEqual([]);
  });
});

describe('quién puede enviarse', () => {
  it('el primer evento de la vaca sí; el segundo espera al primero', () => {
    const lista = [evento('a', 1), evento('b', 2)];
    expect(puedeEnviarse(lista[0]!, lista, 0)).toBe(true);
    expect(puedeEnviarse(lista[1]!, lista, 0)).toBe(false);
  });

  it('un fallo transitorio del anterior frena al siguiente de esa vaca', () => {
    const lista = [evento('a', 1, { proximoIntento: 9_000, intentos: 1 }), evento('b', 2)];
    expect(puedeEnviarse(lista[0]!, lista, 1_000)).toBe(false); // todavía no cumplió su espera
    expect(puedeEnviarse(lista[1]!, lista, 1_000)).toBe(false);
    expect(puedeEnviarse(lista[0]!, lista, 9_000)).toBe(true);
  });

  it('ignorar las esperas permite enviar uno cuya espera no se cumplió', () => {
    const lista = [evento('a', 1, { proximoIntento: 9_000 })];
    expect(puedeEnviarse(lista[0]!, lista, 1_000, true)).toBe(true);
  });

  it('las demás vacas siguen aunque una esté frenada', () => {
    const lista = [evento('a', 1, { estado: 'rechazado' }), evento('b', 2), evento('c', 3, { animalId: 'a2' })];
    expect(puedeEnviarse(lista[1]!, lista, 0)).toBe(false);
    expect(puedeEnviarse(lista[2]!, lista, 0)).toBe(true);
  });

  it('un evento "enviando" delante también frena al siguiente', () => {
    const lista = [evento('a', 1, { estado: 'enviando' }), evento('b', 2)];
    expect(puedeEnviarse(lista[1]!, lista, 0)).toBe(false);
  });

  it('los que no están "esperando" no se envían', () => {
    for (const estado of ['enviando', 'rechazado'] as const) expect(puedeEnviarse(evento('a', 1, { estado }), [], 0)).toBe(false);
  });

  it('los litros esperan a los eventos anteriores pero no a los litros anteriores', () => {
    const lista = [litros('l1', 1, { estado: 'rechazado' }), litros('l2', 2), evento('e', 3), litros('l3', 4)];
    expect(puedeEnviarse(lista[1]!, lista, 0)).toBe(true); // el litro rechazado anterior no frena
    expect(puedeEnviarse(lista[3]!, lista, 0)).toBe(false); // el evento anterior sí
  });

  it('un litro anterior no frena a un evento', () => {
    const lista = [litros('l1', 1), evento('e', 2)];
    expect(puedeEnviarse(lista[1]!, lista, 0)).toBe(true);
  });

  it('el primero enviable sigue el orden de carga entre vacas', () => {
    const lista = [evento('c', 30, { animalId: 'a3' }), evento('a', 10), evento('b', 20, { animalId: 'a2' })];
    expect(primeroEnviable(lista, 0)?.id).toBe('a');
    const sinA = [lista[0]!, { ...lista[1]!, estado: 'rechazado' as const }, lista[2]!];
    expect(primeroEnviable(sinA, 0)?.id).toBe('b');
    expect(primeroEnviable([], 0)).toBeNull();
  });
});

describe('estado visible (en espera del anterior se calcula)', () => {
  it('un evento posterior a uno rechazado está en espera; el rechazado sigue rechazado', () => {
    const lista = [evento('a', 1, { estado: 'rechazado' }), evento('b', 2)];
    expect(estadoVisible(lista[0]!, lista)).toBe('rechazado');
    expect(estadoVisible(lista[1]!, lista)).toBe('enEspera');
  });

  it('un litro después de un parto rechazado queda en espera', () => {
    const lista = [evento('p', 1, { tipo: 'PARTO', estado: 'rechazado' }), litros('l', 2)];
    expect(estadoVisible(lista[1]!, lista)).toBe('enEspera');
  });

  it('un litro rechazado no deja en espera a nadie', () => {
    const lista = [litros('l', 1, { estado: 'rechazado' }), evento('e', 2), litros('l2', 3)];
    expect(estadoVisible(lista[1]!, lista)).toBe('esperando');
    expect(estadoVisible(lista[2]!, lista)).toBe('esperando');
  });

  it('esperando y enviando se ven como están guardados', () => {
    const lista = [evento('a', 1, { estado: 'enviando' }), evento('b', 2)];
    expect(estadoVisible(lista[0]!, lista)).toBe('enviando');
    expect(estadoVisible(lista[1]!, lista)).toBe('esperando');
  });

  it('reintentar o descartar el rechazado libera a los que esperaban', () => {
    const rechazado = evento('a', 1, { estado: 'rechazado' });
    const b = evento('b', 2);
    expect(estadoVisible(b, [rechazado, b])).toBe('enEspera');
    expect(estadoVisible(b, [{ ...rechazado, estado: 'esperando' }, b])).toBe('esperando');
    expect(estadoVisible(b, [b])).toBe('esperando');
  });

  it('un rechazado de otra vaca no cuenta', () => {
    const lista = [evento('a', 1, { estado: 'rechazado', animalId: 'a2' }), evento('b', 2)];
    expect(estadoVisible(lista[1]!, lista)).toBe('esperando');
  });
});
