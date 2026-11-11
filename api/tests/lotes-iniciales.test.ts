import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { crearTamboConDueno } from '../src/auth/registro.js';
import { limpiarBase, registrarTambo } from './ayudas.js';

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

// RF-18: al registrar un tambo nuevo se crean sus 4 lotes iniciales,
// cada uno configurado como destino de su estado.
describe('Lotes iniciales en el registro (RF-18)', () => {
  it('un tambo recién registrado tiene los 4 lotes con sus 4 destinos', async () => {
    const { perfil } = await registrarTambo('Tambo A', 'a@prueba.test');
    const establecimientoId = perfil.establecimiento.id;

    const lotes = await prisma.lote.findMany({ where: { establecimientoId } });
    expect(lotes.map((l) => l.nombre).sort()).toEqual(['En ordeñe', 'Secas', 'Terneros', 'Vaquillonas']);

    const reglas = await prisma.reglaLote.findMany({
      where: { establecimientoId },
      include: { lote: true },
    });
    // Cada estado apunta al lote con su nombre inicial.
    const destinos = Object.fromEntries(reglas.map((r) => [r.estado, r.lote.nombre]));
    expect(destinos).toEqual({
      RECIEN_NACIDO: 'Terneros',
      VAQUILLONA: 'Vaquillonas',
      EN_ORDENE: 'En ordeñe',
      SECA: 'Secas',
    });
  });

  it('dos tambos tienen cada uno sus propios lotes iniciales', async () => {
    const { perfil: a } = await registrarTambo('Tambo A', 'a@prueba.test');
    const { perfil: b } = await registrarTambo('Tambo B', 'b@prueba.test');

    expect(await prisma.lote.count({ where: { establecimientoId: a.establecimiento.id } })).toBe(4);
    expect(await prisma.lote.count({ where: { establecimientoId: b.establecimiento.id } })).toBe(4);
    expect(await prisma.reglaLote.count({ where: { establecimientoId: b.establecimiento.id } })).toBe(4);
  });

  it('si falla la creación del dueño, no queda establecimiento, lotes ni reglas', async () => {
    await registrarTambo('Tambo A', 'repetido@prueba.test');
    const antes = {
      establecimientos: await prisma.establecimiento.count(),
      lotes: await prisma.lote.count(),
      reglas: await prisma.reglaLote.count(),
    };

    // Se llama a la función directamente (sin la verificación de email de la
    // ruta) para forzar que el dueño falle al final de la transacción.
    await expect(
      crearTamboConDueno({
        nombreEstablecimiento: 'Tambo B',
        nombre: 'Dueño B',
        email: 'repetido@prueba.test',
        passwordHash: 'hash-de-prueba',
      }),
    ).rejects.toThrow();

    expect(await prisma.establecimiento.count()).toBe(antes.establecimientos);
    expect(await prisma.lote.count()).toBe(antes.lotes);
    expect(await prisma.reglaLote.count()).toBe(antes.reglas);
    expect(await prisma.establecimiento.findFirst({ where: { nombre: 'Tambo B' } })).toBeNull();
  });
});
