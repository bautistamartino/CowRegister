import { describe, expect, it } from 'vitest';
import type { Rol } from '../src/compartido/api';
import type { Pendiente } from '../src/sinconexion/almacen';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import type { Respuesta } from '../src/sinconexion/clasificar';
import { registrar } from '../src/sinconexion/registrar';
import { aceptadaDe, DATOS_POR_TIPO, pendiente, pendienteDe, persona, vacaCopia } from './ayudas';

// Punto único de registro (spec 010, RF-15, RF-20, RF-22): decide entre enviar enseguida o dejar pendiente.

const AHORA = new Date('2026-11-12T11:15:00Z'); // 12/11/2026 en Argentina
const ID = '33333333-3333-4333-8333-333333333333';

type Envio = (p: Pendiente, senal: AbortSignal) => Promise<Respuesta>;

async function armar(envio: Envio, cambios: { enLinea?: boolean; rol?: Rol; maxPendientes?: number; copia?: boolean } = {}) {
  const almacen = new AlmacenMemoria();
  if (cambios.copia !== false) {
    await almacen.reemplazarCopia({ generadaEn: '2026-11-12T10:00:00.000Z', totalAnimales: 1, lotes: [], animales: [vacaCopia('a1', '12')] }, persona);
  }
  const enviados: Pendiente[] = [];
  const cargar = (tipo: Pendiente['tipo'] = 'SERVICIO', datos: Record<string, unknown> = DATOS_POR_TIPO[tipo]!) =>
    registrar({
      almacen,
      persona,
      rol: cambios.rol ?? 'DUENO',
      tipo,
      animal: { id: 'a1', numero: '12' },
      datos,
      enLinea: cambios.enLinea ?? true,
      enviar: async (p, senal) => {
        enviados.push(p);
        return envio(p, senal);
      },
      ahora: AHORA,
      generarId: () => ID,
      tiempoMs: 25,
      maxPendientes: cambios.maxPendientes,
    });
  return { almacen, enviados, cargar };
}

describe('con señal y sin pendientes delante: se envía enseguida con su id (RF-15)', () => {
  it('lo manda con el id y la hora de la tablet, sin control local previo; si lo aceptan no queda pendiente y se guarda el enviado', async () => {
    const { almacen, enviados, cargar } = await armar(async (p) => aceptadaDe(p));
    // La fecha es futura: la regla local la rechazaría, pero con señal manda el servidor (acá, aceptó).
    const r = await cargar('SERVICIO', { fecha: '2026-12-31', tipo: 'INSEMINACION' });
    expect(r).toMatchObject({ tipo: 'enviado', avisos: [], registro: null });
    expect(enviados[0]).toMatchObject({ id: ID, tipo: 'SERVICIO', cargadoEnDispositivo: '2026-11-12T08:15:00-03:00', animalId: 'a1' });
    expect(await almacen.listarPendientes()).toEqual([]);
    expect((await almacen.listarEnviados()).map((e) => e.id)).toEqual([ID]);
  });

  it('guarda los avisos del servidor junto al enviado', async () => {
    const avisos = [{ codigo: 'LOTE_1', mensaje: 'Pasó al lote Ordeñe' }];
    const { almacen, cargar } = await armar(async (p) => aceptadaDe(p, { avisos }));
    const r = await cargar('PARTO');
    expect(r).toMatchObject({ tipo: 'enviado', avisos });
    expect(await almacen.listarAvisos()).toEqual([expect.objectContaining({ id: ID, tipo: 'PARTO', avisos })]);
  });

  it.each([
    [400, 'La fecha no puede ser futura'],
    [403, 'No tenés permiso para hacer esto'],
    [404, 'Animal no encontrado'],
    [409, 'La vaca tiene una preñez vigente'],
  ])('el rechazo %i se devuelve con su mensaje y NO se guarda como pendiente', async (estado, error) => {
    const { almacen, cargar } = await armar(async () => ({ estado, cuerpo: { error } }));
    const r = await cargar();
    expect(r).toMatchObject({ tipo: 'rechazado', origen: 'servidor', codigo: estado, mensaje: error });
    expect(await almacen.listarPendientes()).toEqual([]);
    expect(await almacen.listarEnviados()).toEqual([]);
  });

  it('el rechazo con detalles de campo los devuelve por campo', async () => {
    const { cargar } = await armar(async () => ({ estado: 400, cuerpo: { error: 'Datos inválidos', detalles: [{ campo: 'fecha', mensaje: 'La fecha no puede ser futura' }] } }));
    expect(await cargar()).toMatchObject({ tipo: 'rechazado', campos: { fecha: 'La fecha no puede ser futura' } });
  });

  it.each([
    ['falla de red', async () => ({ red: true }) as Respuesta],
    ['un 503', async () => ({ estado: 503, cuerpo: null }) as Respuesta],
    ['un 401 (sesión vencida)', async () => ({ estado: 401, cuerpo: null }) as Respuesta],
    ['un HTML de portal', async () => ({ estado: 200, cuerpo: null }) as Respuesta],
  ])('%s: queda pendiente con el MISMO id que se mandó', async (_n, envio) => {
    const { almacen, enviados, cargar } = await armar(envio);
    const r = await cargar();
    expect(r.tipo).toBe('pendiente');
    const [guardado] = await almacen.listarPendientes();
    expect(guardado).toMatchObject({ id: ID, tipo: 'SERVICIO', estado: 'esperando', datos: DATOS_POR_TIPO.SERVICIO });
    expect(enviados[0]?.id).toBe(guardado?.id);
  });

  it('si el servidor no confirma a tiempo queda pendiente (y se cancela el pedido)', async () => {
    let cancelado = false;
    const { almacen, cargar } = await armar((_p, senal) => new Promise<Respuesta>(() => senal.addEventListener('abort', () => (cancelado = true))));
    expect((await cargar()).tipo).toBe('pendiente');
    expect(cancelado).toBe(true);
    expect(await almacen.listarPendientes()).toHaveLength(1);
  });

  it('una anulación se manda a su ruta y se guarda como enviado con la hora de la anulación', async () => {
    const { almacen, enviados, cargar } = await armar(async (p) => aceptadaDe(p));
    const r = await cargar('ANULACION', { eventoId: 'ev-1', tipoEvento: 'TACTO', motivo: 'Error' });
    expect(r.tipo).toBe('enviado');
    expect(enviados[0]).toMatchObject({ tipo: 'ANULACION', datos: { eventoId: 'ev-1' } });
    expect((await almacen.listarEnviados())[0]).toMatchObject({ tipo: 'ANULACION', aceptadoEn: Date.parse('2026-11-12T11:30:00.000Z') });
  });
});

describe('con pendientes delante: se guarda detrás aunque haya señal (RF-15)', () => {
  it.each(['esperando', 'enviando', 'rechazado'] as const)('con un evento %s de la vaca no envía nada y guarda detrás', async (estado) => {
    const { almacen, enviados, cargar } = await armar(async (p) => aceptadaDe(p));
    await almacen.guardarPendiente(pendienteDe('TACTO', { id: 'delante', orden: 5, estado, datos: { fecha: '2026-11-01', resultado: 'VACIA' } }));
    const r = await cargar('SERVICIO', { fecha: '2026-11-02', tipo: 'INSEMINACION' });
    expect(r.tipo).toBe('pendiente');
    expect(enviados).toEqual([]);
    const guardados = (await almacen.listarPendientes()).sort((a, b) => a.orden - b.orden);
    expect(guardados.map((p) => p.id)).toEqual(['delante', ID]);
    expect(guardados[1]!.orden).toBeGreaterThan(5);
  });

  it('un evento pendiente de OTRA vaca no frena (se envía enseguida)', async () => {
    const { almacen, enviados, cargar } = await armar(async (p) => aceptadaDe(p));
    await almacen.guardarPendiente(pendienteDe('TACTO', { id: 'otra', animalId: 'a2', orden: 5 }));
    expect((await cargar()).tipo).toBe('enviado');
    expect(enviados).toHaveLength(1);
  });

  it('los litros pendientes no desvían a un evento: se envía enseguida', async () => {
    const { almacen, enviados, cargar } = await armar(async (p) => aceptadaDe(p));
    await almacen.guardarPendiente(pendiente({ id: 'litro', orden: 5 }));
    expect((await cargar()).tipo).toBe('enviado');
    expect(enviados.map((p) => p.id)).toEqual([ID]);
  });

  it('los litros con un evento pendiente de su vaca esperan detrás sin enviarse', async () => {
    const { almacen, enviados, cargar } = await armar(async (p) => aceptadaDe(p));
    await almacen.guardarPendiente(pendienteDe('PARTO', { id: 'parto', orden: 5 }));
    const r = await cargar('LITROS', { fecha: '2026-11-12', turno: 'manana', litros: '12.5' });
    expect(r.tipo).toBe('pendiente');
    expect(enviados).toEqual([]);
    expect((await almacen.listarPendientes()).find((p) => p.id === ID)).toMatchObject({ tipo: 'LITROS', datos: { litros: '12.5' } });
  });

  it('con pendientes delante controla con las reglas locales sobre la vista: un segundo secado se rechaza sin guardar', async () => {
    const { almacen, cargar } = await armar(async (p) => aceptadaDe(p));
    await almacen.guardarPendiente(pendienteDe('SECADO', { id: 'secado', orden: 5, datos: { fecha: '2026-11-01' } }));
    const r = await cargar('SECADO', { fecha: '2026-11-05' });
    expect(r).toMatchObject({ tipo: 'rechazado', origen: 'local', codigo: 409 });
    expect(await almacen.listarPendientes()).toHaveLength(1);
  });
});

describe('sin señal: reglas locales y guardado (RF-15, RF-20, RF-22)', () => {
  it('lo válido se guarda como pendiente sin intentar la red', async () => {
    const { almacen, enviados, cargar } = await armar(async (p) => aceptadaDe(p), { enLinea: false });
    const r = await cargar();
    expect(r.tipo).toBe('pendiente');
    expect(enviados).toEqual([]);
    expect(await almacen.listarPendientes()).toEqual([expect.objectContaining({ id: ID, tipo: 'SERVICIO', animalId: 'a1', numero: '12', usuarioId: persona.usuarioId })]);
  });

  it('lo inválido se devuelve con el mensaje de la API y no se guarda', async () => {
    const { almacen, cargar } = await armar(async (p) => aceptadaDe(p), { enLinea: false });
    const r = await cargar('SERVICIO', { fecha: '2026-12-31', tipo: 'INSEMINACION' });
    expect(r).toMatchObject({ tipo: 'rechazado', origen: 'local', codigo: 400, mensaje: 'La fecha no puede ser futura', campos: { fecha: 'La fecha no puede ser futura' } });
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('una carga cuya vaca no está en la copia se rechaza como "Animal no encontrado"', async () => {
    const { almacen, cargar } = await armar(async (p) => aceptadaDe(p), { enLinea: false, copia: false });
    expect(await cargar()).toMatchObject({ tipo: 'rechazado', origen: 'local', codigo: 404, mensaje: 'Animal no encontrado' });
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('el límite de pendientes no se confirma como guardado, con el mensaje de siempre', async () => {
    const { almacen, cargar } = await armar(async (p) => aceptadaDe(p), { enLinea: false, maxPendientes: 1 });
    await almacen.guardarPendiente(pendienteDe('TACTO', { id: 'ya', animalId: 'a2', orden: 1 }));
    const r = await cargar();
    expect(r).toMatchObject({ tipo: 'sinLugar', mensaje: 'No se pudo guardar en la tablet: ya hay 1 pendientes. Conectate para sincronizar los pendientes' });
    expect(await almacen.listarPendientes()).toHaveLength(1);
  });

  it('el navegador sin espacio tampoco se confirma como guardado', async () => {
    const { almacen, cargar } = await armar(async (p) => aceptadaDe(p), { enLinea: false });
    almacen.configurar({ capacidadPendientes: 0 });
    const r = await cargar();
    expect(r.tipo).toBe('sinLugar');
    expect(r.tipo === 'sinLugar' && r.mensaje).toContain('no hay espacio en la tablet');
  });
});

describe('permiso por rol (RF-22)', () => {
  it('un veterinario no puede cargar un parto: se rechaza con 403, sin enviar ni guardar', async () => {
    const { almacen, enviados, cargar } = await armar(async (p) => aceptadaDe(p), { rol: 'VETERINARIO' });
    expect(await cargar('PARTO')).toMatchObject({ tipo: 'rechazado', origen: 'local', codigo: 403 });
    expect(enviados).toEqual([]);
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('un veterinario sí puede cargar un servicio y un tacto', async () => {
    const { cargar } = await armar(async (p) => aceptadaDe(p), { rol: 'VETERINARIO' });
    expect((await cargar('SERVICIO')).tipo).toBe('enviado');
    expect((await cargar('TACTO')).tipo).toBe('enviado');
  });

  it('anular un secado también le está vedado al veterinario; anular un servicio no', async () => {
    const { cargar } = await armar(async (p) => aceptadaDe(p), { rol: 'VETERINARIO' });
    expect(await cargar('ANULACION', { eventoId: 'e', tipoEvento: 'SECADO', motivo: 'x' })).toMatchObject({ tipo: 'rechazado', codigo: 403 });
    expect((await cargar('ANULACION', { eventoId: 'e', tipoEvento: 'SERVICIO', motivo: 'x' })).tipo).toBe('enviado');
  });

  it('los litros solo los carga dueño o encargado (con el mensaje de la API)', async () => {
    const { cargar } = await armar(async (p) => aceptadaDe(p), { rol: 'VETERINARIO' });
    expect(await cargar('LITROS', { fecha: '2026-11-12', turno: 'manana', litros: '10' })).toMatchObject({ tipo: 'rechazado', codigo: 403, mensaje: 'Esta acción la tiene que hacer un dueño o encargado' });
  });
});
