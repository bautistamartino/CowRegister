import { describe, expect, it } from 'vitest';
import type { Enviado } from '../src/sinconexion/almacen';
import { ayudaRechazo, resumenAviso, resumenCompleto, resumenPendiente } from '../src/sinconexion/resumenPendiente';
import { pendiente } from './ayudas';

// Texto de resumen de un pendiente (spec 011, RF-16).

const crias = (...c: { sexo: string; nacidaMuerta?: boolean }[]) => ({ crias: c });

describe('resumenPendiente', () => {
  it('servicio, tacto y secado', () => {
    expect(resumenPendiente('SERVICIO', { fecha: '2026-11-01', tipo: 'INSEMINACION' })).toBe('Servicio');
    expect(resumenPendiente('TACTO', { resultado: 'PRENADA' })).toBe('Tacto preñada');
    expect(resumenPendiente('TACTO', { resultado: 'VACIA' })).toBe('Tacto vacía');
    expect(resumenPendiente('SECADO', {})).toBe('Secado');
  });

  it('parto con una o dos crías', () => {
    expect(resumenPendiente('PARTO', crias({ sexo: 'HEMBRA' }))).toBe('Parto con 1 cría');
    expect(resumenPendiente('PARTO', crias({ sexo: 'HEMBRA' }, { sexo: 'MACHO' }))).toBe('Parto con 2 crías');
  });

  it('parto con nacidas muertas', () => {
    expect(resumenPendiente('PARTO', crias({ sexo: 'HEMBRA' }, { sexo: 'MACHO', nacidaMuerta: true }))).toBe('Parto con 2 crías (1 nacida muerta)');
    expect(resumenPendiente('PARTO', crias({ sexo: 'HEMBRA', nacidaMuerta: true }, { sexo: 'MACHO', nacidaMuerta: true }))).toBe('Parto con 2 crías (2 nacidas muertas)');
    expect(resumenPendiente('PARTO', crias({ sexo: 'HEMBRA', nacidaMuerta: true }))).toBe('Parto con 1 cría (nacida muerta)');
  });

  it('parto sin crías en los datos no rompe', () => {
    expect(resumenPendiente('PARTO', {})).toBe('Parto');
  });

  it('baja por venta y por muerte', () => {
    expect(resumenPendiente('BAJA', { motivo: 'venta' })).toBe('Baja por venta');
    expect(resumenPendiente('BAJA', { motivo: 'muerte' })).toBe('Baja por muerte');
  });

  it('anulación de cada tipo', () => {
    expect(resumenPendiente('ANULACION', { tipoEvento: 'SERVICIO' })).toBe('Anulación de servicio');
    expect(resumenPendiente('ANULACION', { tipoEvento: 'TACTO' })).toBe('Anulación de tacto');
    expect(resumenPendiente('ANULACION', { tipoEvento: 'PARTO' })).toBe('Anulación de parto');
    expect(resumenPendiente('ANULACION', { tipoEvento: 'SECADO' })).toBe('Anulación de secado');
  });

  it('litros', () => {
    expect(resumenPendiente('LITROS', { fecha: '2026-11-12', turno: 'manana', litros: '12.5' })).toBe('Litros');
  });
});

// Spec 012 (RF-8, RF-10, RF-11): resumen completo, resumen de un aviso y ayuda ante el rechazo por vaca no activa.

describe('resumenCompleto (RF-8)', () => {
  const de = (tipo: Parameters<typeof resumenPendiente>[0], datos: Record<string, unknown>, numero = '214') => ({ tipo, datos, numero });

  it('cada tipo con el número de la vaca', () => {
    expect(resumenCompleto(de('SERVICIO', { fecha: '2026-11-01' }))).toBe('Vaca 214 · Servicio');
    expect(resumenCompleto(de('TACTO', { resultado: 'PRENADA' }))).toBe('Vaca 214 · Tacto preñada');
    expect(resumenCompleto(de('TACTO', { resultado: 'VACIA' }))).toBe('Vaca 214 · Tacto vacía');
    expect(resumenCompleto(de('SECADO', {}))).toBe('Vaca 214 · Secado');
    expect(resumenCompleto(de('BAJA', { motivo: 'muerte' }))).toBe('Vaca 214 · Baja por muerte');
    expect(resumenCompleto(de('ANULACION', { tipoEvento: 'PARTO' }))).toBe('Vaca 214 · Anulación de parto');
  });

  it('parto con crías y nacidas muertas', () => {
    expect(resumenCompleto(de('PARTO', crias({ sexo: 'HEMBRA' }, { sexo: 'MACHO', nacidaMuerta: true })))).toBe('Vaca 214 · Parto con 2 crías (1 nacida muerta)');
  });

  it('litros: vaca, fecha, turno y litros', () => {
    expect(resumenCompleto(de('LITROS', { fecha: '2026-11-12', turno: 'manana', litros: '12.5' }))).toBe('Vaca 214 · 12/11/2026 · Mañana · 12,5 L');
  });
});

describe('resumenAviso (RF-10)', () => {
  const aviso = { id: 'p-1', numero: '214', tipo: 'PARTO' as const };

  it('con el enviado a mano usa el resumen completo', () => {
    const e = { id: 'p-1', numero: '214', tipo: 'PARTO', datos: crias({ sexo: 'HEMBRA' }) } as unknown as Enviado;
    expect(resumenAviso(aviso, [e])).toBe('Vaca 214 · Parto con 1 cría');
  });

  it('sin el enviado usa el texto del tipo', () => {
    expect(resumenAviso(aviso, [])).toBe('Vaca 214 · Parto');
    expect(resumenAviso({ id: 'x', numero: '9', tipo: 'TACTO' }, [])).toBe('Vaca 9 · Tacto');
    expect(resumenAviso({ id: 'x', numero: '9', tipo: 'ANULACION' }, [])).toBe('Vaca 9 · Anulación');
  });

  it('un enviado con otro id no se usa', () => {
    const otro = { id: 'otro', numero: '214', tipo: 'PARTO', datos: crias({ sexo: 'HEMBRA' }) } as unknown as Enviado;
    expect(resumenAviso(aviso, [otro])).toBe('Vaca 214 · Parto');
  });
});

describe('ayudaRechazo (RF-11)', () => {
  const rechazado = (codigoRechazo: number | null, estado: 'rechazado' | 'esperando' = 'rechazado') => pendiente({ estado, codigoRechazo, motivo: 'x' });

  it('con un rechazo 404 explica que puede estar dado de baja', () => {
    expect(ayudaRechazo(rechazado(404))).toBe('Puede que el animal haya sido dado de baja: actualizá los datos y revisá su historial');
  });

  it('con otros códigos, sin código o sin estar rechazado: null', () => {
    expect(ayudaRechazo(rechazado(409))).toBeNull();
    expect(ayudaRechazo(rechazado(400))).toBeNull();
    expect(ayudaRechazo(rechazado(null))).toBeNull();
    expect(ayudaRechazo(rechazado(404, 'esperando'))).toBeNull();
  });
});
