import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import {
  app,
  crearServicioDirecto,
  crearTactoDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
  registrarTambo,
} from './ayudas.js';

// Tests de POST /api/animales/:id/tactos: RF-12 a RF-18, RF-27 y RF-28.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';

type Agente = ReturnType<typeof request.agent>;
const url = (animalId: string) => `/api/animales/${animalId}/tactos`;
const eventosDe = async (agente: Agente, animalId: string) =>
  (await agente.get(`/api/animales/${animalId}/eventos`).expect(200)).body as {
    situacion: { estado: string; fechaProbableParto: { fecha: string; dias: number; vencida: boolean } | null };
    eventos: { id: string; tipo: string; tacto: { resultado: string; fechaProbable: string | null; fechaProbableIndicada: string | null; anomalias: string | null } | null }[];
  };

describe('registrar un tacto (RF-12)', () => {
  it.each(['VAQUILLONA', 'EN_ORDENE', 'SECA'] as const)('"preñada" y "vacía" sobre una hembra %s: 201', async (estado) => {
    const { agente, vaca } = await prepararVaca({ estado });
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'PRENADA', fechaProbableParto: '2027-06-01' }).expect(201);
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-02', resultado: 'VACIA' }).expect(201);
  });

  it('macho y recién nacida: 409 con el motivo', async () => {
    const macho = await prepararVaca({ sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
    const r1 = await macho.agente.post(url(macho.vaca.id)).send({ fecha: '2026-10-01', resultado: 'VACIA' }).expect(409);
    expect(r1.body.error).toMatch(/macho/i);
    const { agente, vaca } = await prepararVaca({ estado: 'RECIEN_NACIDO', nombreTambo: 'B', email: 'b@prueba.test' });
    const r2 = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'VACIA' }).expect(409);
    expect(r2.body.error).toMatch(/recién nacida/i);
    expect(await prisma.evento.count()).toBe(0);
  });

  it.each([
    ['sin resultado', { fecha: '2026-10-01' }, /resultado/i],
    ['resultado inválido', { fecha: '2026-10-01', resultado: 'TAL VEZ' }, /resultado/i],
    ['sin fecha', { resultado: 'VACIA' }, /fecha/i],
    ['fecha con formato inválido', { fecha: '1/10/2026', resultado: 'VACIA' }, /AAAA-MM-DD/],
  ])('%s: 400', async (_caso, cuerpo, mensaje) => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send(cuerpo).expect(400);
    expect(JSON.stringify(res.body)).toMatch(mensaje);
  });

  it('guarda quién lo registró, no cambia estado ni lote y la lista lo muestra', async () => {
    const { agente, vaca, usuarioId } = await prepararVaca();
    const res = await agente
      .post(url(vaca.id))
      .send({ fecha: '2026-10-01', resultado: 'PRENADA', fechaProbableParto: '2027-06-01', anomalias: 'Quiste' })
      .expect(201);
    expect(res.body).toMatchObject({
      tipo: 'TACTO',
      fecha: '2026-10-01',
      tacto: { resultado: 'PRENADA', fechaProbableIndicada: '2027-06-01', fechaProbable: '2027-06-01', anomalias: 'Quiste' },
    });
    const evento = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(evento.registradoPorId).toBe(usuarioId);
    const despues = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(despues.estado).toBe('EN_ORDENE');
  });
});

describe('fecha probable de parto (RF-13, RF-14, RF-16)', () => {
  it('"preñada" sin servicio previo y con fecha probable: se acepta', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'PRENADA', fechaProbableParto: '2027-05-15' }).expect(201);
    const { situacion } = await eventosDe(agente, vaca.id);
    expect(situacion.estado).toBe('PRENADA');
    expect(situacion.fechaProbableParto?.fecha).toBe('2027-05-15');
  });

  it('"preñada" sin servicio base ni fecha: 400 que pide la fecha', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'PRENADA' }).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/fecha probable/i);
    expect(await prisma.evento.count()).toBe(0);
  });

  it('con servicio y sin fecha: se guarda y la fecha vigente es servicio + 283 días', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-03-01' });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'PRENADA' }).expect(201);
    expect(res.body.tacto.fechaProbableIndicada).toBeNull();
    expect(res.body.tacto.fechaProbable).toBe('2026-12-09'); // 2026-03-01 + 283
    const { situacion } = await eventosDe(agente, vaca.id);
    expect(situacion.fechaProbableParto).toEqual({ fecha: '2026-12-09', dias: 28, vencida: false });
  });

  it('un segundo "preñada" sin fecha conserva la indicada del primero', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).send({ fecha: '2026-09-01', resultado: 'PRENADA', fechaProbableParto: '2027-04-01' }).expect(201);
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'PRENADA' }).expect(201);
    expect(res.body.tacto.fechaProbable).toBe('2027-04-01');
  });

  it('el último tacto ajusta la fecha y los anteriores siguen en la lista', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).send({ fecha: '2026-09-01', resultado: 'PRENADA', fechaProbableParto: '2027-04-01' }).expect(201);
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'PRENADA', fechaProbableParto: '2027-04-20' }).expect(201);
    const { situacion, eventos } = await eventosDe(agente, vaca.id);
    expect(situacion.fechaProbableParto?.fecha).toBe('2027-04-20');
    expect(eventos.map((e) => e.tacto?.fechaProbable)).toEqual(['2027-04-20', '2027-04-01']);
  });

  it('servicio anterior a un "vacía" no cuenta: "preñada" sin fecha da 400', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearServicioDirecto({ ...base, fecha: '2026-03-01' });
    await crearTactoDirecto({ ...base, fecha: '2026-04-01', resultado: 'VACIA' });
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'PRENADA' }).expect(400);
  });

  it('derivada de hace 300 días: se guarda y se informa vencida con días negativos', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-01-10' });
    // servicio + 283 = 2026-10-20: ya pasó respecto del 11/11/2026
    await agente.post(url(vaca.id)).send({ fecha: '2026-02-20', resultado: 'PRENADA' }).expect(201);
    const { situacion } = await eventosDe(agente, vaca.id);
    expect(situacion.fechaProbableParto).toEqual({ fecha: '2026-10-20', dias: -22, vencida: true });
  });

  it('fecha probable igual o anterior al tacto, o a más de 283 días: 400; a 283 días se acepta', async () => {
    const { agente, vaca } = await prepararVaca();
    for (const fechaProbableParto of ['2026-10-01', '2026-09-30', '2027-07-12']) {
      // 2026-10-01 + 284 = 2027-07-12
      const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'PRENADA', fechaProbableParto }).expect(400);
      expect(JSON.stringify(res.body)).toMatch(/fecha probable/i);
    }
    // 2026-10-01 + 283 = 2027-07-11
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'PRENADA', fechaProbableParto: '2027-07-11' }).expect(201);
  });

  it('fecha probable con formato inválido: 400', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'PRENADA', fechaProbableParto: '01/06/2027' }).expect(400);
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'PRENADA', fechaProbableParto: '2027-02-30' }).expect(400);
  });

  it('un tacto "vacía" con fecha probable: 400', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'VACIA', fechaProbableParto: '2027-05-01' }).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/vacía/i);
  });
});

describe('tacto "vacía" (RF-15)', () => {
  it('sobre una preñada deja "VACIA" sin fecha vigente; estado y lote sin cambios', async () => {
    const { agente, vaca } = await prepararVaca({ estado: 'SECA' });
    await agente.post(url(vaca.id)).send({ fecha: '2026-09-01', resultado: 'PRENADA', fechaProbableParto: '2027-05-01' }).expect(201);
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'VACIA' }).expect(201);
    const { situacion } = await eventosDe(agente, vaca.id);
    expect(situacion.estado).toBe('VACIA');
    expect(situacion.fechaProbableParto).toBeNull();
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('SECA');
  });

  it('sobre una vaca sin servicio ni preñez se acepta', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'VACIA' }).expect(201);
    expect((await eventosDe(agente, vaca.id)).situacion.estado).toBe('VACIA');
  });
});

describe('anomalías (RF-17)', () => {
  it('200 caracteres se guardan; 201 dan 400; vacías quedan en null', async () => {
    const { agente, vaca } = await prepararVaca();
    const ok = await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'VACIA', anomalias: `  ${'ñ'.repeat(200)}  ` }).expect(201);
    expect(ok.body.tacto.anomalias).toBe('ñ'.repeat(200));
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-10-02', resultado: 'VACIA', anomalias: 'a'.repeat(201) }).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/200/);
    const vacia = await agente.post(url(vaca.id)).send({ fecha: '2026-10-03', resultado: 'VACIA', anomalias: '   ' }).expect(201);
    expect(vacia.body.tacto.anomalias).toBeNull();
    const nula = await agente.post(url(vaca.id)).send({ fecha: '2026-10-04', resultado: 'VACIA', anomalias: null }).expect(201);
    expect(nula.body.tacto.anomalias).toBeNull();
  });
});

describe('reglas de fecha contra el animal (RF-18)', () => {
  it('futura, anterior al 2000, al nacimiento y al último evento: 400 con el motivo', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca({ fechaNacimiento: '2025-01-10' });
    const casos: [string, RegExp][] = [
      ['2026-11-12', /futura/],
      ['1999-12-31', /2000/],
      ['2025-01-09', /nacimiento/],
    ];
    for (const [fecha, mensaje] of casos) {
      const res = await agente.post(url(vaca.id)).send({ fecha, resultado: 'VACIA' }).expect(400);
      expect(JSON.stringify(res.body)).toMatch(mensaje);
    }
    await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-10-01' });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-09-01', resultado: 'VACIA' }).expect(400);
    expect(JSON.stringify(res.body)).toMatch(/último evento/);
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'VACIA' }).expect(201); // igual fecha
  });
});

describe('orden de controles, aislamiento y permisos (RF-27, RF-28)', () => {
  it('sin sesión: 401, también con JSON roto', async () => {
    const { vaca } = await prepararVaca();
    await request(app).post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'VACIA' }).expect(401);
    await request(app).post(url(vaca.id)).set('Content-Type', 'application/json').send('{roto').expect(401);
  });

  it('cuerpo inválido con animal inexistente: 400; animal inexistente, ajeno o mal formado: el mismo 404', async () => {
    const { agente } = await prepararVaca();
    await agente.post(url(ID_INEXISTENTE)).send({}).expect(400);
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    const ajeno = await prepararVaca({ nombreTambo: 'Ajeno', email: 'ajeno@prueba.test' });
    const cuerpo = { fecha: '2026-10-01', resultado: 'VACIA' };
    const respuestas = [];
    for (const id of [ID_INEXISTENTE, 'no-es-un-uuid', ajeno.vaca.id]) {
      respuestas.push((await agente.post(url(id)).send(cuerpo).expect(404)).body);
    }
    expect(new Set(respuestas.map((r) => JSON.stringify(r))).size).toBe(1);
    await otro.agente.post(url(ajeno.vaca.id)).send(cuerpo).expect(404);
    expect(await prisma.evento.count()).toBe(0);
  });

  it('un establecimientoId en el cuerpo se ignora', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    const res = await agente
      .post(url(vaca.id))
      .send({ fecha: '2026-10-01', resultado: 'VACIA', establecimientoId: otro.perfil.establecimiento.id })
      .expect(201);
    expect((await prisma.evento.findUniqueOrThrow({ where: { id: res.body.id } })).establecimientoId).toBe(tambo);
  });

  it.each(['ENCARGADO', 'VETERINARIO'] as const)('el %s puede registrar un tacto', async (rol) => {
    const { agente, vaca } = await prepararVaca();
    const agenteRol = await crearUsuario(agente, rol, `${rol.toLowerCase()}@prueba.test`);
    await agenteRol.post(url(vaca.id)).send({ fecha: '2026-10-01', resultado: 'VACIA' }).expect(201);
  });
});
