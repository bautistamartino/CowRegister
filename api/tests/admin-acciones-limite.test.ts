import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { iniciarSesionAdmin, limpiarBase, registrarTambo } from './ayudas.js';

// Límite compartido de acciones sensibles del administrador (spec 015, RF-33).
// Está en su propio archivo porque el contador del límite vive en memoria mientras corre el archivo.

process.env.LIMITE_ACCIONES_SENSIBLES = '3';
process.env.LIMITE_ACCIONES_ADMIN = '2';

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

const UUID_CUALQUIERA = '00000000-0000-4000-8000-000000000000';

describe('Límite de acciones sensibles (RF-33)', () => {
  it('las cuatro acciones comparten un contador que cuenta también los pedidos rechazados', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    const t = await registrarTambo('Tambo A', 'dueno@prueba.test');
    const id = t.perfil.establecimiento.id;
    const uid = t.perfil.id;

    // 1: un 400 (motivo vacío) cuenta. 2: un 404 (usuario inexistente) cuenta. 3: una baja aplicada.
    await admin.post(`/api/admin/tambos/${id}/baja`).send({ motivo: '' }).expect(400);
    await admin
      .post(`/api/admin/tambos/${id}/usuarios/${UUID_CUALQUIERA}/contrasena`)
      .send({ password: 'contraseña-nueva-1' })
      .expect(404);
    await admin.post(`/api/admin/tambos/${id}/baja`).send({ motivo: 'x' }).expect(200);
    const auditoriasAntes = await prisma.auditoriaAdmin.count();

    // 4: ya pasó el límite. Cada una de las cuatro rutas responde "Demasiados intentos" y no cambia nada.
    for (const [url, cuerpo] of [
      [`/api/admin/tambos/${id}/reactivar`, {}],
      [`/api/admin/tambos/${id}/baja`, { motivo: 'otra' }],
      [`/api/admin/tambos/${id}/usuarios/${uid}/contrasena`, { password: 'contraseña-nueva-1' }],
      [`/api/admin/tambos/${id}/usuarios/${uid}/reactivar`, {}],
    ] as const) {
      const res = await admin.post(url).send(cuerpo).expect(429);
      expect(res.body.error).toMatch(/Demasiados intentos/);
    }
    expect((await prisma.establecimiento.findUniqueOrThrow({ where: { id } })).estado).toBe('BAJA');
    expect(await prisma.registroEstadoTambo.count()).toBe(1);
    expect(await prisma.auditoriaAdmin.count()).toBe(auditoriasAntes);
  });

  it('crear tambos tiene su propio contador (no lo consumen las acciones sensibles)', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    const crear = (n: number) =>
      admin
        .post('/api/admin/tambos')
        .send({ nombreEstablecimiento: `Tambo ${n}`, nombre: 'D', email: `d${n}@prueba.test`, password: 'contraseña-inicial-1' });
    // Agota el contador de acciones sensibles (3 pedidos y uno más que da 429).
    for (let i = 0; i < 3; i++) await admin.post(`/api/admin/tambos/${UUID_CUALQUIERA}/reactivar`).expect(404);
    await admin.post(`/api/admin/tambos/${UUID_CUALQUIERA}/reactivar`).expect(429);
    // Crear tambos sigue andando y llega a su propio límite (2).
    await crear(1).expect(201);
    await crear(2).expect(201);
    await crear(3).expect(429);
  });
});
