import { describe, expect, it } from 'vitest';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import { fechaYTurnoArgentina, horaParaApi } from '../src/sinconexion/horaArgentina';
import {
  contarPendientes,
  crearPendiente,
  guardarPendienteNuevo,
  pendientesDe,
  delPropietario,
  limpiarEnviadosIncluidos,
  registrosParaFicha,
  restablecerEnviando,
  ultimoRegistro,
} from '../src/sinconexion/cola';
import { enviado, pendiente, persona, registroDe, vacaCopia } from './ayudas';

// Cola de pendientes (spec 009, RF-18 a RF-23, RF-34, RF-36, RF-42): lógica pura con el almacén en memoria.

const AHORA = new Date('2026-11-12T11:15:00Z'); // 08:15 en Argentina
let contador = 0;
const generarId = () => `00000000-0000-4000-8000-${String(++contador).padStart(12, '0')}`;

function cargar(almacen: AlmacenMemoria, cambios: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return crearPendiente({
    almacen,
    persona,
    datos: { animalId: 'a1', numero: '12', fecha: '2026-11-12', turno: 'manana', litros: '12,5', ...cambios },
    registrosCopia: [],
    ahora: AHORA,
    generarId,
    ...extra,
  });
}

describe('hora de Argentina del dispositivo (RF-21)', () => {
  it('13:59 es mañana y 14:00 es tarde', () => {
    expect(fechaYTurnoArgentina(new Date('2026-11-12T16:59:00Z'))).toEqual({ fecha: '2026-11-12', turno: 'manana' });
    expect(fechaYTurnoArgentina(new Date('2026-11-12T17:00:00Z'))).toEqual({ fecha: '2026-11-12', turno: 'tarde' });
  });

  it('usa el día de Argentina, no el de UTC: a las 23:59 argentinas todavía es el mismo día', () => {
    expect(fechaYTurnoArgentina(new Date('2026-11-13T02:59:00Z'))).toEqual({ fecha: '2026-11-12', turno: 'tarde' });
    expect(fechaYTurnoArgentina(new Date('2026-11-13T03:00:00Z'))).toEqual({ fecha: '2026-11-13', turno: 'manana' });
  });

  it('la hora de la tablet para la API lleva el huso -03:00', () => {
    expect(horaParaApi(AHORA)).toBe('2026-11-12T08:15:00-03:00');
  });
});

describe('crear un pendiente', () => {
  it('guarda todo lo que pide RF-18 y acepta la coma decimal', async () => {
    const almacen = new AlmacenMemoria();
    const r = await cargar(almacen);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pendiente).toMatchObject({
      usuarioId: 'u1',
      establecimientoId: 'e1',
      animalId: 'a1',
      numero: '12',
      tipo: 'LITROS',
      datos: { fecha: '2026-11-12', turno: 'manana', litros: '12.5' }, // la coma se convierte a punto, sin pasar por número
      cargadoEnDispositivo: '2026-11-12T08:15:00-03:00',
      estado: 'esperando',
      intentos: 0,
      proximoIntento: null,
    });
    expect(r.pendiente.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await almacen.listarPendientes()).length).toBe(1);
  });

  it('acepta el punto, el cero y el máximo', async () => {
    const almacen = new AlmacenMemoria();
    for (const [i, litros] of ['12.5', '0', '99.9', '7'].entries()) {
      const r = await cargar(almacen, { litros, numero: `v${i}`, animalId: `a${i}` });
      expect(r.ok).toBe(true);
    }
  });

  it('rechaza los litros inválidos con los mismos mensajes de la API y no guarda nada', async () => {
    const casos: [string, string][] = [
      ['', 'Los litros son obligatorios'],
      ['   ', 'Los litros son obligatorios'],
      ['-3', 'Los litros no pueden ser negativos'],
      ['100', 'Los litros no pueden superar 99,9'],
      ['12,55', 'Los litros admiten un solo decimal (por ejemplo 12.5)'],
      ['doce', 'Los litros tienen que ser un número con punto decimal, por ejemplo 12.5'],
      ['1e3', 'Los litros tienen que ser un número con punto decimal, por ejemplo 12.5'],
    ];
    for (const [litros, mensaje] of casos) {
      const almacen = new AlmacenMemoria();
      const r = await cargar(almacen, { litros });
      expect(r).toMatchObject({ ok: false, tipo: 'invalido', errores: { litros: mensaje } });
      expect(await almacen.listarPendientes()).toEqual([]);
    }
  });

  it('valida la fecha (formato, futura, anterior al 2000) y el turno', async () => {
    const almacen = new AlmacenMemoria();
    expect(await cargar(almacen, { fecha: '2026-02-31' })).toMatchObject({ ok: false, errores: { fecha: 'La fecha no es válida: usá el formato AAAA-MM-DD con un día que exista' } });
    expect(await cargar(almacen, { fecha: '' })).toMatchObject({ ok: false, errores: { fecha: 'La fecha no es válida: usá el formato AAAA-MM-DD con un día que exista' } });
    expect(await cargar(almacen, { fecha: '2026-11-13' })).toMatchObject({ ok: false, errores: { fecha: 'La fecha no puede ser futura' } });
    expect(await cargar(almacen, { fecha: '1999-12-31' })).toMatchObject({ ok: false, errores: { fecha: 'La fecha no puede ser anterior al 01/01/2000' } });
    expect(await cargar(almacen, { turno: 'noche' })).toMatchObject({ ok: false, errores: { turno: 'El turno tiene que ser mañana o tarde' } });
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('el orden de carga crece aunque se cargue en el mismo milisegundo', async () => {
    const almacen = new AlmacenMemoria();
    const a = await cargar(almacen, { animalId: 'a1', numero: '1' });
    const b = await cargar(almacen, { animalId: 'a2', numero: '2' });
    const c = await cargar(almacen, { animalId: 'a3', numero: '3' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('debían guardarse');
    expect(a.pendiente.orden).toBeLessThan(b.pendiente.orden);
    expect(b.pendiente.orden).toBeLessThan(c.pendiente.orden);
  });
});

describe('duplicado local (RF-20)', () => {
  it('rechaza si hay un pendiente de lo mismo y dice que se descarte desde Pendientes', async () => {
    const almacen = new AlmacenMemoria();
    await cargar(almacen);
    const r = await cargar(almacen, { litros: '8' });
    expect(r).toMatchObject({ ok: false, tipo: 'invalido' });
    if (r.ok || r.tipo !== 'invalido') throw new Error('debía rechazar');
    expect(r.general).toMatch(/pendiente/i);
    expect(r.general).toMatch(/descart/i);
    expect((await almacen.listarPendientes()).length).toBe(1);
  });

  it('cuenta también los pendientes enviando y rechazados', async () => {
    for (const estado of ['enviando', 'rechazado'] as const) {
      const almacen = new AlmacenMemoria();
      await almacen.guardarPendiente(pendiente({ estado }));
      expect(await cargar(almacen)).toMatchObject({ ok: false, tipo: 'invalido' });
    }
  });

  it('otro turno, otra fecha u otra vaca no son duplicado', async () => {
    const almacen = new AlmacenMemoria();
    await cargar(almacen);
    expect((await cargar(almacen, { turno: 'tarde' })).ok).toBe(true);
    expect((await cargar(almacen, { fecha: '2026-11-11' })).ok).toBe(true);
    expect((await cargar(almacen, { animalId: 'a2', numero: '13' })).ok).toBe(true);
  });

  it('rechaza si la copia ya tiene un registro vigente y dice que se anule con conexión', async () => {
    const almacen = new AlmacenMemoria();
    const registro = registroDe(pendiente({ id: 'x' }));
    const r = await cargar(almacen, {}, { registrosCopia: [registro] });
    expect(r).toMatchObject({ ok: false, tipo: 'invalido' });
    if (r.ok || r.tipo !== 'invalido') throw new Error('debía rechazar');
    expect(r.general).toMatch(/anul/i);
    expect(r.general).toMatch(/conexión/i);
  });

  it('un registro anulado de la copia no cuenta', async () => {
    const almacen = new AlmacenMemoria();
    const registro = registroDe(pendiente({ id: 'x' }), { anulado: { por: 'Dueño', en: '2026-11-12T12:00:00Z', motivo: 'error' } });
    expect((await cargar(almacen, {}, { registrosCopia: [registro] })).ok).toBe(true);
  });

  it('un enviado reciente (aceptado y todavía no en la copia) también cuenta', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.guardarEnviado(enviado(pendiente()));
    expect(await cargar(almacen)).toMatchObject({ ok: false, tipo: 'invalido' });
  });

  it('sin copia que mirar (registrosCopia null, con señal) solo cuentan los pendientes', async () => {
    const almacen = new AlmacenMemoria();
    expect((await cargar(almacen, {}, { registrosCopia: null })).ok).toBe(true);
  });

  it('lo de otro usuario no cuenta como duplicado', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.guardarPendiente(pendiente({ usuarioId: 'otro' }));
    expect((await cargar(almacen)).ok).toBe(true);
  });
});

describe('límites (RF-22)', () => {
  it('con 500 pendientes no deja cargar más y no lo confirma como guardado', async () => {
    const almacen = new AlmacenMemoria();
    for (let i = 0; i < 500; i++) await almacen.guardarPendiente(pendiente({ id: `p${i}`, animalId: `a${i}`, orden: i }));
    const r = await cargar(almacen, { animalId: 'nuevo', numero: '999' });
    expect(r).toMatchObject({ ok: false, tipo: 'sinLugar' });
    if (r.ok || r.tipo !== 'sinLugar') throw new Error('debía faltar lugar');
    expect(r.mensaje).toMatch(/^No se pudo guardar en la tablet: .+\. Conectate para sincronizar los pendientes$/);
    expect((await almacen.listarPendientes()).length).toBe(500);
  });

  it('el límite es inyectable', async () => {
    const almacen = new AlmacenMemoria();
    expect((await cargar(almacen, { animalId: 'a1' }, { maxPendientes: 2 })).ok).toBe(true);
    expect((await cargar(almacen, { animalId: 'a2' }, { maxPendientes: 2 })).ok).toBe(true);
    expect(await cargar(almacen, { animalId: 'a3' }, { maxPendientes: 2 })).toMatchObject({ ok: false, tipo: 'sinLugar' });
  });

  it('los pendientes de otro usuario no cuentan para el límite', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.guardarPendiente(pendiente({ id: 'ajeno', usuarioId: 'otro' }));
    expect((await cargar(almacen, {}, { maxPendientes: 1 })).ok).toBe(true);
  });

  it('si el navegador no tiene espacio avisa el motivo y no queda nada guardado', async () => {
    const almacen = new AlmacenMemoria();
    almacen.configurar({ capacidadPendientes: 0 });
    const r = await cargar(almacen);
    expect(r).toMatchObject({ ok: false, tipo: 'sinLugar' });
    if (r.ok || r.tipo !== 'sinLugar') throw new Error('debía faltar espacio');
    expect(r.mensaje).toMatch(/no hay espacio/i);
    expect(r.mensaje).toContain('Conectate para sincronizar los pendientes');
    expect(await almacen.listarPendientes()).toEqual([]);
  });
});

describe('contador del menú (RF-42)', () => {
  it('cuenta esperando, enviando y rechazados, y destaca los rechazados', () => {
    const lista = [pendiente({ id: '1' }), pendiente({ id: '2', estado: 'enviando' }), pendiente({ id: '3', estado: 'rechazado' })];
    expect(contarPendientes(lista)).toEqual({ total: 3, rechazados: 1 });
    expect(contarPendientes([])).toEqual({ total: 0, rechazados: 0 });
  });

  it('solo se ven los del usuario y tambo de la sesión', () => {
    const lista = [pendiente({ id: '1' }), pendiente({ id: '2', usuarioId: 'otro' }), pendiente({ id: '3', establecimientoId: 'otro' })];
    expect(delPropietario(lista, persona).map((p) => p.id)).toEqual(['1']);
  });
});

describe('al abrir la app', () => {
  it('un pendiente que quedó "enviando" (se cerró la app a mitad) vuelve a esperando', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.guardarPendiente(pendiente({ id: '1', estado: 'enviando' }));
    await almacen.guardarPendiente(pendiente({ id: '2', estado: 'rechazado', motivo: 'no' }));
    await almacen.guardarPendiente(pendiente({ id: '3', estado: 'enviando', usuarioId: 'otro' }));
    await restablecerEnviando(almacen, persona);
    const estados = Object.fromEntries((await almacen.listarPendientes()).map((p) => [p.id, p.estado]));
    expect(estados).toEqual({ '1': 'esperando', '2': 'rechazado', '3': 'enviando' });
  });
});

describe('último registro (RF-23)', () => {
  const ultimoServidor = { fecha: '2026-11-11', turno: 'tarde' as const, litros: 9 };

  it('sin nada es "—" (null)', () => {
    expect(ultimoRegistro({ animalId: 'a1', ultimoServidor: null, pendientes: [], enviados: [] })).toBeNull();
  });

  it('toma el de la copia si no hay nada más reciente', () => {
    expect(ultimoRegistro({ animalId: 'a1', ultimoServidor, pendientes: [], enviados: [] })).toEqual({ ...ultimoServidor, marca: null });
  });

  it('un pendiente más reciente gana y se marca como pendiente', () => {
    const p = pendiente({ fecha: '2026-11-12', turno: 'manana', litros: '12.5' });
    expect(ultimoRegistro({ animalId: 'a1', ultimoServidor, pendientes: [p], enviados: [] })).toEqual({ fecha: '2026-11-12', turno: 'manana', litros: 12.5, marca: 'pendiente' });
  });

  it('por fecha y turno: la tarde viene después de la mañana del mismo día', () => {
    const manana = pendiente({ id: 'm', fecha: '2026-11-12', turno: 'manana', litros: '10' });
    const tarde = pendiente({ id: 't', fecha: '2026-11-12', turno: 'tarde', litros: '11' });
    const r = ultimoRegistro({ animalId: 'a1', ultimoServidor: null, pendientes: [tarde, manana], enviados: [] });
    expect(r).toMatchObject({ turno: 'tarde', litros: 11 });
  });

  it('un pendiente viejo cargado después NO le gana a uno más reciente por fecha (no manda el orden de carga)', () => {
    const viejo = pendiente({ fecha: '2026-11-01', orden: 99 });
    expect(ultimoRegistro({ animalId: 'a1', ultimoServidor, pendientes: [viejo], enviados: [] })).toMatchObject({ fecha: '2026-11-11', marca: null });
  });

  it('los rechazados y los pendientes de otra vaca no cuentan', () => {
    const rechazado = pendiente({ id: 'r', estado: 'rechazado' });
    const otra = pendiente({ id: 'o', animalId: 'a2' });
    expect(ultimoRegistro({ animalId: 'a1', ultimoServidor, pendientes: [rechazado, otra], enviados: [] })).toMatchObject({ fecha: '2026-11-11', marca: null });
  });

  it('los enviando cuentan', () => {
    const p = pendiente({ estado: 'enviando' });
    expect(ultimoRegistro({ animalId: 'a1', ultimoServidor: null, pendientes: [p], enviados: [] })).toMatchObject({ marca: 'pendiente' });
  });

  it('un enviado reciente cuenta y se marca como enviado', () => {
    const e = enviado(pendiente({ fecha: '2026-11-12' }));
    expect(ultimoRegistro({ animalId: 'a1', ultimoServidor, pendientes: [], enviados: [e] })).toMatchObject({ fecha: '2026-11-12', marca: 'enviado' });
  });

  it('un enviado anulado no cuenta', () => {
    const e = enviado(pendiente({ fecha: '2026-11-12' }), { anulado: { por: 'x', en: '2026-11-12T12:00:00Z', motivo: 'm' } });
    expect(ultimoRegistro({ animalId: 'a1', ultimoServidor, pendientes: [], enviados: [e] })).toMatchObject({ fecha: '2026-11-11' });
  });
});

describe('registros de la ficha con pendientes y enviados (RF-34, RF-36)', () => {
  it('suma los pendientes y los enviados que la copia todavía no trae, del más reciente al más antiguo', () => {
    const delServidor = [registroDe(pendiente({ id: 's1', fecha: '2026-11-10' }))];
    const p = pendiente({ id: 'p1', fecha: '2026-11-12', turno: 'tarde' });
    const e = enviado(pendiente({ id: 'e1', fecha: '2026-11-12', turno: 'manana' }));
    const filas = registrosParaFicha({ animalId: 'a1', registros: delServidor, pendientes: [p], enviados: [e] });
    expect(filas.map((f) => [f.id, f.marca])).toEqual([
      ['p1', 'pendiente'],
      ['e1', 'enviado'],
      ['s1', null],
    ]);
  });

  it('un enviado que la lista ya trae no se repite', () => {
    const p = pendiente({ id: 'e1' });
    const filas = registrosParaFicha({ animalId: 'a1', registros: [registroDe(p)], pendientes: [], enviados: [enviado(p)] });
    expect(filas.map((f) => f.id)).toEqual(['e1']);
  });
});

describe('enviados recientes y la copia nueva (RF-34)', () => {
  async function conCopia(almacen: AlmacenMemoria, generadaEn: string, animales: ReturnType<typeof vacaCopia>[]) {
    await almacen.reemplazarCopia({ generadaEn, totalAnimales: animales.length, lotes: [], animales }, persona);
  }

  it('se mantiene visible mientras la copia no lo incluya', async () => {
    const almacen = new AlmacenMemoria();
    const p = pendiente();
    await almacen.guardarEnviado(enviado(p));
    await conCopia(almacen, '2026-11-12T11:10:00.000Z', [vacaCopia('a1', '12')]); // copia anterior al registro
    await limpiarEnviadosIncluidos(almacen, persona);
    expect((await almacen.listarEnviados()).length).toBe(1);
  });

  it('se quita cuando la copia nueva ya trae el registro', async () => {
    const almacen = new AlmacenMemoria();
    const p = pendiente();
    await almacen.guardarEnviado(enviado(p));
    await conCopia(almacen, '2026-11-12T11:30:00.000Z', [vacaCopia('a1', '12', [registroDe(p)])]);
    await limpiarEnviadosIncluidos(almacen, persona);
    expect(await almacen.listarEnviados()).toEqual([]);
  });

  it('se quita si el animal ya no está en la copia (por ejemplo, se vendió)', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.guardarEnviado(enviado(pendiente()));
    await conCopia(almacen, '2026-11-12T11:30:00.000Z', [vacaCopia('otra', '99')]);
    await limpiarEnviadosIncluidos(almacen, persona);
    expect(await almacen.listarEnviados()).toEqual([]);
  });

  it('no deja un enviado para siempre si la copia es mucho más nueva y no lo trae (anulado o fuera del tope)', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.guardarEnviado(enviado(pendiente()));
    await conCopia(almacen, '2026-11-12T12:30:00.000Z', [vacaCopia('a1', '12')]); // 1 hora después
    await limpiarEnviadosIncluidos(almacen, persona);
    expect(await almacen.listarEnviados()).toEqual([]);
  });

  it('no toca los enviados de otro usuario', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.guardarEnviado(enviado(pendiente({ usuarioId: 'otro' })));
    await conCopia(almacen, '2026-11-12T13:30:00.000Z', [vacaCopia('a1', '12')]);
    await limpiarEnviadosIncluidos(almacen, persona);
    expect((await almacen.listarEnviados()).length).toBe(1);
  });
});

// ─── Cola general (spec 010, RF-12, RF-14, RF-30) ───

describe('guardar un pendiente de cualquier tipo (RF-12)', () => {
  const nuevo = (almacen: AlmacenMemoria, cambios: Partial<Parameters<typeof guardarPendienteNuevo>[0]> = {}) =>
    guardarPendienteNuevo({ almacen, persona, tipo: 'SERVICIO', animalId: 'a1', numero: '12', datos: { fecha: '2026-11-12' }, id: 'x1', ahora: AHORA, ...cambios });

  it('guarda cada tipo con todos sus datos, el dueño, el id y el orden creciente', async () => {
    const almacen = new AlmacenMemoria();
    const tipos = ['SERVICIO', 'TACTO', 'PARTO', 'SECADO', 'BAJA', 'ANULACION', 'LITROS'] as const;
    for (const [i, tipo] of tipos.entries()) {
      const datos = { tipo, i };
      const r = await nuevo(almacen, { tipo, id: `id-${i}`, datos });
      expect(r.ok).toBe(true);
    }
    const guardados = await pendientesDe(almacen, persona);
    expect(guardados.map((p) => p.tipo)).toEqual([...tipos]);
    expect(guardados.map((p) => p.datos)).toEqual(tipos.map((tipo, i) => ({ tipo, i })));
    for (const p of guardados) {
      expect(p).toMatchObject({ usuarioId: 'u1', establecimientoId: 'e1', animalId: 'a1', numero: '12', estado: 'esperando', cargadoEnDispositivo: '2026-11-12T08:15:00-03:00' });
    }
    const ordenes = guardados.map((p) => p.orden);
    expect([...ordenes].sort((a, b) => a - b)).toEqual(ordenes);
    expect(new Set(ordenes).size).toBe(ordenes.length);
  });

  it('el límite de 500 cuenta los pendientes de todos los tipos juntos y el 501.º no se confirma', async () => {
    const almacen = new AlmacenMemoria();
    for (let i = 0; i < 500; i++) await almacen.guardarPendiente(pendiente({ id: `p${i}`, orden: i, ...(i % 2 ? {} : { tipo: 'TACTO' as const, datos: {} }) }));
    const r = await nuevo(almacen, { tipo: 'PARTO', id: 'el-501' });
    expect(r).toEqual({ ok: false, tipo: 'sinLugar', mensaje: 'No se pudo guardar en la tablet: ya hay 500 pendientes. Conectate para sincronizar los pendientes' });
    expect((await almacen.listarPendientes()).length).toBe(500);
  });

  it('el límite es inyectable y la falta de espacio no se confirma como guardado', async () => {
    const chico = new AlmacenMemoria();
    expect((await nuevo(chico, { id: 'a', maxPendientes: 1 })).ok).toBe(true);
    expect(await nuevo(chico, { id: 'b', maxPendientes: 1 })).toMatchObject({ ok: false, tipo: 'sinLugar' });

    const lleno = new AlmacenMemoria();
    lleno.configurar({ capacidadPendientes: 0 });
    const r = await nuevo(lleno);
    expect(r).toEqual({ ok: false, tipo: 'sinLugar', mensaje: 'No se pudo guardar en la tablet: no hay espacio en la tablet. Conectate para sincronizar los pendientes' });
    expect(await lleno.listarPendientes()).toEqual([]);
  });
});

describe('conteo de no aceptados de todos los tipos (RF-30)', () => {
  it('cuenta todos los tipos y destaca los rechazados; los enviados no cuentan', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.guardarPendiente(pendiente({ id: '1', tipo: 'PARTO', datos: {} }));
    await almacen.guardarPendiente(pendiente({ id: '2', tipo: 'BAJA', datos: {}, estado: 'rechazado' }));
    await almacen.guardarPendiente(pendiente({ id: '3' }));
    await almacen.guardarEnviado(enviado(pendiente({ id: '4' })));
    expect(contarPendientes(await pendientesDe(almacen, persona))).toEqual({ total: 3, rechazados: 1 });
  });

  it('un pendiente de otro tipo "enviando" vuelve a esperando al abrir la app', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.guardarPendiente(pendiente({ id: '1', tipo: 'SECADO', datos: {}, estado: 'enviando' }));
    await restablecerEnviando(almacen, persona);
    expect((await almacen.listarPendientes())[0]!.estado).toBe('esperando');
  });
});
