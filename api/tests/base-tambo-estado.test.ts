import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { crearAdministradorDirecto, limpiarBase } from './ayudas.js';

// Estos tests NO pasan por la API: insertan directo en la base para comprobar que las garantías
// de las migraciones "admin_acciones_enum" y "tambo_estado_y_registro" (spec 015) están en
// PostgreSQL: RF-1, RF-5 (CHECK del motivo), RF-16 y RF-32 (base).

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

async function preparar() {
  const admin = await crearAdministradorDirecto();
  const tambo = await prisma.establecimiento.create({ data: { nombre: 'Tambo de prueba' } });
  return { admin, tambo };
}

// Inserta un registro de baja o reactivación (con SQL directo para poder probar los CHECK).
function insertarRegistro(
  establecimientoId: string,
  administradorId: string,
  tipo: 'BAJA' | 'REACTIVACION',
  motivo: string | null,
) {
  return prisma.registroEstadoTambo.create({ data: { establecimientoId, administradorId, tipo, motivo } });
}

describe('Estado del tambo (RF-1)', () => {
  it('un tambo nuevo nace ACTIVO y sin registro de bajas', async () => {
    const { tambo } = await preparar();
    expect(tambo.estado).toBe('ACTIVO');
    expect(await prisma.registroEstadoTambo.count({ where: { establecimientoId: tambo.id } })).toBe(0);
  });

  it('los tambos que ya existían antes de la migración quedan ACTIVOS (valor por defecto de la columna)', async () => {
    // Un INSERT que no nombra la columna "estado" (como los de antes de la migración) toma el valor
    // por defecto: ACTIVO.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "establecimientos" ("id", "nombre", "actualizadoEn") VALUES (gen_random_uuid(), 'Viejo', now())`,
    );
    const filas = await prisma.$queryRawUnsafe<{ estado: string }[]>(`SELECT "estado"::text FROM "establecimientos"`);
    expect(filas).toEqual([{ estado: 'ACTIVO' }]);
  });

  it('un usuario nuevo no tiene último ingreso (nunca ingresó)', async () => {
    const { tambo } = await preparar();
    const usuario = await prisma.usuario.create({
      data: { establecimientoId: tambo.id, nombre: 'Ana', email: 'ana@prueba.test', passwordHash: 'x', rol: 'DUENO' },
    });
    expect(usuario.ultimoIngresoEn).toBeNull();
  });
});

describe('Registro de bajas y reactivaciones (RF-5, RF-16)', () => {
  it('acepta una baja con motivo y una reactivación sin motivo', async () => {
    const { admin, tambo } = await preparar();
    const baja = await insertarRegistro(tambo.id, admin.id, 'BAJA', 'Dejó de usar el sistema');
    const reactivacion = await insertarRegistro(tambo.id, admin.id, 'REACTIVACION', null);
    expect(baja.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(baja.creadoEn).toBeInstanceOf(Date);
    expect(reactivacion.motivo).toBeNull();
  });

  it('acepta un motivo de exactamente 200 caracteres, también de 2 bytes (se cuentan caracteres, no bytes)', async () => {
    const { admin, tambo } = await preparar();
    await expect(insertarRegistro(tambo.id, admin.id, 'BAJA', 'a'.repeat(200))).resolves.toBeDefined();
    await expect(insertarRegistro(tambo.id, admin.id, 'BAJA', 'ñ'.repeat(200))).resolves.toBeDefined();
  });

  it('rechaza una baja sin motivo, con motivo vacío, de 201 caracteres o con espacios en los bordes', async () => {
    const { admin, tambo } = await preparar();
    await expect(insertarRegistro(tambo.id, admin.id, 'BAJA', null)).rejects.toThrow();
    await expect(insertarRegistro(tambo.id, admin.id, 'BAJA', '')).rejects.toThrow();
    await expect(insertarRegistro(tambo.id, admin.id, 'BAJA', 'a'.repeat(201))).rejects.toThrow();
    await expect(insertarRegistro(tambo.id, admin.id, 'BAJA', ' con espacio')).rejects.toThrow();
    await expect(insertarRegistro(tambo.id, admin.id, 'BAJA', 'con espacio ')).rejects.toThrow();
    expect(await prisma.registroEstadoTambo.count()).toBe(0);
  });

  it('rechaza una reactivación con motivo', async () => {
    const { admin, tambo } = await preparar();
    await expect(insertarRegistro(tambo.id, admin.id, 'REACTIVACION', 'no corresponde')).rejects.toThrow();
  });

  it('rechaza modificar o borrar un registro (solo se agrega)', async () => {
    const { admin, tambo } = await preparar();
    const registro = await insertarRegistro(tambo.id, admin.id, 'BAJA', 'Motivo');
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "registro_estado_tambo" SET "motivo" = 'otro' WHERE "id" = '${registro.id}'::uuid`),
    ).rejects.toThrow(/solo se agrega/);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "registro_estado_tambo" WHERE "id" = '${registro.id}'::uuid`),
    ).rejects.toThrow(/solo se agrega/);
    const despues = await prisma.registroEstadoTambo.findUniqueOrThrow({ where: { id: registro.id } });
    expect(despues.motivo).toBe('Motivo');
  });

  it('no deja borrar el tambo ni el administrador que tienen registros (Restrict)', async () => {
    const { admin, tambo } = await preparar();
    await insertarRegistro(tambo.id, admin.id, 'BAJA', 'Motivo');
    await expect(prisma.establecimiento.delete({ where: { id: tambo.id } })).rejects.toThrow();
    await expect(prisma.administrador.delete({ where: { id: admin.id } })).rejects.toThrow();
  });
});

describe('Auditoría ampliada (RF-32, base)', () => {
  const insertar = (datos: {
    accion: string;
    administradorId: string;
    establecimientoId?: string | null;
    tamboNombre?: string | null;
    usuarioId?: string | null;
    usuarioEmail?: string | null;
  }) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "auditoria_admin" ("id", "accion", "administradorId", "establecimientoId", "tamboNombre", "usuarioId", "usuarioEmail")
       VALUES (gen_random_uuid(), $1::"AccionAdmin", $2::uuid, $3::uuid, $4, $5::uuid, $6)`,
      datos.accion,
      datos.administradorId,
      datos.establecimientoId ?? null,
      datos.tamboNombre ?? null,
      datos.usuarioId ?? null,
      datos.usuarioEmail ?? null,
    );

  it('acepta TAMBO_BAJA y TAMBO_REACTIVADO con tambo y sin usuario', async () => {
    const { admin, tambo } = await preparar();
    for (const accion of ['TAMBO_BAJA', 'TAMBO_REACTIVADO']) {
      await expect(
        insertar({ accion, administradorId: admin.id, establecimientoId: tambo.id, tamboNombre: tambo.nombre }),
      ).resolves.toBeDefined();
    }
  });

  it('acepta CONTRASENA_RESTABLECIDA y USUARIO_REACTIVADO con tambo y usuario (id y email)', async () => {
    const { admin, tambo } = await preparar();
    for (const accion of ['CONTRASENA_RESTABLECIDA', 'USUARIO_REACTIVADO']) {
      await expect(
        insertar({
          accion,
          administradorId: admin.id,
          establecimientoId: tambo.id,
          tamboNombre: tambo.nombre,
          usuarioId: crypto.randomUUID(),
          usuarioEmail: 'ana@prueba.test',
        }),
      ).resolves.toBeDefined();
    }
  });

  it('sigue aceptando TAMBO_CREADO, INGRESO e INGRESO_FALLIDO como en la 014', async () => {
    const { admin, tambo } = await preparar();
    await insertar({ accion: 'TAMBO_CREADO', administradorId: admin.id, establecimientoId: tambo.id, tamboNombre: tambo.nombre });
    await insertar({ accion: 'INGRESO', administradorId: admin.id });
    await insertar({ accion: 'INGRESO_FALLIDO', administradorId: admin.id });
    expect(await prisma.auditoriaAdmin.count()).toBe(3);
  });

  it('rechaza combinaciones incoherentes', async () => {
    const { admin, tambo } = await preparar();
    const t = { establecimientoId: tambo.id, tamboNombre: tambo.nombre };
    const u = { usuarioId: crypto.randomUUID(), usuarioEmail: 'ana@prueba.test' };
    const malas = [
      // baja o reactivación de tambo: sin tambo, o con usuario
      { accion: 'TAMBO_BAJA', administradorId: admin.id },
      { accion: 'TAMBO_BAJA', administradorId: admin.id, ...t, ...u },
      { accion: 'TAMBO_REACTIVADO', administradorId: admin.id, establecimientoId: tambo.id },
      { accion: 'TAMBO_REACTIVADO', administradorId: admin.id, ...t, usuarioId: u.usuarioId },
      // acciones sobre un usuario: falta el id, el email o el tambo
      { accion: 'CONTRASENA_RESTABLECIDA', administradorId: admin.id, ...t },
      { accion: 'CONTRASENA_RESTABLECIDA', administradorId: admin.id, ...t, usuarioId: u.usuarioId },
      { accion: 'USUARIO_REACTIVADO', administradorId: admin.id, ...t, usuarioEmail: u.usuarioEmail },
      { accion: 'USUARIO_REACTIVADO', administradorId: admin.id, ...u },
      // ingresos: no llevan nada
      { accion: 'INGRESO', administradorId: admin.id, ...u },
      { accion: 'INGRESO_FALLIDO', administradorId: admin.id, ...t },
      // creación de tambo: no lleva usuario
      { accion: 'TAMBO_CREADO', administradorId: admin.id, ...t, ...u },
    ];
    for (const mala of malas) await expect(insertar(mala), JSON.stringify(mala)).rejects.toThrow();
    expect(await prisma.auditoriaAdmin.count()).toBe(0);
  });

  it('rechaza modificar o borrar un registro de auditoría (solo se agrega)', async () => {
    const { admin } = await preparar();
    await insertar({ accion: 'INGRESO', administradorId: admin.id });
    await expect(prisma.$executeRawUnsafe(`UPDATE "auditoria_admin" SET "accion" = 'INGRESO_FALLIDO'`)).rejects.toThrow(
      /solo se agrega/,
    );
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "auditoria_admin"`)).rejects.toThrow(/solo se agrega/);
  });
});
