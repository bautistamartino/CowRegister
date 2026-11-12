import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { crearAnimalDirecto, crearProduccionDirecta, limpiarBase, prepararVaca } from './ayudas.js';

// Estos tests NO pasan por la API: insertan directo en la base para comprobar que las garantías
// de la migración "produccion_base" (spec 008, RF-28 y RF-29) están en PostgreSQL.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

async function preparar() {
  const base = await prepararVaca();
  const datos = { establecimientoId: base.tambo, animalId: base.vaca.id, registradoPorId: base.usuarioId, fecha: '2026-11-10' };
  return { ...base, datos };
}

describe('identificador y marcas de tiempo (RF-29)', () => {
  it('genera un UUID, creadoEn y actualizadoEn', async () => {
    const { datos } = await preparar();
    const p = await crearProduccionDirecta(datos);
    expect(p.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(p.creadoEn).toBeInstanceOf(Date);
    expect(p.actualizadoEn).toBeInstanceOf(Date);
  });

  it('acepta un id enviado por el cliente', async () => {
    const { datos } = await preparar();
    const id = crypto.randomUUID();
    expect((await crearProduccionDirecta({ ...datos, id })).id).toBe(id);
  });
});

describe('un solo registro vigente por vaca, fecha y turno (RF-6, RF-28)', () => {
  it('rechaza un segundo vigente del mismo ordeño y acepta otro turno u otro día', async () => {
    const { datos } = await preparar();
    await crearProduccionDirecta({ ...datos, turno: 'MANANA' });
    await expect(crearProduccionDirecta({ ...datos, turno: 'MANANA' })).rejects.toThrow();
    await expect(crearProduccionDirecta({ ...datos, turno: 'TARDE' })).resolves.toBeDefined();
    await expect(crearProduccionDirecta({ ...datos, fecha: '2026-11-09' })).resolves.toBeDefined();
  });

  it('un anulado no cuenta: se puede cargar otro, y también tener varios anulados', async () => {
    const { datos, usuarioId } = await preparar();
    const anulacion = { porId: usuarioId, motivo: 'Error de tipeo' };
    await crearProduccionDirecta({ ...datos, anulacion });
    await crearProduccionDirecta({ ...datos, anulacion });
    await expect(crearProduccionDirecta(datos)).resolves.toBeDefined();
    await expect(crearProduccionDirecta(datos)).rejects.toThrow();
  });

  it('dos vacas distintas pueden cargar el mismo ordeño', async () => {
    const { datos, tambo } = await preparar();
    const otra = await crearAnimalDirecto(tambo, '102');
    await crearProduccionDirecta(datos);
    await expect(crearProduccionDirecta({ ...datos, animalId: otra.id })).resolves.toBeDefined();
  });
});

describe('CHECK de litros, fecha, motivo y lote (RF-28)', () => {
  it('litros en décimas de 0 a 999', async () => {
    const { datos } = await preparar();
    await expect(crearProduccionDirecta({ ...datos, litros: 0, turno: 'MANANA' })).resolves.toBeDefined();
    await expect(crearProduccionDirecta({ ...datos, litros: 99.9, turno: 'TARDE' })).resolves.toBeDefined();
    await expect(crearProduccionDirecta({ ...datos, litros: 100, fecha: '2026-11-09' })).rejects.toThrow(/producciones_litros_rango/);
    await expect(crearProduccionDirecta({ ...datos, litros: -0.1, fecha: '2026-11-08' })).rejects.toThrow(/producciones_litros_rango/);
  });

  it('fecha no anterior al 01/01/2000', async () => {
    const { datos } = await preparar();
    await expect(crearProduccionDirecta({ ...datos, fecha: '2000-01-01' })).resolves.toBeDefined();
    await expect(crearProduccionDirecta({ ...datos, fecha: '1999-12-31' })).rejects.toThrow(/producciones_fecha_minima/);
  });

  it('el turno es del enum (un valor inventado no entra)', async () => {
    const { datos } = await preparar();
    await expect(
      prisma.$executeRaw`INSERT INTO "producciones" ("id","establecimientoId","animalId","fecha","turno","litrosDecimas","registradoPorId","actualizadoEn")
        VALUES (gen_random_uuid(), ${datos.establecimientoId}::uuid, ${datos.animalId}::uuid, '2026-11-10', 'NOCHE', 10, ${datos.registradoPorId}::uuid, now())`,
    ).rejects.toThrow();
  });

  it('la anulación va completa: las tres columnas o ninguna', async () => {
    const { datos, usuarioId } = await preparar();
    const incompleta = (data: Record<string, unknown>) =>
      prisma.produccion.create({
        data: {
          establecimientoId: datos.establecimientoId,
          animalId: datos.animalId,
          fecha: new Date('2026-11-10T00:00:00Z'),
          turno: 'MANANA',
          litrosDecimas: 10,
          registradoPorId: usuarioId,
          ...data,
        },
      });
    await expect(incompleta({ anuladoEn: new Date() })).rejects.toThrow(/producciones_anulacion_completa/);
    await expect(incompleta({ anuladoEn: new Date(), motivoAnulacion: 'x' })).rejects.toThrow(/producciones_anulacion_completa/);
    await expect(incompleta({ motivoAnulacion: 'x' })).rejects.toThrow(/producciones_anulacion_completa/);
    await expect(incompleta({ anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'x' })).resolves.toBeDefined();
  });

  it('el motivo tiene de 1 a 200 caracteres y sin espacios en los extremos', async () => {
    const { datos, usuarioId } = await preparar();
    const con = (motivo: string, fecha: string) => crearProduccionDirecta({ ...datos, fecha, anulacion: { porId: usuarioId, motivo } });
    await expect(con('a'.repeat(200), '2026-11-01')).resolves.toBeDefined();
    await expect(con('a'.repeat(201), '2026-11-02')).rejects.toThrow(/producciones_motivo_largo/);
    await expect(con('', '2026-11-03')).rejects.toThrow(/producciones_motivo_largo/);
    await expect(con(' con espacio', '2026-11-04')).rejects.toThrow(/producciones_motivo_largo/);
    await expect(con('con espacio ', '2026-11-05')).rejects.toThrow(/producciones_motivo_largo/);
  });

  it('el lote copiado: id y nombre juntos o ninguno, y el nombre no vacío', async () => {
    const { datos } = await preparar();
    const id = crypto.randomUUID();
    await expect(crearProduccionDirecta({ ...datos, fecha: '2026-11-01', loteId: id, loteNombre: 'Lote A' })).resolves.toBeDefined();
    await expect(crearProduccionDirecta({ ...datos, fecha: '2026-11-02', loteId: id, loteNombre: null })).rejects.toThrow(
      /producciones_lote_coherente/,
    );
    await expect(crearProduccionDirecta({ ...datos, fecha: '2026-11-03', loteId: null, loteNombre: 'Lote A' })).rejects.toThrow(
      /producciones_lote_coherente/,
    );
    await expect(crearProduccionDirecta({ ...datos, fecha: '2026-11-04', loteId: id, loteNombre: '  ' })).rejects.toThrow(
      /producciones_lote_coherente/,
    );
    await expect(crearProduccionDirecta({ ...datos, fecha: '2026-11-05' })).resolves.toBeDefined();
  });

  it('el lote copiado no tiene clave foránea: sobrevive a eliminar el lote', async () => {
    const { datos, tambo } = await preparar();
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Efímero' } });
    const p = await crearProduccionDirecta({ ...datos, loteId: lote.id, loteNombre: 'Efímero' });
    await prisma.lote.delete({ where: { id: lote.id } });
    const guardada = await prisma.produccion.findUniqueOrThrow({ where: { id: p.id } });
    expect(guardada).toMatchObject({ loteId: lote.id, loteNombre: 'Efímero' });
  });
});

describe('pertenece al tambo de su vaca y de sus usuarios (claves compuestas)', () => {
  it('rechaza una vaca o un usuario de otro tambo', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    // vaca de B con el tambo A
    await expect(
      crearProduccionDirecta({ establecimientoId: a.tambo, animalId: b.vaca.id, registradoPorId: a.usuarioId, fecha: '2026-11-10' }),
    ).rejects.toThrow();
    // usuario de B con el tambo A
    await expect(
      crearProduccionDirecta({ establecimientoId: a.tambo, animalId: a.vaca.id, registradoPorId: b.usuarioId, fecha: '2026-11-10' }),
    ).rejects.toThrow();
    // quien anula, de otro tambo
    await expect(
      crearProduccionDirecta({
        establecimientoId: a.tambo,
        animalId: a.vaca.id,
        registradoPorId: a.usuarioId,
        fecha: '2026-11-10',
        anulacion: { porId: b.usuarioId, motivo: 'x' },
      }),
    ).rejects.toThrow();
  });
});

describe('solo se agrega: no se borra ni se edita, solo se anula (constitución §3)', () => {
  it('no se puede borrar (con Prisma y con SQL)', async () => {
    const { datos } = await preparar();
    const p = await crearProduccionDirecta(datos);
    await expect(prisma.produccion.delete({ where: { id: p.id } })).rejects.toThrow(/solo se agrega/);
    await expect(prisma.produccion.deleteMany()).rejects.toThrow(/solo se agrega/);
    expect(await prisma.produccion.count()).toBe(1);
  });

  it('no se puede editar un registro vigente (litros, fecha, turno ni lote)', async () => {
    const { datos } = await preparar();
    const p = await crearProduccionDirecta(datos);
    await expect(prisma.produccion.update({ where: { id: p.id }, data: { litrosDecimas: 99 } })).rejects.toThrow(/solo se agrega/);
    await expect(prisma.$executeRaw`UPDATE "producciones" SET "turno" = 'TARDE' WHERE id = ${p.id}::uuid`).rejects.toThrow(/solo se agrega/);
    await expect(prisma.$executeRaw`UPDATE "producciones" SET "fecha" = '2026-11-01' WHERE id = ${p.id}::uuid`).rejects.toThrow(/solo se agrega/);
    expect((await prisma.produccion.findUniqueOrThrow({ where: { id: p.id } })).litrosDecimas).toBe(100);
  });

  it('el paso "no anulado -> anulado" se permite, pero no cambiando nada más a la vez', async () => {
    const { datos, usuarioId } = await preparar();
    const p = await crearProduccionDirecta(datos);
    await expect(
      prisma.produccion.update({
        where: { id: p.id },
        data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'x', litrosDecimas: 5 },
      }),
    ).rejects.toThrow(/solo se agrega/);
    const anulada = await prisma.produccion.update({
      where: { id: p.id },
      data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'Error de tipeo' },
    });
    expect(anulada.motivoAnulacion).toBe('Error de tipeo');
    expect(anulada.litrosDecimas).toBe(100);
  });

  it('un registro ya anulado no se modifica más (ni se des-anula ni se cambia el motivo)', async () => {
    const { datos, usuarioId } = await preparar();
    const p = await crearProduccionDirecta({ ...datos, anulacion: { porId: usuarioId, motivo: 'Uno' } });
    await expect(prisma.produccion.update({ where: { id: p.id }, data: { motivoAnulacion: 'Otro' } })).rejects.toThrow(/solo se agrega/);
    await expect(
      prisma.$executeRaw`UPDATE "producciones" SET "anuladoEn" = NULL, "anuladoPorId" = NULL, "motivoAnulacion" = NULL WHERE id = ${p.id}::uuid`,
    ).rejects.toThrow();
  });

  it('TRUNCATE no dispara el trigger (limpiarBase sigue andando)', async () => {
    const { datos } = await preparar();
    await crearProduccionDirecta(datos);
    await limpiarBase();
    expect(await prisma.produccion.count()).toBe(0);
  });
});
