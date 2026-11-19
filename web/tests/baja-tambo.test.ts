import { afterEach, describe, expect, it, vi } from 'vitest';
import { clasificarRespuesta } from '../src/sinconexion/clasificar';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import { evaluarIngreso } from '../src/sinconexion/propietario';
import { alVencerSesion, api, ApiError } from '../src/compartido/api';
import type { CopiaLocal } from '../src/compartido/api';
import { pendiente, persona } from './ayudas';

// Tambo dado de baja visto desde la tablet (spec 015, RF-17, RF-18, RF-19).

const copiaVacia: CopiaLocal = { generadaEn: '2026-11-12T11:00:00.000Z', totalAnimales: 0, lotes: [], animales: [] };
const respuesta = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

async function tabletConDatos() {
  const a = new AlmacenMemoria();
  await a.reemplazarCopia(copiaVacia, persona);
  await a.guardarPendiente(pendiente({ id: 'p1' }));
  await a.guardarPendiente(pendiente({ id: 'p2', estado: 'rechazado', motivo: 'x', codigoRechazo: 409 }));
  return a;
}

afterEach(() => vi.unstubAllGlobals());

describe('el 401 de un tambo de baja al enviar pendientes', () => {
  it('se clasifica como "sesion" (nunca "rechazado"), con el cuerpo real de la API', () => {
    const c = clasificarRespuesta({ estado: 401, cuerpo: { error: 'Tenés que iniciar sesión' } }, pendiente());
    expect(c.tipo).toBe('sesion');
  });

  it('la copia y los pendientes siguen en la tablet', async () => {
    const a = await tabletConDatos();
    clasificarRespuesta({ estado: 401, cuerpo: { error: 'Tenés que iniciar sesión' } }, pendiente({ id: 'p1' }));
    expect(await a.listarPendientes()).toHaveLength(2);
    expect(await a.leerMeta()).not.toBeNull();
  });
});

describe('ingreso rechazado con TAMBO_DE_BAJA (403)', () => {
  const MENSAJE = 'Tu tambo está dado de baja. Consultá con el administrador de la plataforma.';

  it('api() lanza el error con el mensaje para mostrarlo en el ingreso y NO apaga la sesión', async () => {
    const vencida = vi.fn();
    const quitar = alVencerSesion(vencida);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(403, { error: MENSAJE, codigo: 'TAMBO_DE_BAJA' })));
    const error = (await api('/auth/login', { method: 'POST', body: { email: 'a@prueba.test', password: 'x' } }).catch((e) => e)) as ApiError;
    quitar();
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.message).toBe(MENSAJE);
    expect(vencida).not.toHaveBeenCalled();
  });

  it('no se toca el almacén local: la copia y los pendientes siguen', async () => {
    const a = await tabletConDatos();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(403, { error: MENSAJE, codigo: 'TAMBO_DE_BAJA' })));
    await api('/auth/login', { method: 'POST', body: {} }).catch(() => undefined);
    expect(await a.listarPendientes()).toHaveLength(2);
    expect(await a.leerMeta()).not.toBeNull();
  });
});

describe('tras reactivar el tambo', () => {
  it('el mismo usuario reingresa: continúa sin confirmar ni borrar, y los pendientes quedan para reenviar', async () => {
    const a = await tabletConDatos();
    expect(await evaluarIngreso(a, persona)).toEqual({ tipo: 'continuar' });
    const esperando = (await a.listarPendientes()).filter((p) => p.estado === 'esperando');
    expect(esperando.map((p) => p.id)).toEqual(['p1']);
    expect(await a.leerMeta()).not.toBeNull();
  });
});
