import { describe, expect, it } from 'vitest';
import { TEXTO_GUARDADO_PENDIENTE, traducirGuardado } from '../src/sinconexion/guardadoCarga';
import type { Pendiente } from '../src/sinconexion/almacen';
import type { ResultadoRegistro } from '../src/sinconexion/registrar';

// Traducción del resultado de `registrar` a lo que muestra un formulario de carga (spec 011, RF-8, RF-10 a RF-12).

const pendiente = (tipo: Pendiente['tipo'], datos: Record<string, unknown>): ResultadoRegistro => ({
  tipo: 'pendiente',
  pendiente: { id: 'p1', usuarioId: 'u', establecimientoId: 'e', animalId: 'a', numero: '101', tipo, datos, cargadoEnDispositivo: '2026-11-18T12:00:00.000Z', orden: 1, estado: 'esperando', motivo: null, codigoRechazo: null, intentos: 0, proximoIntento: null } as Pendiente,
});

describe('traducirGuardado', () => {
  it('aceptado en el momento: el título del formulario, sin "pendiente", con los avisos y el evento', () => {
    const r = traducirGuardado(
      { tipo: 'enviado', avisos: [{ codigo: 'X', mensaje: 'Aviso uno' } as never], aceptadoEn: 1, registro: null, evento: { id: 'e1' } },
      { tipo: 'SECADO', datos: { fecha: '2026-11-01' }, tituloAceptado: 'Secado registrado', camposDibujados: ['fecha'] },
    );
    expect(r).toEqual({
      tipo: 'guardado',
      pendiente: false,
      confirmacion: { titulo: 'Secado registrado', detalle: null, avisos: [{ codigo: 'X', mensaje: 'Aviso uno' }] },
      evento: { id: 'e1' },
    });
  });

  it('pendiente: "Guardado en la tablet: pendiente de sincronizar" y el resumen del tipo', () => {
    const r = traducirGuardado(pendiente('TACTO', { resultado: 'PRENADA' }), { tipo: 'TACTO', datos: { resultado: 'PRENADA' }, tituloAceptado: 'Tacto registrado', camposDibujados: [] });
    expect(r).toMatchObject({ tipo: 'guardado', pendiente: true, confirmacion: { titulo: TEXTO_GUARDADO_PENDIENTE, detalle: 'Tacto preñada', avisos: [] }, evento: null });
    expect(TEXTO_GUARDADO_PENDIENTE).toBe('Guardado en la tablet: pendiente de sincronizar');
  });

  it('rechazo local con campo: el error va junto al campo y se conserva el código para quien lo necesite', () => {
    const r = traducirGuardado(
      { tipo: 'rechazado', origen: 'local', codigo: 400, mensaje: 'La fecha no puede ser futura', campos: { fecha: 'La fecha no puede ser futura' } },
      { tipo: 'SERVICIO', datos: {}, tituloAceptado: 'Servicio registrado', camposDibujados: ['fecha'] },
    );
    expect(r).toEqual({ tipo: 'error', errores: { campos: { fecha: 'La fecha no puede ser futura' }, general: null }, rechazo: { origen: 'local', codigo: 400 } });
  });

  it('rechazo del servidor sin campo: alerta general', () => {
    const r = traducirGuardado(
      { tipo: 'rechazado', origen: 'servidor', codigo: 404, mensaje: 'Animal no encontrado', campos: {} },
      { tipo: 'BAJA', datos: {}, tituloAceptado: 'Baja registrada', camposDibujados: ['fecha'] },
    );
    expect(r).toEqual({ tipo: 'error', errores: { campos: {}, general: 'Animal no encontrado' }, rechazo: { origen: 'servidor', codigo: 404 } });
  });

  it('animal fuera de la copia: el texto de la tablet', () => {
    const r = traducirGuardado(
      { tipo: 'rechazado', origen: 'local', codigo: 404, mensaje: 'Animal no encontrado', campos: {} },
      { tipo: 'SERVICIO', datos: {}, tituloAceptado: 'x', camposDibujados: [] },
    );
    expect(r.tipo === 'error' && r.errores.general).toBe('Este animal no está en los datos de la tablet: actualizá los datos cuando tengas señal');
  });

  it('sin lugar: "No se pudo guardar en la tablet…" y nada confirmado', () => {
    const r = traducirGuardado({ tipo: 'sinLugar', mensaje: 'Hay 500 pendientes' }, { tipo: 'SERVICIO', datos: {}, tituloAceptado: 'x', camposDibujados: [] });
    expect(r).toEqual({ tipo: 'error', errores: { campos: {}, general: 'No se pudo guardar en la tablet: Hay 500 pendientes. Conectate para sincronizar los pendientes' }, rechazo: null });
  });
});
