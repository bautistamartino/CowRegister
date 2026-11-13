import { describe, expect, it } from 'vitest';
import { clasificarRespuesta } from '../src/sinconexion/clasificar';
import { aceptada, aceptadaDe, ANULADO_EN, pendiente, pendienteDe, registroDe, REGISTRADO_EN } from './ayudas';

// Tabla cerrada de respuestas del servidor al enviar un pendiente (spec 009, RF-24 y RF-29 a RF-32).

const p = pendiente();
const conError = (estado: number, error = 'Motivo en español') => ({ estado, cuerpo: { error } });

describe('aceptado', () => {
  it('201 con el registro que coincide con el pendiente', () => {
    const c = clasificarRespuesta(aceptada(p), p);
    expect(c.tipo).toBe('aceptado');
    if (c.tipo === 'aceptado') expect(c.registro?.id).toBe(p.id);
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

// ─── Spec 010: forma aceptada por tipo (RF-25, RF-28) ───

describe('aceptado por tipo de evento', () => {
  it.each(['SERVICIO', 'TACTO', 'PARTO', 'SECADO', 'BAJA'] as const)('%s: el 201 de su ruta es aceptado, con la hora del servidor y sin registro de litros', (tipo) => {
    const pe = pendienteDe(tipo);
    const c = clasificarRespuesta(aceptadaDe(pe), pe);
    expect(c).toMatchObject({ tipo: 'aceptado', registro: null, aceptadoEn: Date.parse(REGISTRADO_EN), avisos: [] });
  });

  it.each(['SERVICIO', 'TACTO', 'PARTO', 'SECADO', 'BAJA'] as const)('%s: el 200 "yaExistia" con el mismo id también es aceptado', (tipo) => {
    const pe = pendienteDe(tipo);
    expect(clasificarRespuesta(aceptadaDe(pe, { reenvio: true }), pe).tipo).toBe('aceptado');
  });

  it('los avisos del cuerpo (201 o 200) viajan en la clasificación', () => {
    const avisos = [{ codigo: 'LOTE_1', mensaje: 'La vaca pasó al lote Ordeñe' }];
    const pe = pendienteDe('PARTO');
    expect(clasificarRespuesta(aceptadaDe(pe, { avisos }), pe)).toMatchObject({ tipo: 'aceptado', avisos });
    expect(clasificarRespuesta(aceptadaDe(pe, { avisos, reenvio: true }), pe)).toMatchObject({ tipo: 'aceptado', avisos });
  });

  it.each(['SERVICIO', 'TACTO', 'PARTO', 'SECADO'] as const)('anulación de %s: aceptada con la hora de la anulación (también el reenvío "yaEstabaAnulado")', (tipoEvento) => {
    const pe = pendienteDe('ANULACION', { datos: { eventoId: 'ev-9', tipoEvento, motivo: 'x' } });
    expect(clasificarRespuesta(aceptadaDe(pe), pe)).toMatchObject({ tipo: 'aceptado', aceptadoEn: Date.parse(ANULADO_EN) });
    expect(clasificarRespuesta(aceptadaDe(pe, { reenvio: true }), pe).tipo).toBe('aceptado');
  });

  it('un 2xx de otro evento (otro id), sin forma de la API o HTML de un portal NO es aceptado: espera', () => {
    const pe = pendienteDe('SERVICIO');
    const otro = aceptadaDe(pendienteDe('SERVICIO', { id: 'otro' }));
    expect(clasificarRespuesta(otro, pe).tipo).toBe('esperar');
    expect(clasificarRespuesta({ estado: 200, cuerpo: null }, pe).tipo).toBe('esperar');
    expect(clasificarRespuesta({ estado: 200, cuerpo: { cosa: 1 } }, pe).tipo).toBe('esperar');
    // Un parto cuyo 201 vino sin la caja { evento, avisos } no es de la API.
    const parto = pendienteDe('PARTO');
    expect(clasificarRespuesta({ estado: 201, cuerpo: (aceptadaDe(pendienteDe('SERVICIO', { id: parto.id })).cuerpo as object) }, parto).tipo).toBe('esperar');
  });

  it('una anulación cuya respuesta no trae el evento anulado, o es de otro evento, espera', () => {
    const pe = pendienteDe('ANULACION');
    const sinAnular = aceptadaDe(pendienteDe('SERVICIO', { id: 'evento-1' }));
    expect(clasificarRespuesta(sinAnular, pe).tipo).toBe('esperar');
    const otra = pendienteDe('ANULACION', { datos: { eventoId: 'distinto', tipoEvento: 'SERVICIO', motivo: 'x' } });
    expect(clasificarRespuesta(aceptadaDe(otra), pe).tipo).toBe('esperar');
  });

  it('la tabla cerrada no cambia con los eventos: 409 es rechazo, 401 sesión, 503 y la red esperan', () => {
    const pe = pendienteDe('TACTO');
    expect(clasificarRespuesta(conError(409, 'La vaca tiene una preñez vigente'), pe)).toMatchObject({ tipo: 'rechazado', estado: 409 });
    expect(clasificarRespuesta({ estado: 401, cuerpo: null }, pe).tipo).toBe('sesion');
    expect(clasificarRespuesta({ estado: 503, cuerpo: null }, pe).tipo).toBe('esperar');
    expect(clasificarRespuesta({ red: true }, pe)).toMatchObject({ tipo: 'esperar', red: true });
  });
});
