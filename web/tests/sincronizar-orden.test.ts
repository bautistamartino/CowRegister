import { describe, expect, it } from 'vitest';
import type { Pendiente } from '../src/sinconexion/almacen';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import type { Respuesta } from '../src/sinconexion/clasificar';
import { limpiarEnviadosReflejados } from '../src/sinconexion/reflejo';
import { avisosDe } from '../src/sinconexion/cola';
import { crearSincronizador } from '../src/sinconexion/sincronizar';
import { aceptadaDe, pendiente, pendienteDe, persona, vacaCopia } from './ayudas';

// Orden y espera por vaca en la sincronización (spec 010, RF-25 a RF-29). El envío y el reloj se inyectan.

type Envio = (p: Pendiente, veces: number) => Promise<Respuesta> | Respuesta;

function armar(envio: Envio = (p) => aceptadaDe(p)) {
  const almacen = new AlmacenMemoria();
  const enviados: string[] = [];
  const veces = new Map<string, number>();
  const reloj = { t: 1_000_000 };
  const sinc = crearSincronizador({
    almacen,
    persona,
    ahora: () => reloj.t,
    bloqueo: (fn) => fn(),
    enviar: async (p) => {
      enviados.push(p.id);
      const n = (veces.get(p.id) ?? 0) + 1;
      veces.set(p.id, n);
      return envio(p, n);
    },
  });
  return { almacen, sinc, enviados, reloj };
}

// Un evento pendiente de la vaca indicada con su orden de carga.
const evento = (id: string, tipo: Pendiente['tipo'], animalId: string, orden: number, cambios: Partial<Pendiente> = {}) => pendienteDe(tipo, { id, animalId, orden, ...cambios });
const rechazo = (error: string): Respuesta => ({ estado: 409, cuerpo: { error } });
const porId = async (a: AlmacenMemoria) => Object.fromEntries((await a.listarPendientes()).map((p) => [p.id, p]));

describe('orden de carga entre tipos (RF-25)', () => {
  it('envía de todos los tipos, de a uno y en el orden de carga, y los aceptados pasan a enviados', async () => {
    const { almacen, sinc, enviados } = armar();
    await almacen.guardarPendiente(evento('baja', 'BAJA', 'a1', 40));
    await almacen.guardarPendiente(evento('servicio', 'SERVICIO', 'a1', 10));
    await almacen.guardarPendiente(evento('tacto', 'TACTO', 'a2', 20));
    await almacen.guardarPendiente(evento('parto', 'PARTO', 'a1', 30));
    await almacen.guardarPendiente(pendiente({ id: 'litros', animalId: 'a3', orden: 50 }));
    const r = await sinc.sincronizar();
    expect(enviados).toEqual(['servicio', 'tacto', 'parto', 'baja', 'litros']);
    expect(r).toMatchObject({ aceptados: 5, rechazados: 0, detenido: null });
    expect(await almacen.listarPendientes()).toEqual([]);
    expect((await almacen.listarEnviados()).map((e) => e.id).sort()).toEqual(['baja', 'litros', 'parto', 'servicio', 'tacto']);
  });

  it('el enviado guarda la hora del SERVIDOR (registradoEn o la de la anulación)', async () => {
    const { almacen, sinc } = armar();
    await almacen.guardarPendiente(evento('s1', 'SERVICIO', 'a1', 1));
    await almacen.guardarPendiente(evento('an1', 'ANULACION', 'a2', 2, { datos: { eventoId: 'ev-9', tipoEvento: 'TACTO', motivo: 'x' } }));
    await sinc.sincronizar();
    const enviados = Object.fromEntries((await almacen.listarEnviados()).map((e) => [e.id, e.aceptadoEn]));
    expect(enviados.s1).toBe(Date.parse('2026-11-12T11:20:00.000Z'));
    expect(enviados.an1).toBe(Date.parse('2026-11-12T11:30:00.000Z'));
  });

  it('el siguiente de una vaca sale en la MISMA ronda en que se acepta el anterior', async () => {
    const { almacen, sinc, enviados } = armar();
    await almacen.guardarPendiente(evento('a', 'SERVICIO', 'a1', 1));
    await almacen.guardarPendiente(evento('b', 'TACTO', 'a1', 2));
    await sinc.sincronizar();
    expect(enviados).toEqual(['a', 'b']);
  });
});

describe('un fallo transitorio frena a los siguientes de ESA vaca y las demás siguen (RF-25)', () => {
  it('un 503 en el primero de la cadena: los siguientes de la vaca no salen y se intenta una sola vez por ronda', async () => {
    const { almacen, sinc, enviados } = armar((p) => (p.id === 'a1-servicio' ? { estado: 503, cuerpo: null } : aceptadaDe(p)));
    await almacen.guardarPendiente(evento('a1-servicio', 'SERVICIO', 'a1', 1));
    await almacen.guardarPendiente(evento('a1-tacto', 'TACTO', 'a1', 2));
    await almacen.guardarPendiente(pendiente({ id: 'a1-litros', animalId: 'a1', orden: 3 }));
    await almacen.guardarPendiente(evento('a2-servicio', 'SERVICIO', 'a2', 4));
    const r = await sinc.sincronizar();
    expect(enviados).toEqual(['a1-servicio', 'a2-servicio']); // una sola vez cada uno
    expect(r).toMatchObject({ aceptados: 1, detenido: null });
    const guardados = await porId(almacen);
    expect(Object.keys(guardados).sort()).toEqual(['a1-litros', 'a1-servicio', 'a1-tacto']);
    expect(guardados['a1-servicio']).toMatchObject({ estado: 'esperando', intentos: 1 });
    expect(guardados['a1-tacto']).toMatchObject({ estado: 'esperando', intentos: 0 });
    expect(r.siguienteIntento).not.toBeNull();
  });

  it('un corte de red corta la ronda entera', async () => {
    const { almacen, sinc, enviados } = armar(() => ({ red: true }));
    await almacen.guardarPendiente(evento('a', 'SERVICIO', 'a1', 1));
    await almacen.guardarPendiente(evento('b', 'SERVICIO', 'a2', 2));
    expect(await sinc.sincronizar()).toMatchObject({ detenido: 'red', aceptados: 0 });
    expect(enviados).toEqual(['a']);
  });

  it('un 401 corta la ronda y conserva todo tal cual estaba', async () => {
    const { almacen, sinc, enviados } = armar(() => ({ estado: 401, cuerpo: null }));
    await almacen.guardarPendiente(evento('a', 'SERVICIO', 'a1', 1));
    await almacen.guardarPendiente(evento('b', 'TACTO', 'a2', 2));
    expect(await sinc.sincronizar()).toMatchObject({ detenido: 'sesion', aceptados: 0 });
    expect(enviados).toEqual(['a']);
    const g = await porId(almacen);
    expect(g.a).toMatchObject({ estado: 'esperando', intentos: 0 });
    expect(g.b).toMatchObject({ estado: 'esperando' });
  });

  it('con la espera cumplida (o ignorándola) el que falló se reintenta y libera a sus siguientes', async () => {
    const { almacen, sinc, enviados, reloj } = armar((p, veces) => (p.id === 'a' && veces === 1 ? { estado: 503, cuerpo: null } : aceptadaDe(p)));
    await almacen.guardarPendiente(evento('a', 'SERVICIO', 'a1', 1));
    await almacen.guardarPendiente(evento('b', 'TACTO', 'a1', 2));
    await sinc.sincronizar();
    expect(enviados).toEqual(['a']);
    await sinc.sincronizar(); // todavía no se cumplió la espera
    expect(enviados).toEqual(['a']);
    reloj.t += 10_000;
    await sinc.sincronizar();
    expect(enviados).toEqual(['a', 'a', 'b']);
    expect(await almacen.listarPendientes()).toEqual([]);
  });
});

describe('respuesta cortada (RF-25, RF-28)', () => {
  it('el pendiente se reenvía con el MISMO id y datos y recibe los avisos del primer envío', async () => {
    const avisos = [{ codigo: 'LOTE_1', mensaje: 'Pasó al lote Ordeñe' }];
    const { almacen, sinc, enviados, reloj } = armar((p, veces) => (veces === 1 ? { red: true } : aceptadaDe(p, { avisos, reenvio: true })));
    const original = evento('parto', 'PARTO', 'a1', 1);
    await almacen.guardarPendiente(original);
    await sinc.sincronizar();
    const tras = (await almacen.listarPendientes())[0]!;
    expect(tras).toMatchObject({ id: 'parto', estado: 'esperando', datos: original.datos });
    reloj.t += 10_000;
    await sinc.sincronizar();
    expect(enviados).toEqual(['parto', 'parto']);
    expect(await almacen.listarPendientes()).toEqual([]);
    expect(await almacen.listarAvisos()).toEqual([expect.objectContaining({ id: 'parto', tipo: 'PARTO', animalId: 'a1', avisos })]);
  });
});

describe('un rechazo deja en espera a los posteriores de esa vaca (RF-26, RF-27, RF-29)', () => {
  async function conParto() {
    const t = armar((p) => (p.id === 'parto' ? rechazo('La vaca no está apta') : aceptadaDe(p)));
    await t.almacen.guardarPendiente(evento('parto', 'PARTO', 'a1', 1));
    await t.almacen.guardarPendiente(evento('tacto', 'TACTO', 'a1', 2));
    await t.almacen.guardarPendiente(pendiente({ id: 'litros', animalId: 'a1', orden: 3 }));
    await t.almacen.guardarPendiente(evento('otra', 'SERVICIO', 'a2', 4));
    return t;
  }

  it('el parto queda rechazado con su motivo, el tacto y el litro posteriores no se envían y la otra vaca sigue', async () => {
    const { almacen, sinc, enviados } = await conParto();
    const r = await sinc.sincronizar();
    expect(enviados).toEqual(['parto', 'otra']);
    expect(r).toMatchObject({ aceptados: 1, rechazados: 1 });
    const g = await porId(almacen);
    expect(g.parto).toMatchObject({ estado: 'rechazado', motivo: 'La vaca no está apta', codigoRechazo: 409 });
    expect(g.tacto?.estado).toBe('esperando');
    expect(g.litros?.estado).toBe('esperando'); // "en espera del anterior" se calcula, no se guarda
  });

  it('un rechazado no se reintenta solo: otra ronda no lo vuelve a mandar ni libera a los que esperan', async () => {
    const { sinc, enviados } = await conParto();
    await sinc.sincronizar();
    await sinc.sincronizar({ ignorarEsperas: true });
    expect(enviados).toEqual(['parto', 'otra']);
  });

  it('reintentar el rechazado (ahora aceptado) reanuda a los que esperaban, en orden', async () => {
    const { almacen, sinc, enviados } = armar((p, veces) => (p.id === 'parto' && veces === 1 ? rechazo('x') : aceptadaDe(p)));
    await almacen.guardarPendiente(evento('parto', 'PARTO', 'a1', 1));
    await almacen.guardarPendiente(evento('tacto', 'TACTO', 'a1', 2));
    await almacen.guardarPendiente(pendiente({ id: 'litros', animalId: 'a1', orden: 3 }));
    await sinc.sincronizar();
    await sinc.reintentar('parto');
    await sinc.sincronizar();
    expect(enviados).toEqual(['parto', 'parto', 'tacto', 'litros']);
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('descartar el rechazado reanuda a los que esperaban sin descartarlos ni rechazarlos por su cuenta', async () => {
    const { almacen, sinc, enviados } = await conParto();
    await sinc.sincronizar();
    expect(await sinc.descartar('parto')).toBe('descartado');
    await sinc.sincronizar();
    expect(enviados).toEqual(['parto', 'otra', 'tacto', 'litros']);
    expect(await almacen.listarPendientes()).toEqual([]);
  });

  it('descartar uno "en espera del anterior" pide confirmación y solo lo quita si llega confirmada', async () => {
    const { almacen, sinc } = await conParto();
    await sinc.sincronizar();
    expect(await sinc.descartar('tacto')).toBe('requiere-confirmacion');
    expect((await porId(almacen)).tacto).toBeDefined();
    expect(await sinc.descartar('tacto', { confirmado: true })).toBe('descartado');
    expect((await porId(almacen)).tacto).toBeUndefined();
  });

  it('informa los posteriores de la misma vaca de un pendiente antes de descartarlo', async () => {
    const { sinc } = await conParto();
    expect((await sinc.posteriores('parto')).map((p) => p.id)).toEqual(['tacto', 'litros']);
  });

  it('un litro rechazado no frena a nadie: ni al evento posterior de su vaca', async () => {
    const { almacen, sinc, enviados } = armar((p) => (p.id === 'litros' ? rechazo('Ya hay una carga') : aceptadaDe(p)));
    await almacen.guardarPendiente(pendiente({ id: 'litros', animalId: 'a1', orden: 1 }));
    await almacen.guardarPendiente(evento('servicio', 'SERVICIO', 'a1', 2));
    await almacen.guardarPendiente(pendiente({ id: 'litros2', animalId: 'a1', orden: 3, fecha: '2026-11-11' }));
    await sinc.sincronizar();
    expect(enviados).toEqual(['litros', 'servicio', 'litros2']);
    const g = await porId(almacen);
    expect(Object.keys(g)).toEqual(['litros']);
    expect(g.litros?.estado).toBe('rechazado');
  });
});

describe('avisos del servidor (RF-28)', () => {
  const avisos = [{ codigo: 'LOTE_4', mensaje: 'Sin lote' }];

  it('se guardan al aceptar, sobreviven a la limpieza del enviado y solo se borran al cerrarlos', async () => {
    const { almacen, sinc } = armar((p) => aceptadaDe(p, { avisos }));
    await almacen.reemplazarCopia({ generadaEn: '2026-11-12T12:30:00.000Z', totalAnimales: 1, lotes: [], animales: [vacaCopia('a1', '12')] }, persona);
    await almacen.guardarPendiente(evento('parto', 'PARTO', 'a1', 1));
    await sinc.sincronizar();
    expect((await almacen.listarEnviados()).map((e) => e.id)).toEqual(['parto']);

    // Una copia 70 minutos posterior sin el evento: el enviado se quita por antigüedad, los avisos NO.
    await almacen.reemplazarCopia({ generadaEn: '2026-11-12T13:30:00.000Z', totalAnimales: 1, lotes: [], animales: [vacaCopia('a1', '12')] }, persona);
    await limpiarEnviadosReflejados(almacen, persona);
    expect(await almacen.listarEnviados()).toEqual([]);
    expect(await avisosDe(almacen, persona)).toEqual([expect.objectContaining({ id: 'parto', avisos })]);

    await sinc.cerrarAvisos(['parto']);
    expect(await avisosDe(almacen, persona)).toEqual([]);
  });

  it('un 200 sin avisos no guarda nada en el almacén de avisos', async () => {
    const { almacen, sinc } = armar();
    await almacen.guardarPendiente(evento('s1', 'SERVICIO', 'a1', 1));
    await sinc.sincronizar();
    expect(await almacen.listarAvisos()).toEqual([]);
  });

  it('cerrar avisos no toca los de otro usuario', async () => {
    const { almacen, sinc } = armar();
    await almacen.guardarAvisos({ id: 'ajeno', usuarioId: 'otro', establecimientoId: 'e1', animalId: 'a1', numero: '12', tipo: 'PARTO', avisos });
    await sinc.cerrarAvisos(['ajeno']);
    expect(await almacen.listarAvisos()).toHaveLength(1);
  });
});
