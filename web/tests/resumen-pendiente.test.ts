import { describe, expect, it } from 'vitest';
import { resumenPendiente } from '../src/sinconexion/resumenPendiente';

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
