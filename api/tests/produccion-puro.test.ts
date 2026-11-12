import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decimasALitros, redondearDecimas } from '../src/produccion/formato.js';
import { cargaSchema, litrosADecimas } from '../src/produccion/validacion.js';
import { sugerirOrdeno } from '../src/produccion/sugerencia.js';
import { fijarReloj } from '../src/reloj.js';

// Spec 008: funciones puras de la producción (litros exactos, validación del cuerpo, sugerencia).
// RF-2, RF-3, RF-4, RF-30 y RF-37.

afterEach(() => fijarReloj(null));

describe('litros a décimas enteras (RF-2, RF-3, RF-37)', () => {
  it.each([
    ['5.0', 50],
    ['5', 50],
    ['0', 0],
    ['0.0', 0],
    ['12.5', 125],
    ['99.9', 999],
    ['05', 50],
    [5, 50],
    [0, 0],
    [99.9, 999],
    [0.1, 1],
    [12.5, 125],
  ])('acepta %j y da %i décimas', (valor, decimas) => {
    expect(litrosADecimas(valor)).toEqual({ ok: true, decimas });
  });

  it.each([
    ['5.00', /un solo decimal/],
    ['5,0', /número/],
    ['5.', /número/],
    ['.5', /número/],
    ['1e1', /número/],
    ['+5', /número/],
    ['abc', /número/],
    ['5 ', /número/],
    [-1, /negativos/],
    ['-1', /negativos/],
    ['-0.5', /negativos/],
    [100, /99,9/],
    ['100', /99,9/],
    ['100.0', /99,9/],
    [99.95, /un solo decimal/],
    [0.1 + 0.2, /un solo decimal/], // 0.30000000000000004
    [1e21, /número/], // notación científica al pasarlo a texto
    ['', /obligatorios/],
    ['   ', /obligatorios/],
    [undefined, /obligatorios/],
    [null, /obligatorios/],
    [true, /número/],
    [{}, /número/],
    [[5], /número/],
  ])('rechaza %j con un mensaje que dice el motivo', (valor, mensaje) => {
    const r = litrosADecimas(valor);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toMatch(mensaje);
  });

  it('decimasALitros devuelve litros con un decimal', () => {
    expect(decimasALitros(125)).toBe(12.5);
    expect(decimasALitros(3)).toBe(0.3);
    expect(decimasALitros(0)).toBe(0);
  });
});

describe('redondeo exacto con enteros (RF-37)', () => {
  it('un promedio de 12,25 se muestra 12,3 (medio punto hacia arriba)', () => {
    // 24,5 L en 2 días = 245 décimas / 2 = 122,5 décimas -> 123
    expect(redondearDecimas(245, 2)).toBe(123);
    expect(decimasALitros(redondearDecimas(245, 2)!)).toBe(12.3);
  });

  it('0,1 + 0,2 da exactamente 0,3', () => {
    const suma = litrosADecimas('0.1') as { decimas: number };
    const otra = litrosADecimas('0.2') as { decimas: number };
    expect(decimasALitros(suma.decimas + otra.decimas)).toBe(0.3);
    expect(redondearDecimas(suma.decimas + otra.decimas, 1)).toBe(3);
  });

  it('sin base devuelve null (nunca 0)', () => {
    expect(redondearDecimas(0, 0)).toBeNull();
    expect(redondearDecimas(100, 0)).toBeNull();
  });

  it('con base, el cero es un valor', () => {
    expect(redondearDecimas(0, 3)).toBe(0);
  });

  it('el medio punto va hacia arriba y lo de abajo del medio hacia abajo', () => {
    expect(redondearDecimas(5, 2)).toBe(3); // 2,5 -> 3
    expect(redondearDecimas(4, 3)).toBe(1); // 1,33 -> 1
    expect(redondearDecimas(5, 3)).toBe(2); // 1,67 -> 2
    expect(redondearDecimas(14, 3)).toBe(5); // 4,67 -> 5
  });
});

describe('cuerpo de la carga (RF-4)', () => {
  // 12:00 ART del 11/11/2026 antes de cada caso.
  beforeEach(() => fijarReloj(new Date('2026-11-11T15:00:00Z')));
  const ok = { fecha: '2026-11-11', turno: 'manana', litros: '12.5' };

  it('acepta un cuerpo válido, con y sin id, y pasa los litros a décimas', () => {
    const r = cargaSchema.parse(ok);
    expect(r).toMatchObject({ fecha: '2026-11-11', turno: 'MANANA', litrosDecimas: 125 });
    expect(r.id).toBeUndefined();
    const id = 'c0a8012e-7b2f-4c4b-9d6e-0a1b2c3d4e5f';
    expect(cargaSchema.parse({ ...ok, turno: 'tarde', id }).id).toBe(id);
  });

  it.each([
    ['fecha inexistente', { fecha: '2026-02-31' }],
    ['fecha futura', { fecha: '2026-11-12' }],
    ['fecha anterior a 2000', { fecha: '1999-12-31' }],
    ['fecha ausente', { fecha: undefined }],
    ['turno inválido', { turno: 'noche' }],
    ['turno con eñe', { turno: 'mañana' }],
    ['turno ausente', { turno: undefined }],
    ['id que no es UUID', { id: 'abc' }],
    ['litros inválidos', { litros: '5.00' }],
    ['litros ausentes', { litros: undefined }],
  ])('rechaza: %s', (_nombre, cambio) => {
    expect(cargaSchema.safeParse({ ...ok, ...cambio }).success).toBe(false);
  });

  it('hoy argentino se acepta aunque en UTC ya sea mañana', () => {
    fijarReloj(new Date('2026-11-12T01:00:00Z')); // 22:00 ART del 11
    expect(cargaSchema.safeParse({ ...ok, fecha: '2026-11-11' }).success).toBe(true);
    expect(cargaSchema.safeParse({ ...ok, fecha: '2026-11-12' }).success).toBe(false);
  });

  it('ignora un establecimientoId enviado', () => {
    const r = cargaSchema.parse({ ...ok, establecimientoId: 'x' });
    expect(r).not.toHaveProperty('establecimientoId');
  });
});

describe('fecha y turno sugeridos (RF-30)', () => {
  it.each([
    ['2026-11-11T15:00:00Z', '2026-11-11', 'manana'], // 12:00 ART
    ['2026-11-11T16:59:00Z', '2026-11-11', 'manana'], // 13:59 ART
    ['2026-11-11T17:00:00Z', '2026-11-11', 'tarde'], // 14:00 ART
    ['2026-11-12T01:00:00Z', '2026-11-11', 'tarde'], // 22:00 ART del 11, ya es 12 en UTC
    ['2026-11-11T03:00:00Z', '2026-11-11', 'manana'], // 00:00 ART
    ['2026-11-11T02:59:00Z', '2026-11-10', 'tarde'], // 23:59 ART del 10
  ])('a las %s sugiere %s y %s', (instante, fecha, turno) => {
    expect(sugerirOrdeno(new Date(instante))).toEqual({ fecha, turno });
  });
});
