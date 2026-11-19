import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { limpiarBase } from './ayudas.js';

// Estos tests NO pasan por la API: insertan directo en la base para comprobar que las garantías
// de la migración "administrador_base" (spec 014) están en PostgreSQL: RF-1, RF-7, RF-8, RF-27 y
// RF-34. Aunque el código de la API tuviera un error, la base tiene que rechazar estos datos.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

const crearTambo = (nombre: string) => prisma.establecimiento.create({ data: { nombre } });

// Un usuario de tambo "pelado" (el hash no se usa: no se inicia sesión).
async function crearUsuarioDirecto(email: string, establecimientoId?: string) {
  const tambo = establecimientoId ?? (await crearTambo(`Tambo de ${email}`)).id;
  return prisma.usuario.create({
    data: { establecimientoId: tambo, nombre: 'Usuario', email, passwordHash: 'hash-de-prueba', rol: 'DUENO' },
  });
}

const crearAdminDirecto = (email = 'admin@prueba.test') =>
  prisma.administrador.create({ data: { nombre: 'Admin', email, passwordHash: 'hash-de-prueba' } });

describe('Un solo administrador (RF-1)', () => {
  it('acepta el primero y rechaza el segundo', async () => {
    await crearAdminDirecto('uno@prueba.test');
    await expect(crearAdminDirecto('dos@prueba.test')).rejects.toThrow();
    expect(await prisma.administrador.count()).toBe(1);
  });

  it('dos altas simultáneas dejan un solo administrador', async () => {
    const resultados = await Promise.allSettled([
      crearAdminDirecto('uno@prueba.test'),
      crearAdminDirecto('dos@prueba.test'),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.administrador.count()).toBe(1);
  });

  it('el email del administrador tiene que estar en minúsculas y sin espacios en los extremos', async () => {
    await expect(crearAdminDirecto('Admin@Prueba.test')).rejects.toThrow();
    await expect(crearAdminDirecto(' admin@prueba.test')).rejects.toThrow();
    await expect(crearAdminDirecto('admin@prueba.test')).resolves.toBeDefined();
  });

  it('las tablas nuevas llevan UUID y fechas de creación', async () => {
    const admin = await crearAdminDirecto();
    expect(admin.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/); // UUID v7, como el resto
    expect(admin.creadoEn).toBeInstanceOf(Date);
    expect(admin.actualizadoEn).toBeInstanceOf(Date);
    const sesion = await prisma.sesionAdmin.create({
      data: { administradorId: admin.id, tokenHash: 'abc', expiraEn: new Date(Date.now() + 1000) },
    });
    expect(sesion.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sesion.creadoEn).toBeInstanceOf(Date);
    // Borrar al administrador borra sus sesiones (igual que las de un usuario).
    await prisma.administrador.delete({ where: { id: admin.id } });
    expect(await prisma.sesionAdmin.count()).toBe(0);
  });
});

describe('Email único entre administradores y usuarios (RF-7, RF-8)', () => {
  it('control: emails distintos conviven', async () => {
    await crearAdminDirecto('admin@prueba.test');
    await expect(crearUsuarioDirecto('otro@prueba.test')).resolves.toBeDefined();
  });

  it('rechaza un administrador con el email de un usuario', async () => {
    await crearUsuarioDirecto('ana@prueba.test');
    await expect(crearAdminDirecto('ana@prueba.test')).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.administrador.count()).toBe(0);
  });

  it('rechaza un usuario con el email de un administrador, aunque cambien mayúsculas y espacios', async () => {
    await crearAdminDirecto('admin@prueba.test');
    await expect(crearUsuarioDirecto('admin@prueba.test')).rejects.toMatchObject({ code: 'P2002' });
    await expect(crearUsuarioDirecto('  Admin@Prueba.TEST ')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rechaza el choque con el código de unicidad 23505 (la API lo traduce a 409)', async () => {
    await crearAdminDirecto('admin@prueba.test');
    const error = await crearUsuarioDirecto('admin@prueba.test').catch((e) => e);
    // Según el adaptador, el código llega como P2002 o dentro del mensaje o la causa.
    const detalle = JSON.stringify({ code: error.code, meta: error.meta, cause: error.cause, msg: error.message });
    expect(detalle).toMatch(/P2002|23505/);
  });

  it('rechaza cambiar (UPDATE) el email de un usuario al de un administrador y al revés', async () => {
    const admin = await crearAdminDirecto('admin@prueba.test');
    const usuario = await crearUsuarioDirecto('ana@prueba.test');
    await expect(
      prisma.usuario.update({ where: { id: usuario.id }, data: { email: 'admin@prueba.test' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.administrador.update({ where: { id: admin.id }, data: { email: 'ana@prueba.test' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // Un UPDATE de otra columna no se ve afectado.
    await expect(prisma.usuario.update({ where: { id: usuario.id }, data: { nombre: 'Nuevo' } })).resolves.toBeDefined();
  });

  it('dos altas simultáneas con el mismo email en tablas distintas dejan una sola cuenta', async () => {
    // Varias vueltas: la carrera es de milisegundos y una sola podría pasar por suerte.
    for (let i = 0; i < 4; i++) {
      await limpiarBase();
      const email = `carrera${i}@prueba.test`;
      const tambo = await crearTambo(`Tambo ${i}`);
      const resultados = await Promise.allSettled([crearAdminDirecto(email), crearUsuarioDirecto(email, tambo.id)]);
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const cuentas =
        (await prisma.administrador.count({ where: { email } })) + (await prisma.usuario.count({ where: { email } }));
      expect(cuentas).toBe(1);
    }
  });
});

describe('Nombre de tambo único (RF-27)', () => {
  it('rechaza el mismo nombre con otras mayúsculas y espacios de más', async () => {
    await crearTambo('Libertad');
    await expect(crearTambo('libertad')).rejects.toThrow();
    await expect(crearTambo('  LIBERTAD  ')).rejects.toThrow();
    await crearTambo('La Esperanza');
    await expect(crearTambo('la   esperanza')).rejects.toThrow();
    await expect(crearTambo('La\tEsperanza')).rejects.toThrow();
    // Un nombre distinto sí.
    await expect(crearTambo('Libertad 2')).resolves.toBeDefined();
  });

  it('dos altas simultáneas con el mismo nombre dejan un solo tambo', async () => {
    const resultados = await Promise.allSettled([crearTambo('Concurrente'), crearTambo(' concurrente ')]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.establecimiento.count()).toBe(1);
  });
});

describe('Auditoría del administrador (solo se agrega)', () => {
  async function registro() {
    const admin = await crearAdminDirecto();
    return prisma.auditoriaAdmin.create({ data: { accion: 'INGRESO', administradorId: admin.id } });
  }

  it('rechaza UPDATE y DELETE', async () => {
    const fila = await registro();
    await expect(
      prisma.auditoriaAdmin.update({ where: { id: fila.id }, data: { accion: 'INGRESO_FALLIDO' } }),
    ).rejects.toThrow(/solo se agrega/i);
    await expect(prisma.auditoriaAdmin.delete({ where: { id: fila.id } })).rejects.toThrow(/solo se agrega/i);
    await expect(prisma.auditoriaAdmin.deleteMany()).rejects.toThrow(/solo se agrega/i);
    expect(await prisma.auditoriaAdmin.count()).toBe(1);
  });

  it('TAMBO_CREADO exige el id y el nombre del tambo; las otras acciones no los admiten', async () => {
    const admin = await crearAdminDirecto();
    const base = { administradorId: admin.id };
    const tambo = crypto.randomUUID();
    await expect(prisma.auditoriaAdmin.create({ data: { ...base, accion: 'TAMBO_CREADO' } })).rejects.toThrow();
    await expect(
      prisma.auditoriaAdmin.create({ data: { ...base, accion: 'TAMBO_CREADO', establecimientoId: tambo } }),
    ).rejects.toThrow();
    await expect(
      prisma.auditoriaAdmin.create({
        data: { ...base, accion: 'INGRESO', establecimientoId: tambo, tamboNombre: 'X' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.auditoriaAdmin.create({ data: { ...base, accion: 'INGRESO_FALLIDO', tamboNombre: 'X' } }),
    ).rejects.toThrow();
    // Sin clave foránea al tambo: el id puede ser de un tambo que ya no existe.
    await expect(
      prisma.auditoriaAdmin.create({
        data: { ...base, accion: 'TAMBO_CREADO', establecimientoId: tambo, tamboNombre: 'Tambo borrado' },
      }),
    ).resolves.toBeDefined();
    await expect(prisma.auditoriaAdmin.create({ data: { ...base, accion: 'INGRESO_FALLIDO' } })).resolves.toBeDefined();
  });

  it('no se puede borrar a un administrador que tiene auditoría', async () => {
    const fila = await registro();
    await expect(prisma.administrador.delete({ where: { id: fila.administradorId } })).rejects.toThrow();
  });
});

// ─── RF-34: bloque de dedupe de la migración ────────────────────────────────
// El test no copia el SQL: lo lee del migration.sql real, entre los marcadores
// "-- INICIO DEDUPE NOMBRES" y "-- FIN DEDUPE NOMBRES".
function bloqueDedupe(): string {
  const carpetas = new URL('../prisma/migrations/', import.meta.url);
  const carpeta = readdirSync(carpetas).find((c) => c.endsWith('_administrador_base'));
  if (!carpeta) throw new Error('No existe la migración administrador_base');
  const sql = readFileSync(new URL(`${carpeta}/migration.sql`, carpetas), 'utf8');
  const bloque = sql.match(/-- INICIO DEDUPE NOMBRES\r?\n([\s\S]*?)-- FIN DEDUPE NOMBRES/);
  if (!bloque) throw new Error('No se encontraron los marcadores en la migración');
  return bloque[1];
}

describe('Nombres repetidos que ya existían (RF-34)', () => {
  // Para sembrar duplicados hay que sacar el índice único un rato (en la base real los duplicados
  // existían ANTES de que el índice se creara). Se vuelve a crear siempre, pase lo que pase.
  async function conDuplicados(sembrar: () => Promise<void>, verificar: () => Promise<void>) {
    await prisma.$executeRawUnsafe('DROP INDEX "establecimientos_nombre_unico"');
    try {
      await sembrar();
      await prisma.$executeRawUnsafe(bloqueDedupe());
      await verificar();
    } finally {
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "establecimientos" CASCADE');
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX "establecimientos_nombre_unico" ON "establecimientos" (lower(regexp_replace(btrim("nombre"), '\\s+', ' ', 'g')))`,
      );
    }
  }

  const nombreDe = async (id: string) => (await prisma.establecimiento.findUniqueOrThrow({ where: { id } })).nombre;

  it('conserva el nombre del más antiguo, renombra a los nuevos con (2), (3) y no borra nada', async () => {
    const ids: string[] = [];
    await conDuplicados(
      async () => {
        const fechas = ['2026-01-01', '2026-02-01', '2026-03-01'];
        const nombres = ['Libertad', '  libertad ', 'LIBERTAD'];
        for (let i = 0; i < 3; i++) {
          const t = await prisma.establecimiento.create({ data: { nombre: nombres[i], creadoEn: new Date(fechas[i]) } });
          ids.push(t.id);
        }
        // Un tambo con datos propios, para comprobar que no se toca nada más.
        await prisma.usuario.create({
          data: { establecimientoId: ids[1], nombre: 'Ana', email: 'ana@prueba.test', passwordHash: 'h', rol: 'DUENO' },
        });
        await prisma.establecimiento.create({ data: { nombre: 'Otro tambo' } });
      },
      async () => {
        expect(await nombreDe(ids[0])).toBe('Libertad'); // el más antiguo no cambia
        expect(await nombreDe(ids[1])).toBe('libertad (2)');
        expect(await nombreDe(ids[2])).toBe('LIBERTAD (3)');
        expect(await prisma.establecimiento.count()).toBe(4);
        expect((await prisma.usuario.findFirstOrThrow()).establecimientoId).toBe(ids[1]);
        expect((await prisma.establecimiento.findFirstOrThrow({ where: { nombre: 'Otro tambo' } })).nombre).toBe(
          'Otro tambo',
        );
      },
    );
  });

  it('si el nombre con número ya existe, sigue con el siguiente', async () => {
    const ids: string[] = [];
    await conDuplicados(
      async () => {
        const nombres = ['Libertad', 'Libertad', 'Libertad (2)'];
        const fechas = ['2026-01-01', '2026-02-01', '2026-03-01'];
        for (let i = 0; i < 3; i++) {
          const t = await prisma.establecimiento.create({ data: { nombre: nombres[i], creadoEn: new Date(fechas[i]) } });
          ids.push(t.id);
        }
      },
      async () => {
        expect(await nombreDe(ids[0])).toBe('Libertad');
        expect(await nombreDe(ids[1])).toBe('Libertad (3)');
        expect(await nombreDe(ids[2])).toBe('Libertad (2)');
      },
    );
  });

  it('con la misma fecha de alta desempata por id y los nombres quedan todos distintos', async () => {
    await conDuplicados(
      async () => {
        const fecha = new Date('2026-01-01');
        for (let i = 0; i < 3; i++) await prisma.establecimiento.create({ data: { nombre: 'Igual', creadoEn: fecha } });
      },
      async () => {
        const nombres = (await prisma.establecimiento.findMany()).map((t) => t.nombre).sort();
        expect(nombres).toEqual(['Igual', 'Igual (2)', 'Igual (3)']);
      },
    );
  });

  it('sin duplicados no cambia nada', async () => {
    await conDuplicados(
      async () => {
        await prisma.establecimiento.create({ data: { nombre: 'Libertad' } });
        await prisma.establecimiento.create({ data: { nombre: 'La Esperanza' } });
      },
      async () => {
        const nombres = (await prisma.establecimiento.findMany()).map((t) => t.nombre).sort();
        expect(nombres).toEqual(['La Esperanza', 'Libertad']);
      },
    );
  });
});
