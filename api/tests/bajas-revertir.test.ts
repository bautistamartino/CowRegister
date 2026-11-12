import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import {
  app,
  crearAnimalDirecto,
  crearBajaRegistradaDirecta,
  crearUsuario,
  limpiarBase,
  prepararVaca,
  registrarTambo,
  verificarInvariantes,
} from './ayudas.js';

// Spec 006: POST /api/animales/:id/revertir-baja (RF-7 a RF-11, RF-17).

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';
const rev = (id: string) => `/api/animales/${id}/revertir-baja`;
const MOTIVO = { motivoReversion: 'Se cargó mal' };

// Una vaca con una baja registrada por la API (con su lote previo si se pide).
async function conBaja(opciones: { estado?: 'VAQUILLONA' | 'EN_ORDENE' | 'SECA'; conLote?: boolean } = {}) {
  const t = await prepararVaca({ estado: opciones.estado });
  const lote = opciones.conLote ? await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: 'Lote previo' } }) : null;
  if (lote) await prisma.animal.update({ where: { id: t.vaca.id }, data: { loteId: lote.id } });
  await t.agente.post(`/api/animales/${t.vaca.id}/baja`).send({ motivo: 'venta', fecha: '2026-11-05' }).expect(201);
  return { ...t, lote };
}

describe('revertir la baja (RF-7)', () => {
  it('vuelve activo con el estado y el lote previos, fecha y motivo vacíos y la baja anulada con quién, cuándo y por qué', async () => {
    const { agente, vaca, lote, usuarioId } = await conBaja({ estado: 'SECA', conLote: true });
    const res = await agente.post(rev(vaca.id)).send(MOTIVO).expect(200);

    // La respuesta es la ficha del animal activo más los avisos (ninguno: el lote previo existe).
    expect(res.body).toMatchObject({ id: vaca.id, numero: '101', estado: 'SECA', lote: { id: lote!.id, nombre: 'Lote previo' }, avisos: [] });

    const animal = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(animal).toMatchObject({ estado: 'SECA', loteId: lote!.id, fechaBaja: null, motivoBaja: null });

    const evento = await prisma.evento.findFirstOrThrow({ where: { animalId: vaca.id, tipo: 'BAJA' } });
    expect(evento).toMatchObject({ anuladoPorId: usuarioId, motivoAnulacion: 'Se cargó mal' });
    expect(evento.anuladoEn).toBeInstanceOf(Date);
    const baja = await prisma.baja.findUniqueOrThrow({ where: { eventoId: evento.id } });
    expect(baja.vigente).toBe(false);
    expect(await verificarInvariantes()).toEqual([]);
  });

  it('no borra nada: el evento y su detalle siguen en la base', async () => {
    const { agente, vaca } = await conBaja();
    await agente.post(rev(vaca.id)).send(MOTIVO).expect(200);
    expect(await prisma.evento.count({ where: { animalId: vaca.id, tipo: 'BAJA' } })).toBe(1);
    expect(await prisma.baja.count({ where: { animalId: vaca.id } })).toBe(1);
  });

  it('después de revertir se puede dar de baja de nuevo: la primera queda anulada y la segunda vigente', async () => {
    const { agente, vaca } = await conBaja();
    await agente.post(rev(vaca.id)).send(MOTIVO).expect(200);
    // La baja anulada no cuenta para la fecha mínima: una fecha anterior a la primera baja se acepta.
    await agente.post(`/api/animales/${vaca.id}/baja`).send({ motivo: 'muerte', fecha: '2026-11-01' }).expect(201);

    const ficha = (await agente.get(`/api/bajas/${vaca.id}`).expect(200)).body;
    const bajas = ficha.eventos.filter((e: { tipo: string }) => e.tipo === 'BAJA');
    expect(bajas).toHaveLength(2);
    expect(bajas.filter((e: { anulacion: unknown }) => e.anulacion === null)).toHaveLength(1);
    expect(ficha.baja.motivo).toBe('muerte');
    expect(await verificarInvariantes()).toEqual([]);
  });

  it('sin límite de tiempo: una baja de hace años se revierte', async () => {
    const { agente, tambo, usuarioId } = await prepararVaca();
    const vieja = await crearAnimalDirecto(tambo, 'VIEJA', { sexo: 'HEMBRA', estado: 'EN_ORDENE' });
    await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: vieja.id, registradoPorId: usuarioId, fecha: '2005-03-01' });
    await agente.post(rev(vieja.id)).send(MOTIVO).expect(200);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vieja.id } })).estado).toBe('EN_ORDENE');
  });
});

describe('número ocupado (RF-8)', () => {
  it('otro animal activo con el número: 409 con su mensaje y no cambia nada', async () => {
    const { agente, vaca, tambo } = await conBaja();
    await crearAnimalDirecto(tambo, '101', { estado: 'VAQUILLONA' }); // el número quedó libre y otro lo tomó
    const res = await agente.post(rev(vaca.id)).send(MOTIVO).expect(409);
    expect(res.body.error).toBe('Ya existe un animal activo con el número 101: cambiale el número a ese animal o dejá esta baja');

    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('BAJA');
    const evento = await prisma.evento.findFirstOrThrow({ where: { animalId: vaca.id, tipo: 'BAJA' } });
    expect(evento.anuladoEn).toBeNull();
    expect(await prisma.baja.count({ where: { animalId: vaca.id, vigente: true } })).toBe(1);
  });

  it('el número ocupado por un animal de baja no molesta', async () => {
    const { agente, vaca, tambo } = await conBaja();
    await crearAnimalDirecto(tambo, '101', { estado: 'BAJA', motivoBaja: 'PARTO_ANULADO' });
    await agente.post(rev(vaca.id)).send(MOTIVO).expect(200);
  });
});

describe('lote previo y avisos (RF-9)', () => {
  it('el lote previo fue eliminado: vuelve sin lote y avisa "su lote anterior ya no existe"', async () => {
    const { agente, vaca, lote } = await conBaja({ estado: 'VAQUILLONA', conLote: true });
    await prisma.lote.delete({ where: { id: lote!.id } }); // la base deja loteAnteriorId en null y tuvoLoteAnterior en true
    const res = await agente.post(rev(vaca.id)).send(MOTIVO).expect(200);
    expect(res.body.lote).toBeNull();
    expect(res.body.estado).toBe('VAQUILLONA');
    expect(res.body.avisos).toEqual(['El animal volvió a «vaquillona» y quedó sin lote: su lote anterior ya no existe']);
  });

  it('no tenía lote antes de la baja: aviso con la fecha de la baja en dd/mm/aaaa y el estado en español', async () => {
    const { agente, vaca } = await conBaja({ estado: 'EN_ORDENE' });
    const res = await agente.post(rev(vaca.id)).send(MOTIVO).expect(200);
    expect(res.body.lote).toBeNull();
    expect(res.body.avisos).toEqual(['El animal volvió a «en ordeñe» y quedó sin lote: no tenía lote antes de la baja del 05/11/2026']);
  });

  it('el estado recién nacido se nombra "recién nacido"', async () => {
    const t = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    await t.agente.post(`/api/animales/${t.vaca.id}/baja`).send({ motivo: 'muerte', fecha: '2026-11-05' }).expect(201);
    const res = await t.agente.post(rev(t.vaca.id)).send(MOTIVO).expect(200);
    expect(res.body.avisos[0]).toMatch(/«recién nacido»/);
  });

  it('el lote previo existe aunque ya no sea destino de su estado: vuelve a él, sin aviso', async () => {
    const { agente, tambo, vaca, lote } = await conBaja({ estado: 'EN_ORDENE', conLote: true });
    // El destino de "en ordeñe" es otro lote distinto del previo.
    const ordene = await prisma.lote.findFirstOrThrow({ where: { establecimientoId: tambo, nombre: 'En ordeñe' } });
    expect(ordene.id).not.toBe(lote!.id);
    const res = await agente.post(rev(vaca.id)).send(MOTIVO).expect(200);
    expect(res.body.lote.id).toBe(lote!.id);
    expect(res.body.avisos).toEqual([]);
  });
});

describe('no encontrado y orden de rechazos (RF-10)', () => {
  it('activo, ya revertido, inexistente, ajeno, mal formado y "parto anulado": el mismo 404', async () => {
    const { agente, vaca, tambo } = await conBaja();
    await agente.post(rev(vaca.id)).send(MOTIVO).expect(200); // ahora está activo y revertido
    const activo = await crearAnimalDirecto(tambo, '300');
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    const ajeno = await crearAnimalDirecto(otro.perfil.establecimiento.id, '555');
    await crearBajaRegistradaDirecta({ establecimientoId: otro.perfil.establecimiento.id, animalId: ajeno.id, registradoPorId: otro.perfil.id, fecha: '2026-10-01' });
    const porParto = await crearAnimalDirecto(tambo, '400', { estado: 'BAJA', motivoBaja: 'PARTO_ANULADO' });

    const respuestas = [] as { status: number; body: unknown }[];
    for (const id of [vaca.id, activo.id, ID_INEXISTENTE, ajeno.id, 'no-es-un-id', porParto.id]) {
      respuestas.push(await agente.post(rev(id)).send(MOTIVO));
    }
    for (const r of respuestas) expect(r.status).toBe(404);
    expect(new Set(respuestas.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: ajeno.id } })).estado).toBe('BAJA'); // el ajeno no se tocó
  });

  it('el 400 (motivoReversion) va antes que el 404, y el 404 antes que el 409', async () => {
    const { agente, vaca, tambo } = await conBaja();
    await agente.post(rev(ID_INEXISTENTE)).send({}).expect(400);
    await agente.post(rev('no-es-un-id')).send({ motivoReversion: '  ' }).expect(400);
    // 404 antes que 409: con el número de la baja ocupado, un animal que no es de baja sigue dando 404.
    await crearAnimalDirecto(tambo, '101', { estado: 'VAQUILLONA' });
    const activo = await crearAnimalDirecto(tambo, '500');
    await agente.post(rev(activo.id)).send(MOTIVO).expect(404);
    // Y la baja con el número ocupado da 409 (no 404): confirma el orden.
    await agente.post(rev(vaca.id)).send(MOTIVO).expect(409);
  });
});

describe('mientras está de baja y al volver (RF-11)', () => {
  it('de baja: registrar eventos, editar, mover y leer por las rutas de activos dan 404; al revertir todo vuelve', async () => {
    const { agente, vaca } = await conBaja();
    const id = vaca.id;
    await agente.post(`/api/animales/${id}/servicios`).send({ fecha: '2026-11-06', tipo: 'MONTA_NATURAL' }).expect(404);
    await agente.patch(`/api/animales/${id}`).send({ numero: 'NUEVO' }).expect(404);
    await agente.patch(`/api/animales/${id}/lote`).send({ loteId: null }).expect(404);
    await agente.get(`/api/animales/${id}`).expect(404);
    await agente.get(`/api/animales/${id}/eventos`).expect(404);
    await agente.get(`/api/animales/${id}/cambios`).expect(404);
    await agente.get('/api/animales/buscar?numero=101').expect(404);

    await agente.post(rev(id)).send(MOTIVO).expect(200);
    await agente.get(`/api/animales/${id}`).expect(200);
    await agente.get('/api/animales/buscar?numero=101').expect(200);
    await agente.post(`/api/animales/${id}/servicios`).send({ fecha: '2026-11-06', tipo: 'MONTA_NATURAL' }).expect(201);
  });

  it('la baja revertida no cuenta como evento reproductivo: la situación queda como estaba', async () => {
    const { agente, vaca } = await conBaja();
    await agente.post(rev(vaca.id)).send(MOTIVO).expect(200);
    const res = (await agente.get(`/api/animales/${vaca.id}/eventos`).expect(200)).body;
    expect(res.situacion).toMatchObject({ estado: 'SIN_SERVICIO', ultimoServicio: null, ultimoTacto: null });
  });
});

describe('permisos y aislamiento (RF-17)', () => {
  it('encargado puede; veterinario 403 también con JSON roto, datos inválidos y animal inexistente; sin sesión 401', async () => {
    const { agente, vaca } = await conBaja();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');
    const veterinario = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');

    await veterinario.post(rev(vaca.id)).send(MOTIVO).expect(403);
    await veterinario.post(rev(vaca.id)).send({}).expect(403);
    await veterinario.post(rev(ID_INEXISTENTE)).send(MOTIVO).expect(403);
    await veterinario.post(rev(vaca.id)).set('Content-Type', 'application/json').send('{roto').expect(403);
    await request(app).post(rev(vaca.id)).send(MOTIVO).expect(401);
    await request(app).post(rev(vaca.id)).set('Content-Type', 'application/json').send('{roto').expect(401);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('BAJA');

    const res = await encargado.post(rev(vaca.id)).send(MOTIVO).expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|@prueba\.test/);
  });

  it('un animal de baja de otro tambo da 404 y sigue de baja; un establecimientoId del cuerpo se ignora', async () => {
    const a = await conBaja();
    const b = await prepararVaca({ numero: '202', nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    await b.agente.post(`/api/animales/${b.vaca.id}/baja`).send({ motivo: 'venta', fecha: '2026-11-05' }).expect(201);

    await a.agente.post(rev(b.vaca.id)).send({ ...MOTIVO, establecimientoId: b.tambo }).expect(404);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: b.vaca.id } })).estado).toBe('BAJA');
  });
});
