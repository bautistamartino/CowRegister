import { describe, expect, it } from 'vitest';
import { completarCierrePendiente, crearMarcaCierre, type AlmacenMarca } from '../src/sinconexion/marcaCierre';

// Marca de "cierre de sesión pendiente" (spec 009, corrección I-1): con un almacenamiento falso en memoria.

function almacenFalso(roto = false): AlmacenMarca & { valor: string | null } {
  const a = {
    valor: null as string | null,
    get() {
      if (roto) throw new Error('sin almacenamiento');
      return a.valor;
    },
    set(v: string) {
      if (roto) throw new Error('sin almacenamiento');
      a.valor = v;
    },
    remove() {
      if (roto) throw new Error('sin almacenamiento');
      a.valor = null;
    },
  };
  return a;
}

describe('marca de cierre pendiente', () => {
  it('se pone, se lee y se limpia', () => {
    const marca = crearMarcaCierre(almacenFalso());
    expect(marca.hayPendiente()).toBe(false);
    marca.poner();
    expect(marca.hayPendiente()).toBe(true);
    marca.limpiar();
    expect(marca.hayPendiente()).toBe(false);
  });

  it('si el almacenamiento falla, no rompe y no hay marca', () => {
    const marca = crearMarcaCierre(almacenFalso(true));
    expect(() => marca.poner()).not.toThrow();
    expect(() => marca.limpiar()).not.toThrow();
    expect(marca.hayPendiente()).toBe(false);
  });
});

describe('completarCierrePendiente', () => {
  it('marca puesta y arranque sin ingreso: intenta cerrar y, si cierra, limpia la marca', async () => {
    const marca = crearMarcaCierre(almacenFalso());
    marca.poner();
    let llamadas = 0;
    await completarCierrePendiente(marca, async () => {
      llamadas++;
      return 'cerrado';
    });
    expect(llamadas).toBe(1);
    expect(marca.hayPendiente()).toBe(false);
  });

  it('si sigue sin red (o falla), la marca queda para el próximo arranque', async () => {
    const marca = crearMarcaCierre(almacenFalso());
    marca.poner();
    await completarCierrePendiente(marca, async () => 'sin-red');
    expect(marca.hayPendiente()).toBe(true);
    await completarCierrePendiente(marca, async () => {
      throw new Error('raro');
    });
    expect(marca.hayPendiente()).toBe(true);
  });

  it('marca puesta e ingreso exitoso (limpiar): el próximo arranque NO cierra la sesión nueva', async () => {
    const marca = crearMarcaCierre(almacenFalso());
    marca.poner(); // cerró sesión sin conexión
    marca.limpiar(); // volvió la señal e ingresó: la cookie nueva reemplaza a la vieja
    let llamadas = 0;
    await completarCierrePendiente(marca, async () => {
      llamadas++;
      return 'cerrado';
    });
    expect(llamadas).toBe(0);
  });

  it('sin marca no hace nada', async () => {
    const marca = crearMarcaCierre(almacenFalso());
    let llamadas = 0;
    await completarCierrePendiente(marca, async () => {
      llamadas++;
      return 'cerrado';
    });
    expect(llamadas).toBe(0);
  });
});
