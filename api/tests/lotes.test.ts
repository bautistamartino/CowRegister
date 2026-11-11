import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { app, crearUsuario, limpiarBase, registrarTambo } from './ayudas.js';

// Tests de la API de lotes: listar, ver y crear (T5); editar y eliminar (T6).
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

// ---------------------------------------------------------------------------
// T6: editar y eliminar
// ---------------------------------------------------------------------------

describe('PATCH /api/lotes/:id (RF-3 a RF-6, RF-27, RF-32)', () => {
  it('renombra y cambia la descripción sin tocar sus animales ni sus destinos (RF-3)', async () => {
    const { agente, perfil } = await registrarTambo();
    const enOrdene = await loteDeLista(agente, 'En ordeñe');
    await crearAnimal(perfil.establecimiento.id, enOrdene.id, '101');

    const res = await agente
      .patch(`/api/lotes/${enOrdene.id}`)
      .send({ nombre: '  Ordeñe   norte ', descripcion: ' Vacas en producción ' })
      .expect(200);

    expect(res.body).toEqual({
      id: enOrdene.id,
      nombre: 'Ordeñe norte', // normalizado (RF-4)
      descripcion: 'Vacas en producción',
      cantidadAnimales: 1,
      destinoDe: ['EN_ORDENE'],
    });
  });

  it('cambia solo la descripción y deja el nombre', async () => {
    const { agente } = await registrarTambo();
    const secas = await loteDeLista(agente, 'Secas');
    const res = await agente.patch(`/api/lotes/${secas.id}`).send({ descripcion: 'Potrero 3' }).expect(200);
    expect(res.body.nombre).toBe('Secas');
    expect(res.body.descripcion).toBe('Potrero 3');
  });

  it('borra la descripción con null y también con un texto vacío (RF-27)', async () => {
    const { agente } = await registrarTambo();
    const creado = await agente.post('/api/lotes').send({ nombre: 'Recría', descripcion: 'Algo' }).expect(201);

    const conNull = await agente.patch(`/api/lotes/${creado.body.id}`).send({ descripcion: null }).expect(200);
    expect(conNull.body.descripcion).toBeNull();

    await agente.patch(`/api/lotes/${creado.body.id}`).send({ descripcion: 'Otra' }).expect(200);
    const conVacia = await agente.patch(`/api/lotes/${creado.body.id}`).send({ descripcion: '   ' }).expect(200);
    expect(conVacia.body.descripcion).toBeNull();
  });

  it('una descripción de 201 caracteres da 400', async () => {
    const { agente } = await registrarTambo();
    const secas = await loteDeLista(agente, 'Secas');
    const res = await agente.patch(`/api/lotes/${secas.id}`).send({ descripcion: 'a'.repeat(201) }).expect(400);
    expect(res.body.detalles[0].campo).toBe('descripcion');
  });

  it('nombre vacío da 400 (RF-5)', async () => {
    const { agente } = await registrarTambo();
    const secas = await loteDeLista(agente, 'Secas');
    const res = await agente.patch(`/api/lotes/${secas.id}`).send({ nombre: '  ' }).expect(400);
    expect(res.body.detalles).toEqual([{ campo: 'nombre', mensaje: 'El nombre del lote es obligatorio' }]);
  });

  it('sin nombre ni descripción da 400', async () => {
    const { agente } = await registrarTambo();
    const secas = await loteDeLista(agente, 'Secas');
    await agente.patch(`/api/lotes/${secas.id}`).send({}).expect(400);
  });

  it('renombrar al nombre de otro lote (sin distinguir mayúsculas) da 409 (RF-6)', async () => {
    const { agente } = await registrarTambo();
    const secas = await loteDeLista(agente, 'Secas');
    const res = await agente.patch(`/api/lotes/${secas.id}`).send({ nombre: 'TERNEROS' }).expect(409);
    expect(res.body.error).toBe('Ya existe un lote con ese nombre');
    expect((await prisma.lote.findUniqueOrThrow({ where: { id: secas.id } })).nombre).toBe('Secas');
  });

  it('renombrar a sí mismo o cambiar solo las mayúsculas da 200 (RF-6)', async () => {
    const { agente } = await registrarTambo();
    const secas = await loteDeLista(agente, 'Secas');
    await agente.patch(`/api/lotes/${secas.id}`).send({ nombre: 'Secas' }).expect(200);
    const res = await agente.patch(`/api/lotes/${secas.id}`).send({ nombre: 'SECAS' }).expect(200);
    expect(res.body.nombre).toBe('SECAS');
  });

  it('id mal formado o inexistente da 404', async () => {
    const { agente } = await registrarTambo();
    await agente.patch('/api/lotes/no-es-un-uuid').send({ nombre: 'X' }).expect(404);
    const res = await agente.patch(`/api/lotes/${ID_INEXISTENTE}`).send({ nombre: 'X' }).expect(404);
    expect(res.body.error).toBe('Lote no encontrado');
  });

  it('un lote ya eliminado da 404 (RF-32)', async () => {
    const { agente } = await registrarTambo();
    const creado = await agente.post('/api/lotes').send({ nombre: 'Recría' }).expect(201);
    await agente.delete(`/api/lotes/${creado.body.id}`).expect(204);

    const res = await agente.patch(`/api/lotes/${creado.body.id}`).send({ nombre: 'Recría 2' }).expect(404);
    expect(res.body.error).toBe('Lote no encontrado');
  });

  it('aislamiento: B no puede editar un lote de A, que queda intacto (RF-20)', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    const b = await registrarTambo('Tambo B', 'dueno-b@prueba.test');
    const secasDeA = await loteDeLista(a.agente, 'Secas');

    const res = await b.agente
      .patch(`/api/lotes/${secasDeA.id}`)
      .send({ nombre: 'Robado', descripcion: 'x' })
      .expect(404);
    expect(res.body.error).toBe('Lote no encontrado');

    const guardado = await prisma.lote.findUniqueOrThrow({ where: { id: secasDeA.id } });
    expect(guardado.nombre).toBe('Secas');
    expect(guardado.descripcion).toBeNull();
  });

  it('el encargado puede editar', async () => {
    const { agente } = await registrarTambo();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const secas = await loteDeLista(agente, 'Secas');
    await encargado.patch(`/api/lotes/${secas.id}`).send({ nombre: 'Secas norte' }).expect(200);
  });

  it('el veterinario recibe 403, también con id de otro tambo, mal formado o datos inválidos (RF-22)', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    const b = await registrarTambo('Tambo B', 'dueno-b@prueba.test');
    const vet = await crearUsuario(b.agente, 'VETERINARIO', 'vet@prueba.test');
    const secasDeB = await loteDeLista(b.agente, 'Secas');
    const secasDeA = await loteDeLista(a.agente, 'Secas');

    const res = await vet.patch(`/api/lotes/${secasDeB.id}`).send({ nombre: 'Del vet' }).expect(403);
    expect(res.body.error).toBe('No tenés permiso para hacer esto');
    await vet.patch(`/api/lotes/${secasDeA.id}`).send({ nombre: 'Del vet' }).expect(403);
    await vet.patch('/api/lotes/no-es-un-uuid').send({ nombre: 'Del vet' }).expect(403);
    await vet.patch(`/api/lotes/${secasDeB.id}`).send({ nombre: '' }).expect(403);

    expect((await prisma.lote.findUniqueOrThrow({ where: { id: secasDeB.id } })).nombre).toBe('Secas');
  });

  it('sin sesión responde 401', async () => {
    await request(app).patch(`/api/lotes/${ID_INEXISTENTE}`).send({ nombre: 'X' }).expect(401);
  });
});

describe('DELETE /api/lotes/:id (RF-7 a RF-9, RF-31, RF-32)', () => {
  it('elimina un lote sin animales ni destinos (204) (RF-7)', async () => {
    const { agente } = await registrarTambo();
    const creado = await agente.post('/api/lotes').send({ nombre: 'Recría' }).expect(201);

    await agente.delete(`/api/lotes/${creado.body.id}`).expect(204);
    expect(await prisma.lote.findUnique({ where: { id: creado.body.id } })).toBeNull();
  });

  it('elimina un lote que solo tiene animales dados de baja; esos animales quedan sin lote (RF-7)', async () => {
    const { agente, perfil } = await registrarTambo();
    const creado = await agente.post('/api/lotes').send({ nombre: 'Recría' }).expect(201);
    const animal = await crearAnimal(perfil.establecimiento.id, creado.body.id, '900', 'BAJA');

    await agente.delete(`/api/lotes/${creado.body.id}`).expect(204);
    // El historial no se pierde: el animal sigue, solo sin lote (la API lo desasigna antes de borrar el lote).
    const guardado = await prisma.animal.findUniqueOrThrow({ where: { id: animal.id } });
    expect(guardado.loteId).toBeNull();
  });

  it('con animales activos y dados de baja a la vez, no borra nada y da 409 (RF-7, RF-8)', async () => {
    const { agente, perfil } = await registrarTambo();
    const creado = await agente.post('/api/lotes').send({ nombre: 'Recría' }).expect(201);
    const baja = await crearAnimal(perfil.establecimiento.id, creado.body.id, '900', 'BAJA');
    await crearAnimal(perfil.establecimiento.id, creado.body.id, '1');

    await agente.delete(`/api/lotes/${creado.body.id}`).expect(409);
    // La baja conserva su lote: no se desasignó nada porque el DELETE se frenó antes.
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: baja.id } })).loteId).toBe(creado.body.id);
  });

  it('alta y DELETE simultáneos del mismo lote: nunca queda un animal con lote inexistente (RF-10)', async () => {
    const { agente, perfil } = await registrarTambo();
    const tamboId = perfil.establecimiento.id;

    for (let i = 0; i < 8; i++) {
      const creado = await agente.post('/api/lotes').send({ nombre: `Carrera ${i}` }).expect(201);
      const loteId: string = creado.body.id;
      const numero = `C${i}`;

      // Los dos pedidos salen a la vez: gana uno y la base garantiza el resultado.
      const [alta, borrado] = await Promise.allSettled([
        crearAnimal(tamboId, loteId, numero),
        agente.delete(`/api/lotes/${loteId}`),
      ]);

      const lote = await prisma.lote.findUnique({ where: { id: loteId } });
      const animal = await prisma.animal.findFirst({ where: { establecimientoId: tamboId, numero } });
      if (lote) {
        // El lote sigue: el animal ganó y el DELETE tiene que haber dado 409.
        expect(animal?.loteId).toBe(loteId);
        expect(borrado.status === 'fulfilled' && borrado.value.status).toBe(409);
      } else {
        // El lote se eliminó: el alta tiene que haber fallado y no quedó el animal.
        expect(alta.status).toBe('rejected');
        expect(animal).toBeNull();
      }
    }
  });

  it('con 3 animales activos da 409 "El lote tiene 3 animales" (RF-8)', async () => {
    const { agente, perfil } = await registrarTambo();
    const creado = await agente.post('/api/lotes').send({ nombre: 'Recría' }).expect(201);
    for (const numero of ['1', '2', '3']) await crearAnimal(perfil.establecimiento.id, creado.body.id, numero);
    await crearAnimal(perfil.establecimiento.id, creado.body.id, '4', 'BAJA'); // no cuenta

    const res = await agente.delete(`/api/lotes/${creado.body.id}`).expect(409);
    expect(res.body.error).toBe('El lote tiene 3 animales');
    expect(await prisma.lote.findUnique({ where: { id: creado.body.id } })).not.toBeNull();
  });

  it('con 1 animal activo dice "1 animal" en singular (RF-8)', async () => {
    const { agente, perfil } = await registrarTambo();
    const creado = await agente.post('/api/lotes').send({ nombre: 'Recría' }).expect(201);
    await crearAnimal(perfil.establecimiento.id, creado.body.id, '1');

    const res = await agente.delete(`/api/lotes/${creado.body.id}`).expect(409);
    expect(res.body.error).toBe('El lote tiene 1 animal');
  });

  it('un lote destino de En ordeñe da 409 "El lote es destino de En ordeñe" (RF-9)', async () => {
    const { agente } = await registrarTambo();
    const enOrdene = await loteDeLista(agente, 'En ordeñe');

    const res = await agente.delete(`/api/lotes/${enOrdene.id}`).expect(409);
    expect(res.body.error).toBe('El lote es destino de En ordeñe');
    expect(await prisma.lote.findUnique({ where: { id: enOrdene.id } })).not.toBeNull();
  });

  it('un lote destino de dos estados los nombra en orden: "En ordeñe y Seca" (RF-9)', async () => {
    const { agente, perfil } = await registrarTambo();
    const enOrdene = await loteDeLista(agente, 'En ordeñe');
    // Hasta que exista la API de destinos (T7), se cambia la regla directo en la base.
    await prisma.reglaLote.update({
      where: { establecimientoId_estado: { establecimientoId: perfil.establecimiento.id, estado: 'SECA' } },
      data: { loteId: enOrdene.id },
    });

    const res = await agente.delete(`/api/lotes/${enOrdene.id}`).expect(409);
    expect(res.body.error).toBe('El lote es destino de En ordeñe y Seca');
  });

  it('con animales y destino a la vez el mensaje nombra los dos motivos (RF-8, RF-9)', async () => {
    const { agente, perfil } = await registrarTambo();
    const enOrdene = await loteDeLista(agente, 'En ordeñe');
    for (const numero of ['1', '2', '3']) await crearAnimal(perfil.establecimiento.id, enOrdene.id, numero);

    const res = await agente.delete(`/api/lotes/${enOrdene.id}`).expect(409);
    expect(res.body.error).toBe('El lote tiene 3 animales y es destino de En ordeñe');
  });

  it('la base informa P2003 al borrar un lote que es destino (la ruta se apoya en eso para RF-31)', async () => {
    const { agente, perfil } = await registrarTambo();
    const secas = await loteDeLista(agente, 'Secas');
    await expect(
      prisma.lote.deleteMany({ where: { id: secas.id, establecimientoId: perfil.establecimiento.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('id mal formado o inexistente da 404', async () => {
    const { agente } = await registrarTambo();
    await agente.delete('/api/lotes/no-es-un-uuid').expect(404);
    const res = await agente.delete(`/api/lotes/${ID_INEXISTENTE}`).expect(404);
    expect(res.body.error).toBe('Lote no encontrado');
  });

  it('un lote ya eliminado da 404 (RF-32)', async () => {
    const { agente } = await registrarTambo();
    const creado = await agente.post('/api/lotes').send({ nombre: 'Recría' }).expect(201);
    await agente.delete(`/api/lotes/${creado.body.id}`).expect(204);

    const res = await agente.delete(`/api/lotes/${creado.body.id}`).expect(404);
    expect(res.body.error).toBe('Lote no encontrado');
  });

  it('aislamiento: B no puede eliminar un lote de A, que queda intacto (RF-20)', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    const b = await registrarTambo('Tambo B', 'dueno-b@prueba.test');
    const creado = await a.agente.post('/api/lotes').send({ nombre: 'Solo de A' }).expect(201);
    const secasDeA = await loteDeLista(a.agente, 'Secas');

    // Uno eliminable (sin animales ni destinos) y uno bloqueado: los dos dan 404,
    // así la respuesta no revela por qué el de A estaría bloqueado.
    const res = await b.agente.delete(`/api/lotes/${creado.body.id}`).expect(404);
    expect(res.body.error).toBe('Lote no encontrado');
    const bloqueado = await b.agente.delete(`/api/lotes/${secasDeA.id}`).expect(404);
    expect(bloqueado.body.error).toBe('Lote no encontrado');

    expect(await prisma.lote.findUnique({ where: { id: creado.body.id } })).not.toBeNull();
  });

  it('el encargado puede eliminar', async () => {
    const { agente } = await registrarTambo();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const creado = await agente.post('/api/lotes').send({ nombre: 'Recría' }).expect(201);
    await encargado.delete(`/api/lotes/${creado.body.id}`).expect(204);
  });

  it('el veterinario recibe 403, también con id de otro tambo o mal formado (RF-22)', async () => {
    const a = await registrarTambo('Tambo A', 'dueno-a@prueba.test');
    const b = await registrarTambo('Tambo B', 'dueno-b@prueba.test');
    const vet = await crearUsuario(b.agente, 'VETERINARIO', 'vet@prueba.test');
    const deB = await b.agente.post('/api/lotes').send({ nombre: 'Recría' }).expect(201);
    const deA = await a.agente.post('/api/lotes').send({ nombre: 'Recría' }).expect(201);

    const res = await vet.delete(`/api/lotes/${deB.body.id}`).expect(403);
    expect(res.body.error).toBe('No tenés permiso para hacer esto');
    await vet.delete(`/api/lotes/${deA.body.id}`).expect(403);
    await vet.delete('/api/lotes/no-es-un-uuid').expect(403);

    expect(await prisma.lote.findUnique({ where: { id: deB.body.id } })).not.toBeNull();
    expect(await prisma.lote.findUnique({ where: { id: deA.body.id } })).not.toBeNull();
  });

  it('sin sesión responde 401', async () => {
    await request(app).delete(`/api/lotes/${ID_INEXISTENTE}`).expect(401);
  });
});
