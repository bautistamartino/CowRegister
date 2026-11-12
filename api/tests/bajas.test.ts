import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import {
  app,
  crearAnimalDirecto,
  crearBajaRegistradaDirecta,
  crearCambioDirecto,
  crearPartoDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
  registrarTambo,
  verificarInvariantes,
} from './ayudas.js';

// Spec 006: POST /api/animales/:id/baja (RF-1, RF-4, RF-5, RF-6, RF-17).

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const OK = { motivo: 'venta', fecha: '2026-11-10', observaciones: 'Se la llevó el frigorífico' };
const url = (id: string) => `/api/animales/${id}/baja`;
const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';

describe('registrar la baja (RF-1)', () => {
  it.each(['RECIEN_NACIDO', 'VAQUILLONA', 'EN_ORDENE', 'SECA'] as const)(
    'una hembra %s: 201, queda de baja con fecha, motivo, sin lote y con su estado y lote previos',
    async (estado) => {
      const { agente, tambo, vaca, usuarioId } = await prepararVaca({ estado });
      const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Lote A' } });
      await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: lote.id } });

      const res = await agente.post(url(vaca.id)).send(OK).expect(201);
      expect(res.body).toMatchObject({
        animalId: vaca.id,
        numero: '101',
        motivo: 'venta',
        fecha: '2026-11-10',
        observaciones: 'Se la llevó el frigorífico',
        estadoAnterior: estado,
        registradoPor: 'Dueño',
      });

      const animal = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
      expect(animal).toMatchObject({ estado: 'BAJA', motivoBaja: 'VENTA', loteId: null });
      expect(animal.fechaBaja?.toISOString().slice(0, 10)).toBe('2026-11-10');

      const baja = await prisma.baja.findUniqueOrThrow({ where: { eventoId: res.body.id } });
      expect(baja).toMatchObject({
        animalId: vaca.id,
        establecimientoId: tambo,
        motivo: 'VENTA',
        estadoAnterior: estado,
        tuvoLoteAnterior: true,
        loteAnteriorId: lote.id,
        vigente: true,
      });
      const evento = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(evento).toMatchObject({ tipo: 'BAJA', registradoPorId: usuarioId, anuladoEn: null });
      expect(await verificarInvariantes()).toEqual([]);
    },
  );

  it('un macho recién nacido por muerte: 201', async () => {
    const { agente, vaca } = await prepararVaca({ sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
    const res = await agente.post(url(vaca.id)).send({ motivo: 'muerte', fecha: '2026-11-11' }).expect(201);
    expect(res.body).toMatchObject({ motivo: 'muerte', observaciones: null });
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).motivoBaja).toBe('MUERTE');
  });

  it('sin lote previo: tuvoLoteAnterior false', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send(OK).expect(201);
    const baja = await prisma.baja.findUniqueOrThrow({ where: { eventoId: res.body.id } });
    expect(baja).toMatchObject({ tuvoLoteAnterior: false, loteAnteriorId: null });
  });

  it('una vaca preñada y con una madre con crías activas se acepta (sin condiciones)', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    await crearPartoDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-06-01' });
    await agente.post(url(vaca.id)).send(OK).expect(201);
  });
});

describe('lo que la baja conserva (RF-4)', () => {
  it('eventos, crías, madre y cambios intactos; el número queda libre para otro animal activo', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const madre = await crearAnimalDirecto(tambo, 'M1');
    await prisma.animal.update({ where: { id: vaca.id }, data: { madreId: madre.id } });
    await crearPartoDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-06-01', crias: [{ numero: 'C9' }] });
    await crearCambioDirecto(tambo, vaca.id);
    const antes = {
      eventos: await prisma.evento.count({ where: { animalId: vaca.id } }),
      crias: await prisma.animal.count({ where: { madreId: vaca.id, estado: { not: 'BAJA' } } }),
      cambios: await prisma.cambioAnimal.count({ where: { animalId: vaca.id } }),
    };

    await agente.post(url(vaca.id)).send(OK).expect(201);

    const animal = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(animal.madreId).toBe(madre.id); // la madre sigue vinculada
    expect(await prisma.evento.count({ where: { animalId: vaca.id } })).toBe(antes.eventos + 1); // solo se agrega la baja
    expect(await prisma.animal.count({ where: { madreId: vaca.id, estado: { not: 'BAJA' } } })).toBe(antes.crias); // las crías no se tocan
    expect(await prisma.cambioAnimal.count({ where: { animalId: vaca.id } })).toBe(antes.cambios);

    // El número "101" quedó libre: se puede dar de alta otro animal con él.
    await agente.post('/api/animales').send({ numero: '101', sexo: 'HEMBRA', estado: 'VAQUILLONA' }).expect(201);
    expect(await verificarInvariantes()).toEqual([]);
  });
});

describe('animal no disponible (RF-6)', () => {
  it('ya de baja, inexistente, ajeno y mal formado: el mismo 404, también con cuerpo válido', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const otro = await registrarTambo('Otro tambo', 'otro@prueba.test');
    const ajeno = await crearAnimalDirecto(otro.perfil.establecimiento.id, '555');
    const deBaja = await crearAnimalDirecto(tambo, '777');
    await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: deBaja.id, registradoPorId: usuarioId, fecha: '2026-10-01' });
    const porPartoAnulado = await crearAnimalDirecto(tambo, '888', { estado: 'BAJA', motivoBaja: 'PARTO_ANULADO' });

    const respuestas = [] as { status: number; body: unknown }[];
    for (const id of [deBaja.id, ID_INEXISTENTE, ajeno.id, 'no-es-un-id', porPartoAnulado.id]) {
      respuestas.push(await agente.post(url(id)).send(OK));
    }
    for (const r of respuestas) expect(r.status).toBe(404);
    expect(new Set(respuestas.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: ajeno.id } })).estado).toBe('EN_ORDENE');
    expect(vaca.estado).toBe('EN_ORDENE');
  });
});

describe('la baja en la ficha de baja (RF-5)', () => {
  it('figura en la lista de eventos con tipo, fecha, motivo, observaciones y solo el nombre de quien la registró', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send(OK).expect(201);
    const ficha = (await agente.get(`/api/bajas/${vaca.id}`).expect(200)).body;
    const evento = ficha.eventos.find((e: { id: string }) => e.id === res.body.id);
    expect(evento).toMatchObject({
      tipo: 'BAJA',
      fecha: '2026-11-10',
      registradoPor: 'Dueño',
      anulacion: null,
      baja: { motivo: 'venta', observaciones: 'Se la llevó el frigorífico', estadoAnterior: 'EN_ORDENE', loteAnterior: 'SIN_LOTE' },
    });
    expect(JSON.stringify(ficha)).not.toMatch(/passwordHash|tokenHash|@prueba\.test/);
  });

  it('tras revertir, la baja figura anulada con el motivo, quién y cuándo', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send(OK).expect(201);
    await agente.post(`/api/animales/${vaca.id}/revertir-baja`).send({ motivoReversion: 'Se cargó mal' }).expect(200);
    // Activo otra vez: la ficha de baja ya no existe, pero la baja anulada figura en la lista de eventos.
    await agente.get(`/api/bajas/${vaca.id}`).expect(404);
    const eventos = (await agente.get(`/api/animales/${vaca.id}/eventos`).expect(200)).body.eventos;
    expect(eventos.find((e: { id: string }) => e.id === res.body.id)).toMatchObject({
      tipo: 'BAJA',
      anulacion: { motivo: 'Se cargó mal', por: 'Dueño' },
    });
  });
});

describe('permisos y aislamiento (RF-17)', () => {
  it('encargado puede; veterinario recibe 403 también con JSON roto, datos inválidos y animal inexistente', async () => {
    const { agente, vaca } = await prepararVaca();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');
    const veterinario = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');

    await veterinario.post(url(vaca.id)).send(OK).expect(403);
    await veterinario.post(url(vaca.id)).send({ motivo: 'x' }).expect(403);
    await veterinario.post(url(ID_INEXISTENTE)).send(OK).expect(403);
    await veterinario.post(url(vaca.id)).set('Content-Type', 'application/json').send('{roto').expect(403);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('EN_ORDENE');

    await encargado.post(url(vaca.id)).send(OK).expect(201);
  });

  it('sin sesión: 401, también con JSON roto', async () => {
    const { vaca } = await prepararVaca();
    await request(app).post(url(vaca.id)).send(OK).expect(401);
    await request(app).post(url(vaca.id)).set('Content-Type', 'application/json').send('{roto').expect(401);
  });

  it('un animal de otro tambo da 404 y no se toca', async () => {
    const a = await prepararVaca({ email: 'a@prueba.test' });
    const b = await prepararVaca({ numero: '202', nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    await a.agente.post(url(b.vaca.id)).send(OK).expect(404);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: b.vaca.id } })).estado).toBe('EN_ORDENE');
    expect(await prisma.baja.count()).toBe(0);
  });
});
