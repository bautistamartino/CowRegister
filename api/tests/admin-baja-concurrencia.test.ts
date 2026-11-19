import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { PASSWORD, app, iniciarSesionAdmin, limpiarBase, registrarTambo } from './ayudas.js';

// Pedidos simultáneos contra la baja de un tambo (spec 015, RF-12, RF-20). Solo dos pedidos a la vez.
// Un caso retiene un bloqueo a mano con una transacción de prueba para ser determinista.
// (Los casos de usuarios, restablecer y reactivar, se suman en la tarea 3.)

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
