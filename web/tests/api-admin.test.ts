import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Las rutas /admin de api() (spec 014, RF-13, RF-21): siempre van a la red y nunca pasan por la copia local.

const estado = vi.hoisted(() => ({ enLinea: true }));
const lecturas = vi.hoisted(() => ({ copia: vi.fn(), contexto: vi.fn() }));

vi.mock('../src/sinconexion/conexion', () => ({
  obtenerConexion: () => ({ enLinea: () => estado.enLinea, hayFalloDeRed: vi.fn(), hayRespuesta: vi.fn() }),
}));
vi.mock('../src/sinconexion/lecturaLocal', () => ({
  leerCopiaLocal: lecturas.copia,
  leerContextoFicha: lecturas.contexto,
}));

import { alVencerSesion, api, ApiError, TEXTO_NECESITA_CONEXION } from '../src/compartido/api';

const respuesta = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  estado.enLinea = true;
  lecturas.copia.mockReset();
  lecturas.contexto.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('api() con rutas /admin', () => {
  it('sin conexión: "Esto necesita conexión" sin leer la copia ni la vista local ni hacer el pedido', async () => {
    estado.enLinea = false;
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    const error = (await api('/admin/tambos').catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(TEXTO_NECESITA_CONEXION);
    expect(lecturas.copia).not.toHaveBeenCalled();
    expect(lecturas.contexto).not.toHaveBeenCalled();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('con conexión: va a la red sin mirar la vista local', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(200, [{ id: 't1' }])));
    expect(await api('/admin/tambos')).toEqual([{ id: 't1' }]);
    expect(lecturas.contexto).not.toHaveBeenCalled();
    expect(lecturas.copia).not.toHaveBeenCalled();
  });

  it('un fallo de red no consulta la copia local', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('sin red')));
    const error = (await api('/admin/tambos').catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(lecturas.copia).not.toHaveBeenCalled();
    expect(lecturas.contexto).not.toHaveBeenCalled();
  });

  it('/admin/yo con 401 es normal: no apaga la sesión; otro 401 de /admin sí', async () => {
    const vencida = vi.fn();
    const quitar = alVencerSesion(vencida);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(401, { error: 'Tenés que iniciar sesión' })));
    await expect(api('/admin/yo')).rejects.toMatchObject({ status: 401 });
    expect(vencida).not.toHaveBeenCalled();
    await expect(api('/admin/tambos')).rejects.toMatchObject({ status: 401 });
    expect(vencida).toHaveBeenCalledTimes(1);
    quitar();
  });
});
