import { describe, expect, it } from 'vitest';
import type { AnimalCopia, EventoReproductivo } from '../src/compartido/api';
import type { Enviado, Pendiente } from '../src/sinconexion/almacen';
import { construirVista, entradasValidas, numerosEnUso } from '../src/sinconexion/vistaLocal';
import { enviado, pendiente, vacaCopia } from './ayudas';

// Vista local de una vaca (spec 010, RF-18, RF-21 y RF-24): la copia + los pendientes que cuentan, en orden.

const HOY = '2026-11-12';

function evento(id: string, tipo: EventoReproductivo['tipo'], fecha: string, extra: Partial<EventoReproductivo> = {}): EventoReproductivo {
  return {
    id,
    tipo,
    fecha,
    registradoPor: 'Dueño',
    registradoEn: `${fecha}T12:00:00.000Z`,
    anulacion: null,
    servicio: tipo === 'SERVICIO' ? { tipoServicio: 'INSEMINACION', semen: null } : null,
    tacto: tipo === 'TACTO' ? { resultado: 'PRENADA', fechaProbableIndicada: null, fechaProbable: null, anomalias: null } : null,
    parto: null,
    secado: null,
    baja: null,
    ...extra,
  };
}

// La vaca "a1" de la copia con los eventos indicados (más reciente primero, como la ficha).
function vaca(eventos: EventoReproductivo[] = [], estado: AnimalCopia['ficha']['estado'] = 'EN_ORDENE', sexo: 'HEMBRA' | 'MACHO' = 'HEMBRA'): AnimalCopia {
  const v = vacaCopia('a1', '12');
  return { ...v, ficha: { ...v.ficha, estado, sexo }, eventos: { situacion: null, eventos } };
}

// Un pendiente de evento de la vaca "a1" (o de otra, con `animalId`).
let contador = 0;
function pend(tipo: Pendiente['tipo'], datos: Record<string, unknown>, cambios: Partial<Pendiente> = {}): Pendiente {
  contador += 1;
  return pendiente({ id: `p-${contador}`, tipo, datos, orden: contador, ...cambios });
}
const env = (p: Pendiente, aceptadoEn = 1): Enviado => ({ ...enviado(p), tipo: p.tipo, datos: p.datos, aceptadoEn, registro: null });

const servicio = (fecha: string, cambios: Partial<Pendiente> = {}) => pend('SERVICIO', { fecha, tipo: 'INSEMINACION' }, cambios);
const tacto = (fecha: string, resultado: 'PRENADA' | 'VACIA', extra: Record<string, unknown> = {}, cambios: Partial<Pendiente> = {}) => pend('TACTO', { fecha, resultado, ...extra }, cambios);
const parto = (fecha: string, crias: Record<string, unknown>[], cambios: Partial<Pendiente> = {}) => pend('PARTO', { fecha, crias }, cambios);

const vista = (animal: AnimalCopia, pendientes: Pendiente[] = [], enviados: Enviado[] = []) => construirVista(animal, entradasValidas(pendientes, enviados), HOY);

describe('construirVista: la copia sola', () => {
  it('sin pendientes es la copia: estado, situación y último evento no anulado', () => {
    const v = vista(vaca([evento('t1', 'TACTO', '2026-10-01', { tacto: { resultado: 'VACIA', fechaProbableIndicada: null, fechaProbable: null, anomalias: null } }), evento('s1', 'SERVICIO', '2026-09-01')]));
    expect(v.estado).toBe('EN_ORDENE');
    expect(v.situacion.estado).toBe('VACIA');
    expect(v.ultimoNoAnulado?.id).toBe('t1');
    expect(v.ultimaFechaNoAnulada).toBe('2026-10-01');
    expect(v.criasPendientes).toEqual([]);
    expect(v.puedeLitros).toBe(true);
  });

  it('una anulación de la copia no cuenta para el último evento', () => {
    const v = vista(vaca([evento('t1', 'TACTO', '2026-10-01', { anulacion: { motivo: 'x', por: 'Dueño', en: '2026-10-02T12:00:00.000Z' } }), evento('s1', 'SERVICIO', '2026-09-01')]));
    expect(v.ultimoNoAnulado?.id).toBe('s1');
    expect(v.situacion.estado).toBe('SERVIDA');
  });
});

describe('construirVista: cada tipo de pendiente', () => {
  it('un servicio pendiente deja a la vaca "servida" y es el último evento', () => {
    const p = servicio('2026-11-01');
    const v = vista(vaca(), [p]);
    expect(v.situacion.estado).toBe('SERVIDA');
    expect(v.ultimoNoAnulado).toMatchObject({ id: p.id, origen: 'pendiente', tipo: 'SERVICIO' });
  });

  it('un tacto "preñada" pendiente da la fecha probable (servicio + 283 días)', () => {
    const v = vista(vaca([evento('s1', 'SERVICIO', '2026-08-01')]), [tacto('2026-10-01', 'PRENADA')]);
    expect(v.situacion.estado).toBe('PRENADA');
    expect(v.situacion.fechaProbableParto?.fecha).toBe('2027-05-11');
  });

  it('un secado pendiente deja a la vaca "seca" y sin litros', () => {
    const v = vista(vaca(), [pend('SECADO', { fecha: '2026-11-10' })]);
    expect(v.estado).toBe('SECA');
    expect(v.puedeLitros).toBe(false);
  });

  it('un parto pendiente pasa a la madre a "en ordeñe" (se le pueden cargar litros) y lleva sus crías adentro', () => {
    const p = parto('2026-11-10', [{ sexo: 'HEMBRA', numero: 'c1' }, { sexo: 'MACHO', nacidaMuerta: true }]);
    const v = vista(vaca([], 'VAQUILLONA'), [p]);
    expect(v.estado).toBe('EN_ORDENE');
    expect(v.puedeLitros).toBe(true);
    expect(v.situacion.estado).toBe('SIN_SERVICIO');
    expect(v.criasPendientes).toEqual([
      { partoId: p.id, orden: 1, sexo: 'HEMBRA', nacidaMuerta: false, numero: 'C1' },
      { partoId: p.id, orden: 2, sexo: 'MACHO', nacidaMuerta: true, numero: null },
    ]);
  });

  it('una baja pendiente marca la vaca como "baja", sin litros', () => {
    const v = vista(vaca(), [pend('BAJA', { motivo: 'venta', fecha: '2026-11-10' })]);
    expect(v.estado).toBe('BAJA');
    expect(v.puedeLitros).toBe(false);
  });

  it('una baja ENVIADA que la copia todavía no refleja también marca "baja"', () => {
    const p = pend('BAJA', { motivo: 'muerte', fecha: '2026-11-10' });
    expect(vista(vaca(), [], [env(p)]).estado).toBe('BAJA');
  });

  it('un macho no admite litros aunque esté en ordeñe', () => {
    expect(vista(vaca([], 'EN_ORDENE', 'MACHO')).puedeLitros).toBe(false);
  });

  it('los litros pendientes no cambian nada de la vista', () => {
    const v = vista(vaca(), [pendiente({ id: 'l1', orden: 99 })]);
    expect(v.eventos).toEqual([]);
    expect(v.estado).toBe('EN_ORDENE');
  });

  it('los pendientes de otra vaca no se aplican', () => {
    const v = vista(vaca(), [pend('BAJA', { motivo: 'venta', fecha: '2026-11-10' }, { animalId: 'otra' })]);
    expect(v.estado).toBe('EN_ORDENE');
  });
});

describe('construirVista: qué pendientes cuentan', () => {
  it('un pendiente rechazado no cuenta', () => {
    const v = vista(vaca(), [servicio('2026-11-01', { estado: 'rechazado' })]);
    expect(v.situacion.estado).toBe('SIN_SERVICIO');
    expect(v.eventos).toEqual([]);
  });

  it('un pendiente "en espera del anterior" no cuenta, y tampoco lo que dependía de él', () => {
    // El servicio se rechazó: el tacto queda en espera y no aparece, y el secado cargado después tampoco.
    const rechazado = servicio('2026-10-01', { estado: 'rechazado' });
    const enEspera = tacto('2026-10-15', 'PRENADA');
    const secado = pend('SECADO', { fecha: '2026-11-01' });
    const v = vista(vaca(), [rechazado, enEspera, secado]);
    expect(v.eventos).toEqual([]);
    expect(v.estado).toBe('EN_ORDENE');
  });

  it('esperando y enviando cuentan', () => {
    const v = vista(vaca(), [servicio('2026-11-01', { estado: 'enviando' }), tacto('2026-11-05', 'VACIA')]);
    expect(v.eventos.map((e) => e.tipo)).toEqual(['SERVICIO', 'TACTO']);
    expect(v.situacion.estado).toBe('VACIA');
  });

  it('los pendientes se aplican en orden de carga, no en el orden en que llegan en la lista', () => {
    const primero = servicio('2026-11-01', { orden: 1 });
    const segundo = tacto('2026-11-01', 'PRENADA', {}, { orden: 2 });
    const v = vista(vaca(), [segundo, primero]);
    expect(v.eventos.map((e) => e.tipo)).toEqual(['SERVICIO', 'TACTO']);
    expect(v.situacion.estado).toBe('PRENADA');
  });

  it('un enviado que la copia ya trae no se repite entre los eventos', () => {
    const p = servicio('2026-11-01');
    const v = vista(vaca([evento(p.id, 'SERVICIO', '2026-11-01')]), [], [env(p)]);
    expect(v.eventos.filter((e) => e.id === p.id)).toHaveLength(1);
    expect(v.eventos[0]?.origen).toBe('copia');
  });

  it('un enviado que la copia todavía no trae sigue contando', () => {
    const p = servicio('2026-11-01');
    const v = vista(vaca(), [], [env(p)]);
    expect(v.eventos[0]).toMatchObject({ id: p.id, origen: 'enviado' });
  });

  it('los enviados van antes que los pendientes', () => {
    const e = servicio('2026-11-01');
    const p = tacto('2026-11-02', 'VACIA');
    expect(entradasValidas([p], [env(e)]).map((x) => x.id)).toEqual([e.id, p.id]);
  });
});

describe('construirVista: anulaciones pendientes', () => {
  it('marcan el evento como anulado y el último no anulado retrocede', () => {
    const anulacion = pend('ANULACION', { eventoId: 't1', tipoEvento: 'TACTO', motivo: 'Error' });
    const v = vista(vaca([evento('t1', 'TACTO', '2026-10-01'), evento('s1', 'SERVICIO', '2026-09-01')]), [anulacion]);
    expect(v.eventos.find((e) => e.id === 't1')?.anulado).toBe(true);
    expect(v.ultimoNoAnulado?.id).toBe('s1');
    expect(v.situacion.estado).toBe('SERVIDA'); // un servicio puede volver a cargarse
  });

  it('no revierten el estado que dejó un parto o un secado (el lote y el estado no se proyectan)', () => {
    const secado = pend('SECADO', { fecha: '2026-11-10' });
    const anulacion = pend('ANULACION', { eventoId: secado.id, tipoEvento: 'SECADO', motivo: 'Error' });
    const v = vista(vaca(), [secado, anulacion]);
    expect(v.estado).toBe('SECA');
    expect(v.ultimoNoAnulado).toBeNull();
  });

  it('las crías de un parto pendiente anulado dejan de existir', () => {
    const p = parto('2026-11-10', [{ sexo: 'HEMBRA', numero: 'C1' }]);
    const anulacion = pend('ANULACION', { eventoId: p.id, tipoEvento: 'PARTO', motivo: 'Error' });
    expect(vista(vaca(), [p, anulacion]).criasPendientes).toEqual([]);
  });
});

describe('numerosEnUso (RF-21)', () => {
  const copia = [vaca(), { ...vacaCopia('a2', '7'), ficha: { ...vacaCopia('a2', '7').ficha } }];

  it('trae los números de los animales activos de la copia', () => {
    expect(numerosEnUso(copia, [])).toEqual(new Set(['12', '7']));
  });

  it('suma las crías vivas de partos pendientes y de partos enviados que la copia no trae (no las muertas)', () => {
    const pendiente1 = parto('2026-11-10', [{ sexo: 'HEMBRA', numero: 'c1' }, { sexo: 'MACHO', nacidaMuerta: true }], { animalId: 'a2' });
    const enviado1 = parto('2026-11-11', [{ sexo: 'HEMBRA', numero: 'C2' }], { animalId: 'a2' });
    const entradas = entradasValidas([pendiente1], [env(enviado1)]);
    expect(numerosEnUso(copia, entradas)).toEqual(new Set(['12', '7', 'C1', 'C2']));
  });

  it('el número de un animal con baja pendiente o enviada queda libre para lo que se carga después', () => {
    const baja = pend('BAJA', { motivo: 'venta', fecha: '2026-11-10' }, { animalId: 'a2', numero: '7', orden: 3 });
    const bajaEnviada = pend('BAJA', { motivo: 'muerte', fecha: '2026-11-10' }, { animalId: 'a1', numero: '12' });
    expect(numerosEnUso(copia, entradasValidas([baja], []))).toEqual(new Set(['12']));
    expect(numerosEnUso(copia, entradasValidas([], [env(bajaEnviada)]))).toEqual(new Set(['7']));
  });

  it('pero NO queda libre para lo cargado antes de esa baja (orden anterior)', () => {
    const baja = pend('BAJA', { motivo: 'venta', fecha: '2026-11-10' }, { animalId: 'a2', numero: '7', orden: 10 });
    const entradas = entradasValidas([baja], []);
    expect(numerosEnUso(copia, entradas, 5).has('7')).toBe(true); // cargado antes de la baja
    expect(numerosEnUso(copia, entradas, 11).has('7')).toBe(false); // cargado después
  });

  it('un parto pendiente anulado libera los números de sus crías', () => {
    const p = parto('2026-11-10', [{ sexo: 'HEMBRA', numero: 'C1' }]);
    const anulacion = pend('ANULACION', { eventoId: p.id, tipoEvento: 'PARTO', motivo: 'Error' });
    expect(numerosEnUso(copia, entradasValidas([p, anulacion], [])).has('C1')).toBe(false);
  });

  it('un parto rechazado o en espera no reserva sus números', () => {
    const rechazado = parto('2026-11-10', [{ sexo: 'HEMBRA', numero: 'C1' }], { estado: 'rechazado' });
    expect(numerosEnUso(copia, entradasValidas([rechazado], [])).has('C1')).toBe(false);
  });
});
