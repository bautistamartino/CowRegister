import { describe, expect, it } from 'vitest';
import type { AnimalCopia, EntradaHistorial, EventoReproductivo, SemenCopia } from '../src/compartido/api';
import type { Enviado, Pendiente } from '../src/sinconexion/almacen';
import { armarFichaLocal, contarSinAceptar, decidirFuente } from '../src/sinconexion/adaptadorFicha';
import { diasEntre } from '../src/sinconexion/situacionLocal';
import { enviado, pendiente, vacaCopia } from './ayudas';

// Adaptador de la ficha (spec 011, RF-18 a RF-24): la copia + los pendientes, con las formas de la API.

const HOY = '2026-11-12';
const USUARIO = 'Ana Pérez';
const SEMEN: SemenCopia[] = [{ id: 'sm1', nombre: 'Toro Rojo', raza: null }];

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

// La vaca "a1" de la copia (eventos más reciente primero, como la ficha).
function vaca(eventos: EventoReproductivo[] = [], estado: AnimalCopia['ficha']['estado'] = 'EN_ORDENE', sexo: 'HEMBRA' | 'MACHO' = 'HEMBRA'): AnimalCopia {
  const v = vacaCopia('a1', '12');
  return { ...v, ficha: { ...v.ficha, estado, sexo, lote: { id: 'l1', nombre: 'Ordeñe' } }, eventos: { situacion: null, eventos } };
}

let contador = 0;
function pend(tipo: Pendiente['tipo'], datos: Record<string, unknown>, cambios: Partial<Pendiente> = {}): Pendiente {
  contador += 1;
  return pendiente({ id: `p-${contador}`, tipo, datos, orden: contador, ...cambios });
}
const env = (p: Pendiente, aceptadoEn = Date.parse('2026-11-12T13:00:00.000Z')): Enviado => ({ ...enviado(p), tipo: p.tipo, datos: p.datos, aceptadoEn, registro: null });

const servicio = (fecha: string, extra: Record<string, unknown> = {}, cambios: Partial<Pendiente> = {}) => pend('SERVICIO', { fecha, tipo: 'INSEMINACION', ...extra }, cambios);
const tacto = (fecha: string, resultado: 'PRENADA' | 'VACIA', extra: Record<string, unknown> = {}, cambios: Partial<Pendiente> = {}) => pend('TACTO', { fecha, resultado, ...extra }, cambios);
const secado = (fecha: string, cambios: Partial<Pendiente> = {}) => pend('SECADO', { fecha }, cambios);
const parto = (fecha: string, crias: Record<string, unknown>[], cambios: Partial<Pendiente> = {}) => pend('PARTO', { fecha, crias }, cambios);
const baja = (cambios: Partial<Pendiente> = {}) => pend('BAJA', { fecha: '2026-11-12', motivo: 'venta' }, cambios);

const armar = (copia: AnimalCopia, pendientes: Pendiente[] = [], enviados: Enviado[] = []) =>
  armarFichaLocal({ copia, pendientes, enviados, semen: SEMEN, usuarioNombre: USUARIO, hoy: HOY });

const eventosEntrada = (entradas: EntradaHistorial[]) => entradas.flatMap((e) => (e.clase === 'EVENTO' ? [e.evento] : []));

describe('decidirFuente y contarSinAceptar (RF-18)', () => {
  it('sin conexión manda siempre la vista local', () => {
    expect(decidirFuente({ enLinea: false, animalId: 'a1', pendientes: [] })).toBe('local');
    expect(decidirFuente({ enLinea: false, animalId: 'a1', pendientes: [servicio('2026-11-01')] })).toBe('local');
  });

  it('con conexión y la vaca sin pendientes sin aceptar manda el servidor', () => {
    expect(decidirFuente({ enLinea: true, animalId: 'a1', pendientes: [] })).toBe('servidor');
  });

  it('con conexión, los pendientes de OTRA vaca o los litros no desvían la fuente', () => {
    const otra = servicio('2026-11-01', {}, { animalId: 'a2' });
    const litros = pendiente({ id: 'l-1', animalId: 'a1', orden: 90 });
    expect(decidirFuente({ enLinea: true, animalId: 'a1', pendientes: [otra, litros] })).toBe('servidor');
  });

  it.each(['esperando', 'enviando', 'rechazado'] as const)('con conexión y un evento %s de la vaca manda la vista local', (estado) => {
    expect(decidirFuente({ enLinea: true, animalId: 'a1', pendientes: [servicio('2026-11-01', {}, { estado })] })).toBe('local');
  });

  it('con conexión y la vaca solo con enviados (ya no son pendientes) manda el servidor', () => {
    // Los enviados no entran en la decisión: el servidor ya los tiene.
    expect(decidirFuente({ enLinea: true, animalId: 'a1', pendientes: [] })).toBe('servidor');
  });

  it('con conexión y una baja ENVIADA que la copia todavía no refleja manda la vista local (el servidor da 404)', () => {
    const bajaEnviada = env(baja());
    expect(decidirFuente({ enLinea: true, animalId: 'a1', pendientes: [], enviados: [bajaEnviada] })).toBe('local');
    // Otra vaca, u otro tipo de enviado (el servidor sí los conoce), no desvían la fuente.
    expect(decidirFuente({ enLinea: true, animalId: 'a2', pendientes: [], enviados: [bajaEnviada] })).toBe('servidor');
    expect(decidirFuente({ enLinea: true, animalId: 'a1', pendientes: [], enviados: [env(servicio('2026-11-01'))] })).toBe('servidor');
  });

  it('cuenta los eventos sin aceptar de la vaca, de todos los estados, sin litros', () => {
    const lista = [servicio('2026-11-01'), tacto('2026-11-02', 'VACIA', {}, { estado: 'rechazado' }), servicio('2026-11-03', {}, { animalId: 'a2' }), pendiente({ id: 'l-2', orden: 91 })];
    expect(contarSinAceptar('a1', lista)).toBe(2);
  });
});

describe('vaca sin pendientes: paridad con la copia (RF-19)', () => {
  it('devuelve la misma situación, eventos e historial que trae la copia', () => {
    const s1 = evento('s1', 'SERVICIO', '2026-08-01');
    const t1 = evento('t1', 'TACTO', '2026-10-01', { tacto: { resultado: 'PRENADA', fechaProbableIndicada: null, fechaProbable: '2027-05-11', anomalias: null } });
    const copia = vaca([t1, s1]);
    copia.eventos.situacion = {
      estado: 'PRENADA',
      ultimoServicio: { id: 's1', fecha: '2026-08-01', tipoServicio: 'INSEMINACION', semen: null, cicloAnterior: false },
      ultimoTacto: { id: 't1', fecha: '2026-10-01', resultado: 'PRENADA', anomalias: null, cicloAnterior: false },
      fechaProbableParto: { fecha: '2027-05-11', dias: diasEntre(HOY, '2027-05-11'), vencida: false },
      fechaReferencia: null,
    };
    copia.historial = {
      total: 2,
      truncado: false,
      tope: 500,
      ultimoEventoNoAnuladoId: 't1',
      entradas: [
        { clase: 'EVENTO', fecha: '2026-10-01', registradoEn: t1.registradoEn, evento: t1 },
        { clase: 'EVENTO', fecha: '2026-08-01', registradoEn: s1.registradoEn, evento: s1 },
      ],
    };
    const r = armar(copia);
    expect(r.eventos).toEqual(copia.eventos);
    expect(r.historial).toEqual(copia.historial);
    expect(r.ficha).toEqual({ ...copia.ficha, locales: { sinAceptar: 0, avisoLotePendiente: false } });
  });

  it('la vaca de la copia sin eventos (sin pendientes) queda "sin servicio"', () => {
    const copia = vaca();
    const r = armar(copia);
    expect(r.eventos.situacion).toMatchObject({ estado: 'SIN_SERVICIO', ultimoServicio: null, ultimoTacto: null, fechaProbableParto: null, fechaReferencia: null });
    expect(r.eventos.eventos).toEqual([]);
  });

  it('un macho no tiene situación ni eventos', () => {
    const r = armar(vaca([], 'VAQUILLONA', 'MACHO'), []);
    expect(r.eventos).toEqual({ situacion: null, eventos: [] });
  });
});

describe('estado y situación con pendientes (RF-19, RF-22)', () => {
  it('un servicio pendiente deja a la vaca servida, con el semen resuelto del catálogo de la copia', () => {
    const p = servicio('2026-11-01', { semenId: 'sm1' });
    const r = armar(vaca(), [p]);
    expect(r.eventos.situacion).toMatchObject({
      estado: 'SERVIDA',
      ultimoServicio: { id: p.id, fecha: '2026-11-01', tipoServicio: 'INSEMINACION', semen: { id: 'sm1', nombre: 'Toro Rojo' }, cicloAnterior: false },
    });
    expect(r.eventos.situacion?.fechaReferencia?.fecha).toBe('2027-08-11');
    expect(r.ficha.estado).toBe('EN_ORDENE');
  });

  it('un servicio sin semen o con un semen que no está en la copia queda con semen null', () => {
    const r = armar(vaca(), [servicio('2026-11-01'), servicio('2026-11-05', { semenId: 'desconocido' })]);
    expect(r.eventos.eventos.map((e) => e.servicio?.semen)).toEqual([null, null]);
  });

  it('un tacto "preñada" pendiente da la fecha probable (servicio + 283 días) también dentro del evento', () => {
    const t = tacto('2026-10-01', 'PRENADA', { anomalias: 'Quiste' });
    const r = armar(vaca([evento('s1', 'SERVICIO', '2026-08-01')]), [t]);
    expect(r.eventos.situacion).toMatchObject({
      estado: 'PRENADA',
      ultimoTacto: { id: t.id, resultado: 'PRENADA', anomalias: 'Quiste' },
      fechaProbableParto: { fecha: '2027-05-11', vencida: false },
    });
    expect(r.eventos.eventos[0].tacto).toEqual({ resultado: 'PRENADA', fechaProbableIndicada: null, fechaProbable: '2027-05-11', anomalias: 'Quiste' });
  });

  it('un tacto "vacía" pendiente deja la vaca vacía y sin fecha probable', () => {
    const t = tacto('2026-10-01', 'VACIA');
    const r = armar(vaca([evento('s1', 'SERVICIO', '2026-08-01')]), [t]);
    expect(r.eventos.situacion?.estado).toBe('VACIA');
    expect(r.eventos.eventos[0].tacto).toMatchObject({ resultado: 'VACIA', fechaProbable: null });
  });

  it('un secado pendiente deja la vaca "seca" y el evento recuerda el estado anterior, sin lote anterior', () => {
    const p = secado('2026-11-10');
    const r = armar(vaca(), [p]);
    expect(r.ficha.estado).toBe('SECA');
    expect(r.ficha.lote).toEqual({ id: 'l1', nombre: 'Ordeñe' }); // el lote no se proyecta
    expect(r.eventos.eventos[0].secado).toEqual({ estadoAnterior: 'EN_ORDENE', loteAnterior: null });
    expect(r.eventos.situacion?.estado).toBe('SIN_SERVICIO'); // el secado no cambia el estado reproductivo
  });

  it('los rechazados y los "en espera del anterior" no cuentan en el estado ni en la situación', () => {
    const rechazado = servicio('2026-11-01', {}, { estado: 'rechazado', motivo: 'x', codigoRechazo: 409 });
    const enEspera = tacto('2026-11-05', 'PRENADA'); // detrás de un rechazado de la misma vaca
    const r = armar(vaca(), [rechazado, enEspera]);
    expect(r.eventos.situacion?.estado).toBe('SIN_SERVICIO');
    expect(r.eventos.eventos).toEqual([]);
    // Spec 012: figuran en el historial (con su marca), pero fuera de la vista.
    expect(eventosEntrada(r.historial.entradas).map((e) => e.id)).toEqual([enEspera.id, rechazado.id]);
    expect(r.ficha.locales?.sinAceptar).toBe(2);
  });

  it('los pendientes de otra vaca y los litros no se aplican', () => {
    const otra = servicio('2026-11-01', {}, { animalId: 'a2' });
    const litros = pendiente({ id: 'l-3', animalId: 'a1', orden: 92 });
    const r = armar(vaca(), [otra, litros]);
    expect(r.eventos.eventos).toEqual([]);
    expect(r.ficha.locales).toEqual({ sinAceptar: 0, avisoLotePendiente: false });
  });
});

describe('eventos pendientes e historial (RF-20)', () => {
  it('un pendiente figura con pendiente: true, el usuario de la sesión, y lote anterior y genética en null', () => {
    const p = parto('2026-11-10', [{ sexo: 'HEMBRA', numero: '900' }]);
    const r = armar(vaca([], 'SECA'), [p]);
    const [e] = eventosEntrada(r.historial.entradas);
    expect(e).toMatchObject({ id: p.id, tipo: 'PARTO', fecha: '2026-11-10', registradoPor: USUARIO, pendiente: true, anulacion: null });
    expect(e.cargadoEnDispositivo).toBe('2026-11-12T08:15:00-03:00');
    expect(e.parto).toMatchObject({ estadoAnterior: 'SECA', loteAnterior: null, genetica: null });
  });

  it('un enviado que la copia no trae figura sin la marca de pendiente', () => {
    const p = servicio('2026-11-01');
    const r = armar(vaca(), [], [env(p)]);
    const [e] = r.eventos.eventos;
    expect(e).toMatchObject({ id: p.id, tipo: 'SERVICIO', registradoPor: USUARIO, registradoEn: '2026-11-12T13:00:00.000Z' });
    expect(e.pendiente).toBeFalsy();
    expect(r.eventos.situacion?.estado).toBe('SERVIDA');
  });

  it('un enviado que la copia ya refleja no se repite', () => {
    const p = servicio('2026-11-01');
    const copia = vaca([evento(p.id, 'SERVICIO', '2026-11-01')]);
    const r = armar(copia, [], [env(p)]);
    expect(r.eventos.eventos).toHaveLength(1);
    expect(r.eventos.eventos[0].registradoPor).toBe('Dueño');
  });

  it('el historial va del más reciente al más antiguo: un pendiente de igual fecha que uno de la copia va primero', () => {
    const s1 = evento('s1', 'SERVICIO', '2026-10-01');
    const t0 = evento('t0', 'TACTO', '2026-09-01');
    const copia = vaca([s1, t0]);
    copia.historial = {
      total: 3,
      truncado: false,
      tope: 500,
      ultimoEventoNoAnuladoId: 's1',
      entradas: [
        { clase: 'EVENTO', fecha: '2026-10-01', registradoEn: s1.registradoEn, evento: s1 },
        { clase: 'CAMBIO', fecha: '2026-09-15', registradoEn: '2026-09-15T12:00:00.000Z', cambio: { id: 'c1', campo: 'LOTE', valorAnterior: null, valorNuevo: 'Ordeñe', usuarioNombre: 'Dueño' } },
        { clase: 'EVENTO', fecha: '2026-09-01', registradoEn: t0.registradoEn, evento: t0 },
      ],
    };
    const igualFecha = tacto('2026-10-01', 'VACIA');
    const antiguo = servicio('2026-09-20');
    const r = armar(copia, [igualFecha, antiguo]);
    expect(r.historial.entradas.map((e) => (e.clase === 'EVENTO' ? e.evento.id : e.cambio.id))).toEqual([igualFecha.id, 's1', antiguo.id, 'c1', 't0']);
    expect(r.historial.total).toBe(5);
    expect(r.historial.ultimoEventoNoAnuladoId).toBe(igualFecha.id);
    // La lista de eventos sigue el mismo orden (sin cambios manuales).
    expect(r.eventos.eventos.map((e) => e.id)).toEqual([igualFecha.id, 's1', antiguo.id, 't0']);
  });

  it('dos pendientes de la misma fecha: el cargado después va primero', () => {
    const a = servicio('2026-11-01');
    const b = servicio('2026-11-01');
    const r = armar(vaca(), [a, b]);
    expect(r.eventos.eventos.map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it('una anulación pendiente muestra el evento como anulado, con motivo y usuario, y retrocede el último no anulado', () => {
    const s1 = evento('s1', 'SERVICIO', '2026-09-01');
    const t1 = evento('t1', 'TACTO', '2026-10-01');
    const copia = vaca([t1, s1]);
    copia.historial = {
      total: 2,
      truncado: false,
      tope: 500,
      ultimoEventoNoAnuladoId: 't1',
      entradas: [
        { clase: 'EVENTO', fecha: '2026-10-01', registradoEn: t1.registradoEn, evento: t1 },
        { clase: 'EVENTO', fecha: '2026-09-01', registradoEn: s1.registradoEn, evento: s1 },
      ],
    };
    const anulacion = pend('ANULACION', { eventoId: 't1', tipoEvento: 'TACTO', motivo: 'Carga equivocada' });
    const r = armar(copia, [anulacion]);
    const entradas = eventosEntrada(r.historial.entradas);
    expect(entradas.map((e) => e.id)).toEqual(['t1', 's1']); // la anulación no es una entrada del historial
    expect(entradas[0].anulacion).toEqual({ motivo: 'Carga equivocada', por: USUARIO, en: '2026-11-12T11:15:00.000Z' });
    expect(r.historial.ultimoEventoNoAnuladoId).toBe('s1');
    expect(r.eventos.situacion?.estado).toBe('SERVIDA');
  });
});

describe('parto pendiente (RF-21)', () => {
  it('madre en ordeñe, crías dentro del parto sin enlace y aviso de lote', () => {
    const p = parto('2026-11-10', [
      { sexo: 'HEMBRA', numero: ' 901 ', observaciones: 'Grande' },
      { sexo: 'MACHO', nacidaMuerta: true },
    ]);
    const r = armar(vaca([], 'SECA'), [p]);
    expect(r.ficha.estado).toBe('EN_ORDENE');
    expect(r.ficha.locales).toEqual({ sinAceptar: 0, avisoLotePendiente: true });
    expect(r.ficha.lote).toEqual({ id: 'l1', nombre: 'Ordeñe' });
    const crias = r.eventos.eventos[0].parto?.crias;
    expect(crias).toEqual([
      { orden: 1, sexo: 'HEMBRA', nacidaMuerta: false, observaciones: 'Grande', animal: null, numeroPendiente: '901' },
      { orden: 2, sexo: 'MACHO', nacidaMuerta: true, observaciones: null, animal: null, numeroPendiente: null },
    ]);
    expect(r.eventos.situacion?.estado).toBe('SIN_SERVICIO'); // el parto reinicia el ciclo
  });

  it('si el parto pendiente se anula (otra entrada), ya no hay aviso de lote', () => {
    const p = parto('2026-11-10', [{ sexo: 'HEMBRA', numero: '901' }]);
    const a = pend('ANULACION', { eventoId: p.id, tipoEvento: 'PARTO', motivo: 'x' });
    expect(armar(vaca([], 'SECA'), [p, a]).ficha.locales?.avisoLotePendiente).toBe(false);
  });
});

describe('baja pendiente (RF-23)', () => {
  it.each([
    ['esperando', {}],
    ['enviando', { estado: 'enviando' as const }],
  ])('baja %s: estado BAJA y datos de la baja pendiente', (estado, cambios) => {
    const b = baja(cambios);
    const r = armar(vaca(), [b]);
    expect(r.ficha.estado).toBe('BAJA');
    expect(r.ficha.locales?.bajaPendiente).toMatchObject({ id: b.id, estado, fecha: '2026-11-12', resumen: 'Baja por venta' });
  });

  it('baja "en espera del anterior": figura como baja pendiente pero no cuenta en el estado', () => {
    const rechazado = servicio('2026-11-01', {}, { estado: 'rechazado', motivo: 'x', codigoRechazo: 409 });
    const b = baja();
    const r = armar(vaca(), [rechazado, b]);
    expect(r.ficha.locales?.bajaPendiente).toMatchObject({ id: b.id, estado: 'enEspera' });
    expect(r.ficha.estado).toBe('EN_ORDENE');
    expect(r.ficha.locales?.sinAceptar).toBe(2);
  });

  it('baja enviada (aceptada y la copia todavía no la refleja)', () => {
    const b = baja();
    const r = armar(vaca(), [], [env(b)]);
    expect(r.ficha.estado).toBe('BAJA');
    expect(r.ficha.locales?.bajaPendiente).toMatchObject({ id: b.id, estado: 'enviada' });
  });

  it('una baja rechazada no es baja pendiente: la ficha sigue normal y se avisa en la nota', () => {
    const b = baja({ estado: 'rechazado', motivo: 'x', codigoRechazo: 409 });
    const r = armar(vaca(), [b]);
    expect(r.ficha.estado).toBe('EN_ORDENE');
    expect(r.ficha.locales?.bajaPendiente).toBeUndefined();
    expect(r.ficha.locales?.sinAceptar).toBe(1);
  });

  it('una baja pendiente de otra vaca no afecta', () => {
    const r = armar(vaca(), [baja({ animalId: 'a2' })]);
    expect(r.ficha.estado).toBe('EN_ORDENE');
    expect(r.ficha.locales?.bajaPendiente).toBeUndefined();
  });
});

// ─── Spec 012: marcas del historial (RF-1 a RF-3) ───

describe('marcas del historial (spec 012, RF-1 a RF-3)', () => {
  const idsDeHistorial = (r: ReturnType<typeof armar>) => eventosEntrada(r.historial.entradas).map((e) => e.id);
  const deHistorial = (r: ReturnType<typeof armar>, id: string) => eventosEntrada(r.historial.entradas).find((e) => e.id === id);

  it('un pendiente esperando o enviando lleva la marca "pendiente"', () => {
    const a = servicio('2026-11-01');
    const b = tacto('2026-11-02', 'PRENADA', {}, { estado: 'enviando' });
    const r = armar(vaca(), [a, b]);
    expect(deHistorial(r, a.id)?.marca).toEqual({ estado: 'pendiente' });
    expect(deHistorial(r, b.id)?.marca).toEqual({ estado: 'pendiente' });
  });

  it('un enviado que la copia no trae lleva la marca "enviado"', () => {
    const s = servicio('2026-11-01');
    const r = armar(vaca(), [], [env(s)]);
    expect(deHistorial(r, s.id)?.marca).toEqual({ estado: 'enviado' });
  });

  it('un evento de la copia no lleva marca', () => {
    const s1 = evento('s1', 'SERVICIO', '2026-08-01');
    const copia = vaca([s1]);
    copia.historial = { ...copia.historial, total: 1, entradas: [{ clase: 'EVENTO', fecha: s1.fecha, registradoEn: s1.registradoEn, evento: s1 }] };
    expect(deHistorial(armar(copia), 's1')?.marca).toBeUndefined();
  });

  it('un rechazado aparece en el historial con su motivo, aunque no cuente en la vista', () => {
    const rech = tacto('2026-11-02', 'PRENADA', {}, { estado: 'rechazado', motivo: 'La fecha no puede ser futura', codigoRechazo: 400 });
    const r = armar(vaca(), [rech]);
    expect(idsDeHistorial(r)).toEqual([rech.id]);
    expect(deHistorial(r, rech.id)).toMatchObject({ tipo: 'TACTO', fecha: '2026-11-02', pendiente: true, marca: { estado: 'rechazado', motivo: 'La fecha no puede ser futura' } });
    expect(r.historial.total).toBe(1);
  });

  it('un "en espera del anterior" aparece con su marca', () => {
    const rech = servicio('2026-11-01', {}, { estado: 'rechazado', motivo: 'x' });
    const espera = tacto('2026-11-02', 'PRENADA');
    const r = armar(vaca(), [rech, espera]);
    expect(deHistorial(r, rech.id)?.marca).toEqual({ estado: 'rechazado', motivo: 'x' });
    expect(deHistorial(r, espera.id)?.marca).toEqual({ estado: 'enEspera' });
  });

  it('un rechazado y uno en espera NO cambian estado, situación ni el último no anulado (RF-3)', () => {
    const rech = secado('2026-11-01', { estado: 'rechazado', motivo: 'x' });
    const espera = parto('2026-11-05', [{ sexo: 'HEMBRA' }]);
    const base = armar(vaca([], 'EN_ORDENE'));
    const r = armar(vaca([], 'EN_ORDENE'), [rech, espera]);
    expect(r.ficha.estado).toBe('EN_ORDENE');
    expect(r.eventos).toEqual(base.eventos);
    expect(r.historial.ultimoEventoNoAnuladoId).toBe(base.historial.ultimoEventoNoAnuladoId);
    expect(r.ficha.locales?.avisoLotePendiente).toBe(false);
    expect(idsDeHistorial(r)).toHaveLength(2);
  });

  it('un rechazado se ubica por fecha entre los eventos de la copia', () => {
    const viejo = evento('s1', 'SERVICIO', '2026-08-01');
    const copia = vaca([viejo]);
    copia.historial = { ...copia.historial, total: 1, entradas: [{ clase: 'EVENTO', fecha: viejo.fecha, registradoEn: viejo.registradoEn, evento: viejo }] };
    const rech = tacto('2026-10-01', 'PRENADA', {}, { estado: 'rechazado', motivo: 'x' });
    expect(idsDeHistorial(armar(copia, [rech]))).toEqual([rech.id, 's1']);
  });

  it('una baja rechazada también figura en el historial', () => {
    const b = baja({ estado: 'rechazado', motivo: 'x', codigoRechazo: 404 });
    const r = armar(vaca(), [b]);
    expect(deHistorial(r, b.id)).toMatchObject({ tipo: 'BAJA', marca: { estado: 'rechazado' }, baja: { motivo: 'venta' } });
  });

  it('una anulación rechazada o en espera no es un evento: no se agrega', () => {
    const rech = pend('ANULACION', { eventoId: 'x', tipoEvento: 'SERVICIO', motivo: 'm' }, { estado: 'rechazado', motivo: 'x' });
    expect(idsDeHistorial(armar(vaca(), [rech]))).toEqual([]);
  });

  it('un parto ENVIADO tiene marca (así sus crías no se muestran como nacidas muertas)', () => {
    const p = parto('2026-11-05', [{ sexo: 'HEMBRA', numero: '99' }]);
    const e = deHistorial(armar(vaca([], 'SECA'), [], [env(p)]), p.id);
    expect(e?.pendiente).toBeUndefined();
    expect(e?.marca).toEqual({ estado: 'enviado' });
    expect(e?.parto?.crias[0]).toMatchObject({ animal: null, nacidaMuerta: false });
  });

  it('un pendiente de otra vaca no aparece', () => {
    const r = armar(vaca(), [tacto('2026-11-02', 'PRENADA', {}, { estado: 'rechazado', motivo: 'x', animalId: 'a2' })]);
    expect(idsDeHistorial(r)).toEqual([]);
  });
});

describe('anulación pendiente (spec 012, RF-2)', () => {
  const copiaCon = (s1: EventoReproductivo) => {
    const copia = vaca([s1]);
    copia.historial = { ...copia.historial, total: 1, ultimoEventoNoAnuladoId: s1.id, entradas: [{ clase: 'EVENTO', fecha: s1.fecha, registradoEn: s1.registradoEn, evento: s1 }] };
    return copia;
  };
  const anulacion = (cambios: Partial<Pendiente> = {}) => pend('ANULACION', { eventoId: 's1', tipoEvento: 'SERVICIO', motivo: 'error' }, cambios);

  it.each(['esperando', 'enviando'] as const)('una anulación %s marca el evento de la copia con anulacionPendiente', (estado) => {
    const r = armar(copiaCon(evento('s1', 'SERVICIO', '2026-08-01')), [anulacion({ estado })]);
    expect(eventosEntrada(r.historial.entradas)[0]).toMatchObject({ id: 's1', anulacionPendiente: true });
  });

  it('una anulación ENVIADA no marca (el evento ya se ve como "Anulado")', () => {
    const r = armar(copiaCon(evento('s1', 'SERVICIO', '2026-08-01')), [], [env(anulacion())]);
    const e = eventosEntrada(r.historial.entradas)[0]!;
    expect(e.anulacionPendiente).toBeUndefined();
    expect(e.anulacion).not.toBeNull();
  });

  it('también marca un evento pendiente (todavía no enviado) que se anuló', () => {
    const s = servicio('2026-11-01');
    const a = pend('ANULACION', { eventoId: s.id, tipoEvento: 'SERVICIO', motivo: 'error' });
    const r = armar(vaca(), [s, a]);
    expect(eventosEntrada(r.historial.entradas)[0]).toMatchObject({ id: s.id, anulacionPendiente: true, marca: { estado: 'pendiente' } });
  });

  it('sin anulación no hay marca', () => {
    const r = armar(copiaCon(evento('s1', 'SERVICIO', '2026-08-01')));
    expect(eventosEntrada(r.historial.entradas)[0]!.anulacionPendiente).toBeUndefined();
  });
});
