import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { ejecutarAltaUnica } from '../src/admin/altaUnica.js';
import { verificarPassword } from '../src/auth/password.js';
import { PASSWORD, crearAdministradorDirecto, limpiarBase, registrarTambo } from './ayudas.js';

// Alta única del administrador (spec 014, RF-9, RF-10 y RF-11). La lógica vive en altaUnica.ts y
// se prueba sin lanzar procesos: la entrada y la salida se inyectan.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

// Corre el alta con la contraseña de ADMIN_PASSWORD (o la "tipeada") y junta todo lo que escribe.
async function correr(
  argumentos: string[],
  opciones: { env?: Record<string, string | undefined>; tipeada?: string } = {},
) {
  const salida: string[] = [];
  const codigo = await ejecutarAltaUnica({
    argumentos,
    env: opciones.env ?? { ADMIN_PASSWORD: PASSWORD },
    leerPassword: async () => opciones.tipeada ?? '',
    escribir: (texto) => salida.push(texto),
  });
  return { codigo, salida: salida.join('\n') };
}

const ARGS = ['--nombre', 'Ana Admin', '--email', 'Admin@Prueba.test'];

describe('Alta única del administrador', () => {
  it('crea al administrador con el email en minúsculas y la contraseña hasheada (RF-9)', async () => {
    const { codigo, salida } = await correr(ARGS);
    expect(codigo).toBe(0);
    expect(salida).toContain('admin@prueba.test');

    const admin = await prisma.administrador.findFirstOrThrow();
    expect(admin.nombre).toBe('Ana Admin');
    expect(admin.email).toBe('admin@prueba.test');
    expect(admin.passwordHash).not.toBe(PASSWORD);
    expect(await verificarPassword(admin.passwordHash, PASSWORD)).toBe(true);
  });

  it('toma la contraseña de la entrada sin eco si no hay ADMIN_PASSWORD (RF-9)', async () => {
    const { codigo } = await correr(ARGS, { env: {}, tipeada: 'otra-clave-larga-99' });
    expect(codigo).toBe(0);
    const admin = await prisma.administrador.findFirstOrThrow();
    expect(await verificarPassword(admin.passwordHash, 'otra-clave-larga-99')).toBe(true);
  });

  it('la salida no contiene la contraseña ni el hash, ni en éxito ni en error (RF-11)', async () => {
    const ok = await correr(ARGS);
    const hash = (await prisma.administrador.findFirstOrThrow()).passwordHash;
    expect(ok.salida).not.toContain(PASSWORD);
    expect(ok.salida).not.toContain(hash);

    // Segunda vez: se detiene, y tampoco muestra la contraseña.
    const repetido = await correr(ARGS);
    expect(repetido.salida).not.toContain(PASSWORD);
    expect(repetido.salida).not.toContain(hash);

    // Contraseña inválida (corta): el mensaje no la repite.
    await limpiarBase();
    const corta = await correr(ARGS, { env: { ADMIN_PASSWORD: 'corta' } });
    expect(corta.codigo).toBe(1);
    expect(corta.salida).not.toContain('corta');
  });

  it('se detiene sin cambios si ya hay un administrador (RF-10)', async () => {
    const existente = await crearAdministradorDirecto({ email: 'primero@prueba.test' });
    const { codigo, salida } = await correr(['--nombre', 'Otro', '--email', 'otro@prueba.test']);
    expect(codigo).toBe(1);
    expect(salida).toMatch(/ya hay un administrador/i);
    const todos = await prisma.administrador.findMany();
    expect(todos).toHaveLength(1);
    expect(todos[0].id).toBe(existente.id);
    expect(todos[0].passwordHash).toBe(existente.passwordHash);
  });

  it('se detiene si el email ya es de un usuario de un tambo (RF-10)', async () => {
    await registrarTambo('Tambo A', 'dueno@prueba.test');
    const { codigo, salida } = await correr(['--nombre', 'Ana', '--email', 'DUENO@prueba.test']);
    expect(codigo).toBe(1);
    expect(salida).toMatch(/ya existe una cuenta con ese email/i);
    expect(await prisma.administrador.count()).toBe(0);
  });

  it('valida los argumentos: sin nombre o con email inválido no crea nada', async () => {
    expect((await correr(['--email', 'a@prueba.test'])).codigo).toBe(1);
    expect((await correr(['--nombre', 'Ana', '--email', 'no-es-email'])).codigo).toBe(1);
    expect((await correr(['--nombre', 'Ana'])).codigo).toBe(1);
    expect(await prisma.administrador.count()).toBe(0);
  });

  it('dos ejecuciones simultáneas dejan un solo administrador', async () => {
    const resultados = await Promise.all([
      correr(['--nombre', 'Uno', '--email', 'uno@prueba.test']),
      correr(['--nombre', 'Dos', '--email', 'dos@prueba.test']),
    ]);
    expect(resultados.map((r) => r.codigo).sort()).toEqual([0, 1]);
    expect(await prisma.administrador.count()).toBe(1);
    for (const r of resultados) expect(r.salida).not.toContain(PASSWORD);
  });
});
