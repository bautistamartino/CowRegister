import { describe, expect, it } from 'vitest';
import { mostrarPendientes } from '../src/sinconexion/condicionPendientes';

// Una sola condición para el enlace "Pendientes" del menú y para la pantalla (spec 012, RF-12).

describe('mostrarPendientes', () => {
  it('dueño y encargado siempre lo ven, aunque no haya nada', () => {
    expect(mostrarPendientes({ rol: 'DUENO', total: 0, avisos: 0 })).toBe(true);
    expect(mostrarPendientes({ rol: 'ENCARGADO', total: 0, avisos: 0 })).toBe(true);
  });

  it('el veterinario sin pendientes ni avisos no lo ve', () => {
    expect(mostrarPendientes({ rol: 'VETERINARIO', total: 0, avisos: 0 })).toBe(false);
  });

  it('el veterinario con pendientes lo ve', () => {
    expect(mostrarPendientes({ rol: 'VETERINARIO', total: 2, avisos: 0 })).toBe(true);
  });

  it('el veterinario con un aviso sin cerrar lo ve (aunque no tenga pendientes)', () => {
    expect(mostrarPendientes({ rol: 'VETERINARIO', total: 0, avisos: 1 })).toBe(true);
  });

  it('todos juntos', () => {
    expect(mostrarPendientes({ rol: 'VETERINARIO', total: 3, avisos: 2 })).toBe(true);
  });
});
