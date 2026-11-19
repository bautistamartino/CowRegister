import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  CLAVES_DETALLE,
  CLAVES_ITEM_LISTADO,
  CLAVES_PERFIL_ADMIN,
  CLAVES_USUARIO_DETALLE,
} from '../src/admin/listaBlanca.js';
import { app, crearAnimalDirecto, crearUsuario, iniciarSesionAdmin, limpiarBase, registrarTambo } from './ayudas.js';

// Listado, detalle y perfil del administrador (spec 014, RF-16 a RF-20 y RF-31).

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

const claves = (o: object) => Object.keys(o).sort();
const ordenadas = (l: readonly string[]) => [...l].sort();

type Item = {
  id: string;
  nombre: string;
  creadoEn: string;
  dueno: { nombre: string; email: string } | null;
  duenosAdicionales: number;
  usuariosActivos: number;
  animalesActivos: number;
};

describe('GET /api/admin/yo', () => {
  it('devuelve solo id, nombre y email del administrador', async () => {
    const { agente, admin } = await iniciarSesionAdmin({ nombre: 'Admin Uno', email: 'admin@prueba.test' });
    const res = await agente.get('/api/admin/yo').expect(200);
    expect(claves(res.body)).toEqual(ordenadas(CLAVES_PERFIL_ADMIN));
    expect(res.body).toEqual({ id: admin.id, nombre: 'Admin Uno', email: 'admin@prueba.test' });
  });
});

describe('GET /api/admin/tambos (RF-16, RF-17, RF-19, RF-31)', () => {
  it('sin tambos devuelve una lista vacía', async () => {
    const { agente } = await iniciarSesionAdmin();
    const res = await agente.get('/api/admin/tambos').expect(200);
    expect(res.body).toEqual([]);
  });

  it('trae todos los tambos ordenados por nombre, con las cantidades correctas', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    const b = await registrarTambo('Bravo', 'b@prueba.test');
    const a = await registrarTambo('alfa', 'a@prueba.test');
    await registrarTambo('Charlie', 'c@prueba.test');

    // Tambo Bravo: 1 dueño + 1 encargado activo + 1 veterinario desactivado.
    await crearUsuario(b.agente, 'ENCARGADO', 'enc@prueba.test');
    await crearUsuario(b.agente, 'VETERINARIO', 'vet@prueba.test');
    const vet = await prisma.usuario.findUniqueOrThrow({ where: { email: 'vet@prueba.test' } });
    await b.agente.patch(`/api/usuarios/${vet.id}`).send({ activo: false }).expect(200);

    // Animales: 2 activos y 1 de baja en Bravo (la baja no cuenta); 1 en Alfa.
    await crearAnimalDirecto(b.perfil.establecimiento.id, '101');
    await crearAnimalDirecto(b.perfil.establecimiento.id, '102');
    await crearAnimalDirecto(b.perfil.establecimiento.id, '103', { estado: 'BAJA' });
    await crearAnimalDirecto(a.perfil.establecimiento.id, '201');

    const res = await admin.get('/api/admin/tambos').expect(200);
    const items = res.body as Item[];
    expect(items.map((i) => i.nombre)).toEqual(['alfa', 'Bravo', 'Charlie']);

    const bravo = items.find((i) => i.nombre === 'Bravo')!;
    expect(bravo).toMatchObject({
      id: b.perfil.establecimiento.id,
      dueno: { nombre: 'Dueño', email: 'b@prueba.test' },
      duenosAdicionales: 0,
      usuariosActivos: 2, // el veterinario desactivado no cuenta
      animalesActivos: 2,
    });
    expect(items.find((i) => i.nombre === 'alfa')!.animalesActivos).toBe(1);
    // Un tambo sin animales se muestra con cero.
    expect(items.find((i) => i.nombre === 'Charlie')!.animalesActivos).toBe(0);
    // La fecha de alta es la del tambo.
    const est = await prisma.establecimiento.findUniqueOrThrow({ where: { id: b.perfil.establecimiento.id } });
    expect(bravo.creadoEn).toBe(est.creadoEn.toISOString());
  });

  it('un tambo con 2 dueños muestra al más antiguo y duenosAdicionales: 1', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    const t = await registrarTambo('Libertad', 'primero@prueba.test');
    await crearUsuario(t.agente, 'DUENO', 'segundo@prueba.test');

    const res = await admin.get('/api/admin/tambos').expect(200);
    const [item] = res.body as Item[];
    expect(item.dueno).toEqual({ nombre: 'Dueño', email: 'primero@prueba.test' });
    expect(item.duenosAdicionales).toBe(1);
    expect(item.usuariosActivos).toBe(2);
  });

  it('las claves son exactamente las de la lista blanca y no hay datos sensibles ni del tambo', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    const t = await registrarTambo('Libertad', 'dueno@prueba.test');
    await crearAnimalDirecto(t.perfil.establecimiento.id, '555');

    const res = await admin.get('/api/admin/tambos').expect(200);
    const [item] = res.body as Item[];
    expect(claves(item)).toEqual(ordenadas(CLAVES_ITEM_LISTADO));
    expect(claves(item.dueno!)).toEqual(['email', 'nombre']);

    const texto = JSON.stringify(res.body);
    for (const prohibido of ['passwordHash', 'tokenHash', 'argon2', '555', 'lotes', 'eventos']) {
      expect(texto).not.toContain(prohibido);
    }
  });
});

describe('GET /api/admin/tambos/:id (RF-18, RF-19, RF-20, RF-31)', () => {
  it('trae el ítem del listado más todos los usuarios, activos o no, con las claves de la lista blanca', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    const t = await registrarTambo('Libertad', 'primero@prueba.test');
    await crearUsuario(t.agente, 'DUENO', 'segundo@prueba.test');
    await crearUsuario(t.agente, 'VETERINARIO', 'vet@prueba.test');
    const vet = await prisma.usuario.findUniqueOrThrow({ where: { email: 'vet@prueba.test' } });
    await t.agente.patch(`/api/usuarios/${vet.id}`).send({ activo: false }).expect(200);
    await crearAnimalDirecto(t.perfil.establecimiento.id, '301');

    const res = await admin.get(`/api/admin/tambos/${t.perfil.establecimiento.id}`).expect(200);
    expect(claves(res.body)).toEqual(ordenadas(CLAVES_DETALLE));
    expect(res.body).toMatchObject({
      id: t.perfil.establecimiento.id,
      nombre: 'Libertad',
      dueno: { nombre: 'Dueño', email: 'primero@prueba.test' },
      duenosAdicionales: 1,
      usuariosActivos: 2, // los dos dueños; el veterinario está desactivado
      animalesActivos: 1,
    });

    const usuarios = res.body.usuarios as { nombre: string; email: string; rol: string; activo: boolean }[];
    expect(usuarios).toHaveLength(3); // todos, activos o no
    for (const u of usuarios) expect(claves(u)).toEqual(ordenadas(CLAVES_USUARIO_DETALLE));
    expect(usuarios.filter((u) => u.rol === 'DUENO').map((u) => u.email)).toEqual([
      'primero@prueba.test',
      'segundo@prueba.test',
    ]);
    expect(usuarios.find((u) => u.email === 'vet@prueba.test')).toMatchObject({ rol: 'VETERINARIO', activo: false });

    const texto = JSON.stringify(res.body);
    for (const prohibido of ['passwordHash', 'tokenHash', 'argon2', '301']) expect(texto).not.toContain(prohibido);
  });

  it('un id mal formado o inexistente da 404 (nunca 500)', async () => {
    const { agente: admin } = await iniciarSesionAdmin();
    for (const id of ['abc', '123', 'no-es-un-uuid', '%00', '00000000-0000-0000-0000-000000000000']) {
      const res = await admin.get(`/api/admin/tambos/${id}`);
      expect(res.status, id).toBe(404);
      expect(res.body.error).toBe('Tambo no encontrado');
    }
  });

  it('sin sesión devuelve 401', async () => {
    await request(app).get('/api/admin/tambos').expect(401);
  });
});
