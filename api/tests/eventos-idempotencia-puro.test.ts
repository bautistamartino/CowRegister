import { describe, expect, it } from 'vitest';
import {
  esMismoEvento,
  mismasAnomalias,
  type EventoGuardado,
  type PedidoEvento,
} from '../src/reproduccion/idempotencia.js';

// Spec 010, RF-5: "mismos datos" de un reenvío, por tipo. Son funciones puras (sin base de datos).

const ANIMAL = '11111111-1111-7111-8111-111111111111';
const USUARIO = '22222222-2222-7222-8222-222222222222';
const SEMEN = '33333333-3333-7333-8333-333333333333';

const comunes = { animalId: ANIMAL, registradoPorId: USUARIO, fecha: '2026-11-01' };
const pedido = { animalId: ANIMAL, usuarioId: USUARIO, fecha: '2026-11-01' };

describe('mismasAnomalias: el campo es texto libre y se compara como conjunto', () => {
  it('ignora el orden, los espacios y los vacíos; separa por coma o punto y coma', () => {
    expect(mismasAnomalias('quiste, retención', 'retención;quiste')).toBe(true);
    expect(mismasAnomalias(' quiste ,, retención ', 'retención, quiste')).toBe(true);
    expect(mismasAnomalias('quiste', 'quiste, retención')).toBe(false);
  });
  it('null, ausente y vacío son lo mismo', () => {
    expect(mismasAnomalias(null, '')).toBe(true);
    expect(mismasAnomalias(null, undefined)).toBe(true);
    expect(mismasAnomalias(null, 'quiste')).toBe(false);
  });
});

describe('comunes a todos los tipos', () => {
  const guardado: EventoGuardado = { ...comunes, tipo: 'SECADO' };
  const igual: PedidoEvento = { ...pedido, tipo: 'SECADO' };

  it('mismo animal, usuario, tipo y fecha', () => {
    expect(esMismoEvento(guardado, igual)).toBe(true);
  });
  it('otro animal, otro usuario, otra fecha u otro tipo no es el mismo', () => {
    expect(esMismoEvento(guardado, { ...igual, animalId: SEMEN })).toBe(false);
    expect(esMismoEvento(guardado, { ...igual, usuarioId: SEMEN })).toBe(false);
    expect(esMismoEvento(guardado, { ...igual, fecha: '2026-11-02' })).toBe(false);
    expect(esMismoEvento(guardado, { ...pedido, tipo: 'BAJA', motivo: 'venta', observaciones: null })).toBe(false);
  });
});

describe('servicio: fecha, tipo y semen (null, ausente y vacío son lo mismo)', () => {
  const guardado = (semenId: string | null): EventoGuardado => ({
    ...comunes,
    tipo: 'SERVICIO',
    servicio: { tipoServicio: 'INSEMINACION', semenId },
  });
  const pide = (semenId?: string | null, tipoServicio: 'INSEMINACION' | 'MONTA_NATURAL' = 'INSEMINACION'): PedidoEvento => ({
    ...pedido,
    tipo: 'SERVICIO',
    tipoServicio,
    semenId,
  });

  it('sin semen en ningún lado', () => {
    expect(esMismoEvento(guardado(null), pide(null))).toBe(true);
    expect(esMismoEvento(guardado(null), pide(undefined))).toBe(true);
  });
  it('con el mismo semen (sin importar mayúsculas del uuid)', () => {
    expect(esMismoEvento(guardado(SEMEN), pide(SEMEN.toUpperCase()))).toBe(true);
  });
  it('otro semen, semen donde no había o tipo distinto', () => {
    expect(esMismoEvento(guardado(SEMEN), pide(null))).toBe(false);
    expect(esMismoEvento(guardado(null), pide(SEMEN))).toBe(false);
    expect(esMismoEvento(guardado(null), pide(null, 'MONTA_NATURAL'))).toBe(false);
  });
});

describe('tacto: fecha, resultado, fecha probable y anomalías como conjunto', () => {
  const guardado: EventoGuardado = {
    ...comunes,
    tipo: 'TACTO',
    tacto: { resultado: 'PRENADA', fechaProbableIndicada: '2027-05-01', anomalias: 'quiste, retención' },
  };
  const pide = (cambios: Partial<Extract<PedidoEvento, { tipo: 'TACTO' }>> = {}): PedidoEvento => ({
    ...pedido,
    tipo: 'TACTO',
    resultado: 'PRENADA',
    fechaProbableParto: '2027-05-01',
    anomalias: 'retención; quiste',
    ...cambios,
  });

  it('anomalías en otro orden: mismo tacto', () => {
    expect(esMismoEvento(guardado, pide())).toBe(true);
  });
  it('otro resultado, otra fecha probable o anomalías distintas', () => {
    expect(esMismoEvento(guardado, pide({ resultado: 'VACIA', fechaProbableParto: null }))).toBe(false);
    expect(esMismoEvento(guardado, pide({ fechaProbableParto: '2027-05-02' }))).toBe(false);
    expect(esMismoEvento(guardado, pide({ anomalias: 'quiste' }))).toBe(false);
  });
  it('fecha probable null y ausente son lo mismo', () => {
    const sin: EventoGuardado = { ...guardado, tacto: { resultado: 'VACIA', fechaProbableIndicada: null, anomalias: null } };
    expect(esMismoEvento(sin, pide({ resultado: 'VACIA', fechaProbableParto: undefined, anomalias: null }))).toBe(true);
  });
});

describe('parto: crías en el orden enviado', () => {
  const guardado: EventoGuardado = {
    ...comunes,
    tipo: 'PARTO',
    parto: {
      crias: [
        { sexo: 'HEMBRA', nacidaMuerta: false, numero: 'C1', observaciones: null },
        { sexo: 'MACHO', nacidaMuerta: true, numero: null, observaciones: 'débil' },
      ],
    },
  };
  const cria1 = { sexo: 'HEMBRA' as const, nacidaMuerta: false, numero: 'C1', observaciones: null };
  const cria2 = { sexo: 'MACHO' as const, nacidaMuerta: true, numero: undefined, observaciones: 'débil' };

  it('mismas crías en el mismo orden', () => {
    expect(esMismoEvento(guardado, { ...pedido, tipo: 'PARTO', crias: [cria1, cria2] })).toBe(true);
  });
  it('las mismas crías en distinto orden son otro parto', () => {
    expect(esMismoEvento(guardado, { ...pedido, tipo: 'PARTO', crias: [cria2, cria1] })).toBe(false);
  });
  it('otro número, otro sexo, otra cantidad u observaciones distintas', () => {
    expect(esMismoEvento(guardado, { ...pedido, tipo: 'PARTO', crias: [{ ...cria1, numero: 'C2' }, cria2] })).toBe(false);
    expect(esMismoEvento(guardado, { ...pedido, tipo: 'PARTO', crias: [{ ...cria1, sexo: 'MACHO' }, cria2] })).toBe(false);
    expect(esMismoEvento(guardado, { ...pedido, tipo: 'PARTO', crias: [cria1] })).toBe(false);
    expect(esMismoEvento(guardado, { ...pedido, tipo: 'PARTO', crias: [cria1, { ...cria2, observaciones: undefined }] })).toBe(false);
  });
});

describe('baja: fecha, motivo y observaciones (null y vacío son lo mismo)', () => {
  const guardado: EventoGuardado = { ...comunes, tipo: 'BAJA', baja: { motivo: 'VENTA', observaciones: null } };
  it('misma baja', () => {
    expect(esMismoEvento(guardado, { ...pedido, tipo: 'BAJA', motivo: 'venta', observaciones: null })).toBe(true);
    expect(esMismoEvento(guardado, { ...pedido, tipo: 'BAJA', motivo: 'venta', observaciones: '' })).toBe(true);
  });
  it('otro motivo u observaciones', () => {
    expect(esMismoEvento(guardado, { ...pedido, tipo: 'BAJA', motivo: 'muerte', observaciones: null })).toBe(false);
    expect(esMismoEvento(guardado, { ...pedido, tipo: 'BAJA', motivo: 'venta', observaciones: 'x' })).toBe(false);
  });
});
