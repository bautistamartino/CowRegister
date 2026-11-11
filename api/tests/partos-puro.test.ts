import { describe, expect, it } from 'vitest';
import { puedeParir, puedeSecarse } from '../src/reproduccion/aptitud.js';
import {
  avisoLoteAnteriorEliminado,
  avisoSinGeneticaFueraDeRango,
  avisoSinGeneticaSinServicio,
  avisoSinLoteCria,
  avisoSinLoteMadre,
  avisoSinLotePrevio,
} from '../src/reproduccion/avisos.js';
import { resolverLotesDestino } from '../src/reproduccion/destinos.js';
import { validarSeparacionPartos } from '../src/reproduccion/partos.js';
import type { EventoCalculo } from '../src/reproduccion/situacion.js';

// Lógica pura de la spec 004: aptitud, separación de 200 días, avisos y lote destino con una
// transacción simulada (RF-9, RF-11, RF-14, RF-19, RF-20 y la lista cerrada de avisos).

let n = 0;
const evento = (tipo: EventoCalculo['tipo'], fecha: string, anulado = false): EventoCalculo => ({
  id: `e${++n}`,
  tipo,
  fecha,
  creadoEn: new Date(2026, 0, 1, 0, 0, n),
  anulado,
  resultado: null,
  fechaProbableIndicada: null,
});

describe('puedeParir', () => {
  it.each(['VAQUILLONA', 'EN_ORDENE', 'SECA'] as const)('una hembra %s puede', (estado) => {
    expect(puedeParir('HEMBRA', estado)).toEqual({ ok: true });
  });
  it('un macho no, con el motivo', () => {
    expect(puedeParir('MACHO', 'RECIEN_NACIDO')).toEqual({ ok: false, motivo: expect.stringMatching(/macho/i) });
  });
  it('una recién nacida no, con el motivo', () => {
    expect(puedeParir('HEMBRA', 'RECIEN_NACIDO')).toEqual({ ok: false, motivo: expect.stringMatching(/recién nacida/i) });
  });
});

describe('puedeSecarse', () => {
  it('solo una hembra en ordeñe', () => {
    expect(puedeSecarse('HEMBRA', 'EN_ORDENE')).toEqual({ ok: true });
  });
  it.each([
    ['SECA', /seca/i],
    ['VAQUILLONA', /vaquillona/i],
    ['RECIEN_NACIDO', /recién nacido/i],
  ] as const)('una hembra %s no, y el motivo dice el estado', (estado, patron) => {
    expect(puedeSecarse('HEMBRA', estado)).toEqual({ ok: false, motivo: expect.stringMatching(patron) });
  });
  it('un macho no', () => {
    expect(puedeSecarse('MACHO', 'RECIEN_NACIDO')).toEqual({ ok: false, motivo: expect.stringMatching(/macho/i) });
  });
});

describe('validarSeparacionPartos (200 días)', () => {
  it('sin partos: null', () => {
    expect(validarSeparacionPartos([evento('SERVICIO', '2026-01-01')], '2026-06-01')).toBeNull();
  });
  it('a 199 días del parto existente: mensaje con su fecha y la sugerencia del tacto "vacía"', () => {
    const m = validarSeparacionPartos([evento('PARTO', '2026-01-01')], '2026-07-19');
    expect(m).toContain('01/01/2026');
    expect(m).toContain('tacto "vacía"');
  });
  it('a 200 días: null; antes del parto existente a 199 días también es conflicto', () => {
    expect(validarSeparacionPartos([evento('PARTO', '2026-01-01')], '2026-07-20')).toBeNull();
    expect(validarSeparacionPartos([evento('PARTO', '2026-07-19')], '2026-01-01')).not.toBeNull();
  });
  it('un parto anulado no cuenta', () => {
    expect(validarSeparacionPartos([evento('PARTO', '2026-01-01', true)], '2026-02-01')).toBeNull();
  });
  it('un secado no es un parto', () => {
    expect(validarSeparacionPartos([evento('SECADO', '2026-01-01')], '2026-02-01')).toBeNull();
  });
});

describe('avisos (lista cerrada)', () => {
  it('textos de los 7 avisos', () => {
    expect(avisoSinLoteMadre('EN_ORDENE')).toEqual({
      codigo: 'SIN_LOTE_MADRE_EN_ORDENE',
      mensaje: 'La vaca quedó sin lote: el estado «en ordeñe» no tiene un lote asignado',
    });
    expect(avisoSinLoteMadre('SECA')).toEqual({
      codigo: 'SIN_LOTE_MADRE_SECA',
      mensaje: 'La vaca quedó sin lote: el estado «seca» no tiene un lote asignado',
    });
    expect(avisoSinLoteCria('A1')).toEqual({
      codigo: 'SIN_LOTE_CRIA',
      mensaje: 'La cría N.º A1 quedó sin lote: el estado «recién nacido» no tiene un lote asignado',
    });
    expect(avisoSinGeneticaSinServicio(true).mensaje).toBe('El parto se guardó sin genética: no hay un servicio cargado después del último parto');
    expect(avisoSinGeneticaSinServicio(false).mensaje).toBe('El parto se guardó sin genética: no hay un servicio cargado en el historial de la vaca');
    expect(avisoSinGeneticaFueraDeRango('2026-03-05')).toEqual({
      codigo: 'SIN_GENETICA_FUERA_DE_RANGO',
      mensaje: 'El parto se guardó sin genética: el último servicio es del 05/03/2026 y está fuera del plazo de 240 a 300 días antes del parto',
    });
    expect(avisoSinLotePrevio('SECA', 'parto', '2026-10-01')).toEqual({
      codigo: 'SIN_LOTE_PREVIO',
      mensaje: 'La vaca volvió a «seca» y quedó sin lote: no tenía lote antes del parto del 01/10/2026',
    });
    expect(avisoSinLotePrevio('EN_ORDENE', 'secado', '2026-10-01').mensaje).toContain('antes del secado del 01/10/2026');
    expect(avisoLoteAnteriorEliminado('VAQUILLONA')).toEqual({
      codigo: 'LOTE_PREVIO_ELIMINADO',
      mensaje: 'La vaca volvió a «vaquillona» y quedó sin lote: su lote anterior ya no existe',
    });
  });
});

describe('resolverLotesDestino con una transacción simulada (RF-14, RF-20)', () => {
  // Simula la parte de `tx` que usa la función: las reglas y el bloqueo FOR SHARE del lote.
  const txSimulado = (reglas: { estado: string; loteId: string }[], lotesQueExisten: string[]) =>
    ({
      reglaLote: { findMany: async () => reglas },
      // Es una función de plantilla etiquetada: recibe (strings, ...valores). El primer valor es el id del lote.
      $queryRaw: async (_strings: TemplateStringsArray, ...valores: unknown[]) => (lotesQueExisten.includes(String(valores[0])) ? [{ id: valores[0] }] : []),
    }) as never;

  it('regla con lote que existe: devuelve el lote; estado sin regla: null', async () => {
    const tx = txSimulado([{ estado: 'EN_ORDENE', loteId: 'L1' }], ['L1']);
    const r = await resolverLotesDestino(tx, 'E1', ['EN_ORDENE', 'RECIEN_NACIDO']);
    expect(r.get('EN_ORDENE')).toBe('L1');
    expect(r.get('RECIEN_NACIDO')).toBeNull();
  });

  it('regla con un lote que ya no existe: 409 "El lote destino ya no existe, volvé a intentar"', async () => {
    const tx = txSimulado([{ estado: 'SECA', loteId: 'L9' }], []);
    await expect(resolverLotesDestino(tx, 'E1', ['SECA'])).rejects.toMatchObject({
      status: 409,
      message: 'El lote destino ya no existe, volvé a intentar',
    });
  });
});
