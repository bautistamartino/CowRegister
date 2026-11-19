import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { buscarSesionAdmin, configSesionAdmin } from '../src/admin/sesionAdmin.js';
import { PASSWORD, app, crearAdministradorDirecto, limpiarBase, registrarTambo } from './ayudas.js';

// Ingreso unificado (spec 014, RF-2 a RF-5 y RF-15): el administrador entra por el mismo
// POST /api/auth/login que los usuarios de un tambo.

beforeEach(limpiarBase);
afterEach(() => {
  configSesionAdmin.ahora = () => Date.now();
});
afterAll(() => prisma.$disconnect());

const OCHO_HORAS_MS = 8 * 60 * 60 * 1000;

function cookieDe(res: request.Response, nombre: string): string {
  const cookies = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return cookies.find((c) => c.startsWith(`${nombre}=`)) ?? '';
}

describe('Ingreso fallido: respuestas idénticas (RF-2, RF-3)', () => {
  it('email inexistente, administrador y usuario con clave mala dan exactamente lo mismo', async () => {
    const admin = await crearAdministradorDirecto();
    await registrarTambo('Tambo A', 'dueno@prueba.test');

    const inexistente = await request(app).post('/api/auth/login').send({ email: 'nadie@prueba.test', password: 'mala-clave-1' });
    const deAdmin = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'mala-clave-1' });
    const deUsuario = await request(app).post('/api/auth/login').send({ email: 'dueno@prueba.test', password: 'mala-clave-1' });

    for (const res of [inexistente, deAdmin, deUsuario]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Email o contraseña incorrectos' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('comparten el contador de intentos por IP (429 sin importar el tipo de cuenta)', async () => {
    const admin = await crearAdministradorDirecto();
    await registrarTambo('Tambo A', 'dueno@prueba.test');
    const limiteOriginal = process.env.LIMITE_INTENTOS_LOGIN;
    process.env.LIMITE_INTENTOS_LOGIN = '3';
    try {
      const cuerpos = [
        { email: admin.email, password: 'mala-clave-1' },
        { email: 'dueno@prueba.test', password: 'mala-clave-1' },
        { email: 'nadie@prueba.test', password: 'mala-clave-1' },
      ];
      let ultimo = 0;
      for (let i = 0; i < 12 && ultimo !== 429; i++) {
        ultimo = (await request(app).post('/api/auth/login').send(cuerpos[i % 3])).status;
      }
      expect(ultimo).toBe(429);
      // Ya bloqueado: tampoco entra el administrador con la clave correcta.
      await request(app).post('/api/auth/login').send({ email: admin.email, password: PASSWORD }).expect(429);
    } finally {
      process.env.LIMITE_INTENTOS_LOGIN = limiteOriginal;
    }
  });
});

describe('Ingreso del administrador (RF-4, RF-5)', () => {
  it('responde con su perfil y rol ADMIN, sin tambo ni hash, y deja la cookie sesion_admin', async () => {
    const admin = await crearAdministradorDirecto({ nombre: 'Ana Admin', email: 'Admin@Prueba.test' });
    const res = await request(app).post('/api/auth/login').send({ email: ' ADMIN@prueba.test ', password: PASSWORD }).expect(200);

    expect(res.body).toEqual({ rol: 'ADMIN', id: admin.id, nombre: 'Ana Admin', email: 'admin@prueba.test' });

    const cookie = cookieDe(res, 'sesion_admin');
    expect(cookie).toMatch(/Path=\/api\/admin/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookieDe(res, 'sesion')).toBe(''); // no recibe la cookie de un usuario de tambo
    expect(await prisma.sesionAdmin.count({ where: { administradorId: admin.id } })).toBe(1);
    expect(await prisma.sesion.count()).toBe(0);
  });

  it('guarda solo el hash del token y vence a las 8 horas fijas', async () => {
    await crearAdministradorDirecto();
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@prueba.test', password: PASSWORD }).expect(200);
    const token = /sesion_admin=([^;]+)/.exec(cookieDe(res, 'sesion_admin'))![1];

    const filas = await prisma.sesionAdmin.findMany();
    expect(filas).toHaveLength(1);
    expect(filas[0].tokenHash).not.toContain(token);
    const duracion = filas[0].expiraEn.getTime() - filas[0].creadoEn.getTime();
    expect(Math.abs(duracion - OCHO_HORAS_MS)).toBeLessThan(5000);

    expect(await buscarSesionAdmin(token)).not.toBeNull();
    // Reloj inyectado: 7 h 59 min sigue válida; pasadas las 8 h vence, aunque se haya usado.
    const inicio = Date.now();
    configSesionAdmin.ahora = () => inicio + OCHO_HORAS_MS - 60_000;
    expect(await buscarSesionAdmin(token)).not.toBeNull();
    configSesionAdmin.ahora = () => inicio + OCHO_HORAS_MS + 60_000;
    expect(await buscarSesionAdmin(token)).toBeNull();
    // Usarla no la renovó: la fila conserva su vencimiento.
    expect((await prisma.sesionAdmin.findMany())[0].expiraEn.getTime()).toBe(filas[0].expiraEn.getTime());
  });

  it('cada ingreso genera un token nuevo', async () => {
    await crearAdministradorDirecto();
    const a = await request(app).post('/api/auth/login').send({ email: 'admin@prueba.test', password: PASSWORD }).expect(200);
    const b = await request(app).post('/api/auth/login').send({ email: 'admin@prueba.test', password: PASSWORD }).expect(200);
    expect(cookieDe(a, 'sesion_admin')).not.toBe(cookieDe(b, 'sesion_admin'));
    const hashes = (await prisma.sesionAdmin.findMany()).map((s) => s.tokenHash);
    expect(new Set(hashes).size).toBe(2);
  });

  it('un usuario de tambo sigue entrando igual (cookie sesion, sin rol ADMIN)', async () => {
    await registrarTambo('Tambo A', 'dueno@prueba.test');
    const res = await request(app).post('/api/auth/login').send({ email: 'dueno@prueba.test', password: PASSWORD }).expect(200);
    expect(res.body.rol).toBe('DUENO');
    expect(cookieDe(res, 'sesion')).toMatch(/Path=\//);
    expect(cookieDe(res, 'sesion_admin')).toBe('');
    expect(await prisma.sesionAdmin.count()).toBe(0);
  });
});

describe('Auditoría de ingresos (RF-15)', () => {
  it('registra el ingreso correcto y el fallido, sin contraseñas ni datos de tambo', async () => {
    const admin = await crearAdministradorDirecto();
    await request(app).post('/api/auth/login').send({ email: admin.email, password: 'clave-equivocada-77' }).expect(401);
    await request(app).post('/api/auth/login').send({ email: admin.email, password: PASSWORD }).expect(200);
    // Email inexistente: no es del administrador, no se audita.
    await request(app).post('/api/auth/login').send({ email: 'nadie@prueba.test', password: 'x' }).expect(401);

    const filas = await prisma.auditoriaAdmin.findMany({ orderBy: { creadoEn: 'asc' } });
    expect(filas.map((f) => f.accion)).toEqual(['INGRESO_FALLIDO', 'INGRESO']);
    for (const f of filas) {
      expect(f.administradorId).toBe(admin.id);
      expect(f.establecimientoId).toBeNull();
      const texto = JSON.stringify(f);
      expect(texto).not.toContain('clave-equivocada-77');
      expect(texto).not.toContain(PASSWORD);
    }
  });
});
