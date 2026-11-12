import { describe, expect, it } from 'vitest';
import { resultadoDeServicio, type EventoResultado } from '../src/informes/resultado-servicio.js';

// Spec 007 (RF-7): el resultado de un servicio es una función pura. Cada caso arma los eventos de
// una vaca; `hora` controla el momento de registro (orden total a igual fecha).

let n = 0;
function ev(
  tipo: EventoResultado['tipo'],
  fecha: string,
  hora: string,
  extra: Partial<EventoResultado> = {},
): EventoResultado {
  n += 1;
  return {
    id: `e${n}`,
    tipo,
    fecha,
    creadoEn: new Date(`2026-11-01T${hora}:00Z`),
    resultado: null,
    servicioDelParto: null,
    anulado: false,
    ...extra,
  };
}
const tacto = (fecha: string, hora: string, resultado: 'PRENADA' | 'VACIA', extra: Partial<EventoResultado> = {}) =>
  ev('TACTO', fecha, hora, { resultado, ...extra });
const servicio = (fecha: string, hora = '08:00', extra: Partial<EventoResultado> = {}) => ev('SERVICIO', fecha, hora, extra);

describe('resultadoDeServicio', () => {
  it('tacto preñada -> PRENADA_TACTO; tacto vacía -> VACIA; sin tacto -> SIN_TACTO', () => {
    const s = servicio('2026-01-10');
    expect(resultadoDeServicio(s, [s, tacto('2026-02-20', '08:00', 'PRENADA')])).toBe('PRENADA_TACTO');
    expect(resultadoDeServicio(s, [s, tacto('2026-02-20', '08:00', 'VACIA')])).toBe('VACIA');
    expect(resultadoDeServicio(s, [s])).toBe('SIN_TACTO');
  });

  it('manda el primer tacto aunque después venga uno contrario (aborto o vacía y luego preñada)', () => {
    const s = servicio('2026-01-10');
    expect(resultadoDeServicio(s, [s, tacto('2026-02-20', '08:00', 'PRENADA'), tacto('2026-04-01', '08:00', 'VACIA')])).toBe('PRENADA_TACTO');
    const s2 = servicio('2026-01-10');
    expect(resultadoDeServicio(s2, [s2, tacto('2026-02-20', '08:00', 'VACIA'), tacto('2026-04-01', '08:00', 'PRENADA')])).toBe('VACIA');
  });

  it('el tramo termina en el siguiente servicio: un tacto posterior a otro servicio no cuenta para el primero', () => {
    const s1 = servicio('2026-01-10');
    const s2 = servicio('2026-02-10');
    const t = tacto('2026-03-20', '08:00', 'PRENADA');
    expect(resultadoDeServicio(s1, [s1, s2, t])).toBe('SIN_TACTO');
    expect(resultadoDeServicio(s2, [s1, s2, t])).toBe('PRENADA_TACTO');
  });

  it('el tramo termina en el siguiente parto', () => {
    const s = servicio('2026-01-10');
    const parto = ev('PARTO', '2026-10-20', '08:00');
    const t = tacto('2026-11-01', '08:00', 'PRENADA'); // tacto del ciclo siguiente
    expect(resultadoDeServicio(s, [s, parto, t])).toBe('SIN_TACTO');
  });

  it('mismo día: el tacto registrado antes del servicio no cuenta; el registrado después sí', () => {
    const antes = tacto('2026-01-10', '07:00', 'PRENADA');
    const s = servicio('2026-01-10', '08:00');
    const despues = tacto('2026-01-10', '09:00', 'VACIA');
    expect(resultadoDeServicio(s, [antes, s])).toBe('SIN_TACTO');
    expect(resultadoDeServicio(s, [antes, s, despues])).toBe('VACIA');
  });

  it('un tacto anulado se saltea y pasa a contar el siguiente del tramo', () => {
    const s = servicio('2026-01-10');
    const anulado = tacto('2026-02-20', '08:00', 'VACIA', { anulado: true });
    const bueno = tacto('2026-03-01', '08:00', 'PRENADA');
    expect(resultadoDeServicio(s, [s, anulado, bueno])).toBe('PRENADA_TACTO');
    expect(resultadoDeServicio(s, [s, anulado])).toBe('SIN_TACTO');
  });

  it('un servicio anulado no corta el tramo del anterior', () => {
    const s1 = servicio('2026-01-10');
    const s2 = servicio('2026-02-10', '08:00', { anulado: true });
    const t = tacto('2026-03-20', '08:00', 'PRENADA');
    expect(resultadoDeServicio(s1, [s1, s2, t])).toBe('PRENADA_TACTO');
  });

  it('un tacto anterior a todo servicio (sin servicio previo) no se mira', () => {
    const t = tacto('2026-01-01', '08:00', 'PRENADA');
    const s = servicio('2026-01-10');
    expect(resultadoDeServicio(s, [t, s])).toBe('SIN_TACTO');
  });

  it('parto vinculado sin tacto -> PRENADA_PARTO; con tacto manda el tacto', () => {
    const s = servicio('2026-01-10');
    const parto = ev('PARTO', '2026-10-20', '08:00', { servicioDelParto: s.id });
    expect(resultadoDeServicio(s, [s, parto])).toBe('PRENADA_PARTO');
    expect(resultadoDeServicio(s, [s, tacto('2026-02-20', '08:00', 'VACIA'), parto])).toBe('VACIA');
    expect(resultadoDeServicio(s, [s, tacto('2026-02-20', '08:00', 'PRENADA'), parto])).toBe('PRENADA_TACTO');
  });

  it('un parto anulado no vincula: vuelve a SIN_TACTO', () => {
    const s = servicio('2026-01-10');
    const parto = ev('PARTO', '2026-10-20', '08:00', { servicioDelParto: s.id, anulado: true });
    expect(resultadoDeServicio(s, [s, parto])).toBe('SIN_TACTO');
  });

  it('un parto que vincula a otro servicio no hace preñada a este', () => {
    const s1 = servicio('2026-01-10');
    const s2 = servicio('2026-02-10');
    const parto = ev('PARTO', '2026-11-10', '08:00', { servicioDelParto: s2.id });
    expect(resultadoDeServicio(s1, [s1, s2, parto])).toBe('SIN_TACTO');
    expect(resultadoDeServicio(s2, [s1, s2, parto])).toBe('PRENADA_PARTO');
  });

  it('no depende del orden en que llegan los eventos', () => {
    const s = servicio('2026-01-10');
    const t = tacto('2026-02-20', '08:00', 'PRENADA');
    expect(resultadoDeServicio(s, [t, s])).toBe('PRENADA_TACTO');
  });
});
