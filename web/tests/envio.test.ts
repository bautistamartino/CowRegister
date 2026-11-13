import { describe, expect, it } from 'vitest';
import { pedidoDe } from '../src/sinconexion/envio';
import { pendiente, pendienteDe } from './ayudas';

// URL y cuerpo del envío de cada tipo (spec 010, RF-25): la ruta de la API y el `id` de idempotencia.

describe('pedidoDe', () => {
  it.each([
    ['SERVICIO', '/api/animales/a1/servicios'],
    ['TACTO', '/api/animales/a1/tactos'],
    ['PARTO', '/api/animales/a1/partos'],
    ['SECADO', '/api/animales/a1/secados'],
    ['BAJA', '/api/animales/a1/baja'],
  ] as const)('%s va a %s con su id y la hora de la tablet, y los datos tal cual', (tipo, url) => {
    const p = pendienteDe(tipo);
    expect(pedidoDe(p)).toEqual({ url, cuerpo: { ...p.datos, id: p.id, cargadoEnDispositivo: p.cargadoEnDispositivo } });
  });

  it('los litros siguen yendo a /produccion con el mismo cuerpo de la 009', () => {
    const p = pendiente();
    expect(pedidoDe(p)).toEqual({
      url: '/api/animales/a1/produccion',
      cuerpo: { fecha: '2026-11-12', turno: 'manana', litros: '12.5', id: p.id, cargadoEnDispositivo: p.cargadoEnDispositivo },
    });
  });

  it.each([
    ['SERVICIO', 'servicios'],
    ['TACTO', 'tactos'],
    ['PARTO', 'partos'],
    ['SECADO', 'secados'],
  ])('la anulación de un %s va a /api/%s/:id/anular con solo el motivo (sin id propio)', (tipoEvento, ruta) => {
    const p = pendienteDe('ANULACION', { datos: { eventoId: 'ev-1', tipoEvento, motivo: 'Me equivoqué' } });
    expect(pedidoDe(p)).toEqual({ url: `/api/${ruta}/ev-1/anular`, cuerpo: { motivo: 'Me equivoqué' } });
  });

  it('nunca manda el tambo ni el usuario en el cuerpo', () => {
    const cuerpos = (['SERVICIO', 'PARTO', 'BAJA', 'ANULACION'] as const).map((t) => JSON.stringify(pedidoDe(pendienteDe(t)).cuerpo));
    for (const c of cuerpos) expect(c).not.toMatch(/establecimientoId|usuarioId/);
  });
});
