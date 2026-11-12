import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import {
  app,
  crearAnimalDirecto,
  crearBajaDirecta,
  crearCambioDirecto,
  crearPartoDirecto,
  crearServicioDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
  registrarTambo,
  verificarInvariantes,
} from './ayudas.js';

// Spec 005, editar un animal: PATCH /api/animales/:id y GET /api/animales/:id/cambios.
// Cubre RF-1 a RF-8, RF-14, RF-15, RF-16, RF-18 y RF-19.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
const MENSAJE_SIN_CAMBIOS = 'No hay cambios para guardar';

// Cuántas filas de historial hay en total (sirve para comprobar "no se guardó nada").
const filasHistorial = () => prisma.cambioAnimal.count();

describe('permisos y orden de controles (RF-16, RF-19)', () => {
  it('sin sesión: 401, también con JSON roto', async () => {
    const { vaca } = await prepararVaca();
    await request(app).patch(`/api/animales/${vaca.id}`).send({ numero: '9' }).expect(401);
    await request(app)
      .patch(`/api/animales/${vaca.id}`)
      .set('Content-Type', 'application/json')
      .send('{roto')
      .expect(401);
  });

  it('veterinario: 403 siempre, con datos inválidos, JSON roto, animal ajeno o inexistente', async () => {
    const { agente, vaca } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const otro = await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test' });

    await vet.patch(`/api/animales/${vaca.id}`).send({ numero: '9' }).expect(403);
    await vet.patch(`/api/animales/${vaca.id}`).send({ estado: 'SECA' }).expect(403);
    await vet.patch(`/api/animales/${vaca.id}`).set('Content-Type', 'application/json').send('{roto').expect(403);
    await vet.patch(`/api/animales/${otro.vaca.id}`).send({ numero: '9' }).expect(403);
    await vet.patch(`/api/animales/${ID_INEXISTENTE}`).send({ numero: '9' }).expect(403);
    await vet.patch('/api/animales/no-es-un-uuid').send({ numero: '9' }).expect(403);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).numero).toBe('101');
    expect(await filasHistorial()).toBe(0);
  });

  it('el encargado también edita', async () => {
    const { agente, vaca } = await prepararVaca();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');
    const res = await encargado.patch(`/api/animales/${vaca.id}`).send({ numero: '102' }).expect(200);
    expect(res.body.numero).toBe('102');
  });

  it('el formato se rechaza antes del 404 (400 con un id inexistente)', async () => {
    const { agente } = await prepararVaca();
    const res = await agente.patch(`/api/animales/${ID_INEXISTENTE}`).send({ estado: 'SECA' }).expect(400);
    expect(res.body.error).toBe('El estado no se cambia a mano: lo cambian los eventos');
    await agente.patch(`/api/animales/${ID_INEXISTENTE}`).send({ numero: null }).expect(400);
    await agente.patch(`/api/animales/${ID_INEXISTENTE}`).send({ numero: '9' }).expect(404);
  });

  it('el 404 es idéntico: inexistente, mal formado, de otro tambo y de baja', async () => {
    const { agente, tambo } = await prepararVaca();
    const otro = await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test' });
    const baja = await crearBajaDirecta(tambo, 'BAJA1');
    const respuestas = await Promise.all(
      [ID_INEXISTENTE, 'no-es-un-uuid', otro.vaca.id, baja.id].map((id) =>
        agente.patch(`/api/animales/${id}`).send({ numero: '555' }),
      ),
    );
    for (const r of respuestas) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: 'Animal no encontrado' });
    }
    // El animal del otro tambo no se tocó.
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: otro.vaca.id } })).numero).toBe('101');
  });
});

describe('formato y sin cambios (RF-1, RF-2)', () => {
  it.each([
    [{ estado: 'SECA' }, 'El estado no se cambia a mano: lo cambian los eventos'],
    [{ loteId: ID_INEXISTENTE }, 'Para cambiar de lote usá «Mover de lote»'],
    [{ id: ID_INEXISTENTE }, 'El dato «id» no se puede editar'],
    [{ cualquierCosa: 1 }, 'El dato «cualquierCosa» no se puede editar'],
    [{ numero: null }, undefined],
    [{ sexo: null }, undefined],
  ])('400 con %j', async (cuerpo, mensaje) => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.patch(`/api/animales/${vaca.id}`).send(cuerpo).expect(400);
    if (mensaje) expect(res.body.error).toBe(mensaje);
    expect(await filasHistorial()).toBe(0);
  });

  it('{} y datos iguales a los actuales: 400 "No hay cambios para guardar"', async () => {
    const { agente, vaca } = await prepararVaca({ fechaNacimiento: '2020-01-01' });
    for (const cuerpo of [{}, { numero: '101' }, { numero: ' 101 ' }, { sexo: 'HEMBRA', fechaNacimiento: '2020-01-01', madre: null }]) {
      const res = await agente.patch(`/api/animales/${vaca.id}`).send(cuerpo).expect(400);
      expect(res.body.error).toBe(MENSAJE_SIN_CAMBIOS);
    }
    expect(await filasHistorial()).toBe(0);
  });

  it('establecimientoId se ignora sin error y no cambia de tambo', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    const otro = await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test' });
    await agente.patch(`/api/animales/${vaca.id}`).send({ numero: '102', establecimientoId: otro.tambo }).expect(200);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).establecimientoId).toBe(tambo);
    // Solo con establecimientoId: no hay nada que cambiar.
    const res = await agente.patch(`/api/animales/${vaca.id}`).send({ establecimientoId: otro.tambo }).expect(400);
    expect(res.body.error).toBe(MENSAJE_SIN_CAMBIOS);
  });

  it('la respuesta es la ficha con el id del lote y sin hashes ni emails', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Enfermería' } });
    await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: lote.id } });
    const res = await agente.patch(`/api/animales/${vaca.id}`).send({ numero: '102' }).expect(200);
    expect(res.body).toMatchObject({ id: vaca.id, numero: '102', lote: { id: lote.id, nombre: 'Enfermería' } });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|email|password|@/i);
  });
});

describe('número (RF-3)', () => {
  it('se guarda normalizado y el buscador usa el nuevo', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.patch(`/api/animales/${vaca.id}`).send({ numero: '  ab-7 ' }).expect(200);
    expect(res.body.numero).toBe('AB-7');
    await agente.get('/api/animales/buscar?numero=101').expect(404);
    const nuevo = await agente.get('/api/animales/buscar?numero=ab-7').expect(200);
    expect(nuevo.body.id).toBe(vaca.id);
  });

  it.each([['   '], ['A'.repeat(21)], ['A B'], ['Ñ5']])('número inválido %j: 400', async (numero) => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.patch(`/api/animales/${vaca.id}`).send({ numero }).expect(400);
    expect(typeof res.body.error).toBe('string');
    expect(await filasHistorial()).toBe(0);
  });

  it('repetido entre activos: 409; de una baja o de otro tambo: se acepta', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    await crearAnimalDirecto(tambo, '200');
    await crearBajaDirecta(tambo, '300');
    await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test', numero: '400' });

    const dup = await agente.patch(`/api/animales/${vaca.id}`).send({ numero: '200' }).expect(409);
    expect(dup.body.error).toBe('Ya existe un animal activo con ese número');
    await agente.patch(`/api/animales/${vaca.id}`).send({ numero: '300' }).expect(200);
    await agente.patch(`/api/animales/${vaca.id}`).send({ numero: '400' }).expect(200);
  });

  it('solo cambian mayúsculas: queda igual y es "sin cambios"', async () => {
    const { agente, vaca } = await prepararVaca({ numero: 'ABC' });
    const res = await agente.patch(`/api/animales/${vaca.id}`).send({ numero: 'abc' }).expect(400);
    expect(res.body.error).toBe(MENSAJE_SIN_CAMBIOS);
  });
});

describe('sexo (RF-4)', () => {
  it('hembra recién nacida sin eventos ni crías pasa a macho', async () => {
    const { agente, vaca } = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    const res = await agente.patch(`/api/animales/${vaca.id}`).send({ sexo: 'MACHO' }).expect(200);
    expect(res.body.sexo).toBe('MACHO');
  });

  it('vaca en ordeñe a macho: 400 (sexo-estado)', async () => {
    const { agente, vaca } = await prepararVaca({ estado: 'EN_ORDENE' });
    await agente.patch(`/api/animales/${vaca.id}`).send({ sexo: 'MACHO' }).expect(400);
  });

  it('con un servicio no anulado: 409; con el servicio anulado: se acepta', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-10-01' });
    const res = await agente.patch(`/api/animales/${vaca.id}`).send({ sexo: 'MACHO' }).expect(409);
    expect(typeof res.body.error).toBe('string');

    await prisma.evento.updateMany({
      where: { animalId: vaca.id },
      data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'Error' },
    });
    await agente.patch(`/api/animales/${vaca.id}`).send({ sexo: 'MACHO' }).expect(200);
  });

  it('con una cría dada de baja también cuenta: 409', async () => {
    const { agente, vaca, tambo } = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    await crearBajaDirecta(tambo, 'CRIA', { madreId: vaca.id, motivoBaja: 'PARTO_ANULADO' });
    await agente.patch(`/api/animales/${vaca.id}`).send({ sexo: 'MACHO' }).expect(409);
  });

  it('sexo inválido: 400', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.patch(`/api/animales/${vaca.id}`).send({ sexo: 'hembra' }).expect(400);
  });
});

describe('fecha de nacimiento (RF-5)', () => {
  it('hoy se acepta; mañana, 31/12/1999 y una fecha imposible dan 400', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.patch(`/api/animales/${vaca.id}`).send({ fechaNacimiento: '2026-11-11' }).expect(200);
    await agente.patch(`/api/animales/${vaca.id}`).send({ fechaNacimiento: '2026-11-12' }).expect(400);
    await agente.patch(`/api/animales/${vaca.id}`).send({ fechaNacimiento: '1999-12-31' }).expect(400);
    await agente.patch(`/api/animales/${vaca.id}`).send({ fechaNacimiento: '2021-02-31' }).expect(400);
  });

  it('se puede vaciar y queda "sin dato"', async () => {
    const { agente, vaca } = await prepararVaca({ fechaNacimiento: '2020-01-01' });
    const res = await agente.patch(`/api/animales/${vaca.id}`).send({ fechaNacimiento: null }).expect(200);
    expect(res.body.fechaNacimiento).toBeNull();
    const cambios = await prisma.cambioAnimal.findMany();
    expect(cambios).toHaveLength(1);
    expect(cambios[0]).toMatchObject({ campo: 'FECHA_NACIMIENTO', valorAnterior: '2020-01-01', valorNuevo: null });
  });

  it('contra la madre: igual o anterior da 400; posterior se acepta', async () => {
    const { agente, tambo } = await prepararVaca();
    const madre = await crearAnimalDirecto(tambo, 'M1', { fechaNacimiento: '2020-06-01' });
    const hija = await crearAnimalDirecto(tambo, 'H1', { madreId: madre.id });
    await agente.patch(`/api/animales/${hija.id}`).send({ fechaNacimiento: '2020-06-01' }).expect(400);
    await agente.patch(`/api/animales/${hija.id}`).send({ fechaNacimiento: '2020-01-01' }).expect(400);
    await agente.patch(`/api/animales/${hija.id}`).send({ fechaNacimiento: '2020-06-02' }).expect(200);
  });

  it('posterior a un evento o a la fecha de una cría: se acepta (no se valida)', async () => {
    const { agente, vaca, tambo } = await prepararVaca({ fechaNacimiento: '2018-01-01' });
    await crearAnimalDirecto(tambo, 'CRIA', { madreId: vaca.id, fechaNacimiento: '2022-01-01' });
    await agente.patch(`/api/animales/${vaca.id}`).send({ fechaNacimiento: '2025-01-01' }).expect(200);
  });
});

describe('madre (RF-6)', () => {
  it('se asigna por número, se cambia y se quita con null', async () => {
    const { agente, tambo } = await prepararVaca();
    const m1 = await crearAnimalDirecto(tambo, 'M1');
    const m2 = await crearAnimalDirecto(tambo, 'M2');
    const hija = await crearAnimalDirecto(tambo, 'H1');

    const r1 = await agente.patch(`/api/animales/${hija.id}`).send({ madre: ' m1 ' }).expect(200);
    expect(r1.body.madre).toMatchObject({ id: m1.id, numero: 'M1' });
    await agente.patch(`/api/animales/${hija.id}`).send({ madre: 'M2' }).expect(200);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: hija.id } })).madreId).toBe(m2.id);
    const r3 = await agente.patch(`/api/animales/${hija.id}`).send({ madre: null }).expect(200);
    expect(r3.body.madre).toBeNull();

    const historial = await prisma.cambioAnimal.findMany({ orderBy: { creadoEn: 'asc' } });
    expect(historial.map((c) => [c.valorAnterior, c.valorNuevo])).toEqual([
      [null, 'M1'],
      ['M1', 'M2'],
      ['M2', null],
    ]);
  });

  it('inexistente, de otro tambo y de baja: el mismo mensaje genérico', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await crearBajaDirecta(tambo, 'B1');
    await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test', numero: 'AJENA' });
    const mensajes: string[] = [];
    for (const numero of ['NOEXISTE', 'AJENA', 'B1']) {
      const res = await agente.patch(`/api/animales/${vaca.id}`).send({ madre: numero }).expect(400);
      mensajes.push(res.body.error);
    }
    expect(mensajes).toEqual([
      'No hay una hembra activa con el número NOEXISTE',
      'No hay una hembra activa con el número AJENA',
      'No hay una hembra activa con el número B1',
    ]);
  });

  it('macho, el mismo animal, cría y nieta: mensajes propios, todos 400', async () => {
    const { agente, tambo, vaca } = await prepararVaca({ numero: 'A' });
    await crearAnimalDirecto(tambo, 'TORO', { sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
    const hija = await crearAnimalDirecto(tambo, 'B', { madreId: vaca.id });
    await crearAnimalDirecto(tambo, 'C', { madreId: hija.id });

    const macho = await agente.patch(`/api/animales/${vaca.id}`).send({ madre: 'TORO' }).expect(400);
    expect(macho.body.error).toContain('macho');
    const propia = await agente.patch(`/api/animales/${vaca.id}`).send({ madre: 'A' }).expect(400);
    expect(propia.body.error).toBe('Un animal no puede ser su propia madre');
    const directo = await agente.patch(`/api/animales/${vaca.id}`).send({ madre: 'B' }).expect(400);
    expect(directo.body.error).toBe('B ya es descendiente de este animal');
    const indirecto = await agente.patch(`/api/animales/${vaca.id}`).send({ madre: 'C' }).expect(400);
    expect(indirecto.body.error).toBe('C ya es descendiente de este animal');
    expect(await verificarInvariantes()).toEqual([]);
  });

  it('madre nacida el mismo día o después: 400; anterior: se acepta', async () => {
    const { agente, tambo } = await prepararVaca();
    const hija = await crearAnimalDirecto(tambo, 'H', { fechaNacimiento: '2022-05-05' });
    await crearAnimalDirecto(tambo, 'IGUAL', { fechaNacimiento: '2022-05-05' });
    await crearAnimalDirecto(tambo, 'DESPUES', { fechaNacimiento: '2023-01-01' });
    await crearAnimalDirecto(tambo, 'ANTES', { fechaNacimiento: '2020-01-01' });
    await agente.patch(`/api/animales/${hija.id}`).send({ madre: 'IGUAL' }).expect(400);
    await agente.patch(`/api/animales/${hija.id}`).send({ madre: 'DESPUES' }).expect(400);
    await agente.patch(`/api/animales/${hija.id}`).send({ madre: 'ANTES' }).expect(200);
  });

  it('el pedido con una nueva fecha y una nueva madre se valida junto', async () => {
    const { agente, tambo } = await prepararVaca();
    const hija = await crearAnimalDirecto(tambo, 'H', { fechaNacimiento: '2022-05-05' });
    await crearAnimalDirecto(tambo, 'M', { fechaNacimiento: '2021-01-01' });
    // La fecha nueva (2020) es anterior a la de la madre nueva (2021): 400 de la fecha.
    const res = await agente.patch(`/api/animales/${hija.id}`).send({ fechaNacimiento: '2020-01-01', madre: 'M' }).expect(400);
    expect(res.body.error).toMatch(/posterior a la de la madre/);
  });
});

describe('cría de parto (RF-7)', () => {
  async function criaDeParto() {
    const t = await prepararVaca({ numero: 'MADRE' });
    await crearPartoDirecto({
      establecimientoId: t.tambo,
      animalId: t.vaca.id,
      registradoPorId: t.usuarioId,
      fecha: '2026-11-01',
      crias: [{ sexo: 'HEMBRA', numero: 'CRIA1' }],
    });
    const cria = await prisma.animal.findFirstOrThrow({ where: { numero: 'CRIA1' } });
    return { ...t, cria };
  }

  it('solo cambia el número', async () => {
    const { agente, cria } = await criaDeParto();
    const res = await agente.patch(`/api/animales/${cria.id}`).send({ numero: 'CRIA9' }).expect(200);
    expect(res.body.numero).toBe('CRIA9');
  });

  it('sexo, fecha o madre (aun null) dan 409, aunque venga con un número válido', async () => {
    const { agente, cria } = await criaDeParto();
    for (const cuerpo of [{ sexo: 'MACHO' }, { fechaNacimiento: '2026-10-01' }, { fechaNacimiento: null }, { madre: null }, { numero: 'X9', madre: null }]) {
      const res = await agente.patch(`/api/animales/${cria.id}`).send(cuerpo).expect(409);
      expect(res.body.error).toMatch(/vienen del parto/);
    }
    expect(await filasHistorial()).toBe(0);
  });
});

describe('todo o nada (RF-8)', () => {
  it('un número repetido con otros campos válidos no guarda ni campos ni historial', async () => {
    const { agente, vaca, tambo } = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    await crearAnimalDirecto(tambo, '200');
    await agente
      .patch(`/api/animales/${vaca.id}`)
      .send({ numero: '200', sexo: 'MACHO', fechaNacimiento: '2024-01-01' })
      .expect(409);
    const guardado = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(guardado).toMatchObject({ numero: '101', sexo: 'HEMBRA', fechaNacimiento: null });
    expect(await filasHistorial()).toBe(0);
  });
});

describe('orden de rechazos (RF-16)', () => {
  it('sexo con eventos y fecha inválida: gana el 400 de la fecha', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-10-01' });
    const res = await agente.patch(`/api/animales/${vaca.id}`).send({ sexo: 'MACHO', fechaNacimiento: '2026-12-31' }).expect(400);
    expect(res.body.error).toMatch(/futura/);
  });

  it('cría de parto con sexo y número repetido: gana el 409 de la cría de parto', async () => {
    const t = await prepararVaca({ numero: 'MADRE' });
    await crearPartoDirecto({ establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId, fecha: '2026-11-01', crias: [{ numero: 'CRIA1' }] });
    const cria = await prisma.animal.findFirstOrThrow({ where: { numero: 'CRIA1' } });
    const res = await t.agente.patch(`/api/animales/${cria.id}`).send({ sexo: 'MACHO', numero: 'MADRE' }).expect(409);
    expect(res.body.error).toMatch(/vienen del parto/);
  });

  it('número repetido y sexo con eventos: gana el de sexo', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    await crearAnimalDirecto(tambo, '200');
    await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-10-01' });
    const res = await agente.patch(`/api/animales/${vaca.id}`).send({ numero: '200', sexo: 'MACHO' }).expect(409);
    expect(res.body.error).toMatch(/sexo/);
  });

  it('madre inexistente y número repetido: gana el 400 de la madre', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    await crearAnimalDirecto(tambo, '200');
    const res = await agente.patch(`/api/animales/${vaca.id}`).send({ numero: '200', madre: 'NOEXISTE' }).expect(400);
    expect(res.body.error).toBe('No hay una hembra activa con el número NOEXISTE');
  });

  it('401 antes que 403 y 403 antes que 400', async () => {
    const { agente, vaca } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    await request(app).patch(`/api/animales/${vaca.id}`).send({ estado: 'X' }).expect(401);
    await vet.patch(`/api/animales/${vaca.id}`).send({ estado: 'X' }).expect(403);
    await agente.patch(`/api/animales/${vaca.id}`).send({ estado: 'X' }).expect(400);
  });
});

describe('historial: escritura (RF-14)', () => {
  it('una fila por dato cambiado, con antes, después, nombre e id y el mismo momento', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca({ estado: 'RECIEN_NACIDO', fechaNacimiento: '2026-01-01' });
    await crearAnimalDirecto(tambo, 'M', { fechaNacimiento: '2020-01-01' });
    await agente
      .patch(`/api/animales/${vaca.id}`)
      .send({ madre: 'M', fechaNacimiento: '2026-02-02', sexo: 'MACHO', numero: '555' })
      .expect(200);
    const filas = await prisma.cambioAnimal.findMany();
    expect(filas).toHaveLength(4);
    expect(new Set(filas.map((f) => f.creadoEn.getTime())).size).toBe(1);
    for (const f of filas) {
      expect(f).toMatchObject({ animalId: vaca.id, establecimientoId: tambo, usuarioId, usuarioNombre: 'Dueño' });
    }
    const por = Object.fromEntries(filas.map((f) => [f.campo, [f.valorAnterior, f.valorNuevo]]));
    expect(por).toEqual({
      NUMERO: ['101', '555'],
      SEXO: ['hembra', 'macho'],
      FECHA_NACIMIENTO: ['2026-01-01', '2026-02-02'],
      MADRE: [null, 'M'],
    });
  });

  it('un campo omitido o sin cambio real no genera fila', async () => {
    const { agente, vaca } = await prepararVaca({ fechaNacimiento: '2020-01-01' });
    await agente.patch(`/api/animales/${vaca.id}`).send({ numero: '102', fechaNacimiento: '2020-01-01' }).expect(200);
    const filas = await prisma.cambioAnimal.findMany();
    expect(filas.map((f) => f.campo)).toEqual(['NUMERO']);
  });

  it('el momento nunca es anterior al del último evento del animal', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const futuro = new Date(Date.now() + 60 * 60 * 1000);
    await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-10-01', creadoEn: futuro });
    await agente.patch(`/api/animales/${vaca.id}`).send({ numero: '102' }).expect(200);
    const fila = await prisma.cambioAnimal.findFirstOrThrow();
    expect(fila.creadoEn.getTime()).toBeGreaterThan(futuro.getTime());
  });
});

describe('historial: lectura (RF-15, RF-18, RF-19)', () => {
  it('más nuevo primero y, dentro de un guardado, en orden fijo de campo', async () => {
    const { agente, vaca, tambo } = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    await crearAnimalDirecto(tambo, 'M', { fechaNacimiento: '2020-01-01' });
    await agente.patch(`/api/animales/${vaca.id}`).send({ numero: '102' }).expect(200);
    await agente.patch(`/api/animales/${vaca.id}`).send({ madre: 'M', sexo: 'MACHO', numero: '103' }).expect(200);

    const res = await agente.get(`/api/animales/${vaca.id}/cambios`).expect(200);
    expect(res.body.total).toBe(4);
    expect(res.body.cambios.map((c: { campo: string }) => c.campo)).toEqual(['NUMERO', 'SEXO', 'MADRE', 'NUMERO']);
    expect(res.body.cambios[0]).toMatchObject({ valorAnterior: '102', valorNuevo: '103', usuarioNombre: 'Dueño' });
    expect(res.body.cambios[3]).toMatchObject({ valorAnterior: '101', valorNuevo: '102' });
    expect(res.body.cambios[0]).toHaveProperty('creadoEn');
  });

  it('tope de 100 con el total', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    const base = Date.now() - 1000 * 1000;
    for (let i = 0; i < 105; i++) {
      await crearCambioDirecto(tambo, vaca.id, { valorAnterior: `V${i}`, valorNuevo: `V${i + 1}`, creadoEn: new Date(base + i * 1000) });
    }
    const res = await agente.get(`/api/animales/${vaca.id}/cambios`).expect(200);
    expect(res.body.total).toBe(105);
    expect(res.body.cambios).toHaveLength(100);
    expect(res.body.cambios[0].valorNuevo).toBe('V105'); // el más nuevo
  });

  it('los textos son copias: se leen aunque el lote o la madre ya no existan', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    await crearCambioDirecto(tambo, vaca.id, { campo: 'LOTE', valorAnterior: 'Lote eliminado', valorNuevo: null });
    await crearCambioDirecto(tambo, vaca.id, { campo: 'MADRE', valorAnterior: 'M-DE-BAJA', valorNuevo: null, creadoEn: new Date(Date.now() - 5000) });
    const res = await agente.get(`/api/animales/${vaca.id}/cambios`).expect(200);
    expect(res.body.cambios.map((c: { valorAnterior: string }) => c.valorAnterior)).toEqual(['Lote eliminado', 'M-DE-BAJA']);
  });

  it('los tres roles leen; sin sesión 401; sin hashes ni emails', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    await crearCambioDirecto(tambo, vaca.id);
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const enc = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');
    await request(app).get(`/api/animales/${vaca.id}/cambios`).expect(401);
    for (const a of [agente, vet, enc]) {
      const res = await a.get(`/api/animales/${vaca.id}/cambios`).expect(200);
      expect(res.body.cambios).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toMatch(/hash|password|@/i);
    }
  });

  it('el historial de otro tambo no se ve: 404 idéntico para ajeno, inexistente, mal formado y de baja', async () => {
    const { agente, tambo } = await prepararVaca();
    const otro = await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test' });
    await crearCambioDirecto(otro.tambo, otro.vaca.id);
    const baja = await crearBajaDirecta(tambo, 'B');
    for (const id of [otro.vaca.id, ID_INEXISTENTE, 'no-es-un-uuid', baja.id]) {
      const res = await agente.get(`/api/animales/${id}/cambios`).expect(404);
      expect(res.body).toEqual({ error: 'Animal no encontrado' });
    }
  });
});

describe('aislamiento entre tambos (RF-18)', () => {
  it('la madre se busca solo en el tambo propio y el número en el tambo propio', async () => {
    const a = await prepararVaca({ numero: 'X' });
    const b = await registrarTambo('Tambo B', 'b@prueba.test');
    const hembraB = await crearAnimalDirecto(b.perfil.establecimiento.id, 'MB');
    const res = await a.agente.patch(`/api/animales/${a.vaca.id}`).send({ madre: 'MB' }).expect(400);
    expect(res.body.error).toBe('No hay una hembra activa con el número MB');
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: a.vaca.id } })).madreId).toBeNull();
    expect(hembraB.id).toBeTruthy();
  });
});
