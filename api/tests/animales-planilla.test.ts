import request from 'supertest';
import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/db.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { app, crearAnimalDirecto, crearUsuario, limpiarBase, registrarTambo } from './ayudas.js';

// Tests de la API de la carga desde planilla (spec 002, T3).
// Todo tambo registrado con registrarTambo() trae los 4 lotes iniciales con sus destinos.

beforeEach(limpiarBase);
afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const VISTA_PREVIA = '/api/animales/planilla/vista-previa';
const CONFIRMAR = '/api/animales/planilla/confirmar';

// Arma el texto de una planilla: celdas separadas por tabulación y filas por salto de línea.
const texto = (...filas: string[][]) => filas.map((f) => f.join('\t')).join('\n');

async function dosTambos() {
  const a = await registrarTambo('Tambo A', 'a@prueba.test');
  const b = await registrarTambo('Tambo B', 'b@prueba.test');
  return { a, b };
}

const cantidadAnimales = () => prisma.animal.count();

describe('permisos y validación del cuerpo', () => {
  it('sin sesión responde 401', async () => {
    await request(app).post(VISTA_PREVIA).send({ texto: 'x' }).expect(401);
    await request(app).post(CONFIRMAR).send({ texto: 'x' }).expect(401);
  });

  it('el veterinario recibe 403 en vista previa y confirmar, también con datos inválidos (RF-40)', async () => {
    const { agente } = await registrarTambo();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    for (const ruta of [VISTA_PREVIA, CONFIRMAR]) {
      await vet.post(ruta).send({ texto: texto(['1', 'H', '', 'seca', '']) }).expect(403);
      await vet.post(ruta).send({}).expect(403);
      await vet.post(ruta).send({ texto: 12345 }).expect(403);
      await vet.post(ruta).send({ texto: '' }).expect(403);
    }
    expect(await cantidadAnimales()).toBe(0);
  });

  it('el encargado puede usarla', async () => {
    const { agente } = await registrarTambo();
    const enc = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');
    await enc.post(VISTA_PREVIA).send({ texto: texto(['1', 'H', '', 'seca', '']) }).expect(200);
    await enc.post(CONFIRMAR).send({ texto: texto(['1', 'H', '', 'seca', '']) }).expect(200);
  });

  it('sin el campo texto, o con un texto que no es un texto: 400 con el detalle del campo', async () => {
    const { agente } = await registrarTambo();
    for (const ruta of [VISTA_PREVIA, CONFIRMAR]) {
      const r1 = await agente.post(ruta).send({}).expect(400);
      expect(r1.body.detalles[0].campo).toBe('texto');
      const r2 = await agente.post(ruta).send({ texto: 5 }).expect(400);
      expect(r2.body.detalles[0].campo).toBe('texto');
    }
  });
});

describe('límites (RF-17)', () => {
  it('texto vacío: 400 con mensaje en español', async () => {
    const { agente } = await registrarTambo();
    const r = await agente.post(VISTA_PREVIA).send({ texto: '   \n ' }).expect(400);
    expect(r.body.error).toMatch(/Pegá/);
  });

  it('500 filas se procesan; 501 se rechazan con 400', async () => {
    const { agente } = await registrarTambo();
    const con = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}\tHEMBRA\t\tSECA\t`).join('\n');
    const ok = await agente.post(VISTA_PREVIA).send({ texto: con(500) }).expect(200);
    expect(ok.body.resumen).toMatchObject({ total: 500, correctas: 500, conError: 0 });
    const mal = await agente.post(VISTA_PREVIA).send({ texto: con(501) }).expect(400);
    expect(mal.body.error).toMatch(/500/);
  });

  it('más de 100.000 caracteres: 400 con mensaje, no un 413 sin mensaje', async () => {
    const { agente } = await registrarTambo();
    // Los tabuladores se escapan como \t en el JSON: el cuerpo pesa más que el texto.
    const r = await agente.post(VISTA_PREVIA).send({ texto: '1\t'.repeat(50_001) }).expect(400);
    expect(r.body.error).toMatch(/100\.000/);
    const c = await agente.post(CONFIRMAR).send({ texto: '1\t'.repeat(50_001) }).expect(400);
    expect(c.body.error).toMatch(/100\.000/);
  });

  it('un cuerpo de cientos de kb entra en la ruta de la planilla (parser de 1 MB)', async () => {
    const { agente } = await registrarTambo();
    // 60.000 caracteres de control, cada uno escapado como \u0001 (6 bytes): cuerpo de ~360 kb, mayor que 100 kb.
    const cuerpo = { texto: '\u0001'.repeat(60_000) };
    expect(JSON.stringify(cuerpo).length).toBeGreaterThan(300_000);
    const r = await agente.post(VISTA_PREVIA).send(cuerpo).expect(400);
    expect(r.body.error).toMatch(/tabulación/); // llegó al análisis: no fue un 413
  });

  it('un cuerpo de más de 1 MB: 413 con mensaje en español', async () => {
    const { agente } = await registrarTambo();
    const r = await agente.post(VISTA_PREVIA).send({ texto: 'a'.repeat(1_100_000) }).expect(413);
    expect(r.body.error).toMatch(/demasiado grande/);
  });

  it('el límite de 100 kb sigue valiendo para el resto de la API, también con mensaje en español', async () => {
    const { agente } = await registrarTambo();
    const r = await agente.post('/api/animales').send({ numero: 'a'.repeat(150_000) }).expect(413);
    expect(r.body.error).toMatch(/demasiado grande/);
  });

  it('sin tabulaciones: mensaje específico', async () => {
    const { agente } = await registrarTambo();
    const r = await agente.post(VISTA_PREVIA).send({ texto: '101 H SECA\n102 H SECA' }).expect(400);
    expect(r.body.error).toBe(
      'Las columnas tienen que estar separadas por tabulación: copiá las celdas desde Excel o Google Sheets',
    );
  });

  it('comillas sin cerrar: 400 con la fila donde empezaron', async () => {
    const { agente } = await registrarTambo();
    const r = await agente.post(CONFIRMAR).send({ texto: '1\tH\t\tseca\t\n"2\tH\t\tseca\t' }).expect(400);
    expect(r.body.error).toContain('fila 2');
    expect(await cantidadAnimales()).toBe(0);
  });
});

describe('POST /api/animales/planilla/vista-previa (RF-11, RF-19, RF-20)', () => {
  it('devuelve filas correctas y con error con su número de fila y motivo, y no escribe nada', async () => {
    const { agente } = await registrarTambo();
    // Fila 1 encabezado, 2 vacía, 3 correcta, 4 con error, 5 correcta con madre posterior (fila 6).
    const t = [
      'Número\tSexo\tFecha de nacimiento\tEstado\tMadre',
      '',
      '101\tHembra\t5/3/2021\ten ordeñe\t',
      '102\tvaca\t\tseca\t',
      '201\tmacho\t\trecién nacido\t103',
      '103\tH\t\tseca\t',
    ].join('\r\n');
    const antes = await cantidadAnimales();
    const r = await agente.post(VISTA_PREVIA).send({ texto: t }).expect(200);
    expect(await cantidadAnimales()).toBe(antes);

    expect(r.body.filas).toEqual([
      { fila: 3, ok: true, numero: '101', sexo: 'HEMBRA', estado: 'EN_ORDENE', fechaNacimiento: '2021-03-05', madre: null },
      { fila: 4, ok: false, numero: '102', sexo: 'vaca', estado: 'SECA', fechaNacimiento: null, madre: null, motivo: 'El sexo tiene que ser hembra, macho, H o M' },
      { fila: 5, ok: true, numero: '201', sexo: 'MACHO', estado: 'RECIEN_NACIDO', fechaNacimiento: null, madre: '103' },
      { fila: 6, ok: true, numero: '103', sexo: 'HEMBRA', estado: 'SECA', fechaNacimiento: null, madre: null },
    ]);
    expect(r.body.resumen).toEqual({ total: 4, correctas: 3, conError: 1, sinLotePorEstado: [] });
  });

  it('informa los animales que quedarían sin lote, por estado (RF-19)', async () => {
    const { agente, perfil } = await registrarTambo();
    // Se quita la regla de "Secas" para que ese estado quede sin lote destino.
    await prisma.reglaLote.deleteMany({ where: { establecimientoId: perfil.establecimiento.id, estado: 'SECA' } });
    const t = texto(['1', 'H', '', 'seca', ''], ['2', 'H', '', 'seca', ''], ['3', 'H', '', 'en ordeñe', ''], ['4', 'x', '', 'seca', '']);
    const r = await agente.post(VISTA_PREVIA).send({ texto: t }).expect(200);
    expect(r.body.resumen.sinLotePorEstado).toEqual([{ estado: 'SECA', cantidad: 2 }]);
  });

  it('un número activo del tambo es error, uno dado de baja no (se puede reutilizar)', async () => {
    const { agente, perfil } = await registrarTambo();
    await crearAnimalDirecto(perfil.establecimiento.id, '101');
    await crearAnimalDirecto(perfil.establecimiento.id, '102', { estado: 'BAJA' });
    const r = await agente.post(VISTA_PREVIA).send({ texto: texto(['101', 'H', '', 'seca', ''], ['102', 'H', '', 'seca', '']) }).expect(200);
    expect(r.body.filas[0]).toMatchObject({ ok: false, motivo: 'Ya existe un animal activo con el número 101' });
    expect(r.body.filas[1].ok).toBe(true);
  });

  it('la madre puede ser un animal activo del tambo, pero no uno dado de baja ni un macho', async () => {
    const { agente, perfil } = await registrarTambo();
    await crearAnimalDirecto(perfil.establecimiento.id, '100');
    await crearAnimalDirecto(perfil.establecimiento.id, '101', { estado: 'BAJA' });
    await crearAnimalDirecto(perfil.establecimiento.id, '102', { sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
    const t = texto(
      ['201', 'M', '', 'recién nacido', '100'],
      ['202', 'M', '', 'recién nacido', '101'],
      ['203', 'M', '', 'recién nacido', '102'],
    );
    const r = await agente.post(VISTA_PREVIA).send({ texto: t }).expect(200);
    expect(r.body.filas.map((f: { ok: boolean }) => f.ok)).toEqual([true, false, false]);
    expect(r.body.filas[1].motivo).toBe('No hay una hembra activa con el número 101');
  });

  it('aislamiento: un número que existe solo en otro tambo se acepta y una madre de otro tambo da error (RF-12, RF-37)', async () => {
    const { a, b } = await dosTambos();
    await crearAnimalDirecto(b.perfil.establecimiento.id, '500');
    await crearAnimalDirecto(b.perfil.establecimiento.id, '600');
    const t = texto(['500', 'H', '', 'seca', ''], ['700', 'M', '', 'recién nacido', '600']);
    const r = await a.agente.post(VISTA_PREVIA).send({ texto: t }).expect(200);
    expect(r.body.filas[0]).toMatchObject({ numero: '500', ok: true });
    expect(r.body.filas[1]).toMatchObject({ ok: false, motivo: 'No hay una hembra activa con el número 600' });
  });

  it('ignora un establecimientoId enviado por el cliente', async () => {
    const { a, b } = await dosTambos();
    await crearAnimalDirecto(b.perfil.establecimiento.id, '500');
    const r = await a.agente
      .post(VISTA_PREVIA)
      .send({ texto: texto(['500', 'H', '', 'seca', '']), establecimientoId: b.perfil.establecimiento.id })
      .expect(200);
    expect(r.body.filas[0].ok).toBe(true);
  });
});

describe('POST /api/animales/planilla/confirmar (RF-18, RF-19, RF-21)', () => {
  it('guarda solo las filas correctas, juntas, cada una en el lote destino de su estado, con la madre vinculada', async () => {
    const { agente, perfil } = await registrarTambo();
    const est = perfil.establecimiento.id;
    const existente = await crearAnimalDirecto(est, '100');
    const t = texto(
      ['201', 'M', '', 'recién nacido', '100'], // madre del tambo
      ['202', 'M', '', 'recién nacido', '300'], // madre en una fila posterior
      ['102', 'vaca', '', 'seca', ''], // con error
      ['300', 'H', '5/3/2021', 'seca', ''],
      ['301', 'H', '', 'vaquillona', ''],
    );
    const r = await agente.post(CONFIRMAR).send({ texto: t }).expect(200);
    expect(r.body).toEqual({
      guardados: 4,
      quedaronAfuera: [{ fila: 3, motivo: 'El sexo tiene que ser hembra, macho, H o M' }],
      sinLotePorEstado: [],
    });

    const guardados = await prisma.animal.findMany({ where: { establecimientoId: est, numero: { not: '100' } }, include: { lote: true, madre: true } });
    const por = Object.fromEntries(guardados.map((a) => [a.numero, a]));
    expect(Object.keys(por).sort()).toEqual(['201', '202', '300', '301']);
    expect(por['201']!.madreId).toBe(existente.id);
    expect(por['202']!.madre!.numero).toBe('300');
    expect(por['300']!.lote!.nombre).toBe('Secas');
    expect(por['300']!.fechaNacimiento!.toISOString().slice(0, 10)).toBe('2021-03-05');
    expect(por['301']!.lote!.nombre).toBe('Vaquillonas');
    expect(por['201']!.lote!.nombre).toBe('Terneros');
    expect(por['301']!.establecimientoId).toBe(est);
  });

  it('informa los animales sin lote por estado y los guarda sin lote (RF-19)', async () => {
    const { agente, perfil } = await registrarTambo();
    await prisma.reglaLote.deleteMany({ where: { establecimientoId: perfil.establecimiento.id, estado: 'SECA' } });
    const r = await agente.post(CONFIRMAR).send({ texto: texto(['1', 'H', '', 'seca', ''], ['2', 'H', '', 'seca', ''], ['3', 'H', '', 'vaquillona', '']) }).expect(200);
    expect(r.body.guardados).toBe(3);
    expect(r.body.sinLotePorEstado).toEqual([{ estado: 'SECA', cantidad: 2 }]);
    const secas = await prisma.animal.findMany({ where: { estado: 'SECA' } });
    expect(secas.every((a) => a.loteId === null)).toBe(true);
  });

  it('sin ninguna fila correcta: 200 con cero guardados y todas afuera', async () => {
    const { agente } = await registrarTambo();
    const r = await agente.post(CONFIRMAR).send({ texto: texto(['1', 'x', '', 'seca', ''], ['2', 'H', '', 'baja', '']) }).expect(200);
    expect(r.body.guardados).toBe(0);
    expect(r.body.quedaronAfuera).toHaveLength(2);
    expect(await cantidadAnimales()).toBe(0);
  });

  it('revalida al confirmar: un número creado entre la vista previa y la confirmación queda afuera con su motivo', async () => {
    const { agente, perfil } = await registrarTambo();
    const t = texto(['1', 'H', '', 'seca', ''], ['2', 'H', '', 'seca', ''], ['3', 'M', '', 'recién nacido', '2']);
    const previa = await agente.post(VISTA_PREVIA).send({ texto: t }).expect(200);
    expect(previa.body.resumen.correctas).toBe(3);

    await crearAnimalDirecto(perfil.establecimiento.id, '2'); // otro usuario lo carga en medio

    const r = await agente.post(CONFIRMAR).send({ texto: t }).expect(200);
    expect(r.body.guardados).toBe(2);
    expect(r.body.quedaronAfuera).toEqual([
      { fila: 2, motivo: 'Ya existe un animal activo con el número 2' },
    ]);
    // La fila 3 sigue siendo correcta: ahora su madre es el animal que existe.
    const guardados = await prisma.animal.findMany({ where: { numero: { in: ['1', '3'] } } });
    expect(guardados).toHaveLength(2);
    expect(guardados.find((a) => a.numero === '3')!.madreId).not.toBeNull();
  });

  it('una cría cuya madre aparece repetida se vincula con la primera fila y la repetida queda afuera', async () => {
    const { agente } = await registrarTambo();
    const t = texto(['10', 'M', '', 'recién nacido', '5'], ['5', 'H', '', 'seca', ''], ['5', 'H', '', 'seca', '']);
    const r = await agente.post(CONFIRMAR).send({ texto: t }).expect(200);
    // La primera fila de número 5 es válida; la segunda es duplicado; la cría se guarda con la primera.
    expect(r.body.guardados).toBe(2);
    expect(r.body.quedaronAfuera).toEqual([{ fila: 3, motivo: 'El número 5 ya aparece en la fila 2' }]);
  });

  it('un conflicto de número simultáneo se reintenta, revalidando todo, y termina bien (RF-21)', async () => {
    const { agente, perfil } = await registrarTambo();
    const est = perfil.establecimiento.id;
    const real = prisma.animal.createMany.bind(prisma.animal);
    // En el primer intento "otro usuario" ocupa el número 2 justo antes de guardar: la base responde P2002.
    const espia = vi.spyOn(prisma.animal, 'createMany').mockImplementationOnce((async () => {
      await crearAnimalDirecto(est, '2');
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
    }) as never);
    espia.mockImplementation(real as never);

    const r = await agente.post(CONFIRMAR).send({ texto: texto(['1', 'H', '', 'seca', ''], ['2', 'H', '', 'seca', '']) }).expect(200);
    expect(espia).toHaveBeenCalledTimes(2);
    expect(r.body.guardados).toBe(1);
    expect(r.body.quedaronAfuera).toEqual([{ fila: 2, motivo: 'Ya existe un animal activo con el número 2' }]);
    expect(await prisma.animal.count({ where: { establecimientoId: est, numero: '1' } })).toBe(1);
  });

  it('un conflicto que persiste tras 3 intentos responde 409 y no guarda nada (RF-21)', async () => {
    const { agente } = await registrarTambo();
    const espia = vi.spyOn(prisma.animal, 'createMany').mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
    );
    const r = await agente.post(CONFIRMAR).send({ texto: texto(['1', 'H', '', 'seca', '']) }).expect(409);
    expect(espia).toHaveBeenCalledTimes(3);
    expect(r.body.error).toMatch(/volvé a intentar/);
    espia.mockRestore();
    expect(await cantidadAnimales()).toBe(0);
  });

  it('si el lote destino se eliminó justo antes de guardar (P2003): 409 y no guarda nada', async () => {
    const { agente } = await registrarTambo();
    const espia = vi.spyOn(prisma.animal, 'createMany').mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', { code: 'P2003', clientVersion: 'test' }),
    );
    const r = await agente.post(CONFIRMAR).send({ texto: texto(['1', 'H', '', 'seca', '']) }).expect(409);
    expect(espia).toHaveBeenCalledTimes(1);
    expect(r.body.error).toBe('El lote destino ya no existe, volvé a intentar');
  });

  it('un error inesperado al guardar no deja nada guardado y responde 500', async () => {
    const { agente } = await registrarTambo();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(prisma.animal, 'createMany').mockRejectedValue(new Error('se cayó la base'));
    await agente.post(CONFIRMAR).send({ texto: texto(['1', 'H', '', 'seca', '']) }).expect(500);
  });

  it('aislamiento: el número que existe solo en otro tambo se guarda; la madre de otro tambo deja la fila afuera (RF-37)', async () => {
    const { a, b } = await dosTambos();
    const estA = a.perfil.establecimiento.id;
    await crearAnimalDirecto(b.perfil.establecimiento.id, '500');
    await crearAnimalDirecto(b.perfil.establecimiento.id, '600');
    const t = texto(['500', 'H', '', 'seca', ''], ['700', 'M', '', 'recién nacido', '600']);
    const r = await a.agente.post(CONFIRMAR).send({ texto: t }).expect(200);
    expect(r.body.guardados).toBe(1);
    expect(r.body.quedaronAfuera).toEqual([{ fila: 2, motivo: 'No hay una hembra activa con el número 600' }]);
    const deA = await prisma.animal.findMany({ where: { establecimientoId: estA } });
    expect(deA.map((x) => x.numero)).toEqual(['500']);
    // El tambo B quedó como estaba: sus dos animales, sin tocar.
    expect(await prisma.animal.count({ where: { establecimientoId: b.perfil.establecimiento.id } })).toBe(2);
  });

  it('el lote de cada animal es del tambo de la sesión, aunque el cliente mande un establecimientoId ajeno', async () => {
    const { a, b } = await dosTambos();
    await a.agente
      .post(CONFIRMAR)
      .send({ texto: texto(['1', 'H', '', 'seca', '']), establecimientoId: b.perfil.establecimiento.id })
      .expect(200);
    const animal = await prisma.animal.findFirstOrThrow({ where: { numero: '1' }, include: { lote: true } });
    expect(animal.establecimientoId).toBe(a.perfil.establecimiento.id);
    expect(animal.lote!.establecimientoId).toBe(a.perfil.establecimiento.id);
  });

  it('500 filas se guardan juntas', async () => {
    const { agente, perfil } = await registrarTambo();
    const t = Array.from({ length: 500 }, (_, i) => `${i + 1}\tHEMBRA\t\tSECA\t`).join('\n');
    const r = await agente.post(CONFIRMAR).send({ texto: t }).expect(200);
    expect(r.body.guardados).toBe(500);
    expect(await prisma.animal.count({ where: { establecimientoId: perfil.establecimiento.id } })).toBe(500);
  });
});
