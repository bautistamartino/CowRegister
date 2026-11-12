import { describe, expect, it } from 'vitest';
import { armarHistorial, type FilaCambio } from '../src/historial/historial.js';
import type { FilaEvento } from '../src/reproduccion/eventos.js';

// Spec 007 (RF-1, RF-3, RF-5): el armado del historial es una función pura, se prueba sin base.

let contador = 0;
// Un evento mínimo para el armado. `registrado` es un minuto del día para controlar el orden de registro.
function evento(tipo: FilaEvento['tipo'], fecha: string, registrado: string, extra: Partial<FilaEvento> = {}): FilaEvento {
  contador += 1;
  return {
    id: `ev-${contador}`,
    tipo,
    fecha,
    creadoEn: new Date(`2026-11-01T${registrado}:00Z`),
    anulado: false,
    resultado: tipo === 'TACTO' ? 'PRENADA' : null,
    fechaProbableIndicada: null,
    registradoPor: 'Dueño',
    anuladoEn: null,
    anuladoPor: null,
    motivoAnulacion: null,
    servicio: tipo === 'SERVICIO' ? { tipoServicio: 'INSEMINACION', semen: null } : null,
    anomalias: null,
    parto: null,
    secado: null,
    baja: null,
    ...extra,
  };
}

function cambio(id: string, campo: string, creadoEn: string): FilaCambio {
  return { id, campo, valorAnterior: 'A', valorNuevo: 'B', usuarioNombre: 'Ana', creadoEn: new Date(creadoEn) };
}

const HOY = '2026-11-12';

describe('armarHistorial', () => {
  it('ordena de más reciente a más antiguo por fecha y, a igual fecha, por momento de registro', () => {
    const a = evento('SERVICIO', '2026-10-01', '10:00');
    const b = evento('TACTO', '2026-10-20', '09:00');
    const c = evento('TACTO', '2026-10-20', '11:00'); // misma fecha, registrado después: primero
    const h = armarHistorial([a, b, c], [], 0, HOY, 500);
    expect(h.entradas.map((e) => (e.clase === 'EVENTO' ? e.evento.id : ''))).toEqual([c.id, b.id, a.id]);
    expect(h.total).toBe(3);
    expect(h.truncado).toBe(false);
  });

  it('mezcla eventos y cambios manuales; los cambios de un mismo guardado salen ordenados por dato y id', () => {
    const e = evento('SERVICIO', '2026-10-01', '10:00');
    const mismo = '2026-11-05T15:00:00Z';
    const cambios = [cambio('z', 'SEXO', mismo), cambio('b', 'NUMERO', mismo), cambio('a', 'NUMERO', mismo)];
    const h = armarHistorial([e], cambios, 3, HOY, 500);
    expect(
      h.entradas.map((x) => (x.clase === 'CAMBIO' ? `${x.cambio.campo}:${x.cambio.id}` : 'evento')),
    ).toEqual(['NUMERO:a', 'NUMERO:b', 'SEXO:z', 'evento']);
  });

  it('un cambio guardado a las 22:00 ART del 12/11 (01:00 UTC del 13/11) figura en el 12/11', () => {
    const h = armarHistorial([], [cambio('x', 'NUMERO', '2026-11-13T01:00:00Z')], 1, HOY, 500);
    expect(h.entradas[0]!.fecha).toBe('2026-11-12');
  });

  it('un evento anulado queda en la fecha del evento, con su marca de anulación', () => {
    const e = evento('TACTO', '2026-10-05', '10:00', {
      anulado: true,
      anuladoEn: new Date('2026-11-10T12:00:00Z'),
      anuladoPor: 'Ana',
      motivoAnulacion: 'Error de carga',
    });
    const h = armarHistorial([e], [], 0, HOY, 500);
    const entrada = h.entradas[0]!;
    expect(entrada.fecha).toBe('2026-10-05');
    expect(entrada.clase === 'EVENTO' && entrada.evento.anulacion?.motivo).toBe('Error de carga');
  });

  it('ultimoEventoNoAnuladoId saltea los anulados y la baja', () => {
    const servicio = evento('SERVICIO', '2026-10-01', '10:00');
    const tacto = evento('TACTO', '2026-10-20', '10:00');
    const tactoAnulado = evento('TACTO', '2026-10-25', '10:00', { anulado: true, anuladoEn: new Date(), anuladoPor: 'Ana', motivoAnulacion: 'x' });
    const baja = evento('BAJA', '2026-11-01', '10:00', {
      baja: { motivo: 'venta', observaciones: null, estadoAnterior: 'EN_ORDENE', loteAnterior: 'SIN_LOTE' },
    });
    const h = armarHistorial([servicio, tacto, tactoAnulado, baja], [], 0, HOY, 500);
    expect(h.ultimoEventoNoAnuladoId).toBe(tacto.id);
  });

  it('sin eventos no hay último evento anulable', () => {
    expect(armarHistorial([], [], 0, HOY, 500).ultimoEventoNoAnuladoId).toBeNull();
  });

  it('con tope, corta las entradas y el último evento no anulado sigue identificado aunque quede fuera', () => {
    const evViejo = evento('SERVICIO', '2026-08-01', '10:00'); // el último evento no anulado, pero muy viejo
    const cambios = [cambio('c1', 'NUMERO', '2026-11-05T15:00:00Z'), cambio('c2', 'SEXO', '2026-11-06T15:00:00Z')];
    const h = armarHistorial([evViejo], cambios, 2, HOY, 2);
    expect(h.total).toBe(3);
    expect(h.truncado).toBe(true);
    expect(h.tope).toBe(2);
    expect(h.entradas).toHaveLength(2);
    expect(h.entradas.every((e) => e.clase === 'CAMBIO')).toBe(true);
    expect(h.ultimoEventoNoAnuladoId).toBe(evViejo.id);
  });

  it('total cuenta todos los cambios del animal, no solo los leídos', () => {
    const h = armarHistorial([], [cambio('c1', 'NUMERO', '2026-11-05T15:00:00Z')], 7, HOY, 500);
    expect(h.total).toBe(7);
  });

  it('macho: solo cambios manuales y bajas (también revertidas)', () => {
    const baja = evento('BAJA', '2026-11-01', '10:00', {
      anulado: true,
      anuladoEn: new Date('2026-11-02T10:00:00Z'),
      anuladoPor: 'Ana',
      motivoAnulacion: 'Se vendió por error',
      baja: { motivo: 'venta', observaciones: null, estadoAnterior: 'VAQUILLONA', loteAnterior: 'SIN_LOTE' },
    });
    const h = armarHistorial([baja], [cambio('c1', 'NUMERO', '2026-11-05T15:00:00Z')], 1, HOY, 500);
    expect(h.entradas.map((e) => e.clase)).toEqual(['CAMBIO', 'EVENTO']);
    expect(h.ultimoEventoNoAnuladoId).toBeNull();
  });
});
