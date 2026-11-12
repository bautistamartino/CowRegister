import { describe, expect, it } from 'vitest';
import { crearConexion } from '../src/sinconexion/conexion';

// Tests del estado de conexión (spec 009, RF-41): puro, con la sonda y el reloj inyectados.

// Un "reloj" falso: guarda lo programado y lo dispara a mano con `pasar()`.
function relojFalso() {
  const tareas = new Set<() => void>();
  return {
    programar(fn: () => void) {
      tareas.add(fn);
      return () => tareas.delete(fn);
    },
    pasar() {
      for (const t of [...tareas]) t();
    },
    pendientes: () => tareas.size,
  };
}

// Deja correr las promesas pendientes (la sonda es asíncrona).
const esperar = () => new Promise((r) => setTimeout(r, 0));

function armar(opts: { enLinea?: boolean; respuestasSonda?: boolean[] } = {}) {
  const reloj = relojFalso();
  const respuestas = [...(opts.respuestasSonda ?? [])];
  let sondeos = 0;
  const conexion = crearConexion({
    enLineaInicial: () => opts.enLinea ?? true,
    sonda: async () => {
      sondeos++;
      return respuestas.length ? respuestas.shift()! : true;
    },
    programar: (fn) => reloj.programar(fn),
  });
  return { conexion, reloj, sondeos: () => sondeos };
}

describe('crearConexion', () => {
  it('arranca con lo que dice el navegador', () => {
    expect(armar({ enLinea: true }).conexion.enLinea()).toBe(true);
    expect(armar({ enLinea: false }).conexion.enLinea()).toBe(false);
  });

  it('un fallo de red pasa a "sin conexión" y avisa una sola vez', () => {
    const { conexion } = armar();
    const avisos: boolean[] = [];
    conexion.suscribir((v) => avisos.push(v));
    conexion.hayFalloDeRed();
    conexion.hayFalloDeRed(); // repetido: no vuelve a avisar
    expect(conexion.enLinea()).toBe(false);
    expect(avisos).toEqual([false]);
  });

  it('el evento "offline" del navegador pasa a "sin conexión"', () => {
    const { conexion } = armar();
    conexion.navegadorSinRed();
    expect(conexion.enLinea()).toBe(false);
  });

  it('el evento "online" NO alcanza: se confirma con la sonda (WiFi sin internet)', async () => {
    const { conexion } = armar({ enLinea: false, respuestasSonda: [false, true] });
    conexion.navegadorConRed();
    await esperar();
    expect(conexion.enLinea()).toBe(false); // la sonda falló
    conexion.navegadorConRed();
    await esperar();
    expect(conexion.enLinea()).toBe(true); // la sonda respondió
  });

  it('mientras está sin conexión sondea cada tanto y al responder vuelve y deja de sondear', async () => {
    const { conexion, reloj, sondeos } = armar({ respuestasSonda: [false, false, true] });
    conexion.hayFalloDeRed();
    expect(reloj.pendientes()).toBe(1);
    reloj.pasar();
    await esperar();
    reloj.pasar();
    await esperar();
    expect(conexion.enLinea()).toBe(false);
    reloj.pasar();
    await esperar();
    expect(sondeos()).toBe(3);
    expect(conexion.enLinea()).toBe(true);
    expect(reloj.pendientes()).toBe(0); // ya no sondea
  });

  it('no hace dos sondas a la vez', async () => {
    const reloj = relojFalso();
    let sondeos = 0;
    let liberar: (v: boolean) => void = () => undefined;
    const conexion = crearConexion({
      enLineaInicial: () => false,
      sonda: () => {
        sondeos++;
        return new Promise<boolean>((r) => (liberar = r));
      },
      programar: (fn) => reloj.programar(fn),
    });
    reloj.pasar();
    reloj.pasar(); // la primera todavía no terminó
    expect(sondeos).toBe(1);
    liberar(true);
    await esperar();
    expect(conexion.enLinea()).toBe(true);
  });

  it('una respuesta real del servidor vuelve a "en línea"', () => {
    const { conexion } = armar();
    conexion.hayFalloDeRed();
    conexion.hayRespuesta();
    expect(conexion.enLinea()).toBe(true);
  });

  it('suscribir devuelve la función que cancela', () => {
    const { conexion } = armar();
    const avisos: boolean[] = [];
    const cancelar = conexion.suscribir((v) => avisos.push(v));
    cancelar();
    conexion.hayFalloDeRed();
    expect(avisos).toEqual([]);
  });

  it('una sonda que lanza un error cuenta como "sin respuesta"', async () => {
    const reloj = relojFalso();
    const conexion = crearConexion({
      enLineaInicial: () => false,
      sonda: async () => {
        throw new Error('red caída');
      },
      programar: (fn) => reloj.programar(fn),
    });
    reloj.pasar();
    await esperar();
    expect(conexion.enLinea()).toBe(false);
  });
});
