import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { app, crearUsuario, limpiarBase, registrarTambo } from './ayudas.js';

// Tests de la API de lotes: listar, ver y crear (T5).
// Recordatorio: todo tambo registrado con registrarTambo() ya trae los 4 lotes
// iniciales (Terneros, Vaquillonas, En ordeñe, Secas) con sus destinos (RF-18).

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

type LoteRespuesta = {
  id: string;
  nombre: string;
  descripcion: string | null;
  cantidadAnimales: number;
  destinoDe: string[];
};

// Busca un lote por nombre en la lista que devuelve GET /api/lotes.
async function loteDeLista(agente: ReturnType<typeof request.agent>, nombre: string) {
  const res = await agente.get('/api/lotes').expect(200);
  const lote = (res.body as LoteRespuesta[]).find((l) => l.nombre === nombre);
  if (!lote) throw new Error(`No está el lote ${nombre}`);
  return lote;
}

// Todavía no hay API de animales: se crean directo con Prisma.
// La base exige que un animal en BAJA tenga fechaBaja (y que solo él la tenga).
function crearAnimal(
  establecimientoId: string,
  loteId: string,
  numero: string,
  estado: 'EN_ORDENE' | 'BAJA' = 'EN_ORDENE',
) {
  return prisma.animal.create({
    data: {
      establecimientoId,
      loteId,
      numero,
      sexo: 'HEMBRA',
      estado,
      fechaBaja: estado === 'BAJA' ? new Date('2026-11-01') : null,
    },
  });
}

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';

describe('GET /api/lotes (RF-1)', () => {
  it('sin sesión responde 401', async () => {
    await request(app).get('/api/lotes').expect(401);
  });

  it('ordena por nombre sin distinguir mayúsculas', async () => {
    const { agente } = await registrarTambo();
    // En orden ASCII "alfalfa" (minúscula) iría al final; sin distinguir mayúsculas va primero.
    await agente.post('/api/lotes').send({ nombre: 'alfalfa' }).expect(201);

    const res = await agente.get('/api/lotes').expect(200);
    expect((res.body as LoteRespuesta[]).map((l) => l.nombre)).toEqual([
      'alfalfa',
      'En ordeñe',
      'Secas',
      'Terneros',
      'Vaquillonas',
    ]);
  });

  it('devuelve id, nombre, descripción, cantidad de animales activos (sin contar BAJA) y destinoDe', async () => {
    const { agente, perfil } = await registrarTambo();
    const tamboId = perfil.establecimiento.id;
    const enOrdene = await loteDeLista(agente, 'En ordeñe');

    await crearAnimal(tamboId, enOrdene.id, '101');
    await crearAnimal(tamboId, enOrdene.id, '102');
    await crearAnimal(tamboId, enOrdene.id, '103', 'BAJA'); // no cuenta

    const res = await agente.get('/api/lotes').expect(200);
    const lote = (res.body as LoteRespuesta[]).find((l) => l.id === enOrdene.id);
    expect(lote).toEqual({
      id: enOrdene.id,
      nombre: 'En ordeñe',
      descripcion: null,
      cantidadAnimales: 2,
      destinoDe: ['EN_ORDENE'],
    });
  });

  it('un lote destino de dos estados los lista en el orden de los estados; uno nuevo no es destino de nada', async () => {
    const { agente, perfil } = await registrarTambo();
    const secas = await loteDeLista(agente, 'Secas');
    // Hasta que exista la API de destinos (T7), se cambia la regla directo en la base.
    await prisma.reglaLote.update({
      where: { establecimientoId_estado: { establecimientoId: perfil.establecimiento.id, estado: 'VAQUILLONA' } },
      data: { loteId: secas.id },
    });
    await agente.post('/api/lotes').send({ nombre: 'Lote norte' }).expect(201);

    expect((await loteDeLista(agente, 'Secas')).destinoDe).toEqual(['VAQUILLONA', 'SECA']);
    expect((await loteDeLista(agente, 'Vaquillonas')).destinoDe).toEqual([]);
    expect((await loteDeLista(agente, 'Lote norte')).destinoDe).toEqual([]);
  });

  it('aislamiento: cada tambo ve solo sus lotes (RF-20)', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    const b = await registrarTambo('Tambo B', 'dueno-b@prueba.test');
    await a.agente.post('/api/lotes').send({ nombre: 'Solo de A' }).expect(201);

    const res = await b.agente.get('/api/lotes').expect(200);
    const lotesB = res.body as LoteRespuesta[];
    expect(lotesB.map((l) => l.nombre)).not.toContain('Solo de A');
    expect(lotesB).toHaveLength(4);

    // Ninguno de los ids que ve B es de A.
    const idsA = (await prisma.lote.findMany({ where: { establecimientoId: a.perfil.establecimiento.id } })).map(
      (l) => l.id,
    );
    for (const lote of lotesB) expect(idsA).not.toContain(lote.id);
  });

  it('el veterinario puede listar (RF-21)', async () => {
    const { agente } = await registrarTambo();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const res = await vet.get('/api/lotes').expect(200);
    expect(res.body).toHaveLength(4);
  });
});

describe('GET /api/lotes/:id (RF-20)', () => {
  it('devuelve el lote con los mismos campos que la lista', async () => {
    const { agente } = await registrarTambo();
    const terneros = await loteDeLista(agente, 'Terneros');
    const res = await agente.get(`/api/lotes/${terneros.id}`).expect(200);
    expect(res.body).toEqual(terneros);
  });

  it('el veterinario puede ver un lote', async () => {
    const { agente } = await registrarTambo();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const secas = await loteDeLista(agente, 'Secas');
    await vet.get(`/api/lotes/${secas.id}`).expect(200);
  });

  it('id mal formado responde 404 "Lote no encontrado"', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.get('/api/lotes/no-es-un-uuid').expect(404);
    expect(res.body.error).toBe('Lote no encontrado');
  });

  it('id inexistente responde 404 "Lote no encontrado"', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.get(`/api/lotes/${ID_INEXISTENTE}`).expect(404);
    expect(res.body.error).toBe('Lote no encontrado');
  });

  it('aislamiento: un lote de otro tambo responde 404 "Lote no encontrado"', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    const b = await registrarTambo('Tambo B', 'dueno-b@prueba.test');
    const secasDeA = await loteDeLista(a.agente, 'Secas');

    const res = await b.agente.get(`/api/lotes/${secasDeA.id}`).expect(404);
    expect(res.body.error).toBe('Lote no encontrado');
  });
});

describe('POST /api/lotes (RF-2, RF-4 a RF-6, RF-27)', () => {
  it('el dueño crea un lote con descripción', async () => {
    const { agente, perfil } = await registrarTambo();
    const res = await agente
      .post('/api/lotes')
      .send({ nombre: 'Lote norte', descripcion: '  Vacas de alta producción  ' })
      .expect(201);

    expect(res.body).toEqual({
      id: expect.any(String),
      nombre: 'Lote norte',
      descripcion: 'Vacas de alta producción', // sin espacios en los extremos
      cantidadAnimales: 0,
      destinoDe: [],
    });
    const guardado = await prisma.lote.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(guardado.establecimientoId).toBe(perfil.establecimiento.id);
  });

  it('el encargado crea un lote sin descripción (queda null)', async () => {
    const { agente } = await registrarTambo();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const res = await encargado.post('/api/lotes').send({ nombre: 'Recría' }).expect(201);
    expect(res.body.descripcion).toBeNull();
  });

  it('una descripción de solo espacios queda null', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/lotes').send({ nombre: 'Recría', descripcion: '   \t ' }).expect(201);
    expect(res.body.descripcion).toBeNull();
  });

  it('una descripción de 201 caracteres da 400 con el mensaje en el campo descripcion', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/lotes').send({ nombre: 'Recría', descripcion: 'a'.repeat(201) }).expect(400);
    expect(res.body.detalles).toEqual([
      { campo: 'descripcion', mensaje: 'La descripción no puede superar los 200 caracteres' },
    ]);
  });

  it('guarda el nombre normalizado: " Lote   norte " pasa a "Lote norte" (RF-4)', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/lotes').send({ nombre: ' Lote \t  norte ' }).expect(201);
    expect(res.body.nombre).toBe('Lote norte');
  });

  it('nombre vacío da 400 con el mensaje en el campo nombre (RF-5)', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/lotes').send({ nombre: '   ' }).expect(400);
    expect(res.body.detalles).toEqual([{ campo: 'nombre', mensaje: 'El nombre del lote es obligatorio' }]);
  });

  it('nombre de 51 caracteres da 400 (RF-5)', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/lotes').send({ nombre: 'ñ'.repeat(51) }).expect(400);
    expect(res.body.detalles[0].campo).toBe('nombre');
  });

  it('"secas" con "Secas" existente da 409 "Ya existe un lote con ese nombre" (RF-6)', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/lotes').send({ nombre: 'secas' }).expect(409);
    expect(res.body.error).toBe('Ya existe un lote con ese nombre');
  });

  it('" en  ORDEÑE " choca con "En ordeñe" después de normalizar (RF-4, RF-6)', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/lotes').send({ nombre: ' en  ORDEÑE ' }).expect(409);
    expect(res.body.error).toBe('Ya existe un lote con ese nombre');
  });

  it('dos tambos pueden tener lotes con el mismo nombre', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    const b = await registrarTambo('Tambo B', 'dueno-b@prueba.test');
    await a.agente.post('/api/lotes').send({ nombre: 'Lote norte' }).expect(201);
    await b.agente.post('/api/lotes').send({ nombre: 'lote NORTE' }).expect(201);
  });

  it('aislamiento: un establecimientoId enviado por el cliente se ignora (RF-20)', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    const b = await registrarTambo('Tambo B', 'dueno-b@prueba.test');

    const res = await b.agente
      .post('/api/lotes')
      .send({ nombre: 'Intruso', establecimientoId: a.perfil.establecimiento.id })
      .expect(201);

    const guardado = await prisma.lote.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(guardado.establecimientoId).toBe(b.perfil.establecimiento.id);
    const nombresA = (await a.agente.get('/api/lotes').expect(200)).body.map((l: LoteRespuesta) => l.nombre);
    expect(nombresA).not.toContain('Intruso');
  });

  it('el veterinario recibe 403 "No tenés permiso para hacer esto", aun con datos inválidos (RF-22)', async () => {
    const { agente } = await registrarTambo();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');

    const valido = await vet.post('/api/lotes').send({ nombre: 'Lote del vet' }).expect(403);
    expect(valido.body.error).toBe('No tenés permiso para hacer esto');
    // El rol se controla antes que el cuerpo: con nombre vacío también es 403, no 400.
    await vet.post('/api/lotes').send({ nombre: '' }).expect(403);

    expect(await prisma.lote.count({ where: { nombre: 'Lote del vet' } })).toBe(0);
  });

  it('sin sesión responde 401', async () => {
    await request(app).post('/api/lotes').send({ nombre: 'X' }).expect(401);
  });
});
