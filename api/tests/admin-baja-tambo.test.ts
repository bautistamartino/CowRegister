import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { PASSWORD, app, crearAnimalDirecto, crearUsuario, iniciarSesionAdmin, limpiarBase, registrarTambo } from './ayudas.js';

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

// Aislamiento entre tambos (spec 015, RF-9, 15): la baja de uno no toca a los demás, ni en el ingreso
// ni en lo que envían (los envíos de pendientes usan los mismos pedidos con `id` generado en el cliente).
describe('Aislamiento entre tambos', () => {
  it('tras la baja de A, un usuario de B ingresa y su envío de pendientes se acepta; A queda rechazado', async () => {
    fijarReloj(new Date('2026-11-11T15:00:00Z'));
    try {
      const { admin, b, idA, idB } = await prepararEscenario();
      const vaca = await crearAnimalDirecto(idB, '101');
      await admin.post(`/api/admin/tambos/${idA}/baja`).send({ motivo: 'Baja de A' }).expect(200);

      // Ingreso de B con sus credenciales: sigue funcionando. Ingreso de A: 403.
      const nuevo = request.agent(app);
      await nuevo.post('/api/auth/login').send({ email: 'dueno-b@prueba.test', password: PASSWORD }).expect(200);
      const rechazo = await request(app).post('/api/auth/login').send({ email: 'dueno-a@prueba.test', password: PASSWORD }).expect(403);
      expect(rechazo.body.codigo).toBe('TAMBO_DE_BAJA');

      // Envío de pendientes de B (litros con id de cliente, repetido: idempotente) con las dos sesiones de B.
      const id = crypto.randomUUID();
      const carga = { id, fecha: '2026-11-11', turno: 'manana', litros: '12.5' };
      for (const agente of [b.agente, nuevo]) {
        const res = await agente.post(`/api/animales/${vaca.id}/produccion`).send(carga).expect(201);
        expect(res.body.id).toBe(id);
      }
      expect(await prisma.produccion.count({ where: { establecimientoId: idB } })).toBe(1);
      // Y un evento (servicio) de B también entra.
      await b.agente
        .post(`/api/animales/${vaca.id}/servicios`)
        .send({ id: crypto.randomUUID(), fecha: '2026-11-10', tipo: 'MONTA_NATURAL' })
        .expect(201);
    } finally {
      fijarReloj(null);
    }
  });

  it('con tres tambos, la baja del de la ruta cambia solo ese: los otros siguen activos, con sesiones y reactivables aparte', async () => {
    const { admin, a, idA, idB } = await prepararEscenario();
    const c = await registrarTambo('Tambo C', 'dueno-c@prueba.test');
    const idC = c.perfil.establecimiento.id;

    await admin.post(`/api/admin/tambos/${idB}/baja`).send({ motivo: 'Solo B' }).expect(200);

    const estados = await prisma.establecimiento.findMany({ select: { id: true, estado: true } });
    expect(Object.fromEntries(estados.map((e) => [e.id, e.estado]))).toEqual({ [idA]: 'ACTIVO', [idB]: 'BAJA', [idC]: 'ACTIVO' });
    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: idB } } })).toBe(0);
    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: idA } } })).toBe(2);
    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: idC } } })).toBe(1);
    await a.agente.get('/api/auth/yo').expect(200);
    await c.agente.get('/api/auth/yo').expect(200);
    await request(app).post('/api/auth/login').send({ email: 'dueno-c@prueba.test', password: PASSWORD }).expect(200);
    // Un solo registro de baja y de auditoría, y es el de B.
    expect((await prisma.registroEstadoTambo.findMany()).map((r) => r.establecimientoId)).toEqual([idB]);
    // Reactivar C (activo) no se confunde con B: 409, y B sigue de baja.
    await admin.post(`/api/admin/tambos/${idC}/reactivar`).expect(409);
    expect((await prisma.establecimiento.findUniqueOrThrow({ where: { id: idB } })).estado).toBe('BAJA');
  });
});
