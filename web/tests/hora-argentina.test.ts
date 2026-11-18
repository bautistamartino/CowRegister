import { afterEach, describe, expect, it } from 'vitest';
import { formatearFechaHora } from '../src/sinconexion/fechaHora';
import { fechaIsoArgentina, fechaYTurnoArgentina, formatearFechaHoraArgentina } from '../src/sinconexion/horaArgentina';
import { fechaArgentinaIso, hoyIso } from '../src/reproduccion/reproduccionDatos';
import { textoMomento } from '../src/produccion/produccionDatos';

// Hora de Argentina única (spec 011, RF-26): ninguna fecha ni hora depende del huso del dispositivo.

const TZ_ORIGINAL = process.env.TZ;
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

// 02:30 UTC del 13/11 = 23:30 del 12/11 en Argentina (UTC-3): cerca de la medianoche argentina.
const CERCA_DE_MEDIANOCHE = '2026-11-13T02:30:00.000Z';
// 03:05 UTC del 13/11 = 00:05 del 13/11 en Argentina: recién pasada la medianoche.
const PASADA_LA_MEDIANOCHE = '2026-11-13T03:05:00.000Z';

describe.each(['Asia/Tokyo', 'America/New_York', 'America/Argentina/Buenos_Aires'])('con el huso del proceso en %s', (zona) => {
  it('"hoy", el turno y los textos dan los de Argentina', () => {
    process.env.TZ = zona;
    const d = new Date(CERCA_DE_MEDIANOCHE);
    expect(fechaIsoArgentina(d)).toBe('2026-11-12');
    expect(fechaArgentinaIso(d)).toBe('2026-11-12');
    expect(fechaYTurnoArgentina(d)).toEqual({ fecha: '2026-11-12', turno: 'tarde' });
    expect(formatearFechaHoraArgentina(d)).toBe('12/11/2026 23:30');
    expect(formatearFechaHora(CERCA_DE_MEDIANOCHE)).toBe('12/11/2026 23:30');
    expect(textoMomento(CERCA_DE_MEDIANOCHE)).toBe('12/11/2026 23:30');
  });

  it('pasada la medianoche argentina la fecha cambia y la hora es 00, no 24', () => {
    process.env.TZ = zona;
    const d = new Date(PASADA_LA_MEDIANOCHE);
    expect(fechaIsoArgentina(d)).toBe('2026-11-13');
    expect(formatearFechaHoraArgentina(d)).toBe('13/11/2026 00:05');
    expect(textoMomento(PASADA_LA_MEDIANOCHE)).toBe('13/11/2026 00:05');
  });
});

describe('hoyIso', () => {
  it('es la fecha de Argentina de este instante', () => {
    expect(hoyIso()).toBe(fechaIsoArgentina(new Date()));
  });
});

describe('formatearFechaHoraArgentina', () => {
  it('rellena con ceros día, mes, hora y minuto', () => {
    expect(formatearFechaHoraArgentina(new Date('2026-01-05T12:05:00.000Z'))).toBe('05/01/2026 09:05');
  });
});
