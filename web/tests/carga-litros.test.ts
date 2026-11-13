import { describe, expect, it } from 'vitest';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import { cargarLitros } from '../src/sinconexion/cargarLitros';
import type { Respuesta } from '../src/sinconexion/clasificar';
import type { Pendiente } from '../src/sinconexion/almacen';
import { aceptada, pendiente, persona } from './ayudas';

// Carga de litros desde el formulario (spec 009, RF-18, RF-22 y RF-24): con señal envía enseguida;
// si no se confirma en el tiempo límite o falla la red, queda pendiente con su id; sin señal va directo.

const AHORA = new Date('2026-11-12T11:15:00Z');
const ID = '22222222-2222-4222-8222-222222222222';

type Envio = (p: Pendiente, senal: AbortSignal) => Promise<Respuesta>;

function armar(envio: Envio, cambios: { enLinea?: boolean; maxPendientes?: number } = {}) {
  const almacen = new AlmacenMemoria();
  const enviados: Pendiente[] = [];
  const cargar = (datos: Record<string, unknown> = {}) =>
    cargarLitros({
      almacen,
      persona,
      rol: 'DUENO',
      datos: { animalId: 'a1', numero: '12', fecha: '2026-11-12', turno: 'manana', litros: '12,5', ...datos },
      registrosCopia: [],
      enLinea: cambios.enLinea ?? true,
      enviar: async (p, senal) => {
        enviados.push(p);
        return envio(p, senal);
      },
      ahora: AHORA,
      generarId: () => ID,
      tiempoMs: 25, // en vez de 10 s, para que el test sea rápido
      maxPendientes: cambios.maxPendientes,
    });
  return { almacen, enviados, cargar };
}

describe('con señal', () => {
  it('lo manda enseguida con el id, los litros con punto y la hora de la tablet; si lo aceptan, no queda pendiente', async () => {
    const { almacen, enviados, cargar } = armar(async (p) => aceptada(p));
    const r = await cargar();
    expect(r.tipo).toBe('enviado');
    expect(enviados[0]).toMatchObject({ id: ID, tipo: 'LITROS', datos: { litros: '12.5' }, cargadoEnDispositivo: '2026-11-12T08:15:00-03:00', animalId: 'a1' });
    expect(await almacen.listarPendientes()).toEqual([]);
    // Queda como "enviado" hasta que la copia lo incluya, por si se corta la señal justo después.
    expect((await almacen.listarEnviados()).map((e) => e.id)).toEqual([ID]);
  });

  it('si falla la red queda pendiente con el MISMO id que se mandó (reenviarlo no duplica)', async () => {
    const { almacen, enviados, cargar } = armar(async () => ({ red: true }));
    const r = await cargar();
    expect(r.tipo).toBe('pendiente');
    const [guardado] = await almacen.listarPendientes();
    expect(guardado).toMatchObject({ id: ID, estado: 'esperando', tipo: 'LITROS', datos: { fecha: '2026-11-12', turno: 'manana', litros: '12.5' } });
    expect(enviados[0]?.id).toBe(guardado?.id);
  });

  it('si el servidor no confirma a tiempo queda pendiente (y se cancela el pedido)', async () => {
    let cancelado = false;
    const { almacen, cargar } = armar(
      (_p, senal) =>
        new Promise<Respuesta>(() => {
          senal.addEventListener('abort', () => (cancelado = true));
        }), // nunca responde
    );
    const r = await cargar();
    expect(r.tipo).toBe('pendiente');
    expect(cancelado).toBe(true);
    expect((await almacen.listarPendientes()).length).toBe(1);
  });

  it('una respuesta de la clase "esperar" (503, 429, HTML con 200) también lo deja pendiente', async () => {
    for (const respuesta of [{ estado: 503, cuerpo: null }, { estado: 429, cuerpo: { error: 'x' } }, { estado: 200, cuerpo: null }]) {
      const { almacen, cargar } = armar(async () => respuesta);
      expect((await cargar()).tipo).toBe('pendiente');
      expect((await almacen.listarPendientes()).length).toBe(1);
    }
  });

  it('un 401 no pierde lo cargado: queda pendiente para cuando vuelva a ingresar', async () => {
    const { almacen, cargar } = armar(async () => ({ estado: 401, cuerpo: { error: 'Sesión no válida' } }));
    expect((await cargar()).tipo).toBe('pendiente');
    expect((await almacen.listarPendientes()).length).toBe(1);
  });

  it('un rechazo de la API (409) se muestra y NO se guarda como pendiente', async () => {
    const { almacen, cargar } = armar(async () => ({ estado: 409, cuerpo: { error: 'Solo se carga producción de vacas en ordeñe; esta vaca está seca' } }));
    const r = await cargar();
    expect(r).toMatchObject({ tipo: 'invalido', general: 'Solo se carga producción de vacas en ordeñe; esta vaca está seca' });
    expect(await almacen.listarPendientes()).toEqual([]);
    expect(await almacen.listarEnviados()).toEqual([]);
  });

  it('un 400 con detalles se muestra debajo de cada campo', async () => {
    const { cargar } = armar(async () => ({ estado: 400, cuerpo: { error: 'Datos inválidos', detalles: [{ campo: 'fecha', mensaje: 'La fecha no puede ser futura' }] } }));
    expect(await cargar()).toMatchObject({ tipo: 'invalido', errores: { fecha: 'La fecha no puede ser futura' } });
  });

  it('una carga inválida o duplicada de un pendiente ni siquiera se envía', async () => {
    const { almacen, enviados, cargar } = armar(async () => ({ red: true }));
    expect((await cargar({ litros: '100' })).tipo).toBe('invalido');
    await almacen.guardarPendiente(pendiente());
    expect((await cargar()).tipo).toBe('invalido');
    expect(enviados).toEqual([]);
  });

  it('con 500 pendientes igual se envía si el servidor responde; si no responde, avisa que no hay lugar', async () => {
    const lleno = armar(async (p) => aceptada(p), { maxPendientes: 0 });
    expect((await lleno.cargar()).tipo).toBe('enviado');
    const sinRed = armar(async () => ({ red: true }), { maxPendientes: 0 });
    const r = await sinRed.cargar();
    expect(r.tipo).toBe('sinLugar');
    expect(await sinRed.almacen.listarPendientes()).toEqual([]);
  });
});

describe('sin señal', () => {
  it('va directo a pendiente, sin intentar la red', async () => {
    const { almacen, enviados, cargar } = armar(async () => ({ red: true }), { enLinea: false });
    const r = await cargar();
    expect(r.tipo).toBe('pendiente');
    expect(enviados).toEqual([]);
    expect(await almacen.listarPendientes()).toMatchObject([{ id: ID, estado: 'esperando', tipo: 'LITROS', datos: { litros: '12.5' } }]);
  });

  it('sin lugar en el navegador no lo confirma como guardado', async () => {
    const { almacen, cargar } = armar(async () => ({ red: true }), { enLinea: false });
    almacen.configurar({ capacidadPendientes: 0 });
    const r = await cargar();
    expect(r.tipo).toBe('sinLugar');
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('el id lo genera el dispositivo', async () => {
    const { almacen, cargar } = armar(async () => ({ red: true }), { enLinea: false });
    await cargar();
    expect((await almacen.listarPendientes())[0]?.id).toBe(ID);
  });
});
