import { describe, expect, it } from 'vitest';
import {
  calcularSituacion,
  cicloActual,
  resolverFechaProbable,
  servicioBase,
  ultimoNoAnulado,
  type EventoCalculo,
} from '../src/reproduccion/situacion.js';

// Tests puros (sin base) de lo que la spec 004 cambia en la situación reproductiva:
// el parto reinicia el ciclo, el secado no cuenta y los últimos servicio y tacto
// anteriores al parto se marcan "del ciclo anterior" (RF-17, RF-40, RF-21).

type Tipo = EventoCalculo['tipo'];
let n = 0;
// Cada evento nuevo queda 1 segundo después del anterior (orden de registro).
function ev(tipo: Tipo, fecha: string, extra: Partial<EventoCalculo> = {}): EventoCalculo {
  n += 1;
  return {
    id: `e${n}`,
    tipo,
    fecha,
    creadoEn: new Date(2026, 0, 1, 0, 0, n),
    anulado: false,
    resultado: null,
    fechaProbableIndicada: null,
    ...extra,
  };
}
const servicio = (fecha: string, extra: Partial<EventoCalculo> = {}) => ev('SERVICIO', fecha, extra);
const prenada = (fecha: string, indicada: string | null = null, extra: Partial<EventoCalculo> = {}) =>
  ev('TACTO', fecha, { resultado: 'PRENADA', fechaProbableIndicada: indicada, ...extra });
const vacia = (fecha: string, extra: Partial<EventoCalculo> = {}) => ev('TACTO', fecha, { resultado: 'VACIA', ...extra });
const parto = (fecha: string, extra: Partial<EventoCalculo> = {}) => ev('PARTO', fecha, extra);
const secado = (fecha: string, extra: Partial<EventoCalculo> = {}) => ev('SECADO', fecha, extra);

const HOY = '2026-11-11';

describe('el parto reinicia el ciclo (RF-17)', () => {
  it('tras el parto el estado vuelve a "sin servicio", sin fecha probable ni de referencia', () => {
    const lista = [servicio('2026-01-01'), prenada('2026-03-01'), parto('2026-10-10')];
    const s = calcularSituacion(lista, HOY);
    expect(s.estado).toBe('SIN_SERVICIO');
    expect(s.fechaProbableParto).toBeNull();
    expect(s.fechaReferencia).toBeNull();
  });

  it('el ciclo actual queda vacío y no hay servicio base después de un parto', () => {
    const lista = [servicio('2026-01-01'), prenada('2026-03-01'), parto('2026-10-10')];
    expect(cicloActual(lista)).toEqual([]);
    expect(servicioBase(lista)).toBeNull();
  });

  it('un servicio posterior al parto abre el ciclo nuevo; el servicio de antes no es base', () => {
    const s1 = servicio('2026-01-01');
    const p = parto('2026-10-10');
    const s2 = servicio('2026-11-05');
    const lista = [s1, p, s2];
    expect(cicloActual(lista).map((e) => e.id)).toEqual([s2.id]);
    expect(servicioBase(lista)?.id).toBe(s2.id);
    const s = calcularSituacion(lista, HOY);
    expect(s.estado).toBe('SERVIDA');
    expect(s.fechaReferencia?.fecha).toBe('2027-08-15'); // 2026-11-05 + 283 días
  });

  it('un parto anulado no reinicia nada', () => {
    const lista = [servicio('2026-01-01'), prenada('2026-03-01'), parto('2026-10-10', { anulado: true })];
    const s = calcularSituacion(lista, HOY);
    expect(s.estado).toBe('PRENADA');
    expect(s.fechaProbableParto?.fecha).toBe('2026-10-11'); // servicio 2026-01-01 + 283 días
    expect(cicloActual(lista)).toHaveLength(2);
  });

  it('el ciclo también se corta con un tacto "vacía" posterior al parto', () => {
    const p = parto('2026-01-10');
    const s1 = servicio('2026-03-01');
    const v = vacia('2026-05-01');
    const s2 = servicio('2026-06-01');
    expect(cicloActual([p, s1, v, s2]).map((e) => e.id)).toEqual([s2.id]);
  });

  it('un tacto "vacía" después del parto da estado "vacía"', () => {
    const s = calcularSituacion([servicio('2026-01-01'), parto('2026-10-10'), vacia('2026-11-01')], HOY);
    expect(s.estado).toBe('VACIA');
  });

  it('con un servicio posterior al parto, la fecha probable de un tacto "preñada" sin fecha es servicio + 283', () => {
    const lista = [servicio('2026-01-01'), parto('2026-10-10'), servicio('2026-11-05')];
    expect(resolverFechaProbable(lista, null)).toBe('2027-08-15');
  });

  it('un tacto "preñada" tras el parto sin servicio nuevo no tiene de dónde sacar la fecha: exige fecha (null)', () => {
    // Aunque haya un servicio y un tacto con fecha indicada del ciclo anterior, no valen.
    const lista = [servicio('2026-01-01'), prenada('2026-03-01', '2026-10-15'), parto('2026-10-10')];
    expect(resolverFechaProbable(lista, null)).toBeNull();
    expect(resolverFechaProbable(lista, '2027-08-01')).toBe('2027-08-01'); // si la indica, vale
  });

  it('con varios partos manda el último no anulado', () => {
    const p1 = parto('2025-10-01');
    const s = servicio('2025-12-20');
    const p2 = parto('2026-09-30');
    expect(cicloActual([p1, s, p2])).toEqual([]);
    expect(cicloActual([p1, s, { ...p2, anulado: true }]).map((e) => e.id)).toEqual([s.id]);
  });
});

describe('el secado no cambia el estado reproductivo (RF-17 y decisión del usuario)', () => {
  it('servida y secada sigue servida', () => {
    const s = calcularSituacion([servicio('2026-03-01'), secado('2026-10-01')], HOY);
    expect(s.estado).toBe('SERVIDA');
    expect(s.fechaReferencia?.fecha).toBe('2026-12-09');
  });

  it('preñada y secada sigue preñada, con su fecha probable vigente', () => {
    const lista = [servicio('2026-03-01'), prenada('2026-05-01'), secado('2026-10-01')];
    const s = calcularSituacion(lista, HOY);
    expect(s.estado).toBe('PRENADA');
    expect(s.fechaProbableParto?.fecha).toBe('2026-12-09');
  });

  it('el secado no corta el ciclo ni es servicio base', () => {
    const s1 = servicio('2026-03-01');
    const sec = secado('2026-10-01');
    const t = prenada('2026-10-05');
    expect(cicloActual([s1, sec, t]).map((e) => e.id)).toEqual([s1.id, sec.id, t.id]);
    expect(servicioBase([s1, sec, t])?.id).toBe(s1.id);
  });

  it('sin otros eventos, un secado deja "sin servicio"', () => {
    expect(calcularSituacion([secado('2026-10-01')], HOY).estado).toBe('SIN_SERVICIO');
  });

  it('un parto y después un secado siguen en "sin servicio"', () => {
    expect(calcularSituacion([servicio('2026-01-01'), parto('2026-10-10'), secado('2026-10-20')], HOY).estado).toBe('SIN_SERVICIO');
  });

  it('un secado anulado se ignora', () => {
    const s = calcularSituacion([servicio('2026-03-01'), secado('2026-10-01', { anulado: true })], HOY);
    expect(s.estado).toBe('SERVIDA');
  });
});

describe('último evento de cualquiera de los cuatro tipos (RF-21)', () => {
  it('ultimoNoAnulado incluye partos y secados y salta los anulados', () => {
    const s = servicio('2026-01-01');
    const p = parto('2026-10-10');
    const sec = secado('2026-10-20');
    expect(ultimoNoAnulado([s, p, sec])?.id).toBe(sec.id);
    expect(ultimoNoAnulado([s, p, { ...sec, anulado: true }])?.id).toBe(p.id);
  });
});

describe('"del ciclo anterior" (RF-40)', () => {
  it('el último servicio y el último tacto anteriores al último parto se marcan del ciclo anterior', () => {
    const s = calcularSituacion([servicio('2026-01-01'), prenada('2026-03-01'), parto('2026-10-10')], HOY);
    expect(s.ultimoServicio?.fecha).toBe('2026-01-01');
    expect(s.ultimoTacto?.fecha).toBe('2026-03-01');
    expect(s.ultimoServicioCicloAnterior).toBe(true);
    expect(s.ultimoTactoCicloAnterior).toBe(true);
  });

  it('sin parto no hay ciclo anterior', () => {
    const s = calcularSituacion([servicio('2026-01-01'), prenada('2026-03-01')], HOY);
    expect(s.ultimoServicioCicloAnterior).toBe(false);
    expect(s.ultimoTactoCicloAnterior).toBe(false);
  });

  it('un servicio posterior al parto es del ciclo actual; el tacto anterior sigue siendo del anterior', () => {
    const s = calcularSituacion([servicio('2026-01-01'), prenada('2026-03-01'), parto('2026-10-10'), servicio('2026-11-05')], HOY);
    expect(s.ultimoServicioCicloAnterior).toBe(false);
    expect(s.ultimoTactoCicloAnterior).toBe(true);
  });

  it('un parto anulado no marca nada como ciclo anterior', () => {
    const s = calcularSituacion([servicio('2026-01-01'), parto('2026-10-10', { anulado: true })], HOY);
    expect(s.ultimoServicioCicloAnterior).toBe(false);
  });

  it('sin servicio ni tacto las marcas son falsas', () => {
    const s = calcularSituacion([parto('2026-10-10')], HOY);
    expect(s.ultimoServicio).toBeNull();
    expect(s.ultimoServicioCicloAnterior).toBe(false);
    expect(s.ultimoTactoCicloAnterior).toBe(false);
  });

  it('a igual fecha manda el momento de registro', () => {
    const p = parto('2026-10-10');
    const sv = servicio('2026-10-10'); // misma fecha, registrado después del parto: ciclo actual
    expect(calcularSituacion([sv, p], HOY).ultimoServicioCicloAnterior).toBe(false);
    const sv2 = servicio('2026-10-10');
    const p2 = parto('2026-10-10'); // el parto se registró después: el servicio es del ciclo anterior
    expect(calcularSituacion([sv2, p2], HOY).ultimoServicioCicloAnterior).toBe(true);
  });
});
