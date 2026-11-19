import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { iniciarSesionAdmin, limpiarBase } from './ayudas.js';

// Límite de creaciones de tambo del administrador (spec 014, RF-28).
// Está en su propio archivo porque el contador del límite vive en memoria mientras corre el archivo.

process.env.LIMITE_ACCIONES_ADMIN = '2';

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

describe('Límite de creaciones de tambo (RF-28)', () => {
  it('al pasar el límite responde 429 con el mensaje de demasiados intentos', async () => {
    const { agente } = await iniciarSesionAdmin();
    const crear = (n: number) =>
      agente
        .post('/api/admin/tambos')
        .send({ nombreEstablecimiento: `Tambo ${n}`, nombre: 'D', email: `d${n}@prueba.test`, password: 'contraseña-inicial-1' });

    await crear(1).expect(201);
    await crear(2).expect(201);
    const res = await crear(3).expect(429);
    expect(res.body.error).toMatch(/Demasiados intentos/);
    expect(await prisma.establecimiento.count()).toBe(2);
  });
});
