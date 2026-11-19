import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import { enviado, pendiente } from './ayudas';

// El almacén real falla si alguien lo pide: la sesión del administrador no debe tocarlo (spec 014, RF-13, RF-14).
const almacenReal = vi.hoisted(() => ({ obtenerAlmacen: vi.fn(() => { throw new Error('el administrador no debe tocar el almacén local'); }) }));
vi.mock('../src/sinconexion/almacenIndexedDb', () => almacenReal);

import { cerrarSesionAdmin, esPerfilAdmin, ingresarAdmin } from '../src/sesion/sesionAdmin';

const admin = { rol: 'ADMIN', id: 'a1', nombre: 'Admin', email: 'admin@prueba.test' };

describe('esPerfilAdmin', () => {
  it('reconoce la respuesta del administrador y rechaza el perfil de un tambo', () => {
    expect(esPerfilAdmin(admin)).toBe(true);
    expect(esPerfilAdmin({ ...admin, rol: 'DUENO' })).toBe(false);
    expect(esPerfilAdmin({ rol: 'ADMIN', id: 'a1' })).toBe(false);
    expect(esPerfilAdmin(null)).toBe(false);
  });
});

describe('ingreso y cierre del administrador', () => {
  it('ingresar no toca el almacén local ni pide confirmación: los datos de un tambo siguen intactos', async () => {
    const almacen = new AlmacenMemoria();
    await almacen.guardarPendiente(pendiente());
    const antes = await almacen.listarPendientes();
    const perfil = ingresarAdmin(admin);
    expect(perfil).toEqual({ id: 'a1', nombre: 'Admin', email: 'admin@prueba.test' });
    expect(almacenReal.obtenerAlmacen).not.toHaveBeenCalled();
    expect(await almacen.listarPendientes()).toEqual(antes);
  });

  it('ingresar con algo que no es un administrador devuelve null', () => {
    expect(ingresarAdmin({ ...admin, rol: 'DUENO' })).toBeNull();
  });

  it('cerrar sesión cierra solo la del servidor y no toca el almacén', async () => {
    const almacen = new AlmacenMemoria();
    const p = pendiente();
    await almacen.guardarPendiente(p);
    await almacen.guardarEnviado(enviado(p));
    const cerrarServidor = vi.fn().mockResolvedValue(undefined);
    await cerrarSesionAdmin({ cerrarServidor });
    expect(cerrarServidor).toHaveBeenCalledTimes(1);
    expect(almacenReal.obtenerAlmacen).not.toHaveBeenCalled();
    expect((await almacen.listarPendientes()).length).toBe(1);
    expect((await almacen.listarEnviados()).length).toBe(1);
  });

  it('si el servidor no responde, el error sube (la sesión sigue abierta)', async () => {
    await expect(cerrarSesionAdmin({ cerrarServidor: async () => { throw new Error('sin red'); } })).rejects.toThrow('sin red');
  });

  it('sesionAdmin.ts no importa nada de sinconexion', () => {
    const codigo = readFileSync(new URL('../src/sesion/sesionAdmin.ts', import.meta.url), 'utf8');
    // Solo las líneas de importación (el comentario del archivo nombra la carpeta a propósito).
    const importaciones = codigo.split('\n').filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l));
    expect(importaciones.join('\n')).not.toMatch(/sinconexion/);
  });
});
