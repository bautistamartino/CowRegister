import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { ejecutarAltaUnica } from '../src/admin/altaUnica.js';
import { PASSWORD, app, crearAdministradorDirecto, limpiarBase, registrarTambo } from './ayudas.js';

// Un email no puede estar en dos cuentas, sea de administrador o de usuario de un tambo (RF-7).
// Acá se prueba cada punto de alta por la API; la garantía en la base está en base-admin.test.ts.
// (El caso de crear tambo desde el administrador se suma en la tarea 3.)

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

describe('Email único entre administrador y usuarios (RF-7)', () => {
  it('el registro rechaza el email del administrador con 409', async () => {
    await crearAdministradorDirecto({ email: 'admin@prueba.test' });
    const res = await request(app)
      .post('/api/auth/registro')
      .send({ nombreEstablecimiento: 'Tambo Nuevo', nombre: 'Dueño', email: 'ADMIN@prueba.test', password: PASSWORD })
      .expect(409);
    expect(res.body.error).toBe('Ya existe una cuenta con ese email');
    // No quedó nada a medias: ni tambo ni usuario.
    expect(await prisma.establecimiento.count()).toBe(0);
    expect(await prisma.usuario.count()).toBe(0);
  });

  it('el registro rechaza un nombre de tambo repetido con 409 (RF-27)', async () => {
    await registrarTambo('Libertad', 'dueno@prueba.test');
    const res = await request(app)
      .post('/api/auth/registro')
      .send({ nombreEstablecimiento: '  libertad  ', nombre: 'Otro', email: 'otro@prueba.test', password: PASSWORD })
      .expect(409);
    expect(res.body.error).toBe('Ya existe un tambo con ese nombre');
    expect(await prisma.establecimiento.count()).toBe(1);
    expect(await prisma.usuario.count()).toBe(1);
  });

  it('el registro con las mismas condiciones simultáneas deja un solo tambo con ese nombre', async () => {
    const pedir = (email: string) =>
      request(app)
        .post('/api/auth/registro')
        .send({ nombreEstablecimiento: 'Tambo Doble', nombre: 'D', email, password: PASSWORD });
    const respuestas = await Promise.all([pedir('a@prueba.test'), pedir('b@prueba.test')]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(respuestas.find((r) => r.status === 409)!.body.error).toBe('Ya existe un tambo con ese nombre');
    expect(await prisma.establecimiento.count()).toBe(1);
  });

  it('POST /api/usuarios rechaza el email del administrador con 409', async () => {
    await crearAdministradorDirecto({ email: 'admin@prueba.test' });
    const { agente } = await registrarTambo('Tambo A', 'dueno@prueba.test');
    const res = await agente
      .post('/api/usuarios')
      .send({ nombre: 'Nuevo', email: 'Admin@prueba.test', password: PASSWORD, rol: 'ENCARGADO' })
      .expect(409);
    expect(res.body.error).toBe('Ya existe una cuenta con ese email');
    expect(await prisma.usuario.count()).toBe(1);
  });

  it('POST /api/usuarios sigue rechazando el rol ADMIN con 400', async () => {
    const { agente } = await registrarTambo('Tambo A', 'dueno@prueba.test');
    await agente
      .post('/api/usuarios')
      .send({ nombre: 'Nuevo', email: 'nuevo@prueba.test', password: PASSWORD, rol: 'ADMIN' })
      .expect(400);
  });

  it('el alta única rechaza el email de un usuario de un tambo', async () => {
    await registrarTambo('Tambo A', 'dueno@prueba.test');
    const salida: string[] = [];
    const codigo = await ejecutarAltaUnica({
      argumentos: ['--nombre', 'Ana', '--email', 'dueno@prueba.test'],
      env: { ADMIN_PASSWORD: PASSWORD },
      leerPassword: async () => '',
      escribir: (t) => salida.push(t),
    });
    expect(codigo).toBe(1);
    expect(await prisma.administrador.count()).toBe(0);
  });

  it('el alta única y el registro simultáneos con el mismo email dejan una sola cuenta', async () => {
    const [alta, registro] = await Promise.all([
      ejecutarAltaUnica({
        argumentos: ['--nombre', 'Ana', '--email', 'mismo@prueba.test'],
        env: { ADMIN_PASSWORD: PASSWORD },
        leerPassword: async () => '',
        escribir: () => undefined,
      }),
      request(app)
        .post('/api/auth/registro')
        .send({ nombreEstablecimiento: 'Tambo Z', nombre: 'Z', email: 'mismo@prueba.test', password: PASSWORD }),
    ]);
    const cuentas = (await prisma.administrador.count()) + (await prisma.usuario.count());
    expect(cuentas).toBe(1);
    // El que perdió recibió un rechazo claro, no un 500.
    if (alta === 0) expect(registro.status).toBe(409);
    else {
      expect(alta).toBe(1);
      expect(registro.status).toBe(201);
    }
    // Si perdió el registro, no quedó el tambo huérfano.
    expect(await prisma.establecimiento.count()).toBe(registro.status === 201 ? 1 : 0);
  });
});
