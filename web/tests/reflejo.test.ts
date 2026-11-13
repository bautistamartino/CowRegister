import { describe, expect, it } from 'vitest';
import type { AnimalCopia, EventoReproductivo } from '../src/compartido/api';
import type { Enviado, TipoPendiente } from '../src/sinconexion/almacen';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import { enviadosReflejados, estaReflejado, limpiarEnviadosReflejados, MARGEN_REFLEJO_MS } from '../src/sinconexion/reflejo';
import { persona, vacaCopia } from './ayudas';

// Qué enviados ya refleja la copia (spec 010, RF-19): por tipo y por antigüedad (con el margen de 10 minutos).

const ACEPTADO = Date.parse('2026-11-12T12:00:00.000Z');
const COPIA_JUSTO_DESPUES = '2026-11-12T12:05:00.000Z'; // 5 minutos después: dentro del margen
const COPIA_MUCHO_DESPUES = '2026-11-12T12:11:00.000Z'; // 11 minutos después: fuera del margen

function evento(id: string, tipo: EventoReproductivo['tipo'], anulado = false): EventoReproductivo {
  return {
    id,
    tipo,
    fecha: '2026-11-10',
    registradoPor: 'Dueño',
    registradoEn: '2026-11-12T12:00:00.000Z',
    anulacion: anulado ? { motivo: 'x', por: 'Dueño', en: '2026-11-12T12:01:00.000Z' } : null,
    servicio: null,
    tacto: null,
    parto: null,
    secado: null,
    baja: null,
  };
}

function copiaCon(eventos: EventoReproductivo[], animalId = 'a1'): AnimalCopia {
  const v = vacaCopia(animalId, '12');
  return { ...v, eventos: { situacion: null, eventos } };
}

function enviadoDe(tipo: TipoPendiente, id: string, datos: Record<string, unknown> = {}, animalId = 'a1'): Enviado {
  return { id, usuarioId: persona.usuarioId, establecimientoId: persona.establecimientoId, animalId, numero: '12', tipo, datos, aceptadoEn: ACEPTADO, registro: null };
}

const reflejado = (e: Enviado, animales: AnimalCopia[], generadaEn = COPIA_JUSTO_DESPUES) => estaReflejado(e, { generadaEn, animales });

describe('estaReflejado: por tipo', () => {
  it.each(['SERVICIO', 'TACTO', 'PARTO', 'SECADO'] as const)('%s: se quita cuando la copia trae el evento con su id', (tipo) => {
    const e = enviadoDe(tipo, 'e1');
    expect(reflejado(e, [copiaCon([])])).toBe(false);
    expect(reflejado(e, [copiaCon([evento('e1', tipo)])])).toBe(true);
    expect(reflejado(e, [copiaCon([evento('otro', tipo)])])).toBe(false);
  });

  it('anulación: se quita cuando la copia trae ese evento ya anulado', () => {
    const e = enviadoDe('ANULACION', 'an1', { eventoId: 's1', tipoEvento: 'SERVICIO', motivo: 'x' });
    expect(reflejado(e, [copiaCon([evento('s1', 'SERVICIO', false)])])).toBe(false);
    expect(reflejado(e, [copiaCon([evento('s1', 'SERVICIO', true)])])).toBe(true);
  });

  it('baja: se quita cuando la copia ya no incluye al animal', () => {
    const e = enviadoDe('BAJA', 'b1');
    expect(reflejado(e, [copiaCon([])])).toBe(false); // el animal sigue en la copia
    expect(reflejado(e, [copiaCon([], 'otra-vaca')])).toBe(true); // ya no está
    expect(reflejado(e, [])).toBe(true);
  });

  it('litros: se quita cuando la copia trae el registro con su id, como en la 009', () => {
    const e = enviadoDe('LITROS', 'l1', { fecha: '2026-11-12', turno: 'manana', litros: '10' });
    const sin = copiaCon([]);
    const con: AnimalCopia = { ...sin, produccion: { ...sin.produccion, registros: [{ id: 'l1', animalId: 'a1', fecha: '2026-11-12', turno: 'manana', litros: 10, loteNombre: null, registradoPor: 'Dueño', registradoEn: '2026-11-12T12:00:00.000Z', anulado: null }] } };
    expect(reflejado(e, [sin])).toBe(false);
    expect(reflejado(e, [con])).toBe(true);
  });

  it('cualquier tipo: se quita si el animal ya no está en la copia', () => {
    expect(reflejado(enviadoDe('SERVICIO', 'e1'), [])).toBe(true);
  });
});

describe('estaReflejado: por antigüedad (margen de 10 minutos)', () => {
  it('dentro del margen no se quita aunque la copia no lo traiga (la foto se toma un instante antes de su fecha)', () => {
    expect(reflejado(enviadoDe('SERVICIO', 'e1'), [copiaCon([])], COPIA_JUSTO_DESPUES)).toBe(false);
    expect(reflejado(enviadoDe('SERVICIO', 'e1'), [copiaCon([])], new Date(ACEPTADO + MARGEN_REFLEJO_MS).toISOString())).toBe(false);
  });

  it('pasado el margen se quita aunque la copia no lo traiga (otro dispositivo lo revirtió)', () => {
    expect(reflejado(enviadoDe('SERVICIO', 'e1'), [copiaCon([])], COPIA_MUCHO_DESPUES)).toBe(true);
  });

  it('una baja revertida: el animal volvió a estar activo y la copia es bastante posterior', () => {
    expect(reflejado(enviadoDe('BAJA', 'b1'), [copiaCon([])], COPIA_JUSTO_DESPUES)).toBe(false);
    expect(reflejado(enviadoDe('BAJA', 'b1'), [copiaCon([])], COPIA_MUCHO_DESPUES)).toBe(true);
  });

  it('una copia ANTERIOR a la aceptación nunca lo quita por antigüedad', () => {
    expect(reflejado(enviadoDe('SERVICIO', 'e1'), [copiaCon([])], '2026-11-12T11:00:00.000Z')).toBe(false);
  });
});

describe('enviadosReflejados y limpiarEnviadosReflejados', () => {
  it('devuelve solo los que la copia ya refleja', () => {
    const si = enviadoDe('SERVICIO', 'e1');
    const no = enviadoDe('TACTO', 'e2');
    expect(enviadosReflejados([si, no], { generadaEn: COPIA_JUSTO_DESPUES, animales: [copiaCon([evento('e1', 'SERVICIO')])] })).toEqual([si]);
  });

  it('quita del almacén un enviado por tipo cuando la copia lo trae, y solo de esa persona', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.reemplazarCopia(
      { generadaEn: COPIA_JUSTO_DESPUES, totalAnimales: 1, lotes: [], animales: [copiaCon([evento('s1', 'SERVICIO'), evento('t1', 'TACTO'), evento('p1', 'PARTO'), evento('d1', 'SECADO'), evento('x1', 'SERVICIO', true)])] },
      persona,
    );
    for (const e of [
      enviadoDe('SERVICIO', 's1'),
      enviadoDe('TACTO', 't1'),
      enviadoDe('PARTO', 'p1'),
      enviadoDe('SECADO', 'd1'),
      enviadoDe('ANULACION', 'an1', { eventoId: 'x1', tipoEvento: 'SERVICIO', motivo: 'x' }),
      enviadoDe('SERVICIO', 'todavia-no'),
      { ...enviadoDe('SERVICIO', 's1-ajeno'), usuarioId: 'otro-usuario' },
    ]) {
      await almacen.guardarEnviado(e);
    }

    await limpiarEnviadosReflejados(almacen, persona);

    expect((await almacen.listarEnviados()).map((e) => e.id).sort()).toEqual(['s1-ajeno', 'todavia-no']);
  });

  it('sin copia guardada no toca nada', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.guardarEnviado(enviadoDe('SERVICIO', 'e1'));
    await limpiarEnviadosReflejados(almacen, persona);
    expect(await almacen.listarEnviados()).toHaveLength(1);
  });
});
