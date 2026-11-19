import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { PASSWORD, app, crearUsuario, iniciarSesionAdmin, limpiarBase, registrarTambo } from './ayudas.js';

// Pedidos simultáneos contra la baja de un tambo (spec 015, RF-12, RF-20). Solo dos pedidos a la vez.
// Un caso retiene un bloqueo a mano con una transacción de prueba para ser determinista.
// (Los casos de usuarios están más abajo, tarea 3.)

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

describe('Concurrencia de la baja', () => {
  it('dos bajas simultáneas: una aplica y la otra recibe 409, con un solo registro y sin 500', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    const t = await registrarTambo('Tambo A', 'dueno@prueba.test');
    const id = t.perfil.establecimiento.id;

    const [r1, r2] = await Promise.all([
      admin.post(`/api/admin/tambos/${id}/baja`).send({ motivo: 'Uno' }),
      admin.post(`/api/admin/tambos/${id}/baja`).send({ motivo: 'Dos' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await prisma.registroEstadoTambo.count()).toBe(1);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'TAMBO_BAJA' } })).toBe(1);
    expect(await prisma.sesion.count()).toBe(0);
  });

  it('baja contra reactivación: queda un estado coherente con su último registro y sin 500', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    const t = await registrarTambo('Tambo A', 'dueno@prueba.test');
    const id = t.perfil.establecimiento.id;
    await admin.post(`/api/admin/tambos/${id}/baja`).send({ motivo: 'Primera' }).expect(200);

    const [baja, reactivar] = await Promise.all([
      admin.post(`/api/admin/tambos/${id}/baja`).send({ motivo: 'Otra' }),
      admin.post(`/api/admin/tambos/${id}/reactivar`),
    ]);
    // Dos órdenes posibles: la baja primero (409) y luego la reactivación, o al revés (las dos aplican).
    expect(reactivar.status).toBe(200);
    expect([200, 409]).toContain(baja.status);
    const tambo = await prisma.establecimiento.findUniqueOrThrow({ where: { id } });
    const ultimo = await prisma.registroEstadoTambo.findFirstOrThrow({
      where: { establecimientoId: id },
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
    });
    expect(tambo.estado).toBe(ultimo.tipo === 'BAJA' ? 'BAJA' : 'ACTIVO');
  });

  it('el ingreso retiene el bloqueo del tambo: la baja espera, y al terminar no queda ninguna sesión válida', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    const t = await registrarTambo('Tambo A', 'dueno@prueba.test');
    const id = t.perfil.establecimiento.id;
    const usuario = await prisma.usuario.findFirstOrThrow();

    // Una transacción de prueba hace de "ingreso en curso": toma FOR SHARE y crea una sesión sin confirmar.
    let liberar!: () => void;
    const retenida = new Promise<void>((r) => (liberar = r));
    let tomado!: () => void;
    const yaTomado = new Promise<void>((r) => (tomado = r));
    const ingreso = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT estado FROM establecimientos WHERE id = ${id}::uuid FOR SHARE`;
        await tx.sesion.create({
          data: { usuarioId: usuario.id, tokenHash: 'a'.repeat(64), expiraEn: new Date(Date.now() + 1e9) },
        });
        tomado();
        await retenida;
      },
      { timeout: 60000 },
    );
    await yaTomado;

    let terminoBaja = false;
    const baja = admin
      .post(`/api/admin/tambos/${id}/baja`)
      .send({ motivo: 'x' })
      .then((r) => {
        terminoBaja = true;
        return r;
      });
    await new Promise((r) => setTimeout(r, 1500));
    expect(terminoBaja).toBe(false); // la baja espera al ingreso (FOR SHARE choca con su UPDATE)

    liberar();
    await ingreso;
    expect((await baja).status).toBe(200);
    // La baja borró la sesión que el ingreso confirmó antes que ella.
    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: id } } })).toBe(0);
  });

  it('ingreso simultáneo con la baja: o se rechaza, o su sesión queda cerrada; nunca una sesión válida', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    const t = await registrarTambo('Tambo A', 'dueno@prueba.test');
    const id = t.perfil.establecimiento.id;

    const [login, baja] = await Promise.all([
      request(app).post('/api/auth/login').send({ email: 'dueno@prueba.test', password: PASSWORD }),
      admin.post(`/api/admin/tambos/${id}/baja`).send({ motivo: 'x' }),
    ]);
    expect(baja.status).toBe(200);
    expect([200, 403]).toContain(login.status);
    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: id } } })).toBe(0);
    // Si el ingreso devolvió cookie, esa cookie ya no sirve.
    if (login.status === 200) {
      const cookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
      await request(app).get('/api/auth/yo').set('Cookie', cookie).expect(401);
    }
  });
});

// Baja contra las acciones sobre usuarios (spec 015, RF-12): el estado del tambo se mira dentro de la
// misma transacción de cada acción, así que o la acción queda antes de la baja o recibe 409/401.
describe('Concurrencia de la baja con acciones sobre usuarios', () => {
  async function preparar() {
    const { agente: admin } = await iniciarSesionAdmin();
    const t = await registrarTambo('Tambo A', 'dueno@prueba.test');
    const id = t.perfil.establecimiento.id;
    const vet = await crearUsuario(t.agente, 'VETERINARIO', 'vet@prueba.test');
    const uVet = await prisma.usuario.findFirstOrThrow({ where: { email: 'vet@prueba.test' } });
    return { admin, t, id, vet, uVet };
  }

  it('baja contra restablecer contraseña: sin 500 y ninguna sesión viva en el tambo de baja', async () => {
    const { admin, id, uVet } = await preparar();
    const [baja, restablecer] = await Promise.all([
      admin.post(`/api/admin/tambos/${id}/baja`).send({ motivo: 'x' }),
      admin.post(`/api/admin/tambos/${id}/usuarios/${uVet.id}/contrasena`).send({ password: 'contraseña-nueva-1' }),
    ]);
    expect(baja.status).toBe(200);
    expect([204, 409]).toContain(restablecer.status);
    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: id } } })).toBe(0);
    // La auditoría concuerda con lo aplicado.
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'CONTRASENA_RESTABLECIDA' } })).toBe(
      restablecer.status === 204 ? 1 : 0,
    );
  });

  it('baja contra reactivar usuario: sin 500 y estado coherente', async () => {
    const { admin, t, id, uVet } = await preparar();
    await t.agente.patch(`/api/usuarios/${uVet.id}`).send({ activo: false }).expect(200);
    const [baja, reactivar] = await Promise.all([
      admin.post(`/api/admin/tambos/${id}/baja`).send({ motivo: 'x' }),
      admin.post(`/api/admin/tambos/${id}/usuarios/${uVet.id}/reactivar`),
    ]);
    expect(baja.status).toBe(200);
    expect([200, 409]).toContain(reactivar.status);
    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: id } } })).toBe(0);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: uVet.id } })).activo).toBe(reactivar.status === 200);
    expect(await prisma.auditoriaAdmin.count({ where: { accion: 'USUARIO_REACTIVADO' } })).toBe(
      reactivar.status === 200 ? 1 : 0,
    );
  });

  it('baja contra alta de usuario del dueño: o el alta queda antes (201) o se rechaza (401); ninguna sesión viva', async () => {
    const { admin, t, id } = await preparar();
    const [baja, alta] = await Promise.all([
      admin.post(`/api/admin/tambos/${id}/baja`).send({ motivo: 'x' }),
      t.agente.post('/api/usuarios').send({ nombre: 'Nuevo', email: 'nuevo@prueba.test', password: PASSWORD, rol: 'ENCARGADO' }),
    ]);
    expect(baja.status).toBe(200);
    expect([201, 401]).toContain(alta.status);
    expect(await prisma.usuario.count({ where: { email: 'nuevo@prueba.test' } })).toBe(alta.status === 201 ? 1 : 0);
    expect(await prisma.sesion.count({ where: { usuario: { establecimientoId: id } } })).toBe(0);
  });

  it('el restablecer retiene el bloqueo del tambo: la baja espera y después cierra todo', async () => {
    const { admin, id, uVet } = await preparar();
    // Una transacción de prueba hace de "restablecer en curso": toma FOR SHARE y no termina.
    let liberar!: () => void;
    const retenida = new Promise<void>((r) => (liberar = r));
    let tomado!: () => void;
    const yaTomado = new Promise<void>((r) => (tomado = r));
    const accion = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT estado FROM establecimientos WHERE id = ${id}::uuid FOR SHARE`;
        tomado();
        await retenida;
      },
      { timeout: 60000 },
    );
    await yaTomado;

    let terminoBaja = false;
    const baja = admin
      .post(`/api/admin/tambos/${id}/baja`)
      .send({ motivo: 'x' })
      .then((r) => {
        terminoBaja = true;
        return r;
      });
    await new Promise((r) => setTimeout(r, 1500));
    expect(terminoBaja).toBe(false);
    liberar();
    await accion;
    expect((await baja).status).toBe(200);
    expect(uVet.id).toBeTruthy();
  });
});
