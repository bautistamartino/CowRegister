import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { CLAVES_DETALLE, CLAVES_ITEM_LISTADO, CLAVES_USUARIO_DETALLE } from '../src/admin/listaBlanca.js';
import { PASSWORD, app, crearUsuario, iniciarSesionAdmin, limpiarBase, registrarTambo } from './ayudas.js';

// Estado, baja vigente y último ingreso en el listado y el detalle (spec 015, RF-1, 2, 3, 22, 34).

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

const claves = (o: object) => Object.keys(o).sort();
const ordenadas = (l: readonly string[]) => [...l].sort();

type Item = { id: string; nombre: string; estado: string; ultimoCambioEstado: unknown; ultimoIngreso: string | null };

describe('GET /api/admin/tambos con estado', () => {
  it('un tambo nuevo nace ACTIVO, sin cambio de estado y sin ingreso; las claves son las de la lista blanca', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    await registrarTambo('Libertad', 'dueno@prueba.test');
    const res = await admin.get('/api/admin/tambos').expect(200);
    const [item] = res.body as Item[];
    expect(claves(item)).toEqual(ordenadas(CLAVES_ITEM_LISTADO));
    expect(item).toMatchObject({ estado: 'ACTIVO', ultimoCambioEstado: null, ultimoIngreso: null });
  });

  it('el detalle trae la baja vigente y los usuarios con id y último ingreso (máximo, activos o no)', async () => {
    const { agente: admin } = await iniciarSesionAdmin({ nombre: 'Admin Uno' });
    const t = await registrarTambo('Libertad', 'dueno@prueba.test');
    const id = t.perfil.establecimiento.id;
    await crearUsuario(t.agente, 'VETERINARIO', 'vet@prueba.test'); // ingresa: queda ultimoIngresoEn
    const vet = await prisma.usuario.findUniqueOrThrow({ where: { email: 'vet@prueba.test' } });
    // El veterinario se desactiva: igual cuenta para el último ingreso del tambo.
    await t.agente.patch(`/api/usuarios/${vet.id}`).send({ activo: false }).expect(200);
    await admin.post(`/api/admin/tambos/${id}/baja`).send({ motivo: 'Cerró' }).expect(200);

    const res = await admin.get(`/api/admin/tambos/${id}`).expect(200);
    expect(claves(res.body)).toEqual(ordenadas(CLAVES_DETALLE));
    expect(res.body.estado).toBe('BAJA');
    expect(res.body.ultimoCambioEstado).toMatchObject({ tipo: 'BAJA', por: 'Admin Uno', motivo: 'Cerró' });
    expect(typeof res.body.ultimoCambioEstado.en).toBe('string');

    const usuarios = res.body.usuarios as { id: string; email: string; ultimoIngreso: string | null }[];
    for (const u of usuarios) expect(claves(u)).toEqual(ordenadas(CLAVES_USUARIO_DETALLE));
    const delVet = usuarios.find((u) => u.email === 'vet@prueba.test')!;
    expect(delVet.id).toBe(vet.id);
    expect(delVet.ultimoIngreso).not.toBeNull();
    // El dueño se registró (no ingresó): "nunca".
    expect(usuarios.find((u) => u.email === 'dueno@prueba.test')!.ultimoIngreso).toBeNull();
    expect(res.body.ultimoIngreso).toBe(delVet.ultimoIngreso);
  });

  it('filtra por estado en el servidor y un valor inválido da 400', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    await registrarTambo('Activo', 'a@prueba.test');
    const b = await registrarTambo('Baja', 'b@prueba.test');
    await admin.post(`/api/admin/tambos/${b.perfil.establecimiento.id}/baja`).send({ motivo: 'x' }).expect(200);

    const nombres = async (q: string) =>
      ((await admin.get(`/api/admin/tambos${q}`).expect(200)).body as Item[]).map((t) => t.nombre);
    expect(await nombres('')).toEqual(['Activo', 'Baja']);
    expect(await nombres('?estado=todos')).toEqual(['Activo', 'Baja']);
    expect(await nombres('?estado=activos')).toEqual(['Activo']);
    expect(await nombres('?estado=baja')).toEqual(['Baja']);
    await admin.get('/api/admin/tambos?estado=cualquiera').expect(400);
  });

  it('con un ingreso real el listado muestra la fecha', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    await registrarTambo('Libertad', 'dueno@prueba.test');
    await request(app).post('/api/auth/login').send({ email: 'dueno@prueba.test', password: PASSWORD }).expect(200);
    const [item] = (await admin.get('/api/admin/tambos').expect(200)).body as Item[];
    expect(item.ultimoIngreso).not.toBeNull();
  });
});
