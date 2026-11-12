import { describe, expect, it } from 'vitest';
import { clasificarRespuesta } from '../src/sinconexion/clasificar';
import { aceptada, pendiente, registroDe } from './ayudas';

// Tabla cerrada de respuestas del servidor al enviar un pendiente (spec 009, RF-24 y RF-29 a RF-32).

const p = pendiente();
const conError = (estado: number, error = 'Motivo en español') => ({ estado, cuerpo: { error } });

describe('aceptado', () => {
  it('201 con el registro que coincide con el pendiente', () => {
    const c = clasificarRespuesta(aceptada(p), p);
    expect(c.tipo).toBe('aceptado');
    if (c.tipo === 'aceptado') expect(c.registro.id).toBe(p.id);
  });

  it('200 (ya estaba guardado con el mismo id y los mismos datos) también es aceptado', () => {
    expect(clasificarRespuesta({ estado: 200, cuerpo: registroDe(p) }, p).tipo).toBe('aceptado');
  });

  it('el id puede venir en mayúsculas', () => {
    expect(clasificarRespuesta({ estado: 201, cuerpo: registroDe(p, { id: p.id.toUpperCase() }) }, p).tipo).toBe('aceptado');
  });

  it('un 2xx cuyo cuerpo no coincide (otro id, vaca, fecha, turno o litros) NO es aceptado: espera', () => {
    for (const cambio of [{ id: 'otro' }, { animalId: 'otra' }, { fecha: '2026-11-11' }, { turno: 'tarde' as const }, { litros: 13 }]) {
      expect(clasificarRespuesta({ estado: 201, cuerpo: registroDe(p, cambio) }, p).tipo).toBe('esperar');
    }
  });
});

describe('rechazado: solo 400, 403, 404 y 409 con el mensaje de la API', () => {
  for (const estado of [400, 403, 404, 409]) {
    it(`${estado} con { error } queda rechazado con el motivo`, () => {
      const c = clasificarRespuesta(conError(estado, 'Animal no encontrado'), p);
      expect(c).toMatchObject({ tipo: 'rechazado', estado, motivo: 'Animal no encontrado' });
    });
  }

  it('el 400 con detalles usa el mensaje de cada campo', () => {
    const c = clasificarRespuesta({ estado: 400, cuerpo: { error: 'Datos inválidos', detalles: [{ campo: 'litros', mensaje: 'Los litros no pueden superar 99,9' }] } }, p);
    expect(c).toMatchObject({ tipo: 'rechazado', motivo: 'Los litros no pueden superar 99,9', campos: { litros: 'Los litros no pueden superar 99,9' } });
  });

  it('un 404 o 403 que NO es JSON de la API (portal, proxy) espera: no se pierde nada', () => {
    expect(clasificarRespuesta({ estado: 404, cuerpo: null }, p).tipo).toBe('esperar');
    expect(clasificarRespuesta({ estado: 403, cuerpo: null }, p).tipo).toBe('esperar');
    expect(clasificarRespuesta({ estado: 409, cuerpo: { otra: 'cosa' } }, p).tipo).toBe('esperar');
  });
});

describe('sesión', () => {
  it('401 es sesión (detiene el envío y conserva todo)', () => {
    expect(clasificarRespuesta(conError(401, 'Sesión no válida'), p).tipo).toBe('sesion');
    expect(clasificarRespuesta({ estado: 401, cuerpo: null }, p).tipo).toBe('sesion');
  });
});

describe('esperar: se reintenta solo, nunca rechazado', () => {
  for (const estado of [408, 429, 500, 502, 503, 504, 599]) {
    it(`${estado} espera`, () => {
      expect(clasificarRespuesta(conError(estado), p).tipo).toBe('esperar');
    });
  }

  for (const estado of [301, 302, 402, 405, 410, 413, 418, 422]) {
    it(`un código no listado (${estado}) espera`, () => {
      expect(clasificarRespuesta(conError(estado), p).tipo).toBe('esperar');
    });
  }

  it('corte de red y tiempo agotado esperan', () => {
    expect(clasificarRespuesta({ red: true }, p)).toMatchObject({ tipo: 'esperar', red: true });
    expect(clasificarRespuesta({ red: true, motivo: 'tiempo' }, p)).toMatchObject({ tipo: 'esperar', red: true });
  });

  it('200 con HTML (portal cautivo de WiFi): cuerpo que no es JSON espera', () => {
    expect(clasificarRespuesta({ estado: 200, cuerpo: null }, p)).toMatchObject({ tipo: 'esperar', red: false });
    expect(clasificarRespuesta({ estado: 200, cuerpo: '<html>Iniciá sesión en el WiFi</html>' }, p).tipo).toBe('esperar');
    expect(clasificarRespuesta({ estado: 200, cuerpo: [] }, p).tipo).toBe('esperar');
  });

  it('el motivo de la espera está en español', () => {
    for (const r of [{ red: true as const }, { estado: 503, cuerpo: null }, { estado: 429, cuerpo: null }, { estado: 200, cuerpo: null }]) {
      const c = clasificarRespuesta(r, p);
      expect(c.tipo === 'esperar' && c.motivo.length > 0).toBe(true);
    }
  });
});
