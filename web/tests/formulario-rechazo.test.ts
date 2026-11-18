import { describe, expect, it } from 'vitest';
import { aErroresFormulario, TEXTO_ANIMAL_FUERA_DE_COPIA } from '../src/sinconexion/formularioRechazo';
import type { ResultadoRegistro } from '../src/sinconexion/registrar';

// Conversión de un rechazo o "sin lugar" al formato de errores de los formularios (spec 011, RF-10, RF-11, RF-12).

const rechazo = (origen: 'local' | 'servidor', mensaje: string, campos: Record<string, string> = {}, codigo = 400): ResultadoRegistro => ({ tipo: 'rechazado', origen, codigo, mensaje, campos });

describe('aErroresFormulario', () => {
  it('un rechazo local con campo: va junto al campo', () => {
    const r = aErroresFormulario(rechazo('local', 'La fecha no puede ser futura', { fecha: 'La fecha no puede ser futura' }), ['fecha', 'tipo']);
    expect(r).toEqual({ campos: { fecha: 'La fecha no puede ser futura' }, general: null });
  });

  it('un rechazo del servidor con varios campos: cada mensaje en su campo', () => {
    const r = aErroresFormulario(rechazo('servidor', 'x', { fecha: 'Fecha inválida', 'crias.0.numero': 'Número repetido' }), ['fecha', 'crias.0.numero']);
    expect(r).toEqual({ campos: { fecha: 'Fecha inválida', 'crias.0.numero': 'Número repetido' }, general: null });
  });

  it('un campo que el formulario no dibuja va a la alerta general (con su mensaje)', () => {
    const r = aErroresFormulario(rechazo('local', 'Un parto admite hasta 2 crías', { crias: 'Un parto admite hasta 2 crías' }), ['fecha', 'crias.0.numero']);
    expect(r).toEqual({ campos: {}, general: 'Un parto admite hasta 2 crías' });
  });

  it('los campos dibujados quedan y los no dibujados se suman a la alerta', () => {
    const r = aErroresFormulario(rechazo('servidor', 'x', { fecha: 'Fecha mala', otro: 'Otro mal' }), ['fecha']);
    expect(r.campos).toEqual({ fecha: 'Fecha mala' });
    expect(r.general).toBe('Otro mal');
  });

  it('un rechazo sin campo va a la alerta general', () => {
    expect(aErroresFormulario(rechazo('local', 'La vaca ya tiene una preñez vigente', {}, 409), ['fecha'])).toEqual({ campos: {}, general: 'La vaca ya tiene una preñez vigente' });
  });

  it('sin lugar: el texto de la tablet con el motivo', () => {
    const r = aErroresFormulario({ tipo: 'sinLugar', mensaje: 'Hay 500 pendientes' }, ['fecha']);
    expect(r).toEqual({ campos: {}, general: 'No se pudo guardar en la tablet: Hay 500 pendientes. Conectate para sincronizar los pendientes' });
  });

  it('sin lugar con el mensaje de la 010 ya completo: se usa tal cual', () => {
    const completo = 'No se pudo guardar en la tablet: no hay espacio. Conectate para sincronizar los pendientes';
    expect(aErroresFormulario({ tipo: 'sinLugar', mensaje: completo }, []).general).toBe(completo);
  });

  it('animal no encontrado (local, 404) con la copia ausente: texto de RF-12', () => {
    const r = aErroresFormulario(rechazo('local', 'Animal no encontrado', {}, 404), ['fecha']);
    expect(r).toEqual({ campos: {}, general: TEXTO_ANIMAL_FUERA_DE_COPIA });
    expect(TEXTO_ANIMAL_FUERA_DE_COPIA).toBe('Este animal no está en los datos de la tablet: actualizá los datos cuando tengas señal');
  });

  it('el mismo "Animal no encontrado" que viene del servidor se muestra como llegó', () => {
    expect(aErroresFormulario(rechazo('servidor', 'Animal no encontrado', {}, 404), []).general).toBe('Animal no encontrado');
  });

  it('un resultado que no es rechazo ni sin lugar no tiene errores', () => {
    expect(aErroresFormulario({ tipo: 'enviado', avisos: [], aceptadoEn: 1, registro: null }, ['fecha'])).toEqual({ campos: {}, general: null });
  });
});
