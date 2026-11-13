import { describe, expect, it } from 'vitest';
import { MENSAJE_SIN_PERMISO, MENSAJE_SOLO_DUENO_O_ENCARGADO, mensajeSinPermiso, puedeRegistrar } from '../src/sinconexion/permisos';
import type { Rol } from '../src/compartido/api';

// Matriz de permisos por rol (spec 010, RF-10 y RF-22): la misma que controla la API.

const ROLES: Rol[] = ['DUENO', 'ENCARGADO', 'VETERINARIO'];

describe('puedeRegistrar', () => {
  it.each([
    ['SERVICIO', [true, true, true]],
    ['TACTO', [true, true, true]],
    ['PARTO', [true, true, false]],
    ['SECADO', [true, true, false]],
    ['BAJA', [true, true, false]],
    ['LITROS', [true, true, false]],
  ] as const)('%s: dueño, encargado y veterinario', (tipo, esperado) => {
    expect(ROLES.map((rol) => puedeRegistrar(rol, tipo))).toEqual(esperado);
  });

  it.each([
    ['SERVICIO', [true, true, true]],
    ['TACTO', [true, true, true]],
    ['PARTO', [true, true, false]],
    ['SECADO', [true, true, false]],
  ])('anular un %s depende del tipo del evento', (tipoEvento, esperado) => {
    expect(ROLES.map((rol) => puedeRegistrar(rol, 'ANULACION', tipoEvento))).toEqual(esperado);
  });

  it('anular algo que no es un servicio, tacto, parto o secado no se permite a nadie', () => {
    for (const rol of ROLES) {
      expect(puedeRegistrar(rol, 'ANULACION', 'BAJA')).toBe(false);
      expect(puedeRegistrar(rol, 'ANULACION')).toBe(false);
    }
  });
});

describe('mensajeSinPermiso', () => {
  it('usa los mismos mensajes que la API', () => {
    expect(mensajeSinPermiso('PARTO')).toBe(MENSAJE_SIN_PERMISO);
    expect(mensajeSinPermiso('ANULACION')).toBe('No tenés permiso para hacer esto');
    expect(mensajeSinPermiso('LITROS')).toBe(MENSAJE_SOLO_DUENO_O_ENCARGADO);
    expect(MENSAJE_SOLO_DUENO_O_ENCARGADO).toBe('Esta acción la tiene que hacer un dueño o encargado');
  });
});
