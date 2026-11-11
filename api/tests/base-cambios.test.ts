import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { crearAnimalDirecto, crearCambioDirecto, limpiarBase, prepararVaca, verificarInvariantes } from './ayudas.js';

// Estos tests NO pasan por la API: insertan directo en la base para comprobar que las garantías
// de la migración "editar_animal" (historial de cambios, spec 005, RF-14) están en PostgreSQL.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

describe('Historial de cambios: solo se agrega (RF-14)', () => {
  it('acepta una fila nueva (control)', async () => {
    const { tambo, vaca } = await prepararVaca();
    await expect(crearCambioDirecto(tambo, vaca.id)).resolves.toMatchObject({ campo: 'NUMERO', valorAnterior: 'VIEJO' });
  });

  it('el trigger impide modificar una fila (con Prisma y con SQL)', async () => {
    const { tambo, vaca } = await prepararVaca();
    const cambio = await crearCambioDirecto(tambo, vaca.id);
    await expect(prisma.cambioAnimal.update({ where: { id: cambio.id }, data: { valorNuevo: 'OTRO' } })).rejects.toThrow(/solo se agrega/);
    await expect(prisma.$executeRaw`UPDATE "cambios_animal" SET "usuarioNombre" = 'Otro' WHERE id = ${cambio.id}::uuid`).rejects.toThrow(
      /solo se agrega/,
    );
    const guardada = await prisma.cambioAnimal.findUniqueOrThrow({ where: { id: cambio.id } });
    expect(guardada.valorNuevo).toBe('NUEVO');
  });

  it('el trigger impide borrar una fila (una o todas)', async () => {
    const { tambo, vaca } = await prepararVaca();
    const cambio = await crearCambioDirecto(tambo, vaca.id);
    await expect(prisma.cambioAnimal.delete({ where: { id: cambio.id } })).rejects.toThrow(/solo se agrega/);
    await expect(prisma.cambioAnimal.deleteMany()).rejects.toThrow(/solo se agrega/);
    expect(await prisma.cambioAnimal.count()).toBe(1);
  });
});

describe('Historial de cambios: CHECK (RF-14)', () => {
  it('rechaza un cambio cuyo valor anterior es igual al nuevo, y acepta si difieren (control)', async () => {
    const { tambo, vaca } = await prepararVaca();
    await expect(crearCambioDirecto(tambo, vaca.id, { valorAnterior: 'A', valorNuevo: 'A' })).rejects.toThrow();
    await expect(crearCambioDirecto(tambo, vaca.id, { valorAnterior: null, valorNuevo: null })).rejects.toThrow();
    await expect(crearCambioDirecto(tambo, vaca.id, { valorAnterior: 'A', valorNuevo: 'B' })).resolves.toBeDefined();
  });

  it('acepta pasar de "sin dato" a un valor y de un valor a "sin dato" (null cuenta como valor)', async () => {
    const { tambo, vaca } = await prepararVaca();
    await expect(crearCambioDirecto(tambo, vaca.id, { campo: 'MADRE', valorAnterior: null, valorNuevo: '50' })).resolves.toBeDefined();
    await expect(crearCambioDirecto(tambo, vaca.id, { campo: 'LOTE', valorAnterior: 'Ordeñe', valorNuevo: null })).resolves.toBeDefined();
  });

  it('rechaza un nombre de usuario vacío o de solo espacios', async () => {
    const { tambo, vaca } = await prepararVaca();
    await expect(crearCambioDirecto(tambo, vaca.id, { usuarioNombre: '' })).rejects.toThrow();
    await expect(crearCambioDirecto(tambo, vaca.id, { usuarioNombre: '   ' })).rejects.toThrow();
  });
});

describe('Historial de cambios: pertenece al tambo de su animal', () => {
  it('rechaza una fila con el tambo de otro (clave compuesta)', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test', numero: '202' });
    await expect(crearCambioDirecto(b.tambo, a.vaca.id)).rejects.toThrow();
    await expect(crearCambioDirecto(a.tambo, a.vaca.id)).resolves.toBeDefined();
  });

  it('una fila con un animal inexistente se rechaza', async () => {
    const { tambo } = await prepararVaca();
    await expect(crearCambioDirecto(tambo, crypto.randomUUID())).rejects.toThrow();
  });

  it('no se puede borrar un animal que tiene historial (RESTRICT)', async () => {
    const { tambo, vaca } = await prepararVaca();
    await crearCambioDirecto(tambo, vaca.id);
    await expect(prisma.animal.delete({ where: { id: vaca.id } })).rejects.toThrow();
  });
});

describe('Historial de cambios: sin claves a lote, madre ni usuario (decisión 7)', () => {
  it('un lote que figura en el historial se puede eliminar y el historial conserva su nombre', async () => {
    const { tambo, vaca } = await prepararVaca();
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Enfermería' } });
    await crearCambioDirecto(tambo, vaca.id, { campo: 'LOTE', valorAnterior: null, valorNuevo: lote.nombre });
    await expect(prisma.lote.delete({ where: { id: lote.id } })).resolves.toBeDefined();
    const filas = await prisma.cambioAnimal.findMany({ where: { animalId: vaca.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0]?.valorNuevo).toBe('Enfermería');
  });

  it('el usuario puede ser un id que no existe (sin clave foránea) y el historial se lee igual', async () => {
    const { tambo, vaca } = await prepararVaca();
    const fantasma = crypto.randomUUID();
    await crearCambioDirecto(tambo, vaca.id, { usuarioId: fantasma, usuarioNombre: 'Usuario eliminado' });
    const fila = await prisma.cambioAnimal.findFirstOrThrow({ where: { animalId: vaca.id } });
    expect(fila.usuarioId).toBe(fantasma);
  });

  it('una madre que ya no está activa no afecta al historial (guarda su número como texto)', async () => {
    const { tambo, vaca } = await prepararVaca();
    const madre = await crearAnimalDirecto(tambo, 'M1');
    await crearCambioDirecto(tambo, vaca.id, { campo: 'MADRE', valorAnterior: null, valorNuevo: madre.numero });
    await prisma.animal.update({ where: { id: madre.id }, data: { estado: 'BAJA', fechaBaja: new Date('2026-11-01T00:00:00.000Z') } });
    const fila = await prisma.cambioAnimal.findFirstOrThrow({ where: { animalId: vaca.id } });
    expect(fila.valorNuevo).toBe('M1');
  });
});

describe('Historial de cambios: estructura', () => {
  it('el enum CampoCambio tiene el orden fijo de RF-15', async () => {
    const filas = await prisma.$queryRaw<{ valor: string }[]>`
      SELECT e.enumlabel AS valor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'CampoCambio' ORDER BY e.enumsortorder`;
    expect(filas.map((f) => f.valor)).toEqual(['NUMERO', 'SEXO', 'FECHA_NACIMIENTO', 'MADRE', 'LOTE']);
  });

  it('limpiarBase vacía la tabla aunque el trigger impida el DELETE (TRUNCATE no lo dispara)', async () => {
    const { tambo, vaca } = await prepararVaca();
    await crearCambioDirecto(tambo, vaca.id);
    await limpiarBase();
    expect(await prisma.cambioAnimal.count()).toBe(0);
  });
});

describe('Invariantes nuevas de verificarInvariantes (RF-17 b y c)', () => {
  it('detecta un ciclo de madres (A madre de B y B de A) y una madre macho', async () => {
    const { tambo } = await prepararVaca();
    expect(await verificarInvariantes()).toEqual([]);
    const a = await crearAnimalDirecto(tambo, 'A');
    const b = await crearAnimalDirecto(tambo, 'B', { madreId: a.id });
    await prisma.animal.update({ where: { id: a.id }, data: { madreId: b.id } });
    expect((await verificarInvariantes()).some((v) => v.startsWith('ciclo de madres'))).toBe(true);
    await prisma.animal.update({ where: { id: a.id }, data: { madreId: null } });
    const macho = await crearAnimalDirecto(tambo, 'T', { sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
    await crearAnimalDirecto(tambo, 'C', { madreId: macho.id });
    expect((await verificarInvariantes()).some((v) => v.startsWith('madre que no es hembra'))).toBe(true);
  });
});
