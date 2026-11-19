import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { crearTamboConDueno } from '../src/auth/registro.js';
import { hashearPassword } from '../src/auth/password.js';
import { CLAVES_ITEM_LISTADO } from '../src/admin/listaBlanca.js';
import { PASSWORD, app, iniciarSesionAdmin, limpiarBase, registrarTambo } from './ayudas.js';

// Crear un tambo desde el administrador (spec 014, RF-22 a RF-27).

// Sube el límite de creaciones para que estos tests no se bloqueen entre sí
// (el del límite está en admin-tambos-limite.test.ts).
process.env.LIMITE_ACCIONES_ADMIN = '1000';

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

const cuerpo = (cambios: Record<string, unknown> = {}) => ({
  nombreEstablecimiento: 'Tambo Nuevo',
  nombre: 'Ana López',
  email: 'ana@prueba.test',
  password: 'contraseña-inicial-1',
  ...cambios,
});

describe('POST /api/admin/tambos: alta correcta (RF-22, RF-23)', () => {
  it('deja tambo, dueño, 4 lotes con destinos y la auditoría; responde 201 con el ítem del listado', async () => {
    const { agente, admin } = await iniciarSesionAdmin();
    const res = await agente.post('/api/admin/tambos').send(cuerpo()).expect(201);

    const est = await prisma.establecimiento.findFirstOrThrow();
    expect(est.nombre).toBe('Tambo Nuevo');
    expect(res.body).toMatchObject({
      id: est.id,
      nombre: 'Tambo Nuevo',
      dueno: { nombre: 'Ana López', email: 'ana@prueba.test' },
      duenosAdicionales: 0,
      usuariosActivos: 1,
      animalesActivos: 0,
    });
    expect(Object.keys(res.body).sort()).toEqual([...CLAVES_ITEM_LISTADO].sort());

    const usuario = await prisma.usuario.findFirstOrThrow({ where: { establecimientoId: est.id } });
    expect(usuario).toMatchObject({ rol: 'DUENO', email: 'ana@prueba.test', activo: true });
    expect(usuario.passwordHash).not.toBe('contraseña-inicial-1');

    expect(await prisma.lote.count({ where: { establecimientoId: est.id } })).toBe(4);
    expect(await prisma.reglaLote.count({ where: { establecimientoId: est.id } })).toBeGreaterThan(0);

    const auditoria = await prisma.auditoriaAdmin.findMany({ where: { accion: 'TAMBO_CREADO' } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ administradorId: admin.id, establecimientoId: est.id, tamboNombre: 'Tambo Nuevo' });
  });

  it('no inicia sesión como el dueño, no cambia la cookie del administrador y no devuelve contraseña ni hash', async () => {
    const { agente } = await iniciarSesionAdmin();
    const sesionesAdminAntes = await prisma.sesionAdmin.count();
    const res = await agente.post('/api/admin/tambos').send(cuerpo()).expect(201);

    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.sesion.count()).toBe(0);
    expect(await prisma.sesionAdmin.count()).toBe(sesionesAdminAntes);

    const texto = JSON.stringify(res.body);
    for (const prohibido of ['passwordHash', 'contraseña-inicial-1', 'argon2', 'password']) {
      expect(texto).not.toContain(prohibido);
    }
    // La sesión del administrador sigue siendo la misma y sirve.
    await agente.get('/api/admin/yo').expect(200);
  });

  it('el dueño nuevo puede ingresar con la contraseña inicial', async () => {
    const { agente } = await iniciarSesionAdmin();
    await agente.post('/api/admin/tambos').send(cuerpo()).expect(201);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@prueba.test', password: 'contraseña-inicial-1' });
    expect(res.status).toBe(200);
    expect(res.body.rol).toBe('DUENO');
  });
});

describe('POST /api/admin/tambos: todo o nada (RF-25)', () => {
  it('si falla el alta del dueño no queda tambo, lotes ni auditoría', async () => {
    const { admin } = await iniciarSesionAdmin();
    await registrarTambo('Otro Tambo', 'existente@prueba.test');
    const hash = await hashearPassword(PASSWORD);

    // Se llama directo a crearTamboConDueno (sin la verificación previa de la ruta) con un email que
    // ya existe: la base rechaza el dueño en el último paso y debe deshacer todo lo anterior.
    await expect(
      crearTamboConDueno(
        { nombreEstablecimiento: 'Tambo Fallido', nombre: 'X', email: 'existente@prueba.test', passwordHash: hash },
        { administradorId: admin.id },
      ),
    ).rejects.toThrow();

    expect(await prisma.establecimiento.count({ where: { nombre: 'Tambo Fallido' } })).toBe(0);
    expect(await prisma.establecimiento.count()).toBe(1); // solo "Otro Tambo"
    expect(await prisma.lote.count()).toBe(4); // los de "Otro Tambo"
    expect(await prisma.usuario.count()).toBe(1);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'TAMBO_CREADO' } })).toBe(0);
  });
});

describe('POST /api/admin/tambos: rechazos (RF-24, RF-26, RF-27)', () => {
  it('409 si el email es de un usuario de otro tambo, y no deja nada', async () => {
    const { agente } = await iniciarSesionAdmin();
    await registrarTambo('Otro Tambo', 'ana@prueba.test');
    const res = await agente.post('/api/admin/tambos').send(cuerpo({ email: 'ANA@prueba.test' })).expect(409);
    expect(res.body.error).toBe('Ya existe una cuenta con ese email');
    expect(await prisma.establecimiento.count()).toBe(1);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'TAMBO_CREADO' } })).toBe(0);
  });

  it('409 si el email es el del propio administrador', async () => {
    const { agente, admin } = await iniciarSesionAdmin({ email: 'admin@prueba.test' });
    const res = await agente.post('/api/admin/tambos').send(cuerpo({ email: admin.email })).expect(409);
    expect(res.body.error).toBe('Ya existe una cuenta con ese email');
    expect(await prisma.establecimiento.count()).toBe(0);
  });

  it('409 "Ya existe un tambo con ese nombre" (también con otras mayúsculas y espacios de más)', async () => {
    const { agente } = await iniciarSesionAdmin();
    await registrarTambo('Libertad', 'dueno@prueba.test');
    // También con espacios REPETIDOS en el medio, que el nombre guardado ya trae colapsados.
    await registrarTambo('La Libertad', 'otro@prueba.test');
    for (const nombre of ['Libertad', ' libertad  ', 'LIBERTAD', '  la   LIBERTAD ']) {
      const res = await agente.post('/api/admin/tambos').send(cuerpo({ nombreEstablecimiento: nombre })).expect(409);
      expect(res.body.error).toBe('Ya existe un tambo con ese nombre');
    }
    expect(await prisma.establecimiento.count()).toBe(2);
    expect(await prisma.usuario.count()).toBe(2);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'TAMBO_CREADO' } })).toBe(0);
  });

  it('dos creaciones simultáneas con el mismo nombre dejan un solo tambo (una 201 y la otra 409)', async () => {
    const { agente } = await iniciarSesionAdmin();
    const pedir = (email: string) => agente.post('/api/admin/tambos').send(cuerpo({ email }));
    const respuestas = await Promise.all([pedir('a@prueba.test'), pedir('b@prueba.test')]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(respuestas.find((r) => r.status === 409)!.body.error).toBe('Ya existe un tambo con ese nombre');
    expect(await prisma.establecimiento.count()).toBe(1);
    expect(await prisma.usuario.count()).toBe(1);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'TAMBO_CREADO' } })).toBe(1);
  });

  it('dos creaciones simultáneas con el mismo email dejan un solo tambo con dueño', async () => {
    const { agente } = await iniciarSesionAdmin();
    const pedir = (nombre: string) => agente.post('/api/admin/tambos').send(cuerpo({ nombreEstablecimiento: nombre }));
    const respuestas = await Promise.all([pedir('Tambo Uno'), pedir('Tambo Dos')]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(respuestas.find((r) => r.status === 409)!.body.error).toBe('Ya existe una cuenta con ese email');
    expect(await prisma.establecimiento.count()).toBe(1);
    expect(await prisma.usuario.count()).toBe(1);
  });

  it.each([
    ['nombreEstablecimiento', { nombreEstablecimiento: '   ' }],
    ['nombreEstablecimiento', { nombreEstablecimiento: 'x'.repeat(101) }],
    ['nombre', { nombre: '' }],
    ['email', { email: 'no-es-un-email' }],
    ['password', { password: 'corta' }],
  ])('400 señalando el campo %s', async (campo, cambio) => {
    const { agente } = await iniciarSesionAdmin();
    const res = await agente.post('/api/admin/tambos').send(cuerpo(cambio)).expect(400);
    expect((res.body.detalles as { campo: string }[]).map((d) => d.campo)).toContain(campo);
    expect(await prisma.establecimiento.count()).toBe(0);
  });

  it('400 con el cuerpo vacío', async () => {
    const { agente } = await iniciarSesionAdmin();
    await agente.post('/api/admin/tambos').send({}).expect(400);
  });
});
