import { describe, expect, it } from 'vitest';
import type { Pendiente } from '../src/sinconexion/almacen';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import type { Respuesta } from '../src/sinconexion/clasificar';
import { descartarYReanudar, reintentarYReanudar } from '../src/sinconexion/reanudar';
import { crearSincronizador } from '../src/sinconexion/sincronizar';
import { aceptadaDe, pendiente, pendienteDe, persona } from './ayudas';

// Lo que hace el ColaProvider al reintentar o descartar un rechazado (spec 010, RF-27): después hay que correr una
// ronda COMPLETA (sin `soloId`) para que se reanuden los de la misma vaca que esperaban por él.

function armar() {
  const almacen = new AlmacenMemoria();
  const enviados: string[] = [];
  let parto = 0;
  const sinc = crearSincronizador({
    almacen,
    persona,
    ahora: () => 1_000_000,
    bloqueo: (fn) => fn(),
    enviar: async (p: Pendiente): Promise<Respuesta> => {
      enviados.push(p.id);
      // El parto se rechaza la primera vez y se acepta al reintentarlo.
      if (p.id === 'parto' && ++parto === 1) return { estado: 409, cuerpo: { error: 'La vaca no está apta' } };
      return aceptadaDe(p);
    },
  });
  // Igual que `correr` del proveedor: una ronda que ignora las esperas.
  const rondas: Array<{ soloId?: string }> = [];
  const correr = (opciones: { soloId?: string; ignorarEsperas?: boolean } = {}) => {
    rondas.push(opciones);
    return sinc.sincronizar(opciones).then(() => undefined);
  };
  return { almacen, sinc, enviados, correr, rondas };
}

async function conPartoRechazado() {
  const c = armar();
  await c.almacen.guardarPendiente(pendienteDe('PARTO', { id: 'parto', animalId: 'a1', orden: 1 }));
  await c.almacen.guardarPendiente(pendienteDe('TACTO', { id: 'tacto', animalId: 'a1', orden: 2 }));
  await c.almacen.guardarPendiente(pendiente({ id: 'litros', animalId: 'a1', orden: 3 }));
  await c.sinc.sincronizar();
  c.enviados.length = 0;
  return c;
}

describe('reanudar tras reintentar o descartar (RF-27)', () => {
  it('reintentar el rechazado corre una ronda completa y los que esperaban se envían', async () => {
    const { sinc, almacen, enviados, correr, rondas } = await conPartoRechazado();
    await reintentarYReanudar(sinc, 'parto', correr);
    expect(enviados).toEqual(['parto', 'tacto', 'litros']);
    expect(rondas.every((r) => r.soloId === undefined)).toBe(true);
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('descartar el rechazado corre una ronda completa y los que esperaban se envían', async () => {
    const { sinc, almacen, enviados, correr } = await conPartoRechazado();
    expect(await descartarYReanudar(sinc, 'parto', { confirmado: true }, correr)).toBe('descartado');
    expect(enviados).toEqual(['tacto', 'litros']);
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('si el descarte pide confirmación no se corre ninguna ronda', async () => {
    const { sinc, enviados, correr, rondas } = await conPartoRechazado();
    expect(await descartarYReanudar(sinc, 'tacto', undefined, correr)).toBe('requiere-confirmacion');
    expect(rondas).toEqual([]);
    expect(enviados).toEqual([]);
  });
});
