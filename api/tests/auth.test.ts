import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { PASSWORD, app, iniciarSesion, limpiarBase, registrarTambo } from './ayudas.js';

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

describe('Registro de tambo', () => {
  it('crea el tambo y su dueño, e inicia sesión con una cookie segura', async () => {
    const res = await request(app)
      .post('/api/auth/registro')
      .send({ nombreEstablecimiento: 'Tambo A', nombre: 'Dueño A', email: 'DUENO@Prueba.test', password: PASSWORD })
      .expect(201);

    expect(res.body.establecimiento.nombre).toBe('Tambo A');
    expect(res.body.rol).toBe('DUENO');
    expect(res.body.email).toBe('dueno@prueba.test'); // se guarda en minúsculas
    expect(res.body).not.toHaveProperty('passwordHash');

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('rechaza un email ya registrado', async () => {
    await registrarTambo('Tambo A', 'dueno@prueba.test');
    await request(app)
      .post('/api/auth/registro')
      .send({ nombreEstablecimiento: 'X', nombre: 'X', email: 'dueno@prueba.test', password: PASSWORD })
      .expect(409);
  });

  it('valida los datos y devuelve un error por campo', async () => {
    const res = await request(app)
      .post('/api/auth/registro')
      .send({ nombreEstablecimiento: 'X', nombre: 'X', email: 'no-es-email', password: 'corta' })
      .expect(400);

    const campos = res.body.detalles.map((d: { campo: string }) => d.campo);
    expect(campos).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('guarda la contraseña hasheada con argon2id', async () => {
    await registrarTambo('Tambo A', 'dueno@prueba.test');
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email: 'dueno@prueba.test' } });
    expect(usuario.passwordHash).toMatch(/^\$argon2id\$/);
    expect(usuario.passwordHash).not.toContain(PASSWORD);
  });
});

describe('Login y sesión', () => {
  it('sin sesión, /yo responde 401', async () => {
    await request(app).get('/api/auth/yo').expect(401);
  });

  it('con sesión, /yo devuelve el usuario y su tambo', async () => {
    const { agente } = await registrarTambo('Tambo A');
    const res = await agente.get('/api/auth/yo').expect(200);
    expect(res.body.establecimiento.nombre).toBe('Tambo A');
  });

  it('da el mismo error con contraseña incorrecta o email inexistente', async () => {
    await registrarTambo('Tambo A', 'dueno@prueba.test');
    const malaClave = await request(app)
      .post('/api/auth/login')
      .send({ email: 'dueno@prueba.test', password: 'incorrecta-123' })
      .expect(401);
    const noExiste = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nadie@prueba.test', password: PASSWORD })
      .expect(401);
    expect(noExiste.body.error).toBe(malaClave.body.error);
  });

  it('el logout invalida la sesión', async () => {
    const { agente } = await registrarTambo();
    await agente.post('/api/auth/logout').expect(204);
    await agente.get('/api/auth/yo').expect(401);
  });

  it('guarda en la base solo el hash del token de sesión', async () => {
    await registrarTambo();
    const sesion = await prisma.sesion.findFirstOrThrow();
    expect(sesion.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Usuarios del tambo', () => {
  it('el dueño crea un encargado; el encargado no puede gestionar usuarios', async () => {
    const { agente } = await registrarTambo();
    const res = await agente
      .post('/api/usuarios')
      .send({ nombre: 'Encargado', email: 'encargado@prueba.test', password: PASSWORD, rol: 'ENCARGADO' })
      .expect(201);
    expect(res.body).not.toHaveProperty('passwordHash');

    const encargado = await iniciarSesion('encargado@prueba.test');
    await encargado.get('/api/usuarios').expect(403);
  });

  it('al desactivar un usuario se cortan sus sesiones', async () => {
    const { agente } = await registrarTambo();
    const { body: encargado } = await agente
      .post('/api/usuarios')
      .send({ nombre: 'Encargado', email: 'encargado@prueba.test', password: PASSWORD, rol: 'ENCARGADO' });
    const sesionEncargado = await iniciarSesion('encargado@prueba.test');

    await agente.patch(`/api/usuarios/${encargado.id}`).send({ activo: false }).expect(200);
    await sesionEncargado.get('/api/auth/yo').expect(401);
  });

  it('el dueño no puede desactivarse a sí mismo', async () => {
    const { agente, perfil } = await registrarTambo();
    await agente.patch(`/api/usuarios/${perfil.id}`).send({ activo: false }).expect(400);
  });
});

describe('Aislamiento entre tambos', () => {
  it('un dueño solo ve los usuarios de su tambo', async () => {
    await registrarTambo('Tambo A', 'a@prueba.test');
    const { agente: dueñoB } = await registrarTambo('Tambo B', 'b@prueba.test');

    const res = await dueñoB.get('/api/usuarios').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].email).toBe('b@prueba.test');
  });

  it('un dueño no puede modificar usuarios de otro tambo', async () => {
    const { perfil: dueñoA } = await registrarTambo('Tambo A', 'a@prueba.test');
    const { agente: dueñoB } = await registrarTambo('Tambo B', 'b@prueba.test');

    await dueñoB.patch(`/api/usuarios/${dueñoA.id}`).send({ activo: false }).expect(404);
  });
});

describe('Otros', () => {
  it('una ruta inexistente responde 404 en JSON', async () => {
    const res = await request(app).get('/api/no-existe').expect(404);
    expect(res.body.error).toBeTruthy();
  });

  it('bloquea temporalmente después de muchos intentos de login', async () => {
    const limiteOriginal = process.env.LIMITE_INTENTOS_LOGIN;
    process.env.LIMITE_INTENTOS_LOGIN = '3';
    try {
      let ultimo = 0;
      for (let i = 0; i < 6 && ultimo !== 429; i++) {
        const res = await request(app).post('/api/auth/login').send({ email: 'x@prueba.test', password: 'mal' });
        ultimo = res.status;
      }
      expect(ultimo).toBe(429);
    } finally {
      process.env.LIMITE_INTENTOS_LOGIN = limiteOriginal;
    }
  });
});
