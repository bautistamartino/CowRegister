import { describe, expect, it } from 'vitest';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import { crearSincronizador } from '../src/sinconexion/sincronizar';
import type { Respuesta } from '../src/sinconexion/clasificar';
import type { Pendiente } from '../src/sinconexion/almacen';
import { aceptada, pendiente, persona } from './ayudas';

// Sincronización de los pendientes (spec 009, RF-29 a RF-32, RF-34, RF-37 a RF-39).
// El envío al servidor es una función inyectada: los tests deciden qué responde.

type Envio = (p: Pendiente) => Promise<Respuesta> | Respuesta;

function armar(opciones: { envio?: Envio; ahora?: () => number; bloqueo?: (fn: () => Promise<void>) => Promise<void> } = {}) {
  const almacen = new AlmacenMemoria();
  const enviados: string[] = []; // ids enviados, en orden
  let enCurso = 0;
  let maxEnParalelo = 0;
  const progreso: ({ actual: number; total: number } | null)[] = [];
  const reloj = { t: 1_000_000 };
  const envio: Envio = opciones.envio ?? ((p) => aceptada(p));
  const sinc = crearSincronizador({
    almacen,
    persona,
    ahora: opciones.ahora ?? (() => reloj.t),
    bloqueo: opciones.bloqueo,
    alProgreso: (p) => progreso.push(p),
    enviar: async (p) => {
      enCurso++;
      maxEnParalelo = Math.max(maxEnParalelo, enCurso);
      enviados.push(p.id);
      try {
        await Promise.resolve(); // un turno de espera: si hubiera paralelismo, se notaría
        return await envio(p);
      } finally {
        enCurso--;
      }
    },
  });
  return { almacen, sinc, enviados, progreso, reloj, maxEnParalelo: () => maxEnParalelo };
}

const guardados = async (a: AlmacenMemoria) => Object.fromEntries((await a.listarPendientes()).map((p) => [p.id, p]));

describe('envío en orden y de a uno (RF-29)', () => {
  it('envía en el orden en que se cargaron, de a uno, y los aceptados dejan de ser pendientes', async () => {
    const { almacen, sinc, enviados, maxEnParalelo } = armar();
    // Se guardan desordenados a propósito: manda `orden`, no la posición.
    await almacen.guardarPendiente(pendiente({ id: 'c', animalId: 'a3', orden: 30 }));
    await almacen.guardarPendiente(pendiente({ id: 'a', animalId: 'a1', orden: 10 }));
    await almacen.guardarPendiente(pendiente({ id: 'b', animalId: 'a2', orden: 20 }));
    const r = await sinc.sincronizar();
    expect(enviados).toEqual(['a', 'b', 'c']);
    expect(maxEnParalelo()).toBe(1);
    expect(r).toMatchObject({ aceptados: 3, rechazados: 0, detenido: null });
    expect(await almacen.listarPendientes()).toEqual([]);
    expect((await almacen.listarEnviados()).map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('informa el avance "3 de 12" y lo limpia al terminar', async () => {
    const { almacen, sinc, progreso } = armar();
    for (let i = 1; i <= 3; i++) await almacen.guardarPendiente(pendiente({ id: `p${i}`, animalId: `a${i}`, orden: i }));
    await sinc.sincronizar();
    expect(progreso.filter((p) => p !== null)).toEqual([
      { actual: 1, total: 3 },
      { actual: 2, total: 3 },
      { actual: 3, total: 3 },
    ]);
    expect(progreso.at(-1)).toBeNull();
  });

  it('el aceptado queda como "enviado" con el registro del servidor, visible hasta que la copia lo incluya (RF-34)', async () => {
    const { almacen, sinc } = armar();
    await almacen.guardarPendiente(pendiente());
    await sinc.sincronizar();
    const [e] = await almacen.listarEnviados();
    expect(e).toMatchObject({ animalId: 'a1', numero: '12', registro: { litros: 12.5, fecha: '2026-11-12', turno: 'manana' } });
  });

  it('manda el mismo id en cada reintento (no duplica)', async () => {
    let intento = 0;
    const { almacen, sinc, enviados } = armar({ envio: (p) => (++intento === 1 ? { red: true } : aceptada(p)) });
    await almacen.guardarPendiente(pendiente({ id: 'x' }));
    await sinc.sincronizar();
    await sinc.sincronizar({ ignorarEsperas: true });
    expect(enviados).toEqual(['x', 'x']);
  });

  it('solo envía los pendientes del usuario y tambo de la sesión', async () => {
    const { almacen, sinc, enviados } = armar();
    await almacen.guardarPendiente(pendiente({ id: 'mio' }));
    await almacen.guardarPendiente(pendiente({ id: 'ajeno', usuarioId: 'otro', animalId: 'a2' }));
    await almacen.guardarPendiente(pendiente({ id: 'otro-tambo', establecimientoId: 'otro', animalId: 'a3' }));
    await sinc.sincronizar();
    expect(enviados).toEqual(['mio']);
    expect(Object.keys(await guardados(almacen)).sort()).toEqual(['ajeno', 'otro-tambo']);
  });

  it('dos rondas a la vez no envían el mismo pendiente dos veces', async () => {
    const { almacen, sinc, enviados, maxEnParalelo } = armar();
    await almacen.guardarPendiente(pendiente({ id: 'x' }));
    await Promise.all([sinc.sincronizar(), sinc.sincronizar(), sinc.sincronizar()]);
    expect(enviados).toEqual(['x']);
    expect(maxEnParalelo()).toBe(1);
  });

  it('si otra pestaña tiene el candado, no envía nada', async () => {
    const { almacen, sinc, enviados } = armar({ bloqueo: async () => undefined }); // el candado no se obtuvo
    await almacen.guardarPendiente(pendiente());
    await sinc.sincronizar();
    expect(enviados).toEqual([]);
    expect((await almacen.listarPendientes()).length).toBe(1);
  });
});

describe('rechazos (RF-30)', () => {
  it('un 409 queda rechazado con el motivo de la API, no se reintenta solo y se sigue con los demás', async () => {
    const { almacen, sinc, enviados } = armar({
      envio: (p) => (p.id === 'dup' ? { estado: 409, cuerpo: { error: 'Ya hay una carga de esta vaca para el ordeño de mañana del 12/11/2026' } } : aceptada(p)),
    });
    await almacen.guardarPendiente(pendiente({ id: 'dup', orden: 1 }));
    await almacen.guardarPendiente(pendiente({ id: 'ok', animalId: 'a2', orden: 2 }));
    const r = await sinc.sincronizar();
    expect(enviados).toEqual(['dup', 'ok']);
    expect(r).toMatchObject({ aceptados: 1, rechazados: 1 });
    const g = await guardados(almacen);
    expect(g['dup']).toMatchObject({ estado: 'rechazado', codigoRechazo: 409, motivo: 'Ya hay una carga de esta vaca para el ordeño de mañana del 12/11/2026', proximoIntento: null });
    expect(g['ok']).toBeUndefined();
    // Otra ronda (aunque ignore las esperas) NO vuelve a enviar el rechazado.
    await sinc.sincronizar({ ignorarEsperas: true });
    expect(enviados).toEqual(['dup', 'ok']);
  });

  for (const [estado, error] of [
    [400, 'Los litros no pueden superar 99,9'],
    [403, 'No tenés permiso para esta acción'],
    [404, 'Animal no encontrado'],
  ] as const) {
    it(`un ${estado} queda rechazado`, async () => {
      const { almacen, sinc } = armar({ envio: () => ({ estado, cuerpo: { error } }) });
      await almacen.guardarPendiente(pendiente({ id: 'x' }));
      await sinc.sincronizar();
      expect((await guardados(almacen))['x']).toMatchObject({ estado: 'rechazado', codigoRechazo: estado, motivo: error });
    });
  }

  it('"Reintentar" lo vuelve a poner en espera y lo envía con el mismo id', async () => {
    let n = 0;
    const { almacen, sinc, enviados } = armar({ envio: (p) => (++n === 1 ? { estado: 409, cuerpo: { error: 'Duplicado' } } : aceptada(p)) });
    await almacen.guardarPendiente(pendiente({ id: 'x' }));
    await sinc.sincronizar();
    expect((await guardados(almacen))['x']?.estado).toBe('rechazado');
    await sinc.reintentar('x');
    expect((await guardados(almacen))['x']).toMatchObject({ estado: 'esperando', motivo: null, codigoRechazo: null, intentos: 0 });
    const r = await sinc.sincronizar({ ignorarEsperas: true });
    expect(r.aceptados).toBe(1);
    expect(enviados).toEqual(['x', 'x']);
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('"Reintentar" solo cambia los rechazados', async () => {
    const { almacen, sinc } = armar();
    await almacen.guardarPendiente(pendiente({ id: 'x', intentos: 2, motivo: 'esperando' }));
    await sinc.reintentar('x');
    expect((await guardados(almacen))['x']).toMatchObject({ intentos: 2, motivo: 'esperando' });
  });
});

describe('sesión (RF-31)', () => {
  it('un 401 detiene el envío, conserva todo y no marca nada como rechazado', async () => {
    const { almacen, sinc, enviados } = armar({ envio: (p) => (p.id === 'b' ? { estado: 401, cuerpo: { error: 'Sesión no válida' } } : aceptada(p)) });
    await almacen.guardarPendiente(pendiente({ id: 'a', orden: 1 }));
    await almacen.guardarPendiente(pendiente({ id: 'b', animalId: 'a2', orden: 2 }));
    await almacen.guardarPendiente(pendiente({ id: 'c', animalId: 'a3', orden: 3 }));
    const r = await sinc.sincronizar();
    expect(r.detenido).toBe('sesion');
    expect(enviados).toEqual(['a', 'b']); // 'c' ni se intentó
    const g = await guardados(almacen);
    expect(g['b']).toMatchObject({ estado: 'esperando', intentos: 0, motivo: null }); // vuelve a esperando: no quedó "enviando"
    expect(g['c']).toMatchObject({ estado: 'esperando' });
    expect(g['a']).toBeUndefined(); // el primero sí se aceptó
  });

  it('avisa que hubo un 401 aunque sea el primero', async () => {
    const { almacen, sinc } = armar({ envio: () => ({ estado: 401, cuerpo: null }) });
    await almacen.guardarPendiente(pendiente({ id: 'a' }));
    expect((await sinc.sincronizar()).detenido).toBe('sesion');
    expect((await almacen.listarPendientes())[0]).toMatchObject({ estado: 'esperando' });
  });
});

describe('esperas crecientes (RF-32)', () => {
  it('un 503 deja el pendiente esperando con la primera espera de 5 s', async () => {
    const { almacen, sinc, reloj } = armar({ envio: () => ({ estado: 503, cuerpo: null }) });
    await almacen.guardarPendiente(pendiente({ id: 'x' }));
    await sinc.sincronizar();
    expect((await guardados(almacen))['x']).toMatchObject({ estado: 'esperando', intentos: 1, proximoIntento: reloj.t + 5_000 });
  });

  it('las esperas crecen 5 s, 15 s, 45 s, 2 min y 5 min (tope) y nunca lo marcan rechazado', async () => {
    const { almacen, sinc, reloj } = armar({ envio: () => ({ estado: 429, cuerpo: { error: 'Demasiados pedidos' } }) });
    await almacen.guardarPendiente(pendiente({ id: 'x' }));
    const esperas: number[] = [];
    for (let i = 0; i < 7; i++) {
      await sinc.sincronizar({ ignorarEsperas: true });
      const p = (await guardados(almacen))['x']!;
      expect(p.estado).toBe('esperando');
      esperas.push(p.proximoIntento! - reloj.t);
    }
    expect(esperas).toEqual([5_000, 15_000, 45_000, 120_000, 300_000, 300_000, 300_000]);
  });

  it('antes de que se cumpla la espera no se reintenta; después sí; y "Reintentar ahora" lo fuerza', async () => {
    let n = 0;
    const { almacen, sinc, enviados, reloj } = armar({ envio: (p) => (++n === 1 ? { estado: 500, cuerpo: null } : aceptada(p)) });
    await almacen.guardarPendiente(pendiente({ id: 'x' }));
    await sinc.sincronizar();
    reloj.t += 4_999;
    await sinc.sincronizar();
    expect(enviados).toEqual(['x']); // todavía no
    reloj.t += 1;
    await sinc.sincronizar();
    expect(enviados).toEqual(['x', 'x']);
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('"Reintentar ahora" sobre uno solo no toca a los demás', async () => {
    const { almacen, sinc, enviados } = armar();
    await almacen.guardarPendiente(pendiente({ id: 'a', orden: 1, proximoIntento: 9_999_999, intentos: 3 }));
    await almacen.guardarPendiente(pendiente({ id: 'b', animalId: 'a2', orden: 2, proximoIntento: 9_999_999, intentos: 3 }));
    await sinc.sincronizar({ soloId: 'b', ignorarEsperas: true });
    expect(enviados).toEqual(['b']);
  });

  it('un corte de red detiene la ronda (los siguientes ni se intentan); un 503 de uno no frena a los demás', async () => {
    const red = armar({ envio: () => ({ red: true }) });
    await red.almacen.guardarPendiente(pendiente({ id: 'a', orden: 1 }));
    await red.almacen.guardarPendiente(pendiente({ id: 'b', animalId: 'a2', orden: 2 }));
    const r = await red.sinc.sincronizar();
    expect(r.detenido).toBe('red');
    expect(red.enviados).toEqual(['a']);
    expect((await guardados(red.almacen))['b']).toMatchObject({ estado: 'esperando', intentos: 0 });

    const srv = armar({ envio: (p) => (p.id === 'a' ? { estado: 503, cuerpo: null } : aceptada(p)) });
    await srv.almacen.guardarPendiente(pendiente({ id: 'a', orden: 1 }));
    await srv.almacen.guardarPendiente(pendiente({ id: 'b', animalId: 'a2', orden: 2 }));
    await srv.sinc.sincronizar();
    expect(srv.enviados).toEqual(['a', 'b']);
  });

  it('200 con HTML (portal cautivo) y un envío que lanza una excepción también esperan', async () => {
    const portal = armar({ envio: () => ({ estado: 200, cuerpo: null }) });
    await portal.almacen.guardarPendiente(pendiente({ id: 'x' }));
    await portal.sinc.sincronizar();
    expect((await guardados(portal.almacen))['x']).toMatchObject({ estado: 'esperando', intentos: 1 });

    const roto = armar({
      envio: () => {
        throw new Error('boom');
      },
    });
    await roto.almacen.guardarPendiente(pendiente({ id: 'x' }));
    await roto.sinc.sincronizar();
    expect((await guardados(roto.almacen))['x']).toMatchObject({ estado: 'esperando', intentos: 1 });
  });
});

describe('descartar (RF-38, RF-39)', () => {
  it('descartar un pendiente que espera o un rechazado lo quita', async () => {
    const { almacen, sinc } = armar();
    await almacen.guardarPendiente(pendiente({ id: 'a' }));
    await almacen.guardarPendiente(pendiente({ id: 'b', animalId: 'a2', estado: 'rechazado', motivo: 'x' }));
    expect(await sinc.descartar('a')).toBe('descartado');
    expect(await sinc.descartar('b')).toBe('descartado');
    expect(await almacen.listarPendientes()).toEqual([]);
    expect(await sinc.descartar('zzz')).toBe('no-existe');
  });

  it('descartar el de otro usuario no hace nada', async () => {
    const { almacen, sinc } = armar();
    await almacen.guardarPendiente(pendiente({ id: 'a', usuarioId: 'otro' }));
    expect(await sinc.descartar('a')).toBe('no-existe');
    expect((await almacen.listarPendientes()).length).toBe(1);
  });

  it('descartar mientras se envía espera el resultado: si fue aceptado avisa que ya estaba guardado y NO lo borra', async () => {
    let liberar!: (r: Respuesta) => void;
    const { almacen, sinc } = armar({ envio: () => new Promise<Respuesta>((res) => (liberar = res)) });
    const p = pendiente({ id: 'x' });
    await almacen.guardarPendiente(p);
    const ronda = sinc.sincronizar();
    await new Promise((r) => setTimeout(r, 0)); // el envío ya arrancó
    expect((await guardados(almacen))['x']?.estado).toBe('enviando');
    const descarte = sinc.descartar('x');
    let resuelto = false;
    void descarte.then(() => (resuelto = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(resuelto).toBe(false); // sigue esperando el resultado
    liberar(aceptada(p));
    expect(await descarte).toBe('ya-guardado');
    await ronda;
    expect((await almacen.listarEnviados()).map((e) => e.id)).toEqual(['x']); // quedó como enviado, no se perdió
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('descartar mientras se envía: si el servidor lo rechaza, recién ahí se descarta', async () => {
    let liberar!: (r: Respuesta) => void;
    const { almacen, sinc } = armar({ envio: () => new Promise<Respuesta>((res) => (liberar = res)) });
    await almacen.guardarPendiente(pendiente({ id: 'x' }));
    const ronda = sinc.sincronizar();
    await new Promise((r) => setTimeout(r, 0));
    const descarte = sinc.descartar('x');
    liberar({ estado: 409, cuerpo: { error: 'Duplicado' } });
    expect(await descarte).toBe('descartado');
    await ronda;
    expect(await almacen.listarPendientes()).toEqual([]);
    expect(await almacen.listarEnviados()).toEqual([]);
  });
});
