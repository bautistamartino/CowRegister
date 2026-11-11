import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { crearAnimalDirecto, crearSemenDirecto, crearServicioDirecto, crearTactoDirecto, limpiarBase } from './ayudas.js';

// Estos tests NO pasan por la API: insertan directo en la base para comprobar que
// las garantías de la migración "reproduccion_base" están en PostgreSQL (RF-3, RF-4,
// RF-19, RF-22, RF-27). Aunque la API tuviera un error, la base tiene que rechazar estos datos.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

// Un tambo con un usuario y una vaca, listo para colgarle eventos.
async function armarTambo(nombre = 'A') {
  const tambo = await prisma.establecimiento.create({ data: { nombre } });
  const usuario = await prisma.usuario.create({
    data: {
      establecimientoId: tambo.id,
      nombre: `Usuario ${nombre}`,
      email: `${nombre.toLowerCase()}@prueba.test`,
      passwordHash: 'x',
      rol: 'DUENO',
    },
  });
  const animal = await crearAnimalDirecto(tambo.id, '101');
  return { tambo, usuario, animal };
}

const datosEvento = (t: Awaited<ReturnType<typeof armarTambo>>, fecha = '2026-10-01') => ({
  establecimientoId: t.tambo.id,
  animalId: t.animal.id,
  registradoPorId: t.usuario.id,
  fecha,
});

describe('Catálogo de semen: nombre y raza (RF-3, RF-4)', () => {
  it('acepta una entrada válida con y sin raza (control)', async () => {
    const t = await prisma.establecimiento.create({ data: { nombre: 'A' } });
    await expect(crearSemenDirecto(t.id, 'Holando Toro 1234', { raza: 'Holando' })).resolves.toBeDefined();
    await expect(crearSemenDirecto(t.id, 'Toro 2')).resolves.toBeDefined();
  });

  it('rechaza un nombre repetido sin distinguir mayúsculas, también contra una desactivada', async () => {
    const t = await prisma.establecimiento.create({ data: { nombre: 'A' } });
    await crearSemenDirecto(t.id, 'Toro Uno', { activo: false });
    await expect(crearSemenDirecto(t.id, 'TORO UNO')).rejects.toThrow();
    await expect(crearSemenDirecto(t.id, 'toro uno')).rejects.toThrow();
  });

  it('permite el mismo nombre en otro tambo', async () => {
    const a = await prisma.establecimiento.create({ data: { nombre: 'A' } });
    const b = await prisma.establecimiento.create({ data: { nombre: 'B' } });
    await crearSemenDirecto(a.id, 'Toro Uno');
    await expect(crearSemenDirecto(b.id, 'Toro Uno')).resolves.toBeDefined();
  });

  it('rechaza un nombre vacío, con espacios en los extremos o de 51 caracteres', async () => {
    const t = await prisma.establecimiento.create({ data: { nombre: 'A' } });
    for (const malo of ['', ' Toro', 'Toro ', 'ñ'.repeat(51)]) {
      await expect(crearSemenDirecto(t.id, malo), `nombre "${malo}"`).rejects.toThrow();
    }
    await expect(crearSemenDirecto(t.id, 'ñ'.repeat(50))).resolves.toBeDefined();
  });

  it('rechaza una raza vacía, con espacios en los extremos o de 51 caracteres', async () => {
    const t = await prisma.establecimiento.create({ data: { nombre: 'A' } });
    let n = 0;
    for (const mala of ['', ' Holando', 'Holando ', 'x'.repeat(51)]) {
      await expect(crearSemenDirecto(t.id, `Toro ${++n}`, { raza: mala }), `raza "${mala}"`).rejects.toThrow();
    }
    await expect(crearSemenDirecto(t.id, 'Toro 9', { raza: 'x'.repeat(50) })).resolves.toBeDefined();
  });
});

describe('Eventos: claves compuestas (RF-27)', () => {
  it('acepta un servicio y un tacto bien armados (control)', async () => {
    const t = await armarTambo();
    const semen = await crearSemenDirecto(t.tambo.id, 'Toro 1');
    await expect(crearServicioDirecto({ ...datosEvento(t), semenId: semen.id })).resolves.toBeDefined();
    await expect(crearTactoDirecto({ ...datosEvento(t, '2026-10-20') })).resolves.toBeDefined();
  });

  it('rechaza un evento con un animal de otro tambo', async () => {
    const a = await armarTambo('A');
    const b = await armarTambo('B');
    // El animal es del tambo B pero el evento dice que es del tambo A.
    await expect(crearServicioDirecto({ ...datosEvento(a), animalId: b.animal.id })).rejects.toThrow();
  });

  it('rechaza un servicio con un semen de otro tambo', async () => {
    const a = await armarTambo('A');
    const b = await armarTambo('B');
    const semenB = await crearSemenDirecto(b.tambo.id, 'Toro de B');
    await expect(crearServicioDirecto({ ...datosEvento(a), semenId: semenB.id })).rejects.toThrow();
  });

  it('rechaza un usuario de otro tambo como quien registró o anuló', async () => {
    const a = await armarTambo('A');
    const b = await armarTambo('B');
    await expect(crearServicioDirecto({ ...datosEvento(a), registradoPorId: b.usuario.id })).rejects.toThrow();
    await expect(
      crearServicioDirecto({ ...datosEvento(a), anulacion: { porId: b.usuario.id, motivo: 'error' } }),
    ).rejects.toThrow();
  });

  it('rechaza un detalle colgado de un evento de otro tipo', async () => {
    const t = await armarTambo();
    const tacto = await crearTactoDirecto(datosEvento(t));
    // Un servicio que apunta a un evento TACTO: la clave (establecimientoId, id, tipo) no existe.
    await expect(
      prisma.servicio.create({
        data: { eventoId: tacto.id, establecimientoId: t.tambo.id, tipo: 'SERVICIO', tipoServicio: 'INSEMINACION' },
      }),
    ).rejects.toThrow();
    // Y con tipo TACTO choca contra el CHECK servicios_tipo.
    await expect(
      prisma.servicio.create({
        data: { eventoId: tacto.id, establecimientoId: t.tambo.id, tipo: 'TACTO', tipoServicio: 'INSEMINACION' },
      }),
    ).rejects.toThrow();
  });

  it('rechaza un detalle de otro tambo que apunta al evento', async () => {
    const a = await armarTambo('A');
    const b = await armarTambo('B');
    const servicioA = await crearServicioDirecto(datosEvento(a));
    await expect(
      prisma.tacto.create({
        data: { eventoId: servicioA.id, establecimientoId: b.tambo.id, tipo: 'TACTO', resultado: 'VACIA' },
      }),
    ).rejects.toThrow();
  });

  it('no deja borrar un animal con eventos ni un usuario que registró uno', async () => {
    const t = await armarTambo();
    await crearServicioDirecto(datosEvento(t));
    await expect(prisma.animal.delete({ where: { id: t.animal.id } })).rejects.toThrow();
    await expect(prisma.usuario.delete({ where: { id: t.usuario.id } })).rejects.toThrow();
  });
});

describe('Eventos: orden y fecha (RF-18, RF-22)', () => {
  it('rechaza dos eventos de un animal con el mismo momento de registro', async () => {
    const t = await armarTambo();
    const momento = new Date('2026-11-01T12:00:00.000Z');
    await crearServicioDirecto({ ...datosEvento(t), creadoEn: momento });
    await expect(crearTactoDirecto({ ...datosEvento(t), creadoEn: momento })).rejects.toThrow();
  });

  it('permite el mismo momento de registro en animales distintos', async () => {
    const t = await armarTambo();
    const otra = await crearAnimalDirecto(t.tambo.id, '102');
    const momento = new Date('2026-11-01T12:00:00.000Z');
    await crearServicioDirecto({ ...datosEvento(t), creadoEn: momento });
    await expect(crearServicioDirecto({ ...datosEvento(t), animalId: otra.id, creadoEn: momento })).resolves.toBeDefined();
  });

  it('rechaza una fecha anterior al 01/01/2000 y acepta el 01/01/2000', async () => {
    const t = await armarTambo();
    await expect(crearServicioDirecto(datosEvento(t, '1999-12-31'))).rejects.toThrow();
    await expect(crearServicioDirecto(datosEvento(t, '2000-01-01'))).resolves.toBeDefined();
  });
});

describe('Eventos: anulación (RF-19)', () => {
  it('acepta una anulación completa (control)', async () => {
    const t = await armarTambo();
    await expect(
      crearServicioDirecto({ ...datosEvento(t), anulacion: { porId: t.usuario.id, motivo: 'Me equivoqué de vaca' } }),
    ).resolves.toBeDefined();
  });

  it('rechaza una anulación a medias', async () => {
    const t = await armarTambo();
    const evento = await crearServicioDirecto(datosEvento(t));
    // Solo la fecha de anulación.
    await expect(prisma.evento.update({ where: { id: evento.id }, data: { anuladoEn: new Date() } })).rejects.toThrow();
    // Solo el motivo.
    await expect(prisma.evento.update({ where: { id: evento.id }, data: { motivoAnulacion: 'error' } })).rejects.toThrow();
    // Fecha y quién, pero sin motivo.
    await expect(
      prisma.evento.update({ where: { id: evento.id }, data: { anuladoEn: new Date(), anuladoPorId: t.usuario.id } }),
    ).rejects.toThrow();
  });

  it('rechaza un motivo de 201 caracteres o vacío, y acepta uno de 200', async () => {
    const t = await armarTambo();
    const anulacion = (motivo: string) => ({ porId: t.usuario.id, motivo });
    await expect(crearServicioDirecto({ ...datosEvento(t), anulacion: anulacion('x'.repeat(201)) })).rejects.toThrow();
    await expect(crearServicioDirecto({ ...datosEvento(t), anulacion: anulacion('   ') })).rejects.toThrow();
    await expect(crearServicioDirecto({ ...datosEvento(t), anulacion: anulacion('x'.repeat(200)) })).resolves.toBeDefined();
  });
});

describe('Tactos: detalle (RF-13, RF-14, RF-17)', () => {
  it('acepta fecha probable en un tacto preñada y la rechaza en uno vacía', async () => {
    const t = await armarTambo();
    await expect(
      crearTactoDirecto({ ...datosEvento(t), resultado: 'PRENADA', fechaProbableIndicada: '2027-05-01' }),
    ).resolves.toBeDefined();
    await expect(
      crearTactoDirecto({ ...datosEvento(t, '2026-10-20'), resultado: 'VACIA', fechaProbableIndicada: '2027-05-01' }),
    ).rejects.toThrow();
  });

  it('rechaza anomalías vacías o de 201 caracteres y acepta 200', async () => {
    const t = await armarTambo();
    await expect(crearTactoDirecto({ ...datosEvento(t), anomalias: '' })).rejects.toThrow();
    await expect(crearTactoDirecto({ ...datosEvento(t), anomalias: 'x'.repeat(201) })).rejects.toThrow();
    await expect(crearTactoDirecto({ ...datosEvento(t), anomalias: 'x'.repeat(200) })).resolves.toBeDefined();
  });
});
