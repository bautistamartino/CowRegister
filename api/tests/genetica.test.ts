import { describe, expect, it } from 'vitest';
import { evaluarGenetica, servicioParaGenetica } from '../src/reproduccion/genetica.js';
import { sumarDias } from '../src/reproduccion/fechas.js';
import type { EventoCalculo } from '../src/reproduccion/situacion.js';

// Tests puros (sin base) de la genética de la cría (RF-15 y RF-16): qué servicio se vincula
// al parto y si cae dentro del rango de 240 a 300 días.

let n = 0;
function ev(tipo: EventoCalculo['tipo'], fecha: string, extra: Partial<EventoCalculo> = {}): EventoCalculo {
  n += 1;
  return {
    id: `g${n}`,
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
const vacia = (fecha: string) => ev('TACTO', fecha, { resultado: 'VACIA' });
const prenada = (fecha: string) => ev('TACTO', fecha, { resultado: 'PRENADA' });
const parto = (fecha: string, extra: Partial<EventoCalculo> = {}) => ev('PARTO', fecha, extra);

describe('servicioParaGenetica', () => {
  it('sin eventos no hay servicio', () => {
    expect(servicioParaGenetica([])).toBeNull();
  });

  it('toma el último servicio no anulado', () => {
    const a = servicio('2026-01-01');
    const b = servicio('2026-01-25');
    const c = servicio('2026-02-10', { anulado: true });
    expect(servicioParaGenetica([a, b, c])?.id).toBe(b.id);
  });

  it('ignora los tactos "vacía": el servicio anterior sigue valiendo (a diferencia del servicio base)', () => {
    const s = servicio('2026-01-01');
    expect(servicioParaGenetica([s, vacia('2026-03-01')])?.id).toBe(s.id);
  });

  it('un tacto "preñada" tampoco cambia nada', () => {
    const s = servicio('2026-01-01');
    expect(servicioParaGenetica([s, prenada('2026-03-01')])?.id).toBe(s.id);
  });

  it('solo cuentan los servicios posteriores al último parto no anulado', () => {
    const viejo = servicio('2025-01-01');
    const p = parto('2025-10-10');
    expect(servicioParaGenetica([viejo, p])).toBeNull();
    const nuevo = servicio('2026-01-10');
    expect(servicioParaGenetica([viejo, p, nuevo])?.id).toBe(nuevo.id);
  });

  it('un parto anulado no corta: el servicio anterior sigue valiendo', () => {
    const s = servicio('2025-01-01');
    expect(servicioParaGenetica([s, parto('2025-10-10', { anulado: true })])?.id).toBe(s.id);
  });

  it('un secado no corta, y un servicio registrado antes del parto del mismo día no cuenta', () => {
    const s = servicio('2026-01-01');
    expect(servicioParaGenetica([s, ev('SECADO', '2026-09-01')])?.id).toBe(s.id);
    const mismoDia = servicio('2026-10-10');
    expect(servicioParaGenetica([mismoDia, parto('2026-10-10')])).toBeNull();
  });
});

describe('evaluarGenetica (rango de 240 a 300 días, extremos incluidos)', () => {
  const fechaParto = '2026-10-10';
  const conDias = (dias: number) => servicio(sumarDias(fechaParto, -dias));

  it('239 días: fuera de rango', () => {
    const s = conDias(239);
    expect(evaluarGenetica(s, fechaParto)).toEqual({ vinculado: false, motivo: 'FUERA_DE_RANGO', fechaServicio: s.fecha });
  });

  it('240 días: vinculado', () => {
    const s = conDias(240);
    expect(evaluarGenetica(s, fechaParto)).toEqual({ vinculado: true, servicioId: s.id });
  });

  it('283 días: vinculado', () => {
    const s = conDias(283);
    expect(evaluarGenetica(s, fechaParto)).toEqual({ vinculado: true, servicioId: s.id });
  });

  it('300 días: vinculado', () => {
    const s = conDias(300);
    expect(evaluarGenetica(s, fechaParto)).toEqual({ vinculado: true, servicioId: s.id });
  });

  it('301 días: fuera de rango', () => {
    expect(evaluarGenetica(conDias(301), fechaParto)).toMatchObject({ vinculado: false, motivo: 'FUERA_DE_RANGO' });
  });

  it('un servicio posterior a la fecha del parto (días negativos) está fuera de rango', () => {
    expect(evaluarGenetica(conDias(-5), fechaParto)).toMatchObject({ vinculado: false, motivo: 'FUERA_DE_RANGO' });
  });

  it('sin servicio: motivo SIN_SERVICIO', () => {
    expect(evaluarGenetica(null, fechaParto)).toEqual({ vinculado: false, motivo: 'SIN_SERVICIO' });
  });
});
