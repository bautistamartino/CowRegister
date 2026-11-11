import { describe, expect, it } from 'vitest';
import {
  calcularSituacion,
  cicloActual,
  ordenarEventos,
  resolverFechaProbable,
  servicioBase,
  ultimoNoAnulado,
  type EventoCalculo,
} from '../src/reproduccion/situacion.js';
import { puedeRecibirEventoReproductivo } from '../src/reproduccion/aptitud.js';

// Tests puros (sin base) de la situación reproductiva y la fecha probable de parto:
// RF-10 a RF-13, RF-16, RF-23 y RF-24.

let n = 0;
// Cada evento nuevo queda 1 segundo después del anterior (orden de registro).
function ev(tipo: 'SERVICIO' | 'TACTO', fecha: string, extra: Partial<EventoCalculo> = {}): EventoCalculo {
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

const HOY = '2026-11-11';

describe('orden y ciclo', () => {
  it('ordena por fecha y, a igual fecha, por momento de registro', () => {
    const a = servicio('2026-05-02');
    const b = servicio('2026-05-01');
    const c = servicio('2026-05-02'); // registrado después de a
    expect(ordenarEventos([c, a, b]).map((e) => e.id)).toEqual([b.id, a.id, c.id]);
  });

  it('ultimoNoAnulado ignora los anulados', () => {
    const a = servicio('2026-05-01');
    const b = servicio('2026-05-02', { anulado: true });
    expect(ultimoNoAnulado([a, b])?.id).toBe(a.id);
    expect(ultimoNoAnulado([b])).toBeNull();
    expect(ultimoNoAnulado([])).toBeNull();
  });

  it('el ciclo son los no anulados posteriores al último tacto "vacía"', () => {
    const s1 = servicio('2026-01-01');
    const v = vacia('2026-02-01');
    const s2 = servicio('2026-03-01');
    const sAnulado = servicio('2026-03-05', { anulado: true });
    expect(cicloActual([s1, v, s2, sAnulado]).map((e) => e.id)).toEqual([s2.id]);
    expect(cicloActual([s1, s2]).map((e) => e.id)).toEqual([s1.id, s2.id]);
  });

  it('una "vacía" anulada no corta el ciclo', () => {
    const s1 = servicio('2026-01-01');
    const v = vacia('2026-02-01', { anulado: true });
    expect(cicloActual([s1, v]).map((e) => e.id)).toEqual([s1.id]);
  });

  it('servicioBase es el último servicio del ciclo o null', () => {
    const s1 = servicio('2026-01-01');
    const v = vacia('2026-02-01');
    expect(servicioBase([s1, v])).toBeNull();
    const s2 = servicio('2026-03-01');
    expect(servicioBase([s1, v, s2])?.id).toBe(s2.id);
    expect(servicioBase([])).toBeNull();
  });
});

describe('resolverFechaProbable (RF-13)', () => {
  it('la fecha indicada gana a todo', () => {
    const lista = [servicio('2026-01-01')];
    expect(resolverFechaProbable(lista, '2026-12-01')).toBe('2026-12-01');
  });

  it('conserva la última indicada por un tacto "preñada" del ciclo', () => {
    const lista = [servicio('2026-01-01'), prenada('2026-03-01', '2026-10-15'), prenada('2026-04-01', '2026-10-20')];
    expect(resolverFechaProbable(lista, null)).toBe('2026-10-20');
  });

  it('salta los tactos "preñada" sin fecha indicada y los anulados', () => {
    const lista = [
      servicio('2026-01-01'),
      prenada('2026-03-01', '2026-10-15'),
      prenada('2026-04-01', '2026-10-20', { anulado: true }),
      prenada('2026-04-02', null),
    ];
    expect(resolverFechaProbable(lista, null)).toBe('2026-10-15');
  });

  it('sin indicada, usa servicio base + 283 días', () => {
    expect(resolverFechaProbable([servicio('2026-01-01')], null)).toBe('2026-10-11');
  });

  it('un servicio anterior a un tacto "vacía" no cuenta como base', () => {
    const lista = [servicio('2026-01-01'), vacia('2026-02-01')];
    expect(resolverFechaProbable(lista, null)).toBeNull();
  });

  it('una indicada anterior a un tacto "vacía" no se conserva', () => {
    const lista = [servicio('2026-01-01'), prenada('2026-02-01', '2026-10-01'), vacia('2026-03-01')];
    expect(resolverFechaProbable(lista, null)).toBeNull();
  });

  it('sin servicio ni indicada devuelve null', () => {
    expect(resolverFechaProbable([], null)).toBeNull();
  });
});

describe('calcularSituacion (RF-23, RF-24)', () => {
  it('sin eventos: "sin servicio" y sin fechas', () => {
    const s = calcularSituacion([], HOY);
    expect(s.estado).toBe('SIN_SERVICIO');
    expect(s.ultimoServicio).toBeNull();
    expect(s.ultimoTacto).toBeNull();
    expect(s.fechaProbableParto).toBeNull();
    expect(s.fechaReferencia).toBeNull();
  });

  it('servida: fecha de referencia servicio + 283 con los días, sin fecha vigente', () => {
    const s1 = servicio('2026-11-01');
    const s = calcularSituacion([s1], HOY);
    expect(s.estado).toBe('SERVIDA');
    expect(s.ultimoServicio?.id).toBe(s1.id);
    expect(s.fechaProbableParto).toBeNull();
    expect(s.fechaReferencia).toEqual({ fecha: '2027-08-11', dias: 273 });
  });

  it('preñada: fecha indicada, días que faltan y sin referencia', () => {
    const t = prenada('2026-11-05', '2027-06-01');
    const s = calcularSituacion([servicio('2026-10-01'), t], HOY);
    expect(s.estado).toBe('PRENADA');
    expect(s.ultimoTacto?.id).toBe(t.id);
    expect(s.fechaProbableParto).toEqual({ fecha: '2027-06-01', dias: 202, vencida: false });
    expect(s.fechaReferencia).toBeNull();
  });

  it('preñada con la fecha derivada ya pasada: días negativos y vencida', () => {
    const lista = [servicio('2025-12-31'), prenada('2026-02-01')];
    const s = calcularSituacion(lista, HOY);
    expect(s.estado).toBe('PRENADA');
    expect(s.fechaProbableParto?.fecha).toBe('2026-10-10'); // 2025-12-31 + 283 días
    expect(s.fechaProbableParto?.dias).toBe(-32);
    expect(s.fechaProbableParto?.vencida).toBe(true);
  });

  it('el día del parto probable no está vencido (0 días)', () => {
    const s = calcularSituacion([prenada('2026-10-01', HOY)], HOY);
    expect(s.fechaProbableParto).toEqual({ fecha: HOY, dias: 0, vencida: false });
  });

  it('vacía: sin fecha vigente ni referencia, aunque haya preñez anterior', () => {
    const lista = [servicio('2026-01-01'), prenada('2026-02-01', '2026-10-01'), vacia('2026-05-01')];
    const s = calcularSituacion(lista, HOY);
    expect(s.estado).toBe('VACIA');
    expect(s.fechaProbableParto).toBeNull();
    expect(s.fechaReferencia).toBeNull();
  });

  it('un servicio después de "vacía" vuelve a "servida"', () => {
    const lista = [prenada('2026-02-01', '2026-10-01'), vacia('2026-05-01'), servicio('2026-06-01')];
    expect(calcularSituacion(lista, HOY).estado).toBe('SERVIDA');
  });

  it('los eventos anulados no cuentan: al anular la "vacía" vuelve la preñez', () => {
    const t = prenada('2026-02-01', '2027-01-15');
    const v = vacia('2026-05-01', { anulado: true });
    const s = calcularSituacion([t, v], HOY);
    expect(s.estado).toBe('PRENADA');
    expect(s.fechaProbableParto?.fecha).toBe('2027-01-15');
  });

  it('vale el último tacto "preñada" y devuelve la fecha resuelta de cada uno', () => {
    const t1 = prenada('2026-02-01', '2026-12-01');
    const t2 = prenada('2026-03-01', '2026-12-20');
    const t3 = prenada('2026-04-01', null); // conserva la del t2
    const tAnulado = prenada('2026-04-02', '2027-01-01', { anulado: true });
    const s = calcularSituacion([t1, t2, t3, tAnulado], HOY);
    expect(s.fechaProbableParto?.fecha).toBe('2026-12-20');
    expect(s.fechasTactos.get(t1.id)).toBe('2026-12-01');
    expect(s.fechasTactos.get(t2.id)).toBe('2026-12-20');
    expect(s.fechasTactos.get(t3.id)).toBe('2026-12-20');
    expect(s.fechasTactos.has(tAnulado.id)).toBe(false);
  });

  it('un tacto "vacía" no tiene fecha resuelta', () => {
    const v = vacia('2026-05-01');
    expect(calcularSituacion([v], HOY).fechasTactos.has(v.id)).toBe(false);
  });
});

describe('puedeRecibirEventoReproductivo (RF-10, RF-12)', () => {
  it('acepta hembras vaquillona, en ordeñe y seca', () => {
    for (const estado of ['VAQUILLONA', 'EN_ORDENE', 'SECA'] as const) {
      expect(puedeRecibirEventoReproductivo('HEMBRA', estado)).toEqual({ ok: true });
    }
  });

  it('rechaza machos y recién nacidas con el motivo', () => {
    const m = puedeRecibirEventoReproductivo('MACHO', 'RECIEN_NACIDO');
    expect(m.ok === false && m.motivo).toMatch(/macho/i);
    const r = puedeRecibirEventoReproductivo('HEMBRA', 'RECIEN_NACIDO');
    expect(r.ok === false && r.motivo).toMatch(/recién nacida/i);
  });
});
