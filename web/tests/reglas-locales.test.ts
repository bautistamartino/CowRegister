import { describe, expect, it } from 'vitest';
import type { AnimalCopia, EventoReproductivo, Rol } from '../src/compartido/api';
import type { Pendiente } from '../src/sinconexion/almacen';
import { validarCarga, type Carga, type ContextoReglas } from '../src/sinconexion/reglasLocales';
import { construirVista, entradasValidas, numerosEnUso } from '../src/sinconexion/vistaLocal';
import { pendiente, vacaCopia } from './ayudas';

// Reglas locales (spec 010, RF-20 a RF-22). La paridad con la API se prueba en casos-compartidos.test.ts; acá
// van las particularidades de la tablet: el orden de los controles, el semen que puede faltar en la copia y el
// número de cría respecto de las bajas cargadas antes o después.

const HOY = '2026-11-12';

function evento(id: string, tipo: EventoReproductivo['tipo'], fecha: string, extra: Partial<EventoReproductivo> = {}): EventoReproductivo {
  return {
    id,
    tipo,
    fecha,
    registradoPor: 'Dueño',
    registradoEn: `${fecha}T12:00:00.000Z`,
    anulacion: null,
    servicio: null,
    tacto: tipo === 'TACTO' ? { resultado: 'PRENADA', fechaProbableIndicada: null, fechaProbable: null, anomalias: null } : null,
    parto: null,
    secado: null,
    baja: null,
    ...extra,
  };
}

function vaca(eventos: EventoReproductivo[] = [], id = 'a1', numero = '12'): AnimalCopia {
  const v = vacaCopia(id, numero);
  return { ...v, ficha: { ...v.ficha, fechaNacimiento: '2022-01-10' }, eventos: { situacion: null, eventos } };
}

let contador = 0;
const pend = (tipo: Pendiente['tipo'], datos: Record<string, unknown>, cambios: Partial<Pendiente> = {}) => {
  contador += 1;
  return pendiente({ id: `p-${contador}`, tipo, datos, orden: contador, ...cambios });
};

type Opciones = { rol?: Rol; animales?: AnimalCopia[]; pendientes?: Pendiente[]; semen?: ContextoReglas['semen']; ordenNuevo?: number };

// Valida `carga` sobre la vaca "a1" de la copia (más las demás de `animales`).
function validar(carga: Carga, { rol = 'DUENO', animales = [vaca()], pendientes = [], semen, ordenNuevo }: Opciones = {}) {
  const entradas = entradasValidas(pendientes, []);
  const animal = animales.find((a) => a.ficha.id === 'a1')!;
  return validarCarga(carga, construirVista(animal, entradas, HOY), { hoy: HOY, rol, semen, numeros: numerosEnUso(animales, entradas, ordenNuevo) });
}

const parto = (numero: string): Carga => ({ tipo: 'PARTO', datos: { fecha: '2026-11-10', crias: [{ sexo: 'HEMBRA', numero }] } });

describe('el orden de los controles', () => {
  it('el permiso por rol va antes que la forma del pedido (como en la API: 403 antes que 400)', () => {
    expect(validar({ tipo: 'PARTO', datos: {} }, { rol: 'VETERINARIO' })).toMatchObject({ ok: false, codigo: 403 });
    expect(validar({ tipo: 'PARTO', datos: {} })).toMatchObject({ ok: false, codigo: 400, campo: 'fecha' });
  });

  it('una vaca con baja pendiente da 404 después de la forma del pedido (400) y antes de las fechas', () => {
    const baja = pend('BAJA', { motivo: 'venta', fecha: '2026-11-10' });
    expect(validar({ tipo: 'SECADO', datos: { fecha: '2026-02-31' } }, { pendientes: [baja] })).toMatchObject({ codigo: 400, campo: 'fecha' });
    expect(validar({ tipo: 'SECADO', datos: { fecha: '2026-11-13' } }, { pendientes: [baja] })).toMatchObject({ codigo: 404, mensaje: 'Animal no encontrado' });
  });

  it('con datos vacíos, cada tipo se rechaza con 400 y sin romper', () => {
    for (const tipo of ['SERVICIO', 'TACTO', 'PARTO', 'SECADO', 'BAJA'] as const) {
      expect(validar({ tipo, datos: {} }), tipo).toMatchObject({ ok: false, codigo: 400 });
    }
  });

  it('un rechazo trae el código, el mensaje y el campo; un ok, solo ok', () => {
    expect(validar({ tipo: 'SERVICIO', datos: { fecha: '2026-11-20', tipo: 'INSEMINACION' } })).toEqual({ ok: false, codigo: 400, mensaje: 'La fecha no puede ser futura', campo: 'fecha' });
    expect(validar({ tipo: 'SERVICIO', datos: { fecha: '2026-11-01', tipo: 'INSEMINACION' } })).toEqual({ ok: true });
  });
});

describe('semen de la copia (RF-20)', () => {
  const servicio = (semenId: unknown): Carga => ({ tipo: 'SERVICIO', datos: { fecha: '2026-11-01', tipo: 'INSEMINACION', semenId } });

  it('un semen que no está entre los activos de la copia se rechaza como desactivado', () => {
    expect(validar(servicio('sm9'), { semen: [{ id: 'sm1', nombre: 'Alfa', raza: null }] })).toMatchObject({ ok: false, codigo: 409, mensaje: 'El semen o toro está desactivado: elegí otro o reactivalo' });
  });

  it('uno activo, vacío o ausente se acepta', () => {
    const semen = [{ id: 'sm1', nombre: 'Alfa', raza: null }];
    expect(validar(servicio('sm1'), { semen })).toEqual({ ok: true });
    expect(validar(servicio(''), { semen })).toEqual({ ok: true });
    expect(validar(servicio(null), { semen })).toEqual({ ok: true });
  });

  it('si la copia no trae semen (es anterior a la 010), la regla no se aplica y decide el servidor', () => {
    expect(validar(servicio('sm9'), { semen: undefined })).toEqual({ ok: true });
  });
});

describe('número de cría contra bajas pendientes (RF-21)', () => {
  const otra = vaca([], 'a2', '7');

  it('ocupado por un animal activo de la copia', () => {
    expect(validar(parto('7'), { animales: [vaca(), otra] })).toEqual({ ok: false, codigo: 409, mensaje: 'Ya existe un animal activo con ese número', campo: 'crias.0.numero' });
  });

  it('libre si el animal tiene una baja cargada ANTES (lo normal: se carga y queda al final de la cola)', () => {
    const baja = pend('BAJA', { motivo: 'venta', fecha: '2026-11-08' }, { animalId: 'a2', numero: '7', orden: 3 });
    expect(validar(parto('7'), { animales: [vaca(), otra], pendientes: [baja] })).toEqual({ ok: true });
  });

  it('ocupado si la baja es POSTERIOR al pendiente que se valida (el servidor lo procesaría antes de que el número se libere)', () => {
    const baja = pend('BAJA', { motivo: 'venta', fecha: '2026-11-08' }, { animalId: 'a2', numero: '7', orden: 9 });
    expect(validar(parto('7'), { animales: [vaca(), otra], pendientes: [baja], ordenNuevo: 4 })).toMatchObject({ ok: false, codigo: 409, campo: 'crias.0.numero' });
  });

  it('ocupado por la cría de un parto pendiente de otra vaca', () => {
    const p = pend('PARTO', { fecha: '2026-11-05', crias: [{ sexo: 'HEMBRA', numero: 'C9' }] }, { animalId: 'a2', numero: '7' });
    expect(validar(parto('C9'), { animales: [vaca(), otra], pendientes: [p] })).toMatchObject({ ok: false, codigo: 409 });
  });
});

describe('anulaciones (RF-20)', () => {
  const anular = (eventoId: string, tipoEvento: string, motivo = 'Error'): Carga => ({ tipo: 'ANULACION', datos: { eventoId, tipoEvento, motivo } });

  it('un tipo de evento que no se puede anular es "no encontrado", sin importar el rol', () => {
    expect(validar(anular('x', 'BAJA'), { rol: 'VETERINARIO' })).toMatchObject({ ok: false, codigo: 404, mensaje: 'Evento no encontrado' });
  });

  it('el permiso depende del tipo del evento: el veterinario anula un tacto pero no un secado', () => {
    const animales = [vaca([evento('t1', 'TACTO', '2026-10-01')])];
    expect(validar(anular('t1', 'TACTO'), { rol: 'VETERINARIO', animales })).toEqual({ ok: true });
    expect(validar(anular('t1', 'SECADO'), { rol: 'VETERINARIO', animales })).toMatchObject({ ok: false, codigo: 403 });
  });

  it('se puede anular un evento todavía pendiente (la pantalla lo resuelve descartándolo)', () => {
    const p = pend('SERVICIO', { fecha: '2026-11-01', tipo: 'INSEMINACION' });
    expect(validar(anular(p.id, 'SERVICIO'), { pendientes: [p] })).toEqual({ ok: true });
  });

  it('un evento ya anulado da 409', () => {
    const animales = [vaca([evento('t1', 'TACTO', '2026-10-01', { anulacion: { motivo: 'x', por: 'Dueño', en: '2026-10-02T12:00:00.000Z' } })])];
    expect(validar(anular('t1', 'TACTO'), { animales })).toMatchObject({ ok: false, codigo: 409, mensaje: 'Este tacto ya fue anulado' });
  });

  it('el motivo se mide sin contar los extremos', () => {
    const animales = [vaca([evento('t1', 'TACTO', '2026-10-01')])];
    expect(validar(anular('t1', 'TACTO', `  ${'x'.repeat(200)}  `), { animales })).toEqual({ ok: true });
    expect(validar(anular('t1', 'TACTO', 'x'.repeat(201)), { animales })).toMatchObject({ ok: false, codigo: 400, campo: 'motivo' });
  });
});

describe('tacto: la fecha probable sale del ciclo (RF-20)', () => {
  it('un segundo tacto "preñada" sin fecha usa la que indicó el anterior del mismo ciclo', () => {
    const animales = [vaca([evento('t1', 'TACTO', '2026-09-01', { tacto: { resultado: 'PRENADA', fechaProbableIndicada: '2027-05-01', fechaProbable: '2027-05-01', anomalias: null } })])];
    expect(validar({ tipo: 'TACTO', datos: { fecha: '2026-10-01', resultado: 'PRENADA' } }, { animales })).toEqual({ ok: true });
  });

  it('sin servicio ni fecha indicada se exige la fecha', () => {
    expect(validar({ tipo: 'TACTO', datos: { fecha: '2026-10-01', resultado: 'PRENADA' } })).toMatchObject({ ok: false, codigo: 400, campo: 'fechaProbableParto' });
  });
});
