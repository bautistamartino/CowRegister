import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { app, crearUsuario, limpiarBase, registrarTambo } from './ayudas.js';

// Tests de la API de destinos de cada estado (T7): /api/reglas-lote.
// Recordatorio: todo tambo registrado con registrarTambo() ya trae los 4 lotes
// iniciales con sus destinos: RECIEN_NACIDO → Terneros, VAQUILLONA → Vaquillonas,
// EN_ORDENE → En ordeñe, SECA → Secas (RF-18).

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

type Agente = ReturnType<typeof request.agent>;
type ReglaRespuesta = { estado: string; lote: { id: string; nombre: string } | null };

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';

// Busca el id de un lote por nombre en GET /api/lotes.
async function idDeLote(agente: Agente, nombre: string) {
  const res = await agente.get('/api/lotes').expect(200);
  const lote = (res.body as { id: string; nombre: string }[]).find((l) => l.nombre === nombre);
  if (!lote) throw new Error(`No está el lote ${nombre}`);
  return lote.id;
}

// Devuelve los destinos como { ESTADO: nombreDelLote | null } para comparar fácil.
async function destinos(agente: Agente) {
  const res = await agente.get('/api/reglas-lote').expect(200);
  return Object.fromEntries(
    (res.body as ReglaRespuesta[]).map((r) => [r.estado, r.lote?.nombre ?? null]),
  );
}

const DESTINOS_INICIALES = {
  RECIEN_NACIDO: 'Terneros',
  VAQUILLONA: 'Vaquillonas',
  EN_ORDENE: 'En ordeñe',
  SECA: 'Secas',
};

describe('GET /api/reglas-lote (RF-11, RF-14)', () => {
  it('sin sesión responde 401', async () => {
    await request(app).get('/api/reglas-lote').expect(401);
  });

  it('devuelve los 4 estados en orden, con id y nombre del lote destino', async () => {
    const { agente } = await registrarTambo();
    const terneros = await idDeLote(agente, 'Terneros');

    const res = await agente.get('/api/reglas-lote').expect(200);
    const reglas = res.body as ReglaRespuesta[];
    expect(reglas.map((r) => r.estado)).toEqual(['RECIEN_NACIDO', 'VAQUILLONA', 'EN_ORDENE', 'SECA']);
    expect(reglas[0]).toEqual({ estado: 'RECIEN_NACIDO', lote: { id: terneros, nombre: 'Terneros' } });
  });

  it('un estado sin destino aparece igual, con lote null', async () => {
    const { agente } = await registrarTambo();
    await agente.delete('/api/reglas-lote/VAQUILLONA').expect(204);

    const res = await agente.get('/api/reglas-lote').expect(200);
    const reglas = res.body as ReglaRespuesta[];
    expect(reglas).toHaveLength(4);
    expect(reglas[1]).toEqual({ estado: 'VAQUILLONA', lote: null });
  });

  it('sin ningún destino, siguen apareciendo los 4 estados con lote null', async () => {
    const { agente } = await registrarTambo();
    for (const estado of ['RECIEN_NACIDO', 'VAQUILLONA', 'EN_ORDENE', 'SECA']) {
      await agente.delete(`/api/reglas-lote/${estado}`).expect(204);
    }
    expect(await destinos(agente)).toEqual({
      RECIEN_NACIDO: null,
      VAQUILLONA: null,
      EN_ORDENE: null,
      SECA: null,
    });
  });
});

describe('PUT /api/reglas-lote/:estado (RF-12, RF-15 a RF-17, RF-31)', () => {
  it('reemplaza el destino anterior y devuelve la lista completa actualizada', async () => {
    const { agente } = await registrarTambo();
    const crear = await agente.post('/api/lotes').send({ nombre: 'Preparto' }).expect(201);
    const preparto = crear.body.id as string;

    const res = await agente.put('/api/reglas-lote/SECA').send({ loteId: preparto }).expect(200);
    const reglas = res.body as ReglaRespuesta[];
    expect(reglas).toHaveLength(4);
    expect(reglas[3]).toEqual({ estado: 'SECA', lote: { id: preparto, nombre: 'Preparto' } });

    expect(await destinos(agente)).toEqual({ ...DESTINOS_INICIALES, SECA: 'Preparto' });
    // Sigue habiendo una sola regla para SECA (cada estado tiene como máximo un destino).
    expect(await prisma.reglaLote.count({ where: { estado: 'SECA' } })).toBe(1);
  });

  it('elegir el lote que ya es destino da 200 y no cambia nada', async () => {
    const { agente } = await registrarTambo();
    const secas = await idDeLote(agente, 'Secas');

    await agente.put('/api/reglas-lote/SECA').send({ loteId: secas }).expect(200);
    await agente.put('/api/reglas-lote/SECA').send({ loteId: secas }).expect(200);

    expect(await destinos(agente)).toEqual(DESTINOS_INICIALES);
    expect(await prisma.reglaLote.count()).toBe(4);
  });

  it('un mismo lote puede ser destino de dos estados (RF-15)', async () => {
    const { agente } = await registrarTambo();
    const enOrdene = await idDeLote(agente, 'En ordeñe');

    await agente.put('/api/reglas-lote/SECA').send({ loteId: enOrdene }).expect(200);
    expect(await destinos(agente)).toEqual({ ...DESTINOS_INICIALES, SECA: 'En ordeñe' });

    // GET /api/lotes también lo refleja en destinoDe.
    const lotes = await agente.get('/api/lotes').expect(200);
    const lote = (lotes.body as { nombre: string; destinoDe: string[] }[]).find((l) => l.nombre === 'En ordeñe');
    expect(lote?.destinoDe).toEqual(['EN_ORDENE', 'SECA']);
  });

  it('el encargado también puede configurar destinos', async () => {
    const { agente } = await registrarTambo();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const terneros = await idDeLote(agente, 'Terneros');

    await encargado.put('/api/reglas-lote/VAQUILLONA').send({ loteId: terneros }).expect(200);
    expect(await destinos(agente)).toEqual({ ...DESTINOS_INICIALES, VAQUILLONA: 'Terneros' });
  });

  it('BAJA da 400 "Estado inválido" (RF-16)', async () => {
    const { agente } = await registrarTambo();
    const secas = await idDeLote(agente, 'Secas');

    const res = await agente.put('/api/reglas-lote/BAJA').send({ loteId: secas }).expect(400);
    expect(res.body.error).toBe('Estado inválido');
    expect(await prisma.reglaLote.count({ where: { estado: 'BAJA' } })).toBe(0);
  });

  it('cualquier otro texto como estado da 400 (también en minúsculas)', async () => {
    const { agente } = await registrarTambo();
    const secas = await idDeLote(agente, 'Secas');

    for (const estado of ['seca', 'VACA', '123']) {
      const res = await agente.put(`/api/reglas-lote/${estado}`).send({ loteId: secas }).expect(400);
      expect(res.body.error).toBe('Estado inválido');
    }
  });

  it('loteId inexistente, mal formado o ausente da 404 "Lote no encontrado" (RF-17, RF-20)', async () => {
    const { agente } = await registrarTambo();

    for (const cuerpo of [{ loteId: ID_INEXISTENTE }, { loteId: 'no-es-un-uuid' }, { loteId: 42 }, {}]) {
      const res = await agente.put('/api/reglas-lote/SECA').send(cuerpo).expect(404);
      expect(res.body.error).toBe('Lote no encontrado');
    }
    // El destino anterior no se tocó.
    expect(await destinos(agente)).toEqual(DESTINOS_INICIALES);
  });

  it('un lote recién eliminado da 404 (RF-31)', async () => {
    const { agente } = await registrarTambo();
    const crear = await agente.post('/api/lotes').send({ nombre: 'Temporal' }).expect(201);
    const temporal = crear.body.id as string;
    await agente.delete(`/api/lotes/${temporal}`).expect(204);

    const res = await agente.put('/api/reglas-lote/SECA').send({ loteId: temporal }).expect(404);
    expect(res.body.error).toBe('Lote no encontrado');
    expect(await destinos(agente)).toEqual(DESTINOS_INICIALES);
  });

  it('ignora un establecimientoId enviado en el cuerpo', async () => {
    const a = await registrarTambo('Tambo A', 'a@prueba.test');
    const b = await registrarTambo('Tambo B', 'b@prueba.test');
    const secasB = await idDeLote(b.agente, 'Secas');

    // B intenta escribir en el tambo de A mandando su id: se usa el tambo de la sesión.
    await b.agente
      .put('/api/reglas-lote/EN_ORDENE')
      .send({ loteId: secasB, establecimientoId: a.perfil.establecimiento.id })
      .expect(200);
    expect(await destinos(a.agente)).toEqual(DESTINOS_INICIALES);
    expect(await destinos(b.agente)).toEqual({ ...DESTINOS_INICIALES, EN_ORDENE: 'Secas' });
  });
});

describe('DELETE /api/reglas-lote/:estado (RF-13)', () => {
  it('deja el estado sin destino y repetirlo también da 204', async () => {
    const { agente } = await registrarTambo();

    await agente.delete('/api/reglas-lote/RECIEN_NACIDO').expect(204);
    await agente.delete('/api/reglas-lote/RECIEN_NACIDO').expect(204);

    expect(await destinos(agente)).toEqual({ ...DESTINOS_INICIALES, RECIEN_NACIDO: null });
    // El lote sigue existiendo: solo se quitó el destino.
    await idDeLote(agente, 'Terneros');
  });

  it('después de quitarlo, el lote se puede eliminar', async () => {
    const { agente } = await registrarTambo();
    const terneros = await idDeLote(agente, 'Terneros');

    await agente.delete(`/api/lotes/${terneros}`).expect(409);
    await agente.delete('/api/reglas-lote/RECIEN_NACIDO').expect(204);
    await agente.delete(`/api/lotes/${terneros}`).expect(204);
  });

  it('BAJA u otro texto da 400 "Estado inválido"', async () => {
    const { agente } = await registrarTambo();
    for (const estado of ['BAJA', 'seca', 'cualquiera']) {
      const res = await agente.delete(`/api/reglas-lote/${estado}`).expect(400);
      expect(res.body.error).toBe('Estado inválido');
    }
    expect(await destinos(agente)).toEqual(DESTINOS_INICIALES);
  });
});

describe('aislamiento entre dos tambos (RF-17, RF-20)', () => {
  it('listar: cada tambo ve solo sus destinos', async () => {
    const a = await registrarTambo('Tambo A', 'a@prueba.test');
    const b = await registrarTambo('Tambo B', 'b@prueba.test');
    const secasA = await idDeLote(a.agente, 'Secas');
    const secasB = await idDeLote(b.agente, 'Secas');

    const resB = await b.agente.get('/api/reglas-lote').expect(200);
    const idsB = (resB.body as ReglaRespuesta[]).map((r) => r.lote?.id);
    expect(idsB).toContain(secasB);
    expect(idsB).not.toContain(secasA);

    // A quita un destino: B sigue con los suyos.
    await a.agente.delete('/api/reglas-lote/SECA').expect(204);
    expect(await destinos(b.agente)).toEqual(DESTINOS_INICIALES);
  });

  it('configurar: B no puede usar un lote de A (404) y A queda igual', async () => {
    const a = await registrarTambo('Tambo A', 'a@prueba.test');
    const b = await registrarTambo('Tambo B', 'b@prueba.test');
    const enOrdeneA = await idDeLote(a.agente, 'En ordeñe');

    const res = await b.agente.put('/api/reglas-lote/SECA').send({ loteId: enOrdeneA }).expect(404);
    expect(res.body.error).toBe('Lote no encontrado');

    expect(await destinos(a.agente)).toEqual(DESTINOS_INICIALES);
    expect(await destinos(b.agente)).toEqual(DESTINOS_INICIALES);
  });

  it('quitar: el DELETE de B no toca los destinos de A', async () => {
    const a = await registrarTambo('Tambo A', 'a@prueba.test');
    const b = await registrarTambo('Tambo B', 'b@prueba.test');

    await b.agente.delete('/api/reglas-lote/EN_ORDENE').expect(204);

    expect(await destinos(a.agente)).toEqual(DESTINOS_INICIALES);
    expect(await destinos(b.agente)).toEqual({ ...DESTINOS_INICIALES, EN_ORDENE: null });
  });
});

describe('veterinario (RF-21, RF-22)', () => {
  it('puede ver los destinos (200)', async () => {
    const { agente } = await registrarTambo();
    const veterinario = await crearUsuario(agente, 'VETERINARIO', 'vete@prueba.test');

    expect(await destinos(veterinario)).toEqual(DESTINOS_INICIALES);
  });

  it('PUT y DELETE dan 403 siempre: con datos válidos, estado inválido, lote inexistente o de otro tambo', async () => {
    const a = await registrarTambo('Tambo A', 'a@prueba.test');
    const b = await registrarTambo('Tambo B', 'b@prueba.test');
    const veterinario = await crearUsuario(b.agente, 'VETERINARIO', 'vete@prueba.test');
    const secasB = await idDeLote(b.agente, 'Secas');
    const secasA = await idDeLote(a.agente, 'Secas');

    const intentos = [
      veterinario.put('/api/reglas-lote/EN_ORDENE').send({ loteId: secasB }), // válido
      veterinario.put('/api/reglas-lote/BAJA').send({ loteId: secasB }), // estado inválido
      veterinario.put('/api/reglas-lote/SECA').send({ loteId: ID_INEXISTENTE }), // inexistente
      veterinario.put('/api/reglas-lote/SECA').send({ loteId: 'no-es-un-uuid' }), // mal formado
      veterinario.put('/api/reglas-lote/SECA').send({ loteId: secasA }), // de otro tambo
      veterinario.delete('/api/reglas-lote/SECA'),
      veterinario.delete('/api/reglas-lote/BAJA'),
    ];
    for (const intento of intentos) {
      const res = await intento.expect(403);
      expect(res.body.error).toBe('No tenés permiso para hacer esto');
    }

    expect(await destinos(b.agente)).toEqual(DESTINOS_INICIALES);
  });
});
