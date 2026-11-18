import { describe, expect, it } from 'vitest';
import { textoDescarte } from '../src/sinconexion/textoDescarte';

// Mensajes del descarte de un pendiente (spec 011, RF-7).
describe('textoDescarte', () => {
  it('descartado: avisa con el texto de lo que se quitó', () => {
    expect(textoDescarte('descartado', 'Se descartó: Servicio')).toEqual({ tipo: 'aviso', texto: 'Se descartó: Servicio' });
  });
  it('ya guardado en el servidor: es un aviso, no un error', () => {
    expect(textoDescarte('ya-guardado', 'x')).toEqual({ tipo: 'aviso', texto: 'Ya estaba guardado en el servidor' });
  });
  it('cualquier otro resultado se ve como error', () => {
    expect(textoDescarte('no-existe', 'x').tipo).toBe('error');
    expect(textoDescarte('requiere-confirmacion', 'x').tipo).toBe('error');
  });
});
