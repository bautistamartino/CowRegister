import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { rutasAdmin } from '../src/rutas/admin.js';
import { rutasAuth } from '../src/rutas/auth.js';
import { PASSWORD, app, crearUsuario, iniciarSesionAdmin, limpiarBase, registrarTambo } from './ayudas.js';

// Aislamiento entre el administrador y los usuarios de tambo (spec 014, RF-6, RF-12, RF-29, RF-30).

process.env.LIMITE_ACCIONES_ADMIN = '1000';

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

// Lista las rutas (método + camino) que declara un router, leyendo su pila interna.
function rutasDe(router: Router): string[] {
  const pila = (router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
  return pila
    .filter((capa) => capa.route)
    .flatMap((capa) =>
      Object.keys(capa.route!.methods)
        .filter((m) => capa.route!.methods[m])
        .map((m) => `${m.toUpperCase()} ${capa.route!.path}`),
    )
    .sort();
}

// Lista FIJA: si alguien agrega una ruta al administrador, este test falla y obliga a revisarla.
const RUTAS_ADMIN_ESPERADAS = [
  'GET /tambos',
  'GET /tambos/:id',
  'GET /yo',
  'POST /logout',
  'POST /tambos',
  // Spec 015: cambios de estado del tambo y acciones sobre USUARIOS DE TAMBO (nunca administradores).
  'POST /tambos/:id/baja',
  'POST /tambos/:id/reactivar',
  'POST /tambos/:id/usuarios/:uid/contrasena',
  'POST /tambos/:id/usuarios/:uid/reactivar',
];

// Ninguna de estas rutas crea ni modifica administradores (RF-12). Si aparece una nueva en /api/auth,
// hay que revisarla a mano y agregarla acá.
const RUTAS_AUTH_ESPERADAS = ['GET /yo', 'POST /login', 'POST /logout', 'POST /registro'];

const UUID_CUALQUIERA = '00000000-0000-4000-8000-000000000000';

// Cookie `nombre=valor` que dejó un ingreso, para mandarla "a mano" (el agente de supertest respeta el
// `path` de la cookie del administrador y no la enviaría a las rutas del tambo, y acá justamente queremos
// comprobar que el servidor también la rechaza).
async function cookieDeIngreso(email: string, password = PASSWORD): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  const cookies = res.headers['set-cookie'] as unknown as string[];
  return cookies[0].split(';')[0];
}

describe('Lista fija de rutas (RF-12, RF-29)', () => {
  it('las rutas del administrador son exactamente las esperadas', () => {
    expect(rutasDe(rutasAdmin)).toEqual(RUTAS_ADMIN_ESPERADAS);
  });

  it('las rutas de /api/auth son exactamente las esperadas (ninguna crea ni modifica administradores)', () => {
    expect(rutasDe(rutasAuth)).toEqual(RUTAS_AUTH_ESPERADAS);
  });

  it('POST /api/usuarios rechaza el rol ADMIN', async () => {
    const { agente } = await registrarTambo('Tambo A', 'dueno@prueba.test');
    await agente
      .post('/api/usuarios')
      .send({ nombre: 'X', email: 'x@prueba.test', password: PASSWORD, rol: 'ADMIN' })
      .expect(400);
  });
});

describe('Control de acceso de TODAS las rutas del administrador (RF-29)', () => {
  const rutas = RUTAS_ADMIN_ESPERADAS.map((r) => {
    const [metodo, camino] = r.split(' ');
    return { metodo: metodo.toLowerCase() as 'get' | 'post', url: `/api/admin${camino.replace(':id', UUID_CUALQUIERA).replace(':uid', UUID_CUALQUIERA)}`, r };
  });

  it.each(rutas)('$r: sin sesión da 401, con rol de tambo 403 y el administrador pasa', async ({ metodo, url }) => {
    const { admin } = await iniciarSesionAdmin();
    const dueno = await registrarTambo('Tambo A', 'dueno@prueba.test');
    await crearUsuario(dueno.agente, 'ENCARGADO', 'enc@prueba.test');
    await crearUsuario(dueno.agente, 'VETERINARIO', 'vet@prueba.test');

    // Sin sesión: 401, también con un JSON roto (el control va antes de los parsers).
    const sinSesion = await request(app)[metodo](url).set('Content-Type', 'application/json').send('{roto');
    expect(sinSesion.status).toBe(401);
    expect(sinSesion.body.error).toBe('Tenés que iniciar sesión');

    // Dueño, encargado y veterinario: 403, también con JSON roto.
    for (const email of ['dueno@prueba.test', 'enc@prueba.test', 'vet@prueba.test']) {
      const cookie = await cookieDeIngreso(email);
      const res = await request(app)[metodo](url).set('Cookie', cookie).set('Content-Type', 'application/json').send('{roto');
      expect(res.status, email).toBe(403);
      expect(res.body.error).toBe('No tenés permiso para hacer esto');
    }

    // El administrador pasa el control (puede dar 200, 204, 400 o 404 según la ruta, pero no 401 ni 403).
    const cookieAdmin = await cookieDeIngreso(admin.email);
    const ok = await request(app)[metodo](url).set('Cookie', cookieAdmin).send({});
    expect([401, 403]).not.toContain(ok.status);
    expect(ok.status).toBeLessThan(500);
  });

  it('un token inventado en la cookie del administrador da 401', async () => {
    await request(app).get('/api/admin/yo').set('Cookie', 'sesion_admin=inventado').expect(401);
  });
});

describe('Aislamiento entre las dos sesiones (RF-6, RF-30)', () => {
  const RUTAS_DEL_TAMBO = ['/api/auth/yo', '/api/copia-local', '/api/animales', '/api/usuarios', '/api/lotes'];

  it.each(RUTAS_DEL_TAMBO)('la cookie del administrador en %s da 401', async (url) => {
    const { admin } = await iniciarSesionAdmin();
    const cookieAdmin = await cookieDeIngreso(admin.email);
    const res = await request(app).get(url).set('Cookie', cookieAdmin);
    expect(res.status).toBe(401);
  });

  it('el navegador ni envía la cookie del administrador a las rutas del tambo (path)', async () => {
    const { agente } = await iniciarSesionAdmin();
    await agente.get('/api/admin/yo').expect(200);
    await agente.get('/api/auth/yo').expect(401);
    await agente.get('/api/animales').expect(401);
  });

  it('la cookie de un usuario de tambo en /api/admin/* da 403', async () => {
    await registrarTambo('Tambo A', 'dueno@prueba.test');
    const cookieTambo = await cookieDeIngreso('dueno@prueba.test');
    for (const url of ['/api/admin/yo', '/api/admin/tambos', `/api/admin/tambos/${UUID_CUALQUIERA}`]) {
      const res = await request(app).get(url).set('Cookie', cookieTambo);
      expect(res.status, url).toBe(403);
    }
  });

  it('cerrar sesión borra la sesión del administrador en el servidor', async () => {
    const { agente, admin } = await iniciarSesionAdmin();
    const cookieAdmin = await cookieDeIngreso(admin.email);
    await request(app).post('/api/admin/logout').set('Cookie', cookieAdmin).expect(204);
    // Esa cookie ya no sirve (aunque el navegador la siguiera mandando).
    await request(app).get('/api/admin/yo').set('Cookie', cookieAdmin).expect(401);
    // La otra sesión del mismo administrador (la del agente) sigue viva: cada ingreso tiene su token.
    await agente.get('/api/admin/yo').expect(200);
  });

  it('en la base ningún usuario tiene establecimientoId nulo (la columna es NOT NULL)', async () => {
    const filas = await prisma.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'usuarios' AND column_name = 'establecimientoId'`;
    expect(filas).toEqual([{ is_nullable: 'NO' }]);
  });
});

describe('Lo que el administrador puede mirar del tambo (RF-19)', () => {
  const carpeta = join(__dirname, '..', 'src', 'admin');
  const archivos = readdirSync(carpeta).filter((f) => f.endsWith('.ts'));

  it('ningún módulo de api/src/admin/ importa código de animales, eventos, lotes ni producción', () => {
    for (const archivo of archivos) {
      const codigo = readFileSync(join(carpeta, archivo), 'utf8');
      const importaciones = [...codigo.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const origen of importaciones) {
        expect(origen, `${archivo} importa ${origen}`).not.toMatch(
          /\/(animales|bajas|historial|informes|copia|produccion|reproduccion|lotes)\//,
        );
      }
    }
  });

  it('la única consulta sobre datos del tambo es el conteo de animales activos (contarAnimalesActivos)', () => {
    // Modelos con datos del tambo que un módulo del administrador no debe consultar.
    const prohibidos =
      /prisma\.(animal|evento|lote|reglaLote|produccion|semenToro|servicio|tacto|parto|secado|baja|cambioAnimal|criaParto)\b/;
    const encontrados: string[] = [];
    for (const archivo of archivos) {
      const lineas = readFileSync(join(carpeta, archivo), 'utf8').split('\n');
      lineas.forEach((linea, i) => {
        if (prohibidos.test(linea)) encontrados.push(`${archivo}:${i + 1}: ${linea.trim()}`);
      });
    }
    // Solo se admite prisma.animal.groupBy, y únicamente en tambos.ts.
    expect(encontrados).toHaveLength(1);
    expect(encontrados[0]).toMatch(/^tambos\.ts:\d+: .*prisma\.animal\.groupBy/);

    const tambos = readFileSync(join(carpeta, 'tambos.ts'), 'utf8');
    expect(tambos).toContain('export async function contarAnimalesActivos');
    // Cuenta animales de los tambos pedidos y deja afuera las bajas.
    expect(tambos).toMatch(/estado:\s*\{\s*not:\s*'BAJA'\s*\}/);
  });
});
