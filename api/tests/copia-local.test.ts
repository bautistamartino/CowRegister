import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { fijarTopes } from '../src/topes.js';
import { app, crearAnimalDirecto, crearBajaRegistradaDirecta, crearProduccionDirecta, crearUsuario, limpiarBase, prepararVaca, registrarTambo } from './ayudas.js';

// Spec 009: GET /api/copia-local — descarga completa del tambo para el modo sin conexión
// (RF-4, RF-6, RF-8, RF-14, RF-49 a RF-52, RF-54). Reloj fijado en las 12:00 ART del 11/11/2026.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => {
  fijarReloj(null);
  fijarTopes(null);
});
afterAll(() => prisma.$disconnect());

const URL_COPIA = '/api/copia-local';

describe('permisos (RF-52)', () => {
  it('sin sesión es 401', async () => {
    await request(app).get(URL_COPIA).expect(401);
  });

  it('los tres roles reciben 200', async () => {
    const { agente } = await prepararVaca();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    for (const a of [agente, encargado, vet]) {
      const res = await a.get(URL_COPIA).expect(200);
      expect(res.body.totalAnimales).toBe(1);
    }
  });
});

describe('contenido (RF-4, RF-14)', () => {
  it('un tambo sin animales responde una copia sin animales (con sus lotes iniciales)', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.get(URL_COPIA).expect(200);
    expect(res.body).toMatchObject({ totalAnimales: 0, animales: [] });
    expect(res.body.lotes).toEqual((await agente.get('/api/lotes').expect(200)).body);
    expect(new Date(res.body.generadaEn).toISOString()).toBe(res.body.generadaEn);
  });

  it('trae solo los activos, cada uno con ficha, eventos, historial y producción (sin sugerencia)', async () => {
    const { agente, tambo, usuarioId, vaca } = await prepararVaca({ numero: '101' });
    const macho = await crearAnimalDirecto(tambo, 'T1', { sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
    const baja = await crearAnimalDirecto(tambo, '777');
    await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: baja.id, registradoPorId: usuarioId, fecha: '2026-11-01' });
    await crearProduccionDirecta({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-11-10', litros: 12.5 });

    const res = await agente.get(URL_COPIA).expect(200);
    expect(res.body.totalAnimales).toBe(2);
    const numeros = res.body.animales.map((a: any) => a.ficha.numero);
    expect(numeros).toEqual(['101', 'T1']); // sin la baja
    const deVaca = res.body.animales.find((a: any) => a.ficha.id === vaca.id);
    expect(Object.keys(deVaca).sort()).toEqual(['eventos', 'ficha', 'historial', 'produccion']);
    expect(deVaca.produccion).not.toHaveProperty('sugerencia');
    expect(deVaca.produccion.registros).toHaveLength(1);
    expect(deVaca.eventos).toHaveProperty('situacion');
    expect(deVaca.historial).toHaveProperty('entradas');
    const deMacho = res.body.animales.find((a: any) => a.ficha.id === macho.id);
    expect(deMacho.eventos).toEqual({ situacion: null, eventos: [] });
  });

  it('los lotes son los de GET /api/lotes', async () => {
    const { agente } = await registrarTambo();
    await agente.post('/api/lotes').send({ nombre: 'Lote B' }).expect(201);
    await agente.post('/api/lotes').send({ nombre: 'Lote A', descripcion: 'Los primeros' }).expect(201);
    const individual = await agente.get('/api/lotes').expect(200);
    const copia = await agente.get(URL_COPIA).expect(200);
    expect(copia.body.lotes).toEqual(individual.body);
    expect(copia.body.lotes.length).toBeGreaterThanOrEqual(2);
  });

  it('sale comprimida con gzip cuando el cliente lo acepta y sin comprimir si no', async () => {
    const { agente } = await prepararVaca();
    const comprimida = await agente.get(URL_COPIA).set('Accept-Encoding', 'gzip').expect(200);
    expect(comprimida.headers['content-encoding']).toBe('gzip');
    expect(comprimida.body.totalAnimales).toBe(1); // supertest la descomprime sola
    const plana = await agente.get(URL_COPIA).set('Accept-Encoding', 'identity').expect(200);
    expect(plana.headers['content-encoding']).toBeUndefined();
    expect(plana.body.animales).toEqual(comprimida.body.animales);
  });
});

describe('tope de la copia (RF-8)', () => {
  it('con más animales activos que el tope responde 422 sin recortar ni mandar nada', async () => {
    const { agente, tambo } = await prepararVaca({ numero: '1' });
    await crearAnimalDirecto(tambo, '2');
    await crearAnimalDirecto(tambo, '3');
    fijarTopes({ copia: 2 });
    const res = await agente.get(URL_COPIA).expect(422);
    expect(res.body).toEqual({
      error: 'El tambo tiene más animales de los que entran en la tablet (2). Pedí ayuda para usarlo sin conexión',
      totalAnimales: 3,
      tope: 2,
    });
  });

  it('con exactamente el tope entra completa; los animales de baja no cuentan', async () => {
    const { agente, tambo, usuarioId } = await prepararVaca({ numero: '1' });
    await crearAnimalDirecto(tambo, '2');
    const baja = await crearAnimalDirecto(tambo, '3');
    await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: baja.id, registradoPorId: usuarioId, fecha: '2026-11-01' });
    fijarTopes({ copia: 2 });
    const res = await agente.get(URL_COPIA).expect(200);
    expect(res.body.animales).toHaveLength(2);
  });

  it('el tope por defecto es 5.000', async () => {
    const { topeCopia } = await import('../src/topes.js');
    expect(topeCopia()).toBe(5000);
  });
});

describe('aislamiento y datos sensibles (RF-49 a RF-51, RF-54)', () => {
  it('con dos tambos, cada uno recibe solo lo suyo (sin bajas del otro ni lotes ajenos)', async () => {
    const a = await prepararVaca({ numero: 'A1', nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ numero: 'B1', nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    await crearAnimalDirecto(b.tambo, 'B2');
    await b.agente.post('/api/lotes').send({ nombre: 'Lote secreto de B' }).expect(201);
    await crearProduccionDirecta({ establecimientoId: b.tambo, animalId: b.vaca.id, registradoPorId: b.usuarioId, fecha: '2026-11-10', litros: 33.3 });

    const deA = await a.agente.get(URL_COPIA).expect(200);
    expect(deA.body.animales.map((x: any) => x.ficha.numero)).toEqual(['A1']);
    // Solo los lotes de A (los iniciales de su registro), nunca los de B.
    expect(deA.body.lotes).toEqual((await a.agente.get('/api/lotes').expect(200)).body);
    const textoA = JSON.stringify(deA.body);
    for (const ajeno of ['B1', 'B2', 'Lote secreto de B', b.tambo, b.vaca.id, b.usuarioId, '33.3']) {
      expect(textoA).not.toContain(ajeno);
    }

    const deB = await b.agente.get(URL_COPIA).expect(200);
    expect(deB.body.animales.map((x: any) => x.ficha.numero)).toEqual(['B1', 'B2']);
    expect(JSON.stringify(deB.body)).not.toContain('A1');
  });

  it('un establecimientoId de la query se ignora', async () => {
    const a = await prepararVaca({ numero: 'A1', nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ numero: 'B1', nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const res = await a.agente.get(`${URL_COPIA}?establecimientoId=${b.tambo}`).expect(200);
    expect(res.body.animales.map((x: any) => x.ficha.numero)).toEqual(['A1']);
  });

  it('no incluye hashes, emails ni ids de usuarios', async () => {
    const { agente, tambo, usuarioId, vaca } = await prepararVaca({ numero: '101' });
    await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    await crearProduccionDirecta({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-11-10' });
    const texto = JSON.stringify((await agente.get(URL_COPIA).expect(200)).body);
    for (const prohibido of ['passwordHash', 'tokenHash', 'dueno@prueba.test', 'encargado@prueba.test', usuarioId, 'argon2']) {
      expect(texto).not.toContain(prohibido);
    }
    // Sí viene el nombre de quien cargó (igual que la ficha individual).
    expect(texto).toContain('Dueño');
  });
});
