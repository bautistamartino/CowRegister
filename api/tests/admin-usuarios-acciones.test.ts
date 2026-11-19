import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db.js';
import { PASSWORD, app, crearUsuario, darDeBajaTamboDirecto, iniciarSesionAdmin, limpiarBase, registrarTambo } from './ayudas.js';

// Restablecer contraseña y reactivar usuario por el administrador (spec 015, RF-24 a RF-32).

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

const NUEVA = 'contraseña-nueva-xyz-987';
const UUID_CUALQUIERA = '00000000-0000-4000-8000-000000000000';

// Tambo A con dueño y veterinario (los dos con sesión), tambo B con su dueño y el administrador.
async function escenario() {
  const { agente: admin, admin: datosAdmin } = await iniciarSesionAdmin();
  const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
  const vetA = await crearUsuario(a.agente, 'VETERINARIO', 'vet-a@prueba.test');
  const b = await registrarTambo('Tambo B', 'dueno-b@prueba.test');
  const idA = a.perfil.establecimiento.id;
  const idB = b.perfil.establecimiento.id;
  const uVet = await prisma.usuario.findFirstOrThrow({ where: { email: 'vet-a@prueba.test' } });
  const uDuenoB = await prisma.usuario.findFirstOrThrow({ where: { email: 'dueno-b@prueba.test' } });
  return { admin, datosAdmin, a, vetA, b, idA, idB, uVet, uDuenoB, uDuenoA: { id: a.perfil.id } };
}

const urlContrasena = (t: string, u: string) => `/api/admin/tambos/${t}/usuarios/${u}/contrasena`;
const urlReactivar = (t: string, u: string) => `/api/admin/tambos/${t}/usuarios/${u}/reactivar`;

describe('POST /api/admin/tambos/:id/usuarios/:uid/contrasena', () => {
  it('cambia la contraseña, cierra solo las sesiones de ese usuario y audita con el id del usuario', async () => {
    const { admin, a, vetA, idA, uVet, datosAdmin } = await escenario();

    const res = await admin.post(urlContrasena(idA, uVet.id)).send({ password: NUEVA }).expect(204);
    expect(res.text).toBe('');

    // La sesión del veterinario se cerró; la del dueño del mismo tambo sigue.
    await vetA.get('/api/auth/yo').expect(401);
    await a.agente.get('/api/auth/yo').expect(200);
    // Con la contraseña vieja ya no entra, con la nueva sí.
    await request(app).post('/api/auth/login').send({ email: 'vet-a@prueba.test', password: PASSWORD }).expect(401);
    await request(app).post('/api/auth/login').send({ email: 'vet-a@prueba.test', password: NUEVA }).expect(200);

    const audit = await prisma.auditoriaAdmin.findFirstOrThrow({ where: { accion: 'CONTRASENA_RESTABLECIDA' } });
    expect(audit).toMatchObject({
      administradorId: datosAdmin.id,
      establecimientoId: idA,
      tamboNombre: 'Tambo A',
      usuarioId: uVet.id,
      usuarioEmail: 'vet-a@prueba.test',
    });
  });

  it('valida la contraseña con las reglas de siempre (400) sin cambiar nada', async () => {
    const { admin, idA, uVet } = await escenario();
    for (const cuerpo of [{}, { password: 'corta' }, { password: 'x'.repeat(129) }, { password: 12345678901 }]) {
      await admin.post(urlContrasena(idA, uVet.id)).send(cuerpo).expect(400);
    }
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'CONTRASENA_RESTABLECIDA' } })).toBe(0);
    await request(app).post('/api/auth/login').send({ email: 'vet-a@prueba.test', password: PASSWORD }).expect(200);
  });

  it('un usuario desactivado se restablece y sigue desactivado; reactivado después entra con la nueva', async () => {
    const { admin, a, idA, uVet } = await escenario();
    await a.agente.patch(`/api/usuarios/${uVet.id}`).send({ activo: false }).expect(200);

    await admin.post(urlContrasena(idA, uVet.id)).send({ password: NUEVA }).expect(204);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: uVet.id } })).activo).toBe(false);
    await request(app).post('/api/auth/login').send({ email: 'vet-a@prueba.test', password: NUEVA }).expect(401);

    await admin.post(urlReactivar(idA, uVet.id)).expect(200);
    await request(app).post('/api/auth/login').send({ email: 'vet-a@prueba.test', password: NUEVA }).expect(200);
  });

  it('404 para usuario de otro tambo, id mal formado, id de un administrador o tambo inexistente; sin cambios ni auditoría', async () => {
    const { admin, idA, uDuenoB, datosAdmin } = await escenario();
    const hashAntes = (await prisma.usuario.findUniqueOrThrow({ where: { id: uDuenoB.id } })).passwordHash;
    const hashAdminAntes = (await prisma.administrador.findUniqueOrThrow({ where: { id: datosAdmin.id } })).passwordHash;

    await admin.post(urlContrasena(idA, uDuenoB.id)).send({ password: NUEVA }).expect(404); // de otro tambo
    await admin.post(urlContrasena(idA, 'no-es-uuid')).send({ password: NUEVA }).expect(404);
    await admin.post(urlContrasena(idA, datosAdmin.id)).send({ password: NUEVA }).expect(404); // administrador
    await admin.post(urlContrasena(UUID_CUALQUIERA, uDuenoB.id)).send({ password: NUEVA }).expect(404);
    await admin.post(urlContrasena('no-es-uuid', uDuenoB.id)).send({ password: NUEVA }).expect(404);

    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: uDuenoB.id } })).passwordHash).toBe(hashAntes);
    expect((await prisma.administrador.findUniqueOrThrow({ where: { id: datosAdmin.id } })).passwordHash).toBe(hashAdminAntes);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'CONTRASENA_RESTABLECIDA' } })).toBe(0);
  });

  it('con el tambo dado de baja responde 409 sin cambiar nada', async () => {
    const { admin, idA, uVet } = await escenario();
    await admin.post(`/api/admin/tambos/${idA}/baja`).send({ motivo: 'x' }).expect(200);
    const hashAntes = (await prisma.usuario.findUniqueOrThrow({ where: { id: uVet.id } })).passwordHash;
    const res = await admin.post(urlContrasena(idA, uVet.id)).send({ password: NUEVA }).expect(409);
    expect(res.body.error).toMatch(/dado de baja/);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: uVet.id } })).passwordHash).toBe(hashAntes);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'CONTRASENA_RESTABLECIDA' } })).toBe(0);
  });

  it('la contraseña nueva no aparece en la auditoría, en los registros del servidor ni en las respuestas', async () => {
    const { admin, idA, uVet } = await escenario();
    const espias = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const res = await admin.post(urlContrasena(idA, uVet.id)).send({ password: NUEVA }).expect(204);
      const detalle = await admin.get(`/api/admin/tambos/${idA}`).expect(200);
      // Un pedido rechazado con la contraseña en el cuerpo tampoco la filtra.
      const rechazo = await admin.post(urlContrasena(idA, 'no-es-uuid')).send({ password: NUEVA }).expect(404);

      const respuestas = JSON.stringify([res.headers, res.text, detalle.body, rechazo.body]);
      expect(respuestas).not.toContain(NUEVA);
      const registros = JSON.stringify(espias.flatMap((e) => e.mock.calls));
      expect(registros).not.toContain(NUEVA);
      expect(JSON.stringify(await prisma.auditoriaAdmin.findMany())).not.toContain(NUEVA);
      expect(JSON.stringify(await prisma.registroEstadoTambo.findMany())).not.toContain(NUEVA);
    } finally {
      espias.forEach((e) => e.mockRestore());
    }
  });
});

describe('POST /api/admin/tambos/:id/usuarios/:uid/reactivar', () => {
  it('reactiva a un usuario desactivado sin crear sesión ni cambiar su contraseña y lo audita', async () => {
    const { admin, a, idA, uVet, datosAdmin } = await escenario();
    await a.agente.patch(`/api/usuarios/${uVet.id}`).send({ activo: false }).expect(200);
    const hashAntes = (await prisma.usuario.findUniqueOrThrow({ where: { id: uVet.id } })).passwordHash;

    const res = await admin.post(urlReactivar(idA, uVet.id)).expect(200);
    expect(res.body.usuarios.find((u: { id: string }) => u.id === uVet.id).activo).toBe(true);

    const despues = await prisma.usuario.findUniqueOrThrow({ where: { id: uVet.id } });
    expect(despues.activo).toBe(true);
    expect(despues.passwordHash).toBe(hashAntes);
    expect(await prisma.sesion.count({ where: { usuarioId: uVet.id } })).toBe(0);
    // Entra con su contraseña de siempre.
    await request(app).post('/api/auth/login').send({ email: 'vet-a@prueba.test', password: PASSWORD }).expect(200);

    expect(await prisma.auditoriaAdmin.findFirstOrThrow({ where: { accion: 'USUARIO_REACTIVADO' } })).toMatchObject({
      administradorId: datosAdmin.id,
      establecimientoId: idA,
      usuarioId: uVet.id,
      usuarioEmail: 'vet-a@prueba.test',
    });
  });

  it('un usuario ya activo da 409 sin auditoría', async () => {
    const { admin, idA, uVet } = await escenario();
    await admin.post(urlReactivar(idA, uVet.id)).expect(409);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'USUARIO_REACTIVADO' } })).toBe(0);
  });

  it('404 para otro tambo, id mal formado, id de un administrador o tambo inexistente', async () => {
    const { admin, a, idA, uDuenoB, datosAdmin, uVet } = await escenario();
    await a.agente.patch(`/api/usuarios/${uVet.id}`).send({ activo: false }).expect(200);
    await admin.post(urlReactivar(idA, uDuenoB.id)).expect(404);
    await admin.post(urlReactivar(idA, 'no-es-uuid')).expect(404);
    await admin.post(urlReactivar(idA, datosAdmin.id)).expect(404);
    await admin.post(urlReactivar(UUID_CUALQUIERA, uVet.id)).expect(404);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: uVet.id } })).activo).toBe(false);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'USUARIO_REACTIVADO' } })).toBe(0);
  });

  it('con el tambo dado de baja responde 409 y no cambia nada', async () => {
    const { admin, a, idA, uVet } = await escenario();
    await a.agente.patch(`/api/usuarios/${uVet.id}`).send({ activo: false }).expect(200);
    await darDeBajaTamboDirecto(idA);
    const res = await admin.post(urlReactivar(idA, uVet.id)).expect(409);
    expect(res.body.error).toMatch(/dado de baja/);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: uVet.id } })).activo).toBe(false);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'USUARIO_REACTIVADO' } })).toBe(0);
  });

  it('reactivar al último dueño es válido y el dueño puede volver a desactivarlo', async () => {
    const { admin, a, idA, uDuenoA } = await escenario();
    // Un segundo dueño desactiva al primero.
    const dueno2 = await crearUsuario(a.agente, 'DUENO', 'dueno2-a@prueba.test');
    await dueno2.patch(`/api/usuarios/${uDuenoA.id}`).send({ activo: false }).expect(200);

    await admin.post(urlReactivar(idA, uDuenoA.id)).expect(200);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: uDuenoA.id } })).activo).toBe(true);

    // Vuelve a ingresar y puede desactivar al otro dueño con su gestión de usuarios.
    const agente = request.agent(app);
    await agente.post('/api/auth/login').send({ email: 'dueno-a@prueba.test', password: PASSWORD }).expect(200);
    const otro = await prisma.usuario.findFirstOrThrow({ where: { email: 'dueno2-a@prueba.test' } });
    await agente.patch(`/api/usuarios/${otro.id}`).send({ activo: false }).expect(200);
  });
});
