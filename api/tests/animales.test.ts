import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db.js';
import { app, crearAnimalDirecto, crearUsuario, limpiarBase, registrarTambo } from './ayudas.js';

// Tests de la API de animales: alta, listado, ficha y búsqueda (spec 002, T2).
// Todo tambo registrado con registrarTambo() trae los 4 lotes iniciales con sus destinos.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

// Dos tambos para los tests de aislamiento.
async function dosTambos() {
  const a = await registrarTambo('Tambo A', 'a@prueba.test');
  const b = await registrarTambo('Tambo B', 'b@prueba.test');
  return { a, b };
}

// Lote por nombre, leído de la base (de un tambo concreto).
async function loteDe(establecimientoId: string, nombre: string) {
  return prisma.lote.findFirstOrThrow({ where: { establecimientoId, nombre } });
}

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';

describe('POST /api/animales: alta (RF-1 a RF-9)', () => {
  it('sin sesión responde 401', async () => {
    await request(app).post('/api/animales').send({}).expect(401);
  });

  it('dueño y encargado dan de alta; queda en el lote destino de su estado (RF-1)', async () => {
    const { agente, perfil } = await registrarTambo();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');
    const secas = await loteDe(perfil.establecimiento.id, 'Secas');

    const r1 = await agente.post('/api/animales').send({ numero: '101', sexo: 'HEMBRA', estado: 'SECA' }).expect(201);
    expect(r1.body.avisoSinLote).toBeNull();
    expect(r1.body.animal).toMatchObject({ numero: '101', sexo: 'HEMBRA', estado: 'SECA', lote: { nombre: 'Secas' } });
    const guardado = await prisma.animal.findUniqueOrThrow({ where: { id: r1.body.animal.id } });
    expect(guardado.loteId).toBe(secas.id);
    expect(guardado.establecimientoId).toBe(perfil.establecimiento.id);

    await encargado.post('/api/animales').send({ numero: '102', sexo: 'HEMBRA', estado: 'VAQUILLONA' }).expect(201);
  });

  it('normaliza el número: " ab-1 " se guarda "AB-1" (RF-2)', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/animales').send({ numero: ' ab-1\n', sexo: 'HEMBRA', estado: 'SECA' }).expect(201);
    expect(res.body.animal.numero).toBe('AB-1');
  });

  it.each([
    ['vacío', '   '],
    ['de 21 caracteres', 'A'.repeat(21)],
    ['con espacio interno', '12 3'],
    ['con ñ', 'ñandú'],
    ['con guion bajo', 'A_1'],
  ])('rechaza un número %s con 400 en el campo numero (RF-2)', async (_nombre, numero) => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/animales').send({ numero, sexo: 'HEMBRA', estado: 'SECA' }).expect(400);
    expect(res.body.detalles[0].campo).toBe('numero');
  });

  it('número repetido entre activos da 409; "ab-1" y "AB-1" son el mismo (RF-3)', async () => {
    const { agente } = await registrarTambo();
    await agente.post('/api/animales').send({ numero: 'AB-1', sexo: 'HEMBRA', estado: 'SECA' }).expect(201);
    const res = await agente.post('/api/animales').send({ numero: 'ab-1', sexo: 'HEMBRA', estado: 'SECA' }).expect(409);
    expect(res.body.error).toBe('Ya existe un animal activo con ese número');
  });

  it('el número de un animal dado de baja se puede reutilizar; en otro tambo también (RF-3)', async () => {
    const { a, b } = await dosTambos();
    await crearAnimalDirecto(a.perfil.establecimiento.id, '7', { estado: 'BAJA' });
    await a.agente.post('/api/animales').send({ numero: '7', sexo: 'HEMBRA', estado: 'SECA' }).expect(201);
    await b.agente.post('/api/animales').send({ numero: '7', sexo: 'HEMBRA', estado: 'SECA' }).expect(201);
  });

  it('dos altas simultáneas del mismo número: una da 201 y la otra 409 (RF-4)', async () => {
    const { agente } = await registrarTambo();
    const datos = { numero: '555', sexo: 'HEMBRA', estado: 'SECA' };
    const res = await Promise.all([agente.post('/api/animales').send(datos), agente.post('/api/animales').send(datos)]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.animal.count({ where: { numero: '555' } })).toBe(1);
  });

  it('sexo y estado inválidos, BAJA y macho no recién nacido dan 400 (RF-5)', async () => {
    const { agente } = await registrarTambo();
    const casos = [
      { numero: '1', sexo: 'X', estado: 'SECA' },
      { numero: '1', sexo: 'HEMBRA', estado: 'XYZ' },
      { numero: '1', sexo: 'HEMBRA', estado: 'BAJA' },
      { numero: '1', sexo: 'MACHO', estado: 'EN_ORDENE' },
      { numero: '1', sexo: 'MACHO' },
    ];
    for (const caso of casos) {
      const res = await agente.post('/api/animales').send(caso).expect(400);
      expect(typeof res.body.error).toBe('string');
    }
    expect(await prisma.animal.count()).toBe(0);
    await agente.post('/api/animales').send({ numero: '1', sexo: 'MACHO', estado: 'RECIEN_NACIDO' }).expect(201);
  });

  it('valida la fecha: futura, anterior a 2000, inexistente y mal formada dan 400 (RF-6)', async () => {
    const { agente } = await registrarTambo();
    for (const fechaNacimiento of ['2999-01-01', '1999-12-31', '2021-02-31', '5/3/2021', 'hola', 20210305]) {
      const res = await agente
        .post('/api/animales')
        .send({ numero: '1', sexo: 'HEMBRA', estado: 'SECA', fechaNacimiento })
        .expect(400);
      expect(res.body.detalles[0].campo).toBe('fechaNacimiento');
    }
    const ok = await agente
      .post('/api/animales')
      .send({ numero: '1', sexo: 'HEMBRA', estado: 'SECA', fechaNacimiento: '2000-01-01' })
      .expect(201);
    expect(ok.body.animal.fechaNacimiento).toBe('2000-01-01');
  });

  it('la cría tiene que haber nacido después de la madre; sin fecha de madre no se compara (RF-6)', async () => {
    const { agente, perfil } = await registrarTambo();
    await crearAnimalDirecto(perfil.establecimiento.id, 'M1', { fechaNacimiento: '2020-05-10' });
    await crearAnimalDirecto(perfil.establecimiento.id, 'M2'); // sin fecha
    const base = { sexo: 'HEMBRA', estado: 'RECIEN_NACIDO' };
    for (const fechaNacimiento of ['2020-05-10', '2020-05-09']) {
      await agente.post('/api/animales').send({ ...base, numero: 'C1', madre: 'M1', fechaNacimiento }).expect(400);
    }
    await agente.post('/api/animales').send({ ...base, numero: 'C1', madre: 'M1', fechaNacimiento: '2020-05-11' }).expect(201);
    await agente.post('/api/animales').send({ ...base, numero: 'C2', madre: 'M2', fechaNacimiento: '2001-01-01' }).expect(201);
  });

  it('madre inexistente, de otro tambo, de baja, macho y el propio número dan el mismo mensaje (RF-7)', async () => {
    const { a, b } = await dosTambos();
    const tambo = a.perfil.establecimiento.id;
    await crearAnimalDirecto(b.perfil.establecimiento.id, 'AJENA');
    await crearAnimalDirecto(tambo, 'BAJA1', { estado: 'BAJA' });
    await crearAnimalDirecto(tambo, 'TORO', { sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
    for (const madre of ['NOEXISTE', 'AJENA', 'BAJA1', 'TORO', 'PROPIA', 'con espacio']) {
      const res = await a.agente
        .post('/api/animales')
        .send({ numero: 'PROPIA', sexo: 'HEMBRA', estado: 'RECIEN_NACIDO', madre })
        .expect(400);
      expect(res.body.detalles[0].campo).toBe('madre');
      expect(res.body.detalles[0].mensaje).toMatch(/^No hay una hembra activa con el número /);
    }
    expect(await prisma.animal.count({ where: { numero: 'PROPIA' } })).toBe(0);
  });

  it('con una madre válida se vincula (RF-7)', async () => {
    const { agente, perfil } = await registrarTambo();
    const madre = await crearAnimalDirecto(perfil.establecimiento.id, 'M1');
    const res = await agente
      .post('/api/animales')
      .send({ numero: 'C1', sexo: 'MACHO', estado: 'RECIEN_NACIDO', madre: ' m1 ' })
      .expect(201);
    const guardado = await prisma.animal.findUniqueOrThrow({ where: { id: res.body.animal.id } });
    expect(guardado.madreId).toBe(madre.id);
  });

  it('sin lote destino para el estado: 201, sin lote y con aviso (RF-8)', async () => {
    const { agente, perfil } = await registrarTambo();
    await prisma.reglaLote.deleteMany({ where: { establecimientoId: perfil.establecimiento.id, estado: 'EN_ORDENE' } });
    const res = await agente.post('/api/animales').send({ numero: '9', sexo: 'HEMBRA', estado: 'EN_ORDENE' }).expect(201);
    expect(res.body.avisoSinLote).toEqual({ estado: 'EN_ORDENE' });
    expect(res.body.animal.lote).toBeNull();
    const guardado = await prisma.animal.findUniqueOrThrow({ where: { id: res.body.animal.id } });
    expect(guardado.loteId).toBeNull();
  });

  it('si el lote destino se eliminó justo antes del insert: 409 y no se guarda nada (RF-9)', async () => {
    const { agente } = await registrarTambo();
    // Se simula la carrera: la regla leída apunta a un lote que ya no existe.
    const espia = vi.spyOn(prisma.reglaLote, 'findFirst').mockResolvedValueOnce({ loteId: ID_INEXISTENTE } as never);
    try {
      const res = await agente.post('/api/animales').send({ numero: '9', sexo: 'HEMBRA', estado: 'SECA' }).expect(409);
      expect(res.body.error).toBe('El lote destino ya no existe, volvé a intentar');
    } finally {
      espia.mockRestore();
    }
    expect(await prisma.animal.count()).toBe(0);
  });

  it('ignora el establecimientoId enviado por el cliente (RF-37)', async () => {
    const { a, b } = await dosTambos();
    const res = await a.agente
      .post('/api/animales')
      .send({ numero: '1', sexo: 'HEMBRA', estado: 'SECA', establecimientoId: b.perfil.establecimiento.id })
      .expect(201);
    const guardado = await prisma.animal.findUniqueOrThrow({ where: { id: res.body.animal.id } });
    expect(guardado.establecimientoId).toBe(a.perfil.establecimiento.id);
  });

  it('el veterinario recibe 403, también con datos inválidos (RF-40)', async () => {
    const { agente } = await registrarTambo();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    await vet.post('/api/animales').send({ numero: '1', sexo: 'HEMBRA', estado: 'SECA' }).expect(403);
    await vet.post('/api/animales').send({ numero: 'ñ ñ', sexo: 'X' }).expect(403);
    await vet.post('/api/animales').expect(403);
    expect(await prisma.animal.count()).toBe(0);
  });
});

describe('GET /api/animales: listado (RF-23 a RF-26)', () => {
  it('sin sesión responde 401', async () => {
    await request(app).get('/api/animales').expect(401);
  });

  it('lista solo activos del tambo, en orden natural, con lote o sin lote (RF-23)', async () => {
    const { a, b } = await dosTambos();
    const tambo = a.perfil.establecimiento.id;
    const secas = await loteDe(tambo, 'Secas');
    for (const n of ['A10', '10', 'A2', '9']) await crearAnimalDirecto(tambo, n, { loteId: n === '9' ? secas.id : null });
    await crearAnimalDirecto(tambo, 'BAJA1', { estado: 'BAJA' });
    await crearAnimalDirecto(b.perfil.establecimiento.id, 'AJENO');

    const res = await a.agente.get('/api/animales').expect(200);
    expect(res.body.animales.map((x: { numero: string }) => x.numero)).toEqual(['9', '10', 'A2', 'A10']);
    expect(res.body).toMatchObject({ total: 4, mostrados: 4, truncado: false });
    expect(res.body.animales[0]).toMatchObject({ numero: '9', sexo: 'HEMBRA', estado: 'EN_ORDENE', lote: { nombre: 'Secas' } });
    expect(res.body.animales[1].lote).toBeNull();
  });

  it('filtra por estado, por lote, por "sin-lote" y combinados con AND (RF-24)', async () => {
    const { agente, perfil } = await registrarTambo();
    const tambo = perfil.establecimiento.id;
    const secas = await loteDe(tambo, 'Secas');
    await crearAnimalDirecto(tambo, '1', { estado: 'SECA', loteId: secas.id });
    await crearAnimalDirecto(tambo, '2', { estado: 'EN_ORDENE', loteId: secas.id });
    await crearAnimalDirecto(tambo, '3', { estado: 'SECA' });
    const numeros = (r: request.Response) => r.body.animales.map((x: { numero: string }) => x.numero);

    expect(numeros(await agente.get('/api/animales?estado=SECA').expect(200))).toEqual(['1', '3']);
    expect(numeros(await agente.get(`/api/animales?loteId=${secas.id}`).expect(200))).toEqual(['1', '2']);
    expect(numeros(await agente.get('/api/animales?loteId=sin-lote').expect(200))).toEqual(['3']);
    const combinado = await agente.get(`/api/animales?estado=SECA&loteId=${secas.id}`).expect(200);
    expect(numeros(combinado)).toEqual(['1']);
    expect(combinado.body.total).toBe(1);
  });

  it('lote ajeno, inexistente o mal formado dan el mismo 404 (RF-25)', async () => {
    const { a, b } = await dosTambos();
    const ajeno = await loteDe(b.perfil.establecimiento.id, 'Secas');
    const respuestas = [];
    for (const loteId of [ajeno.id, ID_INEXISTENTE, 'no-es-uuid']) {
      respuestas.push(await a.agente.get(`/api/animales?loteId=${loteId}`).expect(404));
    }
    expect(new Set(respuestas.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(respuestas[0].body.error).toBe('Lote no encontrado');
  });

  it('estado inválido (incluido BAJA) da 400 en español (RF-25)', async () => {
    const { agente } = await registrarTambo();
    for (const estado of ['XYZ', 'BAJA', '']) {
      const res = await agente.get(`/api/animales?estado=${estado}`).expect(400);
      expect(typeof res.body.error).toBe('string');
    }
  });

  it('con más de 2.000 devuelve 2.000, truncado y el total real (RF-26)', async () => {
    const { agente, perfil } = await registrarTambo();
    await prisma.animal.createMany({
      data: Array.from({ length: 2001 }, (_, i) => ({
        establecimientoId: perfil.establecimiento.id,
        numero: String(i + 1),
        sexo: 'HEMBRA' as const,
        estado: 'EN_ORDENE' as const,
      })),
    });
    const res = await agente.get('/api/animales').expect(200);
    expect(res.body).toMatchObject({ total: 2001, mostrados: 2000, truncado: true });
    expect(res.body.animales).toHaveLength(2000);
    expect(res.body.animales[1999].numero).toBe('2000'); // el orden natural se aplica antes del recorte
  });

  it('el veterinario puede listar (RF-40)', async () => {
    const { agente } = await registrarTambo();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    await vet.get('/api/animales').expect(200);
  });
});

describe('GET /api/animales/:id: ficha (RF-28 a RF-30, RF-38)', () => {
  it('sin sesión responde 401', async () => {
    await request(app).get(`/api/animales/${ID_INEXISTENTE}`).expect(401);
  });

  it('devuelve lote, madre y crías activas; lo que falta queda en null (RF-28)', async () => {
    const { agente, perfil } = await registrarTambo();
    const tambo = perfil.establecimiento.id;
    const secas = await loteDe(tambo, 'Secas');
    const madre = await crearAnimalDirecto(tambo, 'M1', { loteId: secas.id, fechaNacimiento: '2020-01-02' });
    const cria2 = await crearAnimalDirecto(tambo, 'C2', { madreId: madre.id, estado: 'RECIEN_NACIDO' });
    const cria10 = await crearAnimalDirecto(tambo, 'C10', { madreId: madre.id, estado: 'RECIEN_NACIDO' });
    await crearAnimalDirecto(tambo, 'CBAJA', { madreId: madre.id, estado: 'BAJA' }); // no es cría activa

    const ficha = await agente.get(`/api/animales/${madre.id}`).expect(200);
    expect(ficha.body).toEqual({
      id: madre.id,
      numero: 'M1',
      sexo: 'HEMBRA',
      estado: 'EN_ORDENE',
      fechaNacimiento: '2020-01-02',
      lote: { nombre: 'Secas' },
      madre: null,
      crias: [
        { id: cria2.id, numero: 'C2' },
        { id: cria10.id, numero: 'C10' },
      ],
    });

    const fichaCria = await agente.get(`/api/animales/${cria2.id}`).expect(200);
    expect(fichaCria.body).toMatchObject({
      fechaNacimiento: null,
      lote: null,
      madre: { id: madre.id, numero: 'M1', activa: true },
      crias: [],
    });
  });

  it('la madre dada de baja figura con activa: false (RF-28)', async () => {
    const { agente, perfil } = await registrarTambo();
    const madre = await crearAnimalDirecto(perfil.establecimiento.id, 'M1', { estado: 'BAJA' });
    const cria = await crearAnimalDirecto(perfil.establecimiento.id, 'C1', { madreId: madre.id });
    const ficha = await agente.get(`/api/animales/${cria.id}`).expect(200);
    expect(ficha.body.madre).toEqual({ id: madre.id, numero: 'M1', activa: false });
  });

  it('baja del propio tambo, otro tambo, inexistente y mal formado dan el mismo 404 (RF-30, RF-38)', async () => {
    const { a, b } = await dosTambos();
    const baja = await crearAnimalDirecto(a.perfil.establecimiento.id, '1', { estado: 'BAJA' });
    const ajeno = await crearAnimalDirecto(b.perfil.establecimiento.id, '2');
    const respuestas = [];
    for (const id of [baja.id, ajeno.id, ID_INEXISTENTE, 'xyz']) {
      respuestas.push(await a.agente.get(`/api/animales/${id}`).expect(404));
    }
    expect(new Set(respuestas.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(respuestas[0].body.error).toBe('Animal no encontrado');
  });

  it('el veterinario puede ver fichas (RF-40)', async () => {
    const { agente, perfil } = await registrarTambo();
    const animal = await crearAnimalDirecto(perfil.establecimiento.id, '1');
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    await vet.get(`/api/animales/${animal.id}`).expect(200);
  });
});

describe('GET /api/animales/buscar (RF-33 a RF-36)', () => {
  it('sin sesión responde 401', async () => {
    await request(app).get('/api/animales/buscar?numero=1').expect(401);
  });

  it('encuentra el animal activo y devuelve su id (RF-33)', async () => {
    const { agente, perfil } = await registrarTambo();
    const animal = await crearAnimalDirecto(perfil.establecimiento.id, 'AB-1');
    const res = await agente.get('/api/animales/buscar?numero=AB-1').expect(200);
    expect(res.body).toEqual({ id: animal.id, numero: 'AB-1' });
  });

  it('normaliza (extremos y mayúsculas) y busca el número completo (RF-34)', async () => {
    const { agente, perfil } = await registrarTambo();
    const animal = await crearAnimalDirecto(perfil.establecimiento.id, 'AB-1');
    await crearAnimalDirecto(perfil.establecimiento.id, '123');
    const res = await agente.get('/api/animales/buscar?numero=%20ab-1%0A').expect(200);
    expect(res.body.id).toBe(animal.id);
    await agente.get('/api/animales/buscar?numero=12').expect(404); // "12" no es "123"
  });

  it('inexistente, de otro tambo, de baja y con caracteres no permitidos dan la misma respuesta 404 (RF-35)', async () => {
    const { a, b } = await dosTambos();
    await crearAnimalDirecto(a.perfil.establecimiento.id, 'BAJA1', { estado: 'BAJA' });
    await crearAnimalDirecto(b.perfil.establecimiento.id, 'AJENO');
    const respuestas = [];
    for (const numero of ['NOEXISTE', 'AJENO', 'BAJA1', 'ñandú', '12 3', 'A'.repeat(21)]) {
      respuestas.push(await a.agente.get(`/api/animales/buscar?numero=${encodeURIComponent(numero)}`).expect(404));
    }
    expect(new Set(respuestas.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(respuestas[0].body.error).toBe('No hay un animal activo con ese número');
  });

  it('número ausente o vacío al normalizar da 400 (RF-36)', async () => {
    const { agente } = await registrarTambo();
    await agente.get('/api/animales/buscar').expect(400);
    await agente.get('/api/animales/buscar?numero=').expect(400);
    await agente.get('/api/animales/buscar?numero=%20%0A').expect(400);
    await agente.get('/api/animales/buscar?numero=a&numero=b').expect(400);
  });

  it('el veterinario puede buscar (RF-40)', async () => {
    const { agente, perfil } = await registrarTambo();
    await crearAnimalDirecto(perfil.establecimiento.id, '1');
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    await vet.get('/api/animales/buscar?numero=1').expect(200);
  });
});

describe('aislamiento entre dos tambos (RF-37)', () => {
  it('cada tambo lista, busca y abre solo lo suyo', async () => {
    const { a, b } = await dosTambos();
    const deA = await crearAnimalDirecto(a.perfil.establecimiento.id, '1');
    const deB = await crearAnimalDirecto(b.perfil.establecimiento.id, '1'); // mismo número, otro tambo

    const listaA = await a.agente.get('/api/animales').expect(200);
    expect(listaA.body.animales.map((x: { id: string }) => x.id)).toEqual([deA.id]);
    expect((await a.agente.get('/api/animales/buscar?numero=1').expect(200)).body.id).toBe(deA.id);
    expect((await b.agente.get('/api/animales/buscar?numero=1').expect(200)).body.id).toBe(deB.id);
    await a.agente.get(`/api/animales/${deB.id}`).expect(404);
    await b.agente.get(`/api/animales/${deA.id}`).expect(404);
  });
});
