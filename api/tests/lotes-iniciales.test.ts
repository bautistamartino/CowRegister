import { readdirSync, readFileSync } from 'node:fs';
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

// ─── RF-19: migración de datos lotes_iniciales_existentes ───────────────────
// El test no copia el SQL: lo lee del migration.sql real, entre los marcadores
// "-- INICIO lotes iniciales" y "-- FIN lotes iniciales". Así, si alguien
// cambia la migración, este test prueba la versión nueva.
function bloqueMigracion(): string {
  const carpetas = new URL('../prisma/migrations/', import.meta.url);
  const carpeta = readdirSync(carpetas).find((c) => c.endsWith('_lotes_iniciales_existentes'));
  if (!carpeta) throw new Error('No existe la migración lotes_iniciales_existentes');
  const sql = readFileSync(new URL(`${carpeta}/migration.sql`, carpetas), 'utf8');
  const bloque = sql.match(/-- INICIO lotes iniciales\r?\n([\s\S]*?)-- FIN lotes iniciales/);
  if (!bloque) throw new Error('No se encontraron los marcadores en la migración');
  return bloque[1];
}

// Ejecuta el bloque de la migración sobre la base de tests.
async function completarDestinos() {
  await prisma.$executeRawUnsafe(bloqueMigracion());
}

// Destinos de un tambo como { ESTADO: nombre del lote }.
async function destinosDe(establecimientoId: string) {
  const reglas = await prisma.reglaLote.findMany({ where: { establecimientoId }, include: { lote: true } });
  return Object.fromEntries(reglas.map((r) => [r.estado, r.lote.nombre]));
}

// Un tambo "viejo": se crea directo en la base, sin lotes ni reglas
// (como quedaron los registrados antes de esta spec).
async function tamboViejo(nombre = 'Tambo viejo') {
  return prisma.establecimiento.create({ data: { nombre } });
}

describe('Destinos de los tambos ya registrados (RF-19)', () => {
  it('un tambo sin reglas recibe los 4 lotes y los 4 destinos', async () => {
    const tambo = await tamboViejo();

    await completarDestinos();

    const lotes = await prisma.lote.findMany({ where: { establecimientoId: tambo.id } });
    expect(lotes.map((l) => l.nombre).sort()).toEqual(['En ordeñe', 'Secas', 'Terneros', 'Vaquillonas']);
    expect(await destinosDe(tambo.id)).toEqual({
      RECIEN_NACIDO: 'Terneros',
      VAQUILLONA: 'Vaquillonas',
      EN_ORDENE: 'En ordeñe',
      SECA: 'Secas',
    });
  });

  it('reutiliza un lote propio con el nombre normalizado ("  terneros") sin duplicarlo', async () => {
    const tambo = await tamboViejo();
    const propio = await prisma.lote.create({ data: { establecimientoId: tambo.id, nombre: '  terneros' } });
    // También con tabulaciones y espacios internos repetidos.
    const ordene = await prisma.lote.create({ data: { establecimientoId: tambo.id, nombre: '\tEN   ORDEÑE\t' } });

    await completarDestinos();

    const reglaRecien = await prisma.reglaLote.findUnique({
      where: { establecimientoId_estado: { establecimientoId: tambo.id, estado: 'RECIEN_NACIDO' } },
    });
    expect(reglaRecien?.loteId).toBe(propio.id);
    const reglaOrdene = await prisma.reglaLote.findUnique({
      where: { establecimientoId_estado: { establecimientoId: tambo.id, estado: 'EN_ORDENE' } },
    });
    expect(reglaOrdene?.loteId).toBe(ordene.id);

    // 4 lotes en total: los 2 propios (sin tocar su nombre) + Vaquillonas y Secas.
    const lotes = await prisma.lote.findMany({ where: { establecimientoId: tambo.id } });
    expect(lotes.map((l) => l.nombre).sort()).toEqual(['\tEN   ORDEÑE\t', '  terneros', 'Secas', 'Vaquillonas']);
  });

  it('un estado que ya tiene destino no se toca y no se crea su lote inicial', async () => {
    const tambo = await tamboViejo();
    const viejas = await prisma.lote.create({ data: { establecimientoId: tambo.id, nombre: 'Secas viejas' } });
    const regla = await prisma.reglaLote.create({
      data: { establecimientoId: tambo.id, estado: 'SECA', loteId: viejas.id },
    });

    await completarDestinos();

    const despues = await prisma.reglaLote.findUnique({ where: { id: regla.id } });
    expect(despues).toEqual(regla); // misma regla, mismo lote, misma fecha de modificación
    expect(await prisma.lote.findFirst({ where: { establecimientoId: tambo.id, nombre: 'Secas' } })).toBeNull();
    expect(await destinosDe(tambo.id)).toEqual({
      RECIEN_NACIDO: 'Terneros',
      VAQUILLONA: 'Vaquillonas',
      EN_ORDENE: 'En ordeñe',
      SECA: 'Secas viejas',
    });
  });

  it('no usa lotes de otro tambo y no cambia a los tambos ya completos', async () => {
    const { perfil } = await registrarTambo('Tambo nuevo', 'nuevo@prueba.test');
    const completo = perfil.establecimiento.id;
    const antesCompleto = await prisma.reglaLote.findMany({ where: { establecimientoId: completo }, orderBy: { id: 'asc' } });
    const viejo = await tamboViejo();

    await completarDestinos();

    // El tambo completo sigue igual.
    expect(await prisma.reglaLote.findMany({ where: { establecimientoId: completo }, orderBy: { id: 'asc' } })).toEqual(
      antesCompleto,
    );
    expect(await prisma.lote.count({ where: { establecimientoId: completo } })).toBe(4);
    // El viejo recibió sus propios lotes (la clave foránea compuesta impide
    // además que apunte a los del otro tambo).
    expect(await prisma.lote.count({ where: { establecimientoId: viejo.id } })).toBe(4);
    expect(await prisma.reglaLote.count({ where: { establecimientoId: viejo.id } })).toBe(4);
  });

  it('correr el bloque dos veces no duplica lotes ni reglas', async () => {
    const tambo = await tamboViejo();

    await completarDestinos();
    await completarDestinos();

    expect(await prisma.lote.count({ where: { establecimientoId: tambo.id } })).toBe(4);
    expect(await prisma.reglaLote.count({ where: { establecimientoId: tambo.id } })).toBe(4);
  });
});
