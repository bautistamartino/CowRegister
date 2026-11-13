import { describe, expect, it } from 'vitest';
import type { AnimalCopia, EventoReproductivo } from '../src/compartido/api';
import type { Pendiente } from '../src/sinconexion/almacen';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import { anularLocal } from '../src/sinconexion/anularLocal';
import type { Respuesta } from '../src/sinconexion/clasificar';
import { aceptadaDe, pendienteDe, persona, vacaCopia } from './ayudas';

// Anular el último evento no anulado, o descartar si es un pendiente (spec 010, RF-16 y RF-17).

const AHORA = new Date('2026-11-12T11:15:00Z');
const ID = '44444444-4444-4444-8444-444444444444';

function servicio(id: string, fecha: string): EventoReproductivo {
  return {
    id,
    tipo: 'SERVICIO',
    fecha,
    registradoPor: 'Dueño',
    registradoEn: `${fecha}T12:00:00.000Z`,
    anulacion: null,
    servicio: { tipoServicio: 'INSEMINACION', semen: null },
    tacto: null,
    parto: null,
    secado: null,
    baja: null,
  };
}

async function armar(opciones: { eventos?: EventoReproductivo[]; enLinea?: boolean; envio?: (p: Pendiente) => Respuesta } = {}) {
  const almacen = new AlmacenMemoria();
  const v = vacaCopia('a1', '12');
  const animal: AnimalCopia = { ...v, eventos: { situacion: null, eventos: opciones.eventos ?? [] } };
  await almacen.reemplazarCopia({ generadaEn: '2026-11-12T10:00:00.000Z', totalAnimales: 1, lotes: [], animales: [animal] }, persona);
  const enviados: Pendiente[] = [];
  const anular = (cambios: Record<string, unknown> = {}) =>
    anularLocal({
      almacen,
      persona,
      rol: 'DUENO',
      animal: { id: 'a1', numero: '12' },
      motivo: 'Me equivoqué',
      enLinea: opciones.enLinea ?? false,
      enviar: async (p) => {
        enviados.push(p);
        return (opciones.envio ?? ((x) => aceptadaDe(x)))(p);
      },
      ahora: AHORA,
      generarId: () => ID,
      tiempoMs: 25,
      ...cambios,
    });
  return { almacen, anular, enviados };
}

describe('anular un evento de la copia', () => {
  it('sin señal deja una anulación pendiente con el id del evento', async () => {
    const { almacen, anular } = await armar({ eventos: [servicio('s1', '2026-11-01')] });
    const r = await anular();
    expect(r).toMatchObject({ tipo: 'registro', resultado: { tipo: 'pendiente' } });
    expect(await almacen.listarPendientes()).toEqual([
      expect.objectContaining({ id: ID, tipo: 'ANULACION', datos: { eventoId: 's1', tipoEvento: 'SERVICIO', motivo: 'Me equivoqué' } }),
    ]);
  });

  it('con señal la envía enseguida (RF-15) a la ruta del tipo', async () => {
    const { almacen, anular, enviados } = await armar({ eventos: [servicio('s1', '2026-11-01')], enLinea: true });
    const r = await anular();
    expect(r).toMatchObject({ tipo: 'registro', resultado: { tipo: 'enviado' } });
    expect(enviados[0]).toMatchObject({ tipo: 'ANULACION', datos: { eventoId: 's1' } });
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('el motivo vacío se rechaza sin guardar', async () => {
    const { almacen, anular } = await armar({ eventos: [servicio('s1', '2026-11-01')] });
    expect(await anular({ motivo: '   ' })).toMatchObject({ tipo: 'registro', resultado: { tipo: 'rechazado', codigo: 400, mensaje: 'El motivo de la anulación es obligatorio' } });
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('un evento que no es el último se rechaza con el mensaje de la API (eventoId explícito)', async () => {
    const { almacen, anular } = await armar({ eventos: [servicio('s1', '2026-11-01'), servicio('s2', '2026-11-05')] });
    const r = await anular({ eventoId: 's1' });
    expect(r).toMatchObject({ tipo: 'registro', resultado: { tipo: 'rechazado', codigo: 409, mensaje: 'Primero tenés que anular el servicio del 05/11/2026' } });
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('sin ningún evento para anular: "Evento no encontrado"', async () => {
    const { anular } = await armar();
    expect(await anular()).toMatchObject({ tipo: 'registro', resultado: { tipo: 'rechazado', codigo: 404, mensaje: 'Evento no encontrado' } });
  });
});

describe('descartar en vez de anular (RF-16, RF-17)', () => {
  it('si el último evento es un pendiente: lo descarta y no crea ninguna anulación', async () => {
    const { almacen, anular } = await armar({ eventos: [servicio('s1', '2026-11-01')] });
    await almacen.guardarPendiente(pendienteDe('TACTO', { id: 't1', orden: 1, datos: { fecha: '2026-11-03', resultado: 'VACIA' } }));
    const r = await anular();
    expect(r).toMatchObject({ tipo: 'descartado', id: 't1', posteriores: [] });
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('si lo que se quiere anular es una anulación pendiente: la descarta', async () => {
    const { almacen, anular } = await armar({ eventos: [servicio('s1', '2026-11-01')] });
    await almacen.guardarPendiente(pendienteDe('ANULACION', { id: 'an1', orden: 1, datos: { eventoId: 's1', tipoEvento: 'SERVICIO', motivo: 'x' } }));
    const r = await anular({ eventoId: 'an1' });
    expect(r).toMatchObject({ tipo: 'descartado', id: 'an1', posteriores: [] });
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('devuelve los pendientes posteriores de la misma vaca SIN tocarlos (y no los de otra vaca)', async () => {
    const { almacen, anular } = await armar();
    await almacen.guardarPendiente(pendienteDe('SECADO', { id: 'sec', orden: 1, datos: { fecha: '2026-11-01' } }));
    await almacen.guardarPendiente(pendienteDe('BAJA', { id: 'baja', orden: 2, datos: { fecha: '2026-11-02', motivo: 'venta' } }));
    await almacen.guardarPendiente(pendienteDe('TACTO', { id: 'otra', animalId: 'a2', orden: 3 }));
    // La baja no cuenta como "último evento": el último no anulado sigue siendo el secado.
    const r = await anular({ eventoId: 'sec' });
    expect(r).toMatchObject({ tipo: 'descartado', id: 'sec' });
    if (r.tipo === 'descartado') expect(r.posteriores.map((p) => p.id)).toEqual(['baja']);
    expect((await almacen.listarPendientes()).map((p) => p.id).sort()).toEqual(['baja', 'otra']);
  });

  it('si el pendiente ya se envió y el servidor lo aceptó mientras tanto, cae a una anulación común', async () => {
    const { almacen, anular } = await armar({ eventos: [servicio('s1', '2026-11-01')] });
    await almacen.guardarPendiente(pendienteDe('TACTO', { id: 't1', orden: 1, estado: 'enviando', datos: { fecha: '2026-11-03', resultado: 'VACIA' } }));
    const r = await anular({ descartar: async () => 'ya-guardado' as const });
    expect(r).toMatchObject({ tipo: 'registro', resultado: { tipo: 'pendiente' } });
    expect((await almacen.listarPendientes()).some((p) => p.tipo === 'ANULACION' && p.datos.eventoId === 't1')).toBe(true);
  });

  it('un veterinario puede descartar su propio pendiente de tacto', async () => {
    const { almacen, anular } = await armar({ eventos: [servicio('s1', '2026-11-01')] });
    await almacen.guardarPendiente(pendienteDe('TACTO', { id: 't1', orden: 1, datos: { fecha: '2026-11-03', resultado: 'VACIA' } }));
    expect((await anular({ rol: 'VETERINARIO' })).tipo).toBe('descartado');
  });
});
