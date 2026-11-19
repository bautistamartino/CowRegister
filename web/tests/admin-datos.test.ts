import { describe, expect, it } from 'vitest';
import {
  formatearAlta,
  formatearFechaHora,
  textoDueno,
  textoUltimoIngreso,
  validarContrasenaNueva,
  validarMotivo,
  validarTamboNuevo,
} from '../src/admin/adminDatos';

// Lógica pura de las pantallas del administrador (spec 014, RF-26, RF-33).

const valido = {
  nombreEstablecimiento: 'La Libertad',
  nombre: 'Ana López',
  email: 'ana@prueba.test',
  password: 'una-clave-larga',
  confirmar: 'una-clave-larga',
};

describe('validarTamboNuevo (mismas reglas que la API)', () => {
  it('datos válidos: sin errores y datos normalizados (email en minúsculas, nombres sin espacios sobrantes)', () => {
    const r = validarTamboNuevo({ ...valido, nombreEstablecimiento: '  La Libertad ', email: ' ANA@Prueba.Test ' });
    expect(r.errores).toEqual({});
    expect(r.datos).toEqual({
      nombreEstablecimiento: 'La Libertad',
      nombre: 'Ana López',
      email: 'ana@prueba.test',
      password: 'una-clave-larga',
    });
  });

  it('nombre del tambo vacío o solo espacios: obligatorio', () => {
    expect(validarTamboNuevo({ ...valido, nombreEstablecimiento: '   ' }).errores.nombreEstablecimiento).toBe('El nombre es obligatorio');
  });

  it('nombre de más de 100 letras: demasiado largo; con 100 pasa', () => {
    expect(validarTamboNuevo({ ...valido, nombre: 'a'.repeat(101) }).errores.nombre).toBe('El nombre es demasiado largo');
    expect(validarTamboNuevo({ ...valido, nombre: 'a'.repeat(100) }).errores.nombre).toBeUndefined();
  });

  it('email inválido o vacío', () => {
    expect(validarTamboNuevo({ ...valido, email: 'ana@' }).errores.email).toBe('El email no es válido');
    expect(validarTamboNuevo({ ...valido, email: '' }).errores.email).toBe('El email no es válido');
  });

  it('contraseña corta (menos de 10) o muy larga (más de 128)', () => {
    expect(validarTamboNuevo({ ...valido, password: 'corta', confirmar: 'corta' }).errores.password).toBe('La contraseña debe tener al menos 10 caracteres');
    const larga = 'x'.repeat(129);
    expect(validarTamboNuevo({ ...valido, password: larga, confirmar: larga }).errores.password).toBe('La contraseña es demasiado larga');
    const justa = 'x'.repeat(10);
    expect(validarTamboNuevo({ ...valido, password: justa, confirmar: justa }).errores.password).toBeUndefined();
  });

  it('la contraseña no se recorta: los espacios cuentan', () => {
    expect(validarTamboNuevo({ ...valido, password: ' '.repeat(10), confirmar: ' '.repeat(10) }).errores.password).toBeUndefined();
  });

  it('la confirmación tiene que coincidir', () => {
    expect(validarTamboNuevo({ ...valido, confirmar: 'otra-clave-larga' }).errores.confirmar).toBe('Las contraseñas no coinciden');
  });

  it('varios errores a la vez, uno por campo, y sin datos', () => {
    const r = validarTamboNuevo({ nombreEstablecimiento: '', nombre: '', email: 'x', password: '1', confirmar: '1' });
    expect(Object.keys(r.errores).sort()).toEqual(['email', 'nombre', 'nombreEstablecimiento', 'password']);
    expect(r.datos).toBeNull();
  });
});

describe('formatearAlta (fecha de alta en hora de Argentina)', () => {
  it('02:30 UTC del 13/11 es todavía el 12/11 en Argentina', () => {
    expect(formatearAlta('2026-11-13T02:30:00.000Z')).toBe('12/11/2026');
  });

  it('no depende del huso del dispositivo', () => {
    const original = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      expect(formatearAlta('2026-11-13T02:30:00.000Z')).toBe('12/11/2026');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('un valor que no es fecha no rompe', () => {
    expect(formatearAlta('no es fecha')).toBe('—');
  });
});

describe('textoDueno', () => {
  it('un dueño: solo el nombre', () => {
    expect(textoDueno({ nombre: 'Ana López', email: 'a@x.test' }, 0)).toBe('Ana López');
  });
  it('varios dueños: "Ana López +1"', () => {
    expect(textoDueno({ nombre: 'Ana López', email: 'a@x.test' }, 1)).toBe('Ana López +1');
  });
  it('sin dueño: guion', () => {
    expect(textoDueno(null, 0)).toBe('—');
  });
});

describe('validarMotivo (spec 015, RF-5)', () => {
  const MENSAJE = 'Indicá el motivo de la baja (hasta 200 caracteres)';

  it('vacío o solo espacios: pide el motivo', () => {
    expect(validarMotivo('').error).toBe(MENSAJE);
    expect(validarMotivo('   ').error).toBe(MENSAJE);
  });

  it('se recorta antes de enviar', () => {
    expect(validarMotivo('  dejó de usar el sistema  ')).toEqual({ error: null, motivo: 'dejó de usar el sistema' });
  });

  it('200 caracteres pasa y 201 no; se cuentan caracteres, no bytes (emoji = 1)', () => {
    expect(validarMotivo('a'.repeat(200)).error).toBeNull();
    expect(validarMotivo('a'.repeat(201)).error).toBe(MENSAJE);
    expect(validarMotivo('🐄'.repeat(200)).error).toBeNull();
    expect(validarMotivo('🐄'.repeat(201)).error).toBe(MENSAJE);
  });

  it('el HTML es texto: no se modifica', () => {
    expect(validarMotivo('<b>x</b>').motivo).toBe('<b>x</b>');
  });
});

describe('validarContrasenaNueva (mismas reglas que passwordSchema)', () => {
  it('menos de 10, más de 128 y justa', () => {
    expect(validarContrasenaNueva('corta')).toBe('La contraseña debe tener al menos 10 caracteres');
    expect(validarContrasenaNueva('x'.repeat(129))).toBe('La contraseña es demasiado larga');
    expect(validarContrasenaNueva('x'.repeat(10))).toBeNull();
    expect(validarContrasenaNueva('x'.repeat(128))).toBeNull();
  });

  it('no se recorta: los espacios cuentan', () => {
    expect(validarContrasenaNueva(' '.repeat(10))).toBeNull();
  });
});

describe('formatearFechaHora y textoUltimoIngreso (RF-23)', () => {
  it('dd/mm/aaaa HH:mm en hora de Argentina, también con el huso del proceso en Tokyo', () => {
    const original = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      expect(formatearFechaHora('2026-11-13T02:30:00.000Z')).toBe('12/11/2026 23:30');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('un valor que no es fecha no rompe', () => {
    expect(formatearFechaHora('no es fecha')).toBe('—');
  });

  it('"nunca ingresó" si no hay fecha; si hay, la fecha y hora', () => {
    expect(textoUltimoIngreso(null)).toBe('nunca ingresó');
    expect(textoUltimoIngreso('2026-11-13T15:05:00.000Z')).toBe('13/11/2026 12:05');
  });
});
