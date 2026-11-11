import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { sumarDias } from '../src/reproduccion/fechas.js';
import {
  app,
  crearAnimalDirecto,
  crearPartoDirecto,
  crearSecadoDirecto,
  crearSemenDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
  registrarTambo,
  verificarInvariantes,
} from './ayudas.js';

// Tests de POST /api/animales/:id/partos: RF-1 a RF-17, RF-21, RF-41 y RF-42 (spec 004).

beforeEach(() => {
  // "Hoy" en Argentina = 11/11/2026, así las fechas de los tests no dependen del día real.
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';

type Agente = ReturnType<typeof request.agent>;
const url = (animalId: string) => `/api/animales/${animalId}/partos`;
const viva = (numero: string, sexo: 'HEMBRA' | 'MACHO' = 'HEMBRA') => ({ sexo, numero });
const muerta = (sexo: 'HEMBRA' | 'MACHO' = 'MACHO', observaciones?: string) => ({ sexo, nacidaMuerta: true, observaciones });
const loteDe = (establecimientoId: string, nombre: string) => prisma.lote.findFirstOrThrow({ where: { establecimientoId, nombre } });
const situacionDe = async (agente: Agente, animalId: string) =>
  (await agente.get(`/api/animales/${animalId}/eventos`).expect(200)).body.situacion;
const contar = async (tambo: string) => ({
  animales: await prisma.animal.count({ where: { establecimientoId: tambo } }),
  eventos: await prisma.evento.count({ where: { establecimientoId: tambo } }),
  partos: await prisma.parto.count({ where: { establecimientoId: tambo } }),
  crias: await prisma.criaParto.count({ where: { establecimientoId: tambo } }),
});

describe('registrar un parto (RF-1, RF-2, RF-3)', () => {
  it.each(['VAQUILLONA', 'EN_ORDENE', 'SECA'] as const)(
    'una hembra %s con una cría viva: 201, la madre queda en ordeñe en su lote y la cría recién nacida',
    async (estado) => {
      const { agente, tambo, vaca, usuarioId } = await prepararVaca({ estado });
      const previo = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Previo' } });
      await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: previo.id } });
      const ordene = await loteDe(tambo, 'En ordeñe');
      const terneros = await loteDe(tambo, 'Terneros');

      const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('c1', 'MACHO')] }).expect(201);
      // Sin servicio cargado el parto no tiene genética (aviso 4); no hay avisos de lote.
      expect(res.body.avisos.map((a: { codigo: string }) => a.codigo)).toEqual(['SIN_GENETICA_SIN_SERVICIO']);
      expect(res.body.evento).toMatchObject({
        tipo: 'PARTO',
        fecha: '2026-11-01',
        registradoPor: 'Dueño',
        anulacion: null,
        parto: {
          estadoAnterior: estado,
          loteAnterior: { id: previo.id, nombre: 'Previo' },
          genetica: null,
          crias: [{ orden: 1, sexo: 'MACHO', nacidaMuerta: false, observaciones: null, animal: { numero: 'C1', activo: true } }],
        },
      });

      // La madre: estado y lote nuevos, aunque ya estuviera en ordeñe.
      const madre = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
      expect(madre.estado).toBe('EN_ORDENE');
      expect(madre.loteId).toBe(ordene.id);

      // El parto guarda lo que había antes.
      const parto = await prisma.parto.findUniqueOrThrow({ where: { eventoId: res.body.evento.id } });
      expect(parto).toMatchObject({ madreId: vaca.id, estadoAnterior: estado, tuvoLoteAnterior: true, loteAnteriorId: previo.id });
      const evento = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.evento.id } });
      expect(evento.registradoPorId).toBe(usuarioId);

      // La cría: animal nuevo, recién nacido, con la fecha del parto, la madre y el lote de terneros.
      const cria = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: tambo, numero: 'C1' } });
      expect(cria).toMatchObject({ estado: 'RECIEN_NACIDO', sexo: 'MACHO', madreId: vaca.id, loteId: terneros.id });
      expect(cria.fechaNacimiento?.toISOString().slice(0, 10)).toBe('2026-11-01');
      const fila = await prisma.criaParto.findUniqueOrThrow({ where: { animalId: cria.id } });
      expect(fila).toMatchObject({ eventoId: res.body.evento.id, madreId: vaca.id, orden: 1, nacidaMuerta: false });
      expect(await verificarInvariantes()).toEqual([]);
    },
  );

  it('una vaca sin lote previo: guarda "sin lote previo" y el parto lo muestra así', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('A1')] }).expect(201);
    expect(res.body.evento.parto.loteAnterior).toBe('SIN_LOTE');
  });

  it('dos crías vivas: las dos se dan de alta con la misma madre, en orden', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    const res = await agente
      .post(url(vaca.id))
      .send({ fecha: '2026-11-01', crias: [viva('g1', 'HEMBRA'), viva('G2', 'MACHO')] })
      .expect(201);
    expect(res.body.evento.parto.crias.map((c: { orden: number; animal: { numero: string } }) => [c.orden, c.animal.numero])).toEqual([
      [1, 'G1'],
      [2, 'G2'],
    ]);
    const crias = await prisma.animal.findMany({ where: { establecimientoId: tambo, madreId: vaca.id }, orderBy: { numero: 'asc' } });
    expect(crias.map((c) => [c.numero, c.estado, c.sexo])).toEqual([
      ['G1', 'RECIEN_NACIDO', 'HEMBRA'],
      ['G2', 'RECIEN_NACIDO', 'MACHO'],
    ]);
    expect(await prisma.criaParto.count({ where: { eventoId: res.body.evento.id } })).toBe(2);
  });

  it('una viva y una nacida muerta: solo la viva es un animal; la muerta queda en el parto con sexo y observaciones', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    const res = await agente
      .post(url(vaca.id))
      .send({ fecha: '2026-11-01', crias: [viva('V1'), muerta('MACHO', '  Nació sin vida  ')] })
      .expect(201);
    expect(res.body.evento.parto.crias).toMatchObject([
      { orden: 1, nacidaMuerta: false, animal: { numero: 'V1' } },
      { orden: 2, sexo: 'MACHO', nacidaMuerta: true, observaciones: 'Nació sin vida', animal: null },
    ]);
    expect(await prisma.animal.count({ where: { establecimientoId: tambo, madreId: vaca.id } })).toBe(1);
    const filas = await prisma.criaParto.findMany({ where: { eventoId: res.body.evento.id }, orderBy: { orden: 'asc' } });
    expect(filas.map((f) => [f.nacidaMuerta, f.animalId === null])).toEqual([
      [false, false],
      [true, true],
    ]);
  });

  it('todas muertas: no se da de alta ningún animal y la madre pasa igual a "en ordeñe" y a su lote', async () => {
    const { agente, tambo, vaca } = await prepararVaca({ estado: 'SECA' });
    const antes = await prisma.animal.count({ where: { establecimientoId: tambo } });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [muerta('HEMBRA'), muerta('MACHO')] }).expect(201);
    expect(res.body.avisos).toEqual([{ codigo: 'SIN_GENETICA_SIN_SERVICIO', mensaje: expect.any(String) }]);
    expect(await prisma.animal.count({ where: { establecimientoId: tambo } })).toBe(antes);
    const madre = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(madre.estado).toBe('EN_ORDENE');
    expect(madre.loteId).toBe((await loteDe(tambo, 'En ordeñe')).id);
  });

  it('una vaca ya en ordeñe en otro lote: sigue en ordeñe y pasa al lote destino', async () => {
    const { agente, tambo, vaca } = await prepararVaca({ estado: 'EN_ORDENE' });
    const otro = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Otro' } });
    await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: otro.id } });
    await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('X1')] }).expect(201);
    const madre = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(madre).toMatchObject({ estado: 'EN_ORDENE', loteId: (await loteDe(tambo, 'En ordeñe')).id });
  });

  it('la respuesta y la base no exponen hashes ni emails', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('H1')] }).expect(201);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toMatch(/hash|dueno@prueba|email/i);
  });
});

describe('datos de las crías (RF-5, RF-6, RF-7)', () => {
  it.each([
    ['sin crías', { fecha: '2026-11-01', crias: [] }],
    ['sin la lista', { fecha: '2026-11-01' }],
    ['crías que no es lista', { fecha: '2026-11-01', crias: 'una' }],
    ['tres crías', { fecha: '2026-11-01', crias: [viva('A'), viva('B'), viva('C')] }],
    ['cría sin sexo', { fecha: '2026-11-01', crias: [{ numero: 'A' }] }],
    ['sexo inválido', { fecha: '2026-11-01', crias: [{ numero: 'A', sexo: 'OTRO' }] }],
    ['nació muerta como texto', { fecha: '2026-11-01', crias: [{ numero: 'A', sexo: 'HEMBRA', nacidaMuerta: 'si' }] }],
    ['nació muerta como número', { fecha: '2026-11-01', crias: [{ numero: 'A', sexo: 'HEMBRA', nacidaMuerta: 1 }] }],
    ['muerta con número', { fecha: '2026-11-01', crias: [{ numero: 'A', sexo: 'HEMBRA', nacidaMuerta: true }] }],
    ['viva sin número', { fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA' }] }],
    ['número inválido', { fecha: '2026-11-01', crias: [{ numero: 'A B', sexo: 'HEMBRA' }] }],
    ['número con tilde', { fecha: '2026-11-01', crias: [{ numero: 'Ñandú', sexo: 'HEMBRA' }] }],
    ['número de 21 caracteres', { fecha: '2026-11-01', crias: [viva('A'.repeat(21))] }],
    ['observaciones de 201 caracteres', { fecha: '2026-11-01', crias: [{ ...viva('A'), observaciones: 'x'.repeat(201) }] }],
    ['la misma cría repetida en mayúsculas y minúsculas', { fecha: '2026-11-01', crias: [viva('ab-1'), viva('AB-1')] }],
    ['sin fecha', { crias: [viva('A')] }],
    ['fecha con formato inválido', { fecha: '01/11/2026', crias: [viva('A')] }],
    ['fecha inexistente', { fecha: '2026-02-30', crias: [viva('A')] }],
  ])('%s: 400 y no se guarda nada', async (_nombre, cuerpo) => {
    const { agente, tambo, vaca } = await prepararVaca({ estado: 'VAQUILLONA' });
    const antes = await contar(tambo);
    const res = await agente.post(url(vaca.id)).send(cuerpo).expect(400);
    expect(typeof res.body.error).toBe('string');
    expect(await contar(tambo)).toEqual(antes);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('VAQUILLONA');
  });

  it('"nació muerta" ausente se toma como falso', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: 'N1' }] }).expect(201);
    expect(res.body.evento.parto.crias[0].nacidaMuerta).toBe(false);
  });

  it('observaciones: 200 caracteres se aceptan, se recortan y vacías o solo espacios quedan en "sin observaciones"', async () => {
    const { agente, vaca } = await prepararVaca();
    const largo = 'x'.repeat(200);
    const res = await agente
      .post(url(vaca.id))
      .send({
        fecha: '2026-11-01',
        crias: [
          { ...viva('O1'), observaciones: ` ${largo} ` },
          { ...muerta('MACHO'), observaciones: '   ' },
        ],
      })
      .expect(201);
    expect(res.body.evento.parto.crias.map((c: { observaciones: string | null }) => c.observaciones)).toEqual([largo, null]);
    const filas = await prisma.criaParto.findMany({ where: { eventoId: res.body.evento.id }, orderBy: { orden: 'asc' } });
    expect(filas.map((f) => f.observaciones)).toEqual([largo, null]);
  });

  it('un campo no previsto en la cría o en el cuerpo se ignora', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente
      .post(url(vaca.id))
      .send({ fecha: '2026-11-01', raro: 1, crias: [{ ...viva('R1'), color: 'negro' }] })
      .expect(201);
  });

  it('la cría muerta con número vacío o nulo se acepta (la web no lo manda)', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [{ sexo: 'MACHO', nacidaMuerta: true, numero: '' }] }).expect(201);
  });
});

describe('número de la cría (RF-8) y todo o nada (RF-4)', () => {
  it('un número que ya existe entre los activos: 409 completo, sin guardar madre ni crías', async () => {
    const { agente, tambo, vaca } = await prepararVaca({ estado: 'VAQUILLONA' });
    await crearAnimalDirecto(tambo, '500');
    const antes = await contar(tambo);
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('500')] }).expect(409);
    expect(res.body.error).toBe('Ya existe un animal activo con ese número');
    expect(await contar(tambo)).toEqual(antes);
    const madre = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(madre).toMatchObject({ estado: 'VAQUILLONA', loteId: null });
  });

  it('con dos crías y la segunda repetida: no queda la primera (todo o nada)', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await crearAnimalDirecto(tambo, '501');
    const antes = await contar(tambo);
    await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('600'), viva('501')] }).expect(409);
    expect(await contar(tambo)).toEqual(antes);
    expect(await prisma.animal.findFirst({ where: { establecimientoId: tambo, numero: '600' } })).toBeNull();
  });

  it('el número de un animal de baja no choca, y el de otro tambo tampoco', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await crearAnimalDirecto(tambo, '700', { estado: 'BAJA' });
    const otro = await registrarTambo('Otro tambo', 'otro@prueba.test');
    await crearAnimalDirecto(otro.perfil.establecimiento.id, '701');
    await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('700'), viva('701')] }).expect(201);
  });

  it('el número se compara sin distinguir mayúsculas (el existente es "AB1" y llega "ab1")', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await crearAnimalDirecto(tambo, 'AB1');
    await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('ab1')] }).expect(409);
  });
});

describe('madre no apta y fechas (RF-9, RF-10, RF-21)', () => {
  it('un macho: 409 con el motivo', async () => {
    const { agente, vaca } = await prepararVaca({ sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('A')] }).expect(409);
    expect(res.body.error).toMatch(/macho/i);
  });

  it('una recién nacida: 409 con el motivo', async () => {
    const { agente, vaca } = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('A')] }).expect(409);
    expect(res.body.error).toMatch(/recién nacida/i);
  });

  it('un animal de baja, uno de otro tambo, uno inexistente y un id mal formado dan el mismo 404', async () => {
    const { agente, tambo } = await prepararVaca();
    const baja = await crearAnimalDirecto(tambo, '9', { estado: 'BAJA' });
    const ajeno = await prepararVaca({ nombreTambo: 'Ajeno', email: 'ajeno@prueba.test' });
    const cuerpo = { fecha: '2026-11-01', crias: [viva('A')] };
    const respuestas = [
      await agente.post(url(baja.id)).send(cuerpo).expect(404),
      await agente.post(url(ajeno.vaca.id)).send(cuerpo).expect(404),
      await agente.post(url(ID_INEXISTENTE)).send(cuerpo).expect(404),
      await agente.post(url('no-es-un-id')).send(cuerpo).expect(404),
    ];
    expect(new Set(respuestas.map((r) => r.body.error)).size).toBe(1);
  });

  it('cuerpo inválido con un animal inexistente: 400 (la validación va antes que la búsqueda)', async () => {
    const { agente } = await prepararVaca();
    await agente.post(url(ID_INEXISTENTE)).send({ fecha: '2026-11-01', crias: [] }).expect(400);
  });

  it('la fecha no puede ser igual ni anterior al nacimiento de la madre; posterior se acepta', async () => {
    const { agente, vaca } = await prepararVaca({ fechaNacimiento: '2024-05-10' });
    for (const fecha of ['2024-05-10', '2024-05-09']) {
      const res = await agente.post(url(vaca.id)).send({ fecha, crias: [viva('A')] }).expect(400);
      expect(res.body.detalles[0].campo).toBe('fecha');
    }
    await agente.post(url(vaca.id)).send({ fecha: '2024-05-11', crias: [viva('A')] }).expect(201);
  });

  it('fecha futura (con el reloj fijo), anterior a 2000 y anterior al último evento: 400; igual fecha: se acepta', async () => {
    const { agente, tambo, vaca, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearTactoDirecto({ ...base, fecha: '2026-10-01', resultado: 'VACIA' });
    for (const fecha of ['2026-11-12', '1999-12-31', '2026-09-30']) {
      const res = await agente.post(url(vaca.id)).send({ fecha, crias: [viva('A')] }).expect(400);
      expect(res.body.detalles[0].campo).toBe('fecha');
    }
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-01', crias: [viva('A')] }).expect(201);
  });

  it('la fecha no puede ser anterior a un secado registrado (el último evento cuenta los cuatro tipos)', async () => {
    const { agente, tambo, vaca, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearSecadoDirecto({ ...base, fecha: '2026-10-20' });
    await agente.post(url(vaca.id)).send({ fecha: '2026-10-19', crias: [viva('A')] }).expect(400);
  });
});

describe('separación de 200 días entre partos (RF-11)', () => {
  async function conPartoPrevio(anulado = false) {
    const t = await prepararVaca();
    const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
    await crearPartoDirecto({
      ...base,
      fecha: '2026-04-25',
      ...(anulado && { anulacion: { porId: t.usuarioId, motivo: 'Error' } }),
    });
    return t;
  }

  it('a 199 días: 409 con la fecha del parto existente y la sugerencia del tacto "vacía"; a 200 se acepta', async () => {
    const { agente, vaca } = await conPartoPrevio();
    const res = await agente.post(url(vaca.id)).send({ fecha: sumarDias('2026-04-25', 199), crias: [viva('A')] }).expect(409);
    expect(res.body.error).toContain('25/04/2026');
    expect(res.body.error).toContain('tacto "vacía"');
    await agente.post(url(vaca.id)).send({ fecha: sumarDias('2026-04-25', 200), crias: [viva('A')] }).expect(201);
  });

  it('un parto anulado no cuenta', async () => {
    const { agente, vaca } = await conPartoPrevio(true);
    await agente.post(url(vaca.id)).send({ fecha: '2026-05-01', crias: [viva('A')] }).expect(201);
  });
});

describe('orden de los rechazos 409 (RF-12)', () => {
  it('madre no apta y número existente a la vez: gana el rechazo de la madre', async () => {
    const { agente, tambo, vaca } = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    await crearAnimalDirecto(tambo, '800');
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('800')] }).expect(409);
    expect(res.body.error).toMatch(/recién nacida/i);
  });

  it('menos de 200 días y número existente a la vez: gana el de los 200 días', async () => {
    const { agente, tambo, vaca, usuarioId } = await prepararVaca();
    await crearPartoDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-10-01' });
    await crearAnimalDirecto(tambo, '801');
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('801')] }).expect(409);
    expect(res.body.error).toContain('01/10/2026');
  });

  it('dos números existentes: se informa el de la primera cría', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await crearAnimalDirecto(tambo, '802');
    await crearAnimalDirecto(tambo, '803');
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('803'), viva('802')] }).expect(409);
    // El 409 marca en qué cría está el problema: la primera (índice 0), no la segunda.
    expect(res.body.detalles).toEqual([{ campo: 'crias.0.numero', mensaje: 'Ya existe un animal activo con ese número' }]);
  });
});

describe('lote destino sin configurar (RF-13)', () => {
  it('sin regla para "en ordeñe" y "recién nacido": se guarda sin lote y con los avisos 1, 3 (uno por cría viva) y 4, en ese orden', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await prisma.reglaLote.deleteMany({ where: { establecimientoId: tambo, estado: { in: ['EN_ORDENE', 'RECIEN_NACIDO'] } } });
    const res = await agente
      .post(url(vaca.id))
      .send({ fecha: '2026-11-01', crias: [viva('s1'), muerta()] })
      .expect(201);
    // Dos crías: una viva y una muerta → un solo aviso 3.
    expect(res.body.avisos.map((a: { codigo: string }) => a.codigo)).toEqual(['SIN_LOTE_MADRE_EN_ORDENE', 'SIN_LOTE_CRIA', 'SIN_GENETICA_SIN_SERVICIO']);
    expect(res.body.avisos[0].mensaje).toBe('La vaca quedó sin lote: el estado «en ordeñe» no tiene un lote asignado');
    expect(res.body.avisos[1].mensaje).toBe('La cría N.º S1 quedó sin lote: el estado «recién nacido» no tiene un lote asignado');
    const madre = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(madre.loteId).toBeNull();
    const cria = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: tambo, numero: 'S1' } });
    expect(cria.loteId).toBeNull();
  });

  it('con dos crías vivas sin lote: un aviso 3 por cría, en el orden de carga', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await prisma.reglaLote.deleteMany({ where: { establecimientoId: tambo, estado: 'RECIEN_NACIDO' } });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('Z2'), viva('Z1')] }).expect(201);
    expect(res.body.avisos.map((a: { mensaje: string }) => a.mensaje.slice(0, 15))).toEqual(['La cría N.º Z2 ', 'La cría N.º Z1 ', 'El parto se gua']);
  });

  it('solo falta el lote de "recién nacido": la madre sí queda en su lote y no hay aviso 1', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await prisma.reglaLote.deleteMany({ where: { establecimientoId: tambo, estado: 'RECIEN_NACIDO' } });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [viva('Y1')] }).expect(201);
    expect(res.body.avisos.map((a: { codigo: string }) => a.codigo)).toEqual(['SIN_LOTE_CRIA', 'SIN_GENETICA_SIN_SERVICIO']);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).loteId).not.toBeNull();
  });

  it('sin regla de "recién nacido" y todas las crías muertas: no hay aviso 3 (no hay a quién asignar)', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await prisma.reglaLote.deleteMany({ where: { establecimientoId: tambo, estado: 'RECIEN_NACIDO' } });
    const res = await agente.post(url(vaca.id)).send({ fecha: '2026-11-01', crias: [muerta()] }).expect(201);
    expect(res.body.avisos.map((a: { codigo: string }) => a.codigo)).toEqual(['SIN_GENETICA_SIN_SERVICIO']);
  });
});

describe('genética de la cría (RF-15, RF-16)', () => {
  const PARTO = '2026-11-01';

  async function conServicio(diasAntes: number, semen?: string | null) {
    const t = await prepararVaca();
    const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
    const toro = semen ? await crearSemenDirecto(t.tambo, semen) : null;
    const servicio = await crearServicioDirecto({ ...base, fecha: sumarDias(PARTO, -diasAntes), semenId: toro?.id ?? null });
    return { ...t, base, servicio, toro };
  }

  it.each([240, 300])('servicio a %i días: se vincula (extremos incluidos) y la respuesta lleva fecha y semen', async (dias) => {
    const { agente, vaca, servicio, toro } = await conServicio(dias, 'Toro Alfa');
    const res = await agente.post(url(vaca.id)).send({ fecha: PARTO, crias: [viva('G1')] }).expect(201);
    expect(res.body.avisos).toEqual([]);
    expect(res.body.evento.parto.genetica).toEqual({ fechaServicio: sumarDias(PARTO, -dias), semen: { id: toro!.id, nombre: 'Toro Alfa' } });
    const parto = await prisma.parto.findUniqueOrThrow({ where: { eventoId: res.body.evento.id } });
    expect(parto).toMatchObject({ servicioId: servicio.id, servicioTipo: 'SERVICIO' });
  });

  it.each([239, 301])('servicio a %i días: se guarda igual, sin genética y con el aviso 5', async (dias) => {
    const { agente, vaca } = await conServicio(dias, 'Toro Alfa');
    const res = await agente.post(url(vaca.id)).send({ fecha: PARTO, crias: [viva('G1')] }).expect(201);
    expect(res.body.evento.parto.genetica).toBeNull();
    expect(res.body.avisos).toEqual([
      {
        codigo: 'SIN_GENETICA_FUERA_DE_RANGO',
        mensaje: `El parto se guardó sin genética: el último servicio es del ${sumarDias(PARTO, -dias).split('-').reverse().join('/')} y está fuera del plazo de 240 a 300 días antes del parto`,
      },
    ]);
    const parto = await prisma.parto.findUniqueOrThrow({ where: { eventoId: res.body.evento.id } });
    expect(parto.servicioId).toBeNull();
  });

  it('sin ningún servicio cargado: se guarda sin genética y con el aviso 4', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.post(url(vaca.id)).send({ fecha: PARTO, crias: [viva('G1')] }).expect(201);
    expect(res.body.avisos).toEqual([
      { codigo: 'SIN_GENETICA_SIN_SERVICIO', mensaje: expect.stringContaining('no hay un servicio cargado') },
    ]);
  });

  it('un servicio sin semen ni toro vincula igual, con semen null ("sin dato")', async () => {
    const { agente, vaca } = await conServicio(280, null);
    const res = await agente.post(url(vaca.id)).send({ fecha: PARTO, crias: [viva('G1')] }).expect(201);
    expect(res.body.evento.parto.genetica).toEqual({ fechaServicio: sumarDias(PARTO, -280), semen: null });
  });

  it('servicio + tacto "vacía" + parto: se ignora el tacto y se vincula el servicio', async () => {
    const { agente, vaca, base, servicio } = await conServicio(280, 'Toro Beta');
    await crearTactoDirecto({ ...base, fecha: sumarDias(PARTO, -200), resultado: 'VACIA' });
    const res = await agente.post(url(vaca.id)).send({ fecha: PARTO, crias: [viva('G1')] }).expect(201);
    const parto = await prisma.parto.findUniqueOrThrow({ where: { eventoId: res.body.evento.id } });
    expect(parto.servicioId).toBe(servicio.id);
  });

  it('servicio, tacto "vacía" y otro servicio: vale el último servicio', async () => {
    const { agente, vaca, base } = await conServicio(290, 'Toro Beta');
    await crearTactoDirecto({ ...base, fecha: sumarDias(PARTO, -270), resultado: 'VACIA' });
    const ultimo = await crearServicioDirecto({ ...base, fecha: sumarDias(PARTO, -260) });
    const res = await agente.post(url(vaca.id)).send({ fecha: PARTO, crias: [viva('G1')] }).expect(201);
    const parto = await prisma.parto.findUniqueOrThrow({ where: { eventoId: res.body.evento.id } });
    expect(parto.servicioId).toBe(ultimo.id);
  });

  it('un servicio anulado no cuenta', async () => {
    const t = await prepararVaca();
    const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
    await crearServicioDirecto({ ...base, fecha: sumarDias(PARTO, -280), anulacion: { porId: t.usuarioId, motivo: 'Error' } });
    const res = await t.agente.post(url(t.vaca.id)).send({ fecha: PARTO, crias: [viva('G1')] }).expect(201);
    expect(res.body.avisos.map((a: { codigo: string }) => a.codigo)).toEqual(['SIN_GENETICA_SIN_SERVICIO']);
  });

  it('un servicio anterior al último parto no cuenta; si ese parto está anulado, vuelve a contar', async () => {
    const t = await prepararVaca();
    const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
    await crearServicioDirecto({ ...base, fecha: '2025-01-10' });
    await crearPartoDirecto({ ...base, fecha: '2025-10-20' });
    const res = await t.agente.post(url(t.vaca.id)).send({ fecha: '2025-11-01', crias: [viva('G1')] }).expect(409); // a 12 días del anterior
    expect(res.body.error).toContain('20/10/2025');
    const res2 = await t.agente.post(url(t.vaca.id)).send({ fecha: '2026-11-01', crias: [viva('G2')] }).expect(201);
    expect(res2.body.avisos.map((a: { codigo: string }) => a.codigo)).toEqual(['SIN_GENETICA_SIN_SERVICIO']);
    expect(res2.body.avisos[0].mensaje).toContain('después del último parto');
  });

  it('con el último parto anulado vuelve a contar el servicio anterior', async () => {
    const t = await prepararVaca();
    const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
    const servicio = await crearServicioDirecto({ ...base, fecha: '2026-01-10' });
    await crearPartoDirecto({ ...base, fecha: '2026-02-01', anulacion: { porId: t.usuarioId, motivo: 'Error' } });
    const res = await t.agente.post(url(t.vaca.id)).send({ fecha: '2026-11-01', crias: [viva('G1')] }).expect(201); // 295 días
    const parto = await prisma.parto.findUniqueOrThrow({ where: { eventoId: res.body.evento.id } });
    expect(parto.servicioId).toBe(servicio.id);
  });
});

describe('el parto reinicia el ciclo (RF-17)', () => {
  it('una vaca preñada pasa a "sin servicio", sin fecha probable, y el servicio y el tacto quedan "del ciclo anterior"', async () => {
    const { agente, tambo, vaca, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearServicioDirecto({ ...base, fecha: '2026-01-10' });
    await crearTactoDirecto({ ...base, fecha: '2026-03-01', resultado: 'PRENADA' });
    expect((await situacionDe(agente, vaca.id)).estado).toBe('PRENADA');

    await agente.post(url(vaca.id)).send({ fecha: '2026-10-20', crias: [viva('R1')] }).expect(201);
    const s = await situacionDe(agente, vaca.id);
    expect(s).toMatchObject({
      estado: 'SIN_SERVICIO',
      fechaProbableParto: null,
      fechaReferencia: null,
      ultimoServicio: { fecha: '2026-01-10', cicloAnterior: true },
      ultimoTacto: { fecha: '2026-03-01', cicloAnterior: true },
    });
    // Un servicio nuevo ya se acepta.
    await agente.post(`/api/animales/${vaca.id}/servicios`).send({ fecha: '2026-11-05', tipo: 'INSEMINACION' }).expect(201);
  });
});

describe('permisos, aislamiento y orden de controles (RF-41, RF-42)', () => {
  const cuerpo = { fecha: '2026-11-01', crias: [viva('P1')] };

  it('sin sesión: 401, también con JSON roto', async () => {
    await request(app).post(url(ID_INEXISTENTE)).send(cuerpo).expect(401);
    await request(app).post(url(ID_INEXISTENTE)).set('Content-Type', 'application/json').send('{roto').expect(401);
  });

  it('el veterinario recibe 403 con datos válidos, inválidos, JSON roto, animal inexistente y animal ajeno', async () => {
    const { agente, vaca } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const ajeno = await prepararVaca({ nombreTambo: 'Ajeno', email: 'ajeno@prueba.test' });
    await vet.post(url(vaca.id)).send(cuerpo).expect(403);
    await vet.post(url(vaca.id)).send({ crias: [] }).expect(403);
    await vet.post(url(vaca.id)).set('Content-Type', 'application/json').send('{roto').expect(403);
    await vet.post(url(ID_INEXISTENTE)).send(cuerpo).expect(403);
    await vet.post(url(ajeno.vaca.id)).send(cuerpo).expect(403);
    expect(await prisma.parto.count()).toBe(0);
  });

  it('el encargado y el dueño pueden', async () => {
    const { agente, vaca } = await prepararVaca();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');
    await encargado.post(url(vaca.id)).send(cuerpo).expect(201);
  });

  it('aislamiento: el dueño de otro tambo recibe 404 y no cambia nada', async () => {
    const a = await prepararVaca({ nombreTambo: 'A', email: 'a@prueba.test' });
    const b = await registrarTambo('B', 'b@prueba.test');
    await b.agente.post(url(a.vaca.id)).send(cuerpo).expect(404);
    expect(await contar(a.tambo)).toMatchObject({ partos: 0, crias: 0 });
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: a.vaca.id } })).estado).toBe('EN_ORDENE');
  });

  it('un establecimientoId en el cuerpo (o en una cría) se ignora: todo queda en el tambo de la sesión', async () => {
    const a = await prepararVaca({ nombreTambo: 'A', email: 'a@prueba.test' });
    const b = await registrarTambo('B', 'b@prueba.test');
    const res = await a.agente
      .post(url(a.vaca.id))
      .send({ ...cuerpo, establecimientoId: b.perfil.establecimiento.id, crias: [{ ...viva('P1'), establecimientoId: b.perfil.establecimiento.id }] })
      .expect(201);
    const evento = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.evento.id } });
    expect(evento.establecimientoId).toBe(a.tambo);
    const cria = await prisma.animal.findFirstOrThrow({ where: { numero: 'P1' } });
    expect(cria.establecimientoId).toBe(a.tambo);
    expect(await prisma.animal.count({ where: { establecimientoId: b.perfil.establecimiento.id } })).toBe(0);
  });
});
