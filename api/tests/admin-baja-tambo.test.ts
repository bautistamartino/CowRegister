import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { PASSWORD, app, crearUsuario, iniciarSesionAdmin, limpiarBase, registrarTambo } from './ayudas.js';

// Baja y reactivación de un tambo por el administrador (spec 015, RF-4, 5, 7, 12, 13, 14, 15, 32).

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

const UUID_CUALQUIERA = '00000000-0000-4000-8000-000000000000';

// Dos tambos: A con dueño y veterinario (ambos con sesión abierta) y B con su dueño.
async function prepararEscenario() {
  const { agente: admin } = await iniciarSesionAdmin();
  const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
  const vetA = await crearUsuario(a.agente, 'VETERINARIO', 'vet-a@prueba.test');
  const b = await registrarTambo('Tambo B', 'dueno-b@prueba.test');
  return { admin, a, vetA, b, idA: a.perfil.establecimiento.id, idB: b.perfil.establecimiento.id };
}

describe('POST /api/admin/tambos/:id/baja', () => {
  it('registra quién, cuándo y por qué, borra las sesiones de todos sus usuarios y no toca al otro tambo', async () => {
    const { admin, a, vetA, b, idA, idB } = await prepararEscenario();
    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: idA } } })).toBe(2);

    const res = await admin.post(`/api/admin/tambos/${idA}/baja`).send({ motivo: 'Dejó de usar el sistema' }).expect(200);
    expect(res.body.estado).toBe('BAJA');
    expect(res.body.ultimoCambioEstado).toMatchObject({ tipo: 'BAJA', motivo: 'Dejó de usar el sistema' });
    expect(res.body.ultimoCambioEstado.por).toBe('Administrador de prueba');

    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: idA } } })).toBe(0);
    await a.agente.get('/api/auth/yo').expect(401);
    await vetA.get('/api/auth/yo').expect(401);

    // El tambo B queda intacto.
    expect((await prisma.establecimiento.findUniqueOrThrow({ where: { id: idB } })).estado).toBe('ACTIVO');
    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: idB } } })).toBe(1);
    await b.agente.get('/api/auth/yo').expect(200);

    const registros = await prisma.registroEstadoTambo.findMany({ where: { establecimientoId: idA } });
    expect(registros).toHaveLength(1);
    const auditoria = await prisma.auditoriaAdmin.findMany({ where: { accion: 'TAMBO_BAJA' } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ establecimientoId: idA, tamboNombre: 'Tambo A', usuarioId: null, usuarioEmail: null });
    // Nada se borró.
    expect(await prisma.usuario.count({ where: { establecimientoId: idA } })).toBe(2);
  });

  it('recorta el motivo y acepta 200 caracteres aunque ocupen más de 200 bytes', async () => {
    const { admin, idA } = await prepararEscenario();
    const motivo = '🐄'.repeat(200); // 200 caracteres, 800 bytes
    await admin.post(`/api/admin/tambos/${idA}/baja`).send({ motivo: `   ${motivo}  ` }).expect(200);
    const [registro] = await prisma.registroEstadoTambo.findMany();
    expect(registro.motivo).toBe(motivo);
  });

  it('guarda el motivo con HTML tal cual (la web lo muestra como texto)', async () => {
    const { admin, idA } = await prepararEscenario();
    await admin.post(`/api/admin/tambos/${idA}/baja`).send({ motivo: '<b>x</b>' }).expect(200);
    expect((await prisma.registroEstadoTambo.findFirstOrThrow()).motivo).toBe('<b>x</b>');
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '    '],
    ['201 caracteres', 'a'.repeat(201)],
    ['sin motivo', undefined],
    ['no es texto', 5],
  ])('rechaza con 400 un motivo %s, sin cambiar nada ni auditar', async (_nombre, motivo) => {
    const { admin, idA } = await prepararEscenario();
    await admin.post(`/api/admin/tambos/${idA}/baja`).send({ motivo }).expect(400);
    expect((await prisma.establecimiento.findUniqueOrThrow({ where: { id: idA } })).estado).toBe('ACTIVO');
    expect(await prisma.registroEstadoTambo.count()).toBe(0);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'TAMBO_BAJA' } })).toBe(0);
    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: idA } } })).toBe(2);
  });

  it('dar de baja uno ya dado de baja da 409 sin segundo registro ni auditoría', async () => {
    const { admin, idA } = await prepararEscenario();
    await admin.post(`/api/admin/tambos/${idA}/baja`).send({ motivo: 'Primera' }).expect(200);
    const res = await admin.post(`/api/admin/tambos/${idA}/baja`).send({ motivo: 'Segunda' }).expect(409);
    expect(res.body.error).toBe('El tambo ya está dado de baja');
    expect(await prisma.registroEstadoTambo.count()).toBe(1);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'TAMBO_BAJA' } })).toBe(1);
  });

  it('id mal formado o inexistente da 404 sin auditar', async () => {
    const { admin } = await prepararEscenario();
    await admin.post('/api/admin/tambos/no-es-un-id/baja').send({ motivo: 'x' }).expect(404);
    await admin.post(`/api/admin/tambos/${UUID_CUALQUIERA}/baja`).send({ motivo: 'x' }).expect(404);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'TAMBO_BAJA' } })).toBe(0);
  });

  it('sin sesión de administrador da 401 y con un usuario de tambo 403', async () => {
    const { a, idA } = await prepararEscenario();
    await request(app).post(`/api/admin/tambos/${idA}/baja`).send({ motivo: 'x' }).expect(401);
    await a.agente.post(`/api/admin/tambos/${idA}/baja`).send({ motivo: 'x' }).expect(403);
    expect((await prisma.establecimiento.findUniqueOrThrow({ where: { id: idA } })).estado).toBe('ACTIVO');
  });
});

describe('POST /api/admin/tambos/:id/reactivar', () => {
  it('reactiva sin motivo, registra quién y cuándo, y los usuarios activos ingresan con su contraseña de siempre', async () => {
    const { admin, a, idA } = await prepararEscenario();
    // El veterinario fue desactivado por el dueño antes de la baja: sigue desactivado después.
    const vet = await prisma.usuario.findUniqueOrThrow({ where: { email: 'vet-a@prueba.test' } });
    await a.agente.patch(`/api/usuarios/${vet.id}`).send({ activo: false }).expect(200);
    const antes = await prisma.usuario.findMany({
      where: { establecimientoId: idA },
      select: { id: true, passwordHash: true, activo: true },
      orderBy: { id: 'asc' },
    });

    await admin.post(`/api/admin/tambos/${idA}/baja`).send({ motivo: 'Baja' }).expect(200);
    const res = await admin.post(`/api/admin/tambos/${idA}/reactivar`).expect(200);
    expect(res.body.estado).toBe('ACTIVO');
    expect(res.body.ultimoCambioEstado).toMatchObject({ tipo: 'REACTIVACION', motivo: null, por: 'Administrador de prueba' });

    // Las sesiones cerradas no vuelven.
    await a.agente.get('/api/auth/yo').expect(401);
    // El dueño reingresa; el desactivado sigue desactivado; contraseñas y estados no cambian.
    await request(app).post('/api/auth/login').send({ email: 'dueno-a@prueba.test', password: PASSWORD }).expect(200);
    await request(app).post('/api/auth/login').send({ email: 'vet-a@prueba.test', password: PASSWORD }).expect(401);
    const despues = await prisma.usuario.findMany({
      where: { establecimientoId: idA },
      select: { id: true, passwordHash: true, activo: true },
      orderBy: { id: 'asc' },
    });
    expect(despues).toEqual(antes);

    const registros = await prisma.registroEstadoTambo.findMany({ orderBy: { creadoEn: 'asc' } });
    expect(registros.map((r) => r.tipo)).toEqual(['BAJA', 'REACTIVACION']);
    expect(registros[1].motivo).toBeNull();
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'TAMBO_REACTIVADO' } })).toBe(1);
  });

  it('reactivar uno activo da 409 sin registro ni auditoría; id inexistente o mal formado 404', async () => {
    const { admin, idA } = await prepararEscenario();
    const res = await admin.post(`/api/admin/tambos/${idA}/reactivar`).expect(409);
    expect(res.body.error).toBe('El tambo no está dado de baja');
    await admin.post('/api/admin/tambos/xyz/reactivar').expect(404);
    await admin.post(`/api/admin/tambos/${UUID_CUALQUIERA}/reactivar`).expect(404);
    expect(await prisma.registroEstadoTambo.count()).toBe(0);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'TAMBO_REACTIVADO' } })).toBe(0);
  });

  it('tras una segunda baja el detalle muestra la segunda', async () => {
    const { admin, idA } = await prepararEscenario();
    await admin.post(`/api/admin/tambos/${idA}/baja`).send({ motivo: 'Primera' }).expect(200);
    await admin.post(`/api/admin/tambos/${idA}/reactivar`).expect(200);
    const res = await admin.post(`/api/admin/tambos/${idA}/baja`).send({ motivo: 'Segunda' }).expect(200);
    expect(res.body.ultimoCambioEstado).toMatchObject({ tipo: 'BAJA', motivo: 'Segunda' });
  });
});
