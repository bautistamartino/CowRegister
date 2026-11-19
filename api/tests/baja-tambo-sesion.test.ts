import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  PASSWORD,
  app,
  crearAnimalDirecto,
  crearSesionDirecta,
  darDeBajaTamboDirecto,
  iniciarSesionAdmin,
  limpiarBase,
  registrarTambo,
} from './ayudas.js';

// Un tambo dado de baja no opera ni ingresa (spec 015, RF-8, 9, 10, 11, 20, 21).

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

const MENSAJE_BAJA = 'Tu tambo está dado de baja. Consultá con el administrador de la plataforma.';

describe('Pedidos con sesión de un tambo de baja (RF-8, RF-9)', () => {
  const rutasGet = ['/api/auth/yo', '/api/copia-local', '/api/animales', '/api/lotes', '/api/usuarios', '/api/informes/natalidad'];

  it('una sesión abierta antes de la baja y una creada después dan 401 "Tenés que iniciar sesión"', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    const b = await registrarTambo('Tambo B', 'dueno-b@prueba.test');
    const idA = a.perfil.establecimiento.id;
    const vaca = await crearAnimalDirecto(idA, '101');
    // Se da de baja SIN borrar las sesiones (la API de la baja sí las borra): la sesión queda "colgada".
    await darDeBajaTamboDirecto(idA);
    const dueno = await prisma.usuario.findUniqueOrThrow({ where: { email: 'dueno-a@prueba.test' } });
    const nueva = await crearSesionDirecta(dueno.id);

    for (const ruta of rutasGet) {
      for (const pedido of [a.agente.get(ruta), request(app).get(ruta).set('Cookie', nueva.cookie)]) {
        const res = await pedido;
        expect([ruta, res.status, res.body.error]).toEqual([ruta, 401, 'Tenés que iniciar sesión']);
      }
    }
    // Envíos de la tablet: un evento y litros.
    await a.agente.post(`/api/animales/${vaca.id}/secados`).send({ fecha: '2026-11-01' }).expect(401);
    await a.agente
      .post(`/api/animales/${vaca.id}/produccion`)
      .send({ fecha: '2026-11-01', turno: 'MANANA', litros: 10 })
      .expect(401);
    expect(await prisma.evento.count({ where: { establecimientoId: idA } })).toBe(0);
    expect(await prisma.produccion.count({ where: { establecimientoId: idA } })).toBe(0);

    // Tambo B intacto.
    await b.agente.get('/api/auth/yo').expect(200);
  });

  it('siguen andando logout, salud y registro; /auth/yo sin cookie responde lo de siempre', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    await darDeBajaTamboDirecto(a.perfil.establecimiento.id);

    await a.agente.post('/api/auth/logout').expect(204);
    await request(app).get('/api/salud').expect(200);
    await request(app)
      .post('/api/auth/registro')
      .send({ nombreEstablecimiento: 'Tambo Nuevo', nombre: 'N', email: 'nuevo@prueba.test', password: PASSWORD })
      .expect(201);
    const sinCookie = await request(app).get('/api/auth/yo').expect(401);
    expect(sinCookie.body.error).toBe('Tenés que iniciar sesión');
  });
});

describe('Ingreso a un tambo de baja (RF-10, RF-11, RF-21)', () => {
  it('con credenciales correctas de un usuario activo da 403 TAMBO_DE_BAJA, sin cookie, sin sesión y sin último ingreso', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    await darDeBajaTamboDirecto(a.perfil.establecimiento.id, { cerrarSesiones: true });

    const res = await request(app).post('/api/auth/login').send({ email: 'dueno-a@prueba.test', password: PASSWORD }).expect(403);
    expect(res.body).toEqual({ error: MENSAJE_BAJA, codigo: 'TAMBO_DE_BAJA' });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.sesion.count()).toBe(0);
    expect((await prisma.usuario.findFirstOrThrow()).ultimoIngresoEn).toBeNull();
  });

  it('con contraseña mala o usuario desactivado da el genérico; nada se borró y el email sigue reservado', async () => {
    const { agente: admin } = await iniciarSesionAdmin(); // antes de la baja: la ayuda reutiliza a este administrador
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    await prisma.usuario.create({
      data: {
        establecimientoId: a.perfil.establecimiento.id,
        nombre: 'Desactivado',
        email: 'off@prueba.test',
        passwordHash: (await prisma.usuario.findFirstOrThrow()).passwordHash,
        rol: 'VETERINARIO',
        activo: false,
      },
    });
    await darDeBajaTamboDirecto(a.perfil.establecimiento.id, { cerrarSesiones: true });

    for (const datos of [
      { email: 'dueno-a@prueba.test', password: 'otra-clave-equivocada' },
      { email: 'off@prueba.test', password: PASSWORD },
    ]) {
      const res = await request(app).post('/api/auth/login').send(datos).expect(401);
      expect(res.body).toEqual({ error: 'Email o contraseña incorrectos' });
    }
    expect(await prisma.usuario.count()).toBe(2);

    // El email sigue reservado: crear un tambo con él da 409.
    await admin
      .post('/api/admin/tambos')
      .send({ nombreEstablecimiento: 'Otro', nombre: 'O', email: 'dueno-a@prueba.test', password: PASSWORD })
      .expect(409);
  });

  it('el ingreso correcto registra ultimoIngresoEn; /auth/yo, el alta de cuenta y la contraseña mala no', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    // El alta de la cuenta no cuenta como ingreso.
    expect((await prisma.usuario.findFirstOrThrow()).ultimoIngresoEn).toBeNull();
    await a.agente.get('/api/auth/yo').expect(200);
    await request(app).post('/api/auth/login').send({ email: 'dueno-a@prueba.test', password: 'mala-mala-mala' }).expect(401);
    expect((await prisma.usuario.findFirstOrThrow()).ultimoIngresoEn).toBeNull();

    const antes = Date.now();
    await request(app).post('/api/auth/login').send({ email: 'dueno-a@prueba.test', password: PASSWORD }).expect(200);
    const ingreso = (await prisma.usuario.findFirstOrThrow()).ultimoIngresoEn;
    expect(ingreso).not.toBeNull();
    expect(ingreso!.getTime()).toBeGreaterThanOrEqual(antes - 1000);
  });
});
