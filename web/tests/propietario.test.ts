import { describe, expect, it } from 'vitest';
import type { CopiaLocal, Perfil } from '../src/compartido/api';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import { cerrarSesionLocal, decidirIngreso, evaluarIngreso, perfilParaEntrarSinConexion } from '../src/sinconexion/propietario';
import { enviado, pendiente, persona } from './ayudas';

// Decisión de ingreso y cierre de sesión (spec 009, RF-43 a RF-48): lógica pura con el almacén en memoria.

const otroUsuario = { usuarioId: 'u2', establecimientoId: 'e1' }; // mismo tambo, otro usuario
const otroTambo = { usuarioId: 'u1', establecimientoId: 'e2' }; // mismo usuario, otro tambo

const copiaVacia: CopiaLocal = { generadaEn: '2026-11-12T11:00:00.000Z', totalAnimales: 0, lotes: [], animales: [] };

const perfilDe = (p: { usuarioId: string; establecimientoId: string }): Perfil => ({
  id: p.usuarioId,
  nombre: 'Prueba',
  email: 'prueba@prueba.test',
  rol: 'DUENO',
  establecimiento: { id: p.establecimientoId, nombre: 'Tambo de prueba' },
});

describe('decidirIngreso (función pura)', () => {
  it('sin datos locales: continuar', () => {
    expect(decidirIngreso(persona, [], 0)).toEqual({ tipo: 'continuar' });
  });

  it('mismo usuario y mismo tambo: continuar, aunque haya pendientes (RF-47)', () => {
    expect(decidirIngreso(persona, [persona, persona], 3)).toEqual({ tipo: 'continuar' });
  });

  it('otro usuario sin pendientes: reemplazar sin preguntar (RF-46)', () => {
    expect(decidirIngreso(persona, [otroUsuario], 0)).toEqual({ tipo: 'reemplazarSinPreguntar' });
  });

  it('otro usuario con pendientes: pedir confirmación con la cantidad (RF-46)', () => {
    expect(decidirIngreso(persona, [otroUsuario], 2)).toEqual({ tipo: 'confirmarBorrado', pendientes: 2 });
  });

  it('el mismo usuario en OTRO tambo también es otro dueño', () => {
    expect(decidirIngreso(persona, [otroTambo], 1)).toEqual({ tipo: 'confirmarBorrado', pendientes: 1 });
  });

  it('si alguno de los datos es de otro, se decide como "otro" (nunca se mezcla)', () => {
    expect(decidirIngreso(persona, [persona, otroUsuario], 0)).toEqual({ tipo: 'reemplazarSinPreguntar' });
  });
});

describe('evaluarIngreso (lee lo guardado)', () => {
  it('almacén vacío: continuar', async () => {
    expect(await evaluarIngreso(new AlmacenMemoria(), persona)).toEqual({ tipo: 'continuar' });
  });

  it('copia y pendientes del mismo usuario: continuar y no se borra nada', async () => {
    const a = new AlmacenMemoria();
    await a.reemplazarCopia(copiaVacia, persona);
    await a.guardarPendiente(pendiente());
    expect(await evaluarIngreso(a, persona)).toEqual({ tipo: 'continuar' });
    expect(await a.listarPendientes()).toHaveLength(1);
    expect(await a.leerMeta()).not.toBeNull();
  });

  it('copia de otro usuario y sin pendientes: reemplazar sin preguntar', async () => {
    const a = new AlmacenMemoria();
    await a.reemplazarCopia(copiaVacia, otroUsuario);
    expect(await evaluarIngreso(a, persona)).toEqual({ tipo: 'reemplazarSinPreguntar' });
  });

  it('cuenta TODOS los pendientes (esperando y rechazados) de la copia de otro usuario', async () => {
    const a = new AlmacenMemoria();
    await a.reemplazarCopia(copiaVacia, otroUsuario);
    await a.guardarPendiente(pendiente({ id: 'p1', ...otroUsuario }));
    await a.guardarPendiente(pendiente({ id: 'p2', ...otroUsuario, estado: 'rechazado', motivo: 'Ya hay una carga', codigoRechazo: 409 }));
    expect(await evaluarIngreso(a, persona)).toEqual({ tipo: 'confirmarBorrado', pendientes: 2 });
  });

  it('pendientes de otro tambo sin copia: también piden confirmación', async () => {
    const a = new AlmacenMemoria();
    await a.guardarPendiente(pendiente({ id: 'p1', ...otroTambo }));
    expect(await evaluarIngreso(a, persona)).toEqual({ tipo: 'confirmarBorrado', pendientes: 1 });
  });

  it('un litro ya enviado de otro usuario cuenta como dato de otro, pero no como pendiente perdido', async () => {
    const a = new AlmacenMemoria();
    await a.guardarEnviado(enviado(pendiente({ id: 'e1x', ...otroUsuario })));
    expect(await evaluarIngreso(a, persona)).toEqual({ tipo: 'reemplazarSinPreguntar' });
  });
});

describe('entrar sin conexión con el perfil guardado (RF-43, RF-48)', () => {
  it('sin perfil guardado: no se entra', async () => {
    expect(await perfilParaEntrarSinConexion(new AlmacenMemoria())).toBeNull();
  });

  it('perfil y copia del mismo usuario: se entra con ese perfil', async () => {
    const a = new AlmacenMemoria();
    await a.guardarPerfil(perfilDe(persona));
    await a.reemplazarCopia(copiaVacia, persona);
    expect((await perfilParaEntrarSinConexion(a))?.id).toBe('u1');
  });

  it('perfil guardado sin ningún dato local: se entra (se pedirá la primera descarga)', async () => {
    const a = new AlmacenMemoria();
    await a.guardarPerfil(perfilDe(persona));
    expect((await perfilParaEntrarSinConexion(a))?.id).toBe('u1');
  });

  it('si los datos locales son de otro usuario NO se entra y no se borra nada (no se puede confirmar sin conexión)', async () => {
    const a = new AlmacenMemoria();
    await a.guardarPerfil(perfilDe(persona));
    await a.reemplazarCopia(copiaVacia, otroUsuario);
    await a.guardarPendiente(pendiente({ id: 'p1', ...otroUsuario }));
    expect(await perfilParaEntrarSinConexion(a)).toBeNull();
    expect(await a.listarPendientes()).toHaveLength(1);
    expect(await a.leerMeta()).not.toBeNull();
  });
});

describe('cerrarSesionLocal (RF-43 a RF-45)', () => {
  async function almacenConDatos() {
    const a = new AlmacenMemoria();
    await a.guardarPerfil(perfilDe(persona));
    await a.reemplazarCopia(copiaVacia, persona);
    await a.guardarPendiente(pendiente({ id: 'p1' }));
    await a.guardarPendiente(pendiente({ id: 'p2', estado: 'rechazado', motivo: 'x', codigoRechazo: 409 }));
    await a.guardarEnviado(enviado(pendiente({ id: 'p3' })));
    return a;
  }

  it('con conexión: cierra el servidor y borra copia, pendientes, enviados y perfil', async () => {
    const a = await almacenConDatos();
    const r = await cerrarSesionLocal({ almacen: a, cerrarServidor: async () => 'cerrado' });
    expect(r).toEqual({ servidorCerrado: true });
    expect(await a.leerMeta()).toBeNull();
    expect(await a.leerAnimales()).toEqual([]);
    expect(await a.listarPendientes()).toEqual([]);
    expect(await a.listarEnviados()).toEqual([]);
    expect(await a.leerPerfil()).toBeNull();
  });

  it('sin conexión: borra igual todo lo local y avisa que el servidor no se cerró (RF-45)', async () => {
    const a = await almacenConDatos();
    const r = await cerrarSesionLocal({ almacen: a, cerrarServidor: async () => 'sin-red' });
    expect(r).toEqual({ servidorCerrado: false });
    expect(await a.listarPendientes()).toEqual([]);
    expect(await a.leerPerfil()).toBeNull();
  });

  it('si el servidor falla por otra causa (error 500), no se borra nada y se informa el error', async () => {
    const a = await almacenConDatos();
    await expect(
      cerrarSesionLocal({
        almacen: a,
        cerrarServidor: async () => {
          throw new Error('Error 500');
        },
      }),
    ).rejects.toThrow('Error 500');
    expect(await a.listarPendientes()).toHaveLength(2);
    expect(await a.leerPerfil()).not.toBeNull();
  });

  it('si falla el borrado del almacén, el error sube para avisarlo', async () => {
    const a = await almacenConDatos();
    a.borrarTodo = async () => {
      throw new Error('IndexedDB no disponible');
    };
    await expect(cerrarSesionLocal({ almacen: a, cerrarServidor: async () => 'cerrado' })).rejects.toThrow('IndexedDB');
  });
});
