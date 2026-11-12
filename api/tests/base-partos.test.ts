import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  crearAnimalDirecto,
  crearBajaDirecta,
  crearPartoDirecto,
  crearSecadoDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  limpiarBase,
  prepararVaca,
  verificarInvariantes,
} from './ayudas.js';

// Estos tests NO pasan por la API: insertan directo en la base para comprobar que las
// garantías de las migraciones "partos_tipos_evento" y "partos_secados" están en PostgreSQL
// (RF-34, RF-35, RF-36, RF-37). Aunque la API tuviera un error, la base tiene que rechazar
// estos datos.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

const aFecha = (texto: string) => new Date(`${texto}T00:00:00.000Z`);

// Una vaca (101) en un tambo, con su usuario, lista para colgarle eventos.
async function tamboConVaca(sufijo = 'a') {
  const t = await prepararVaca({ nombreTambo: `Tambo ${sufijo}`, email: `${sufijo}@prueba.test`, numero: '101' });
  const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
  return { ...t, base };
}

const crearLote = (establecimientoId: string, nombre: string) => prisma.lote.create({ data: { establecimientoId, nombre } });

describe('Animal de baja sin lote (RF-34)', () => {
  it('rechaza un animal de baja con lote y acepta uno sin lote (control)', async () => {
    const { tambo } = await tamboConVaca();
    const lote = await crearLote(tambo, 'Ordeñe');
    await expect(
      prisma.animal.create({
        data: { establecimientoId: tambo, numero: '1', sexo: 'HEMBRA', estado: 'BAJA', fechaBaja: aFecha('2026-01-01'), motivoBaja: 'PARTO_ANULADO', loteId: lote.id },
      }),
    ).rejects.toThrow();
    await expect(crearBajaDirecta(tambo, '2')).resolves.toBeDefined();
  });

  it('rechaza pasar a baja a un animal que todavía tiene lote, y acepta si se le quita en el mismo cambio', async () => {
    const { tambo } = await tamboConVaca();
    const lote = await crearLote(tambo, 'Ordeñe');
    const animal = await crearAnimalDirecto(tambo, '5', { loteId: lote.id });
    await expect(
      prisma.animal.update({ where: { id: animal.id }, data: { estado: 'BAJA', fechaBaja: aFecha('2026-01-01'), motivoBaja: 'PARTO_ANULADO' } }),
    ).rejects.toThrow();
    await expect(
      prisma.animal.update({ where: { id: animal.id }, data: { estado: 'BAJA', fechaBaja: aFecha('2026-01-01'), motivoBaja: 'PARTO_ANULADO', loteId: null } }),
    ).resolves.toBeDefined();
  });

  it('la migración desasigna las bajas que ya tenían lote y después agrega el CHECK', async () => {
    const { tambo } = await tamboConVaca();
    const lote = await crearLote(tambo, 'Ordeñe');
    const sql = readFileSync(new URL('../prisma/migrations/20261111180100_partos_secados/migration.sql', import.meta.url), 'utf8');
    const update = sql.match(/UPDATE "animales" SET "loteId" = NULL[^;]*;/)?.[0];
    const check = sql.match(/ALTER TABLE "animales" ADD CONSTRAINT "animales_baja_sin_lote"[^;]*;/)?.[0];
    expect(update).toBeDefined();
    expect(check).toBeDefined();
    // Dentro de una transacción que se deshace al final: se reconstruye el estado ANTERIOR a la
    // migración (sin el CHECK, con una baja con lote) y se ejecutan las sentencias reales del
    // archivo. Si el orden fuera el inverso (CHECK primero), esto fallaría.
    const DESHACER = new Error('deshacer');
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('ALTER TABLE "animales" DROP CONSTRAINT "animales_baja_sin_lote"');
        const baja = await tx.animal.create({
          data: { establecimientoId: tambo, numero: '9', sexo: 'HEMBRA', estado: 'BAJA', fechaBaja: aFecha('2026-01-01'), motivoBaja: 'PARTO_ANULADO', loteId: lote.id },
        });
        await tx.$executeRawUnsafe(update!);
        // Desde la spec 006 hay un disparador diferido en animales: PostgreSQL no deja hacer un ALTER TABLE
        // con eventos de disparador pendientes, así que se fuerza su control antes del ALTER.
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        await tx.$executeRawUnsafe(check!);
        expect((await tx.animal.findUniqueOrThrow({ where: { id: baja.id } })).loteId).toBeNull();
        throw DESHACER;
      })
      .catch((e) => {
        if (e !== DESHACER) throw e;
      });
    // La estructura real no cambió: el CHECK sigue vigente.
    await expect(
      prisma.animal.create({
        data: { establecimientoId: tambo, numero: '10', sexo: 'HEMBRA', estado: 'BAJA', fechaBaja: aFecha('2026-01-01'), motivoBaja: 'PARTO_ANULADO', loteId: lote.id },
      }),
    ).rejects.toThrow();
  });

  it('el motivo de baja solo existe en una baja', async () => {
    const { tambo } = await tamboConVaca();
    await expect(crearBajaDirecta(tambo, '1', { motivoBaja: 'PARTO_ANULADO' })).resolves.toBeDefined();
    await expect(crearBajaDirecta(tambo, '2')).resolves.toBeDefined(); // bajas viejas: sin motivo
    await expect(
      prisma.animal.create({ data: { establecimientoId: tambo, numero: '3', sexo: 'HEMBRA', estado: 'EN_ORDENE', motivoBaja: 'PARTO_ANULADO' } }),
    ).rejects.toThrow();
  });
});

describe('Número único entre activos (RF-35)', () => {
  it('permite repetir el número de una baja y rechaza dos activos', async () => {
    const { tambo } = await tamboConVaca();
    await crearBajaDirecta(tambo, 'C1', { motivoBaja: 'PARTO_ANULADO' });
    await expect(crearAnimalDirecto(tambo, 'C1', { estado: 'RECIEN_NACIDO' })).resolves.toBeDefined();
    await expect(crearAnimalDirecto(tambo, 'C1', { estado: 'RECIEN_NACIDO' })).rejects.toThrow();
    await expect(crearBajaDirecta(tambo, 'C1')).resolves.toBeDefined(); // otra baja con el mismo número
  });

  it('dos altas simultáneas del mismo número: una sola entra', async () => {
    const { tambo } = await tamboConVaca();
    const resultados = await Promise.allSettled([
      crearAnimalDirecto(tambo, 'SIM', { estado: 'RECIEN_NACIDO' }),
      crearAnimalDirecto(tambo, 'SIM', { estado: 'RECIEN_NACIDO' }),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await verificarInvariantes()).toEqual([]);
  });
});

describe('Coherencias entre tambos (RF-36)', () => {
  it('control: un parto con servicio de genética y dos crías, y un secado, se aceptan', async () => {
    const { base, tambo } = await tamboConVaca();
    const servicio = await crearServicioDirecto({ ...base, fecha: '2026-01-01' });
    await expect(
      crearPartoDirecto({ ...base, fecha: '2026-10-05', servicioId: servicio.id, crias: [{ sexo: 'HEMBRA' }, { sexo: 'MACHO', nacidaMuerta: true }] }),
    ).resolves.toBeDefined();
    await expect(crearSecadoDirecto({ ...base, fecha: '2026-11-01' })).resolves.toBeDefined();
    expect(await prisma.criaParto.count({ where: { establecimientoId: tambo } })).toBe(2);
    expect(await verificarInvariantes()).toEqual([]);
  });

  it('1. el detalle es del tipo correcto: un parto sobre un tacto, un secado sobre un servicio y un servicio sobre un parto se rechazan', async () => {
    const { base, tambo } = await tamboConVaca();
    const tacto = await crearTactoDirecto({ ...base, fecha: '2026-03-01' });
    const servicio = await crearServicioDirecto({ ...base, fecha: '2026-04-01' });
    const parto = await crearPartoDirecto({ ...base, fecha: '2026-10-05' });
    await expect(
      prisma.parto.create({ data: { eventoId: tacto.id, establecimientoId: tambo, tipo: 'PARTO', madreId: base.animalId, estadoAnterior: 'EN_ORDENE' } }),
    ).rejects.toThrow();
    await expect(
      prisma.secado.create({ data: { eventoId: servicio.id, establecimientoId: tambo, tipo: 'SECADO', estadoAnterior: 'EN_ORDENE' } }),
    ).rejects.toThrow();
    await expect(
      prisma.servicio.create({ data: { eventoId: parto.id, establecimientoId: tambo, tipo: 'SERVICIO', tipoServicio: 'INSEMINACION' } }),
    ).rejects.toThrow();
  });

  it('1b. el evento del parto es de otro tambo o la madre no es la vaca del evento: se rechaza', async () => {
    const a = await tamboConVaca('a');
    const b = await tamboConVaca('b');
    const otra = await crearAnimalDirecto(a.tambo, '202');
    const evento = await prisma.evento.create({
      data: { establecimientoId: a.tambo, animalId: a.vaca.id, tipo: 'PARTO', fecha: aFecha('2026-10-05'), registradoPorId: a.usuarioId },
    });
    // Madre distinta de la vaca del evento.
    await expect(
      prisma.parto.create({ data: { eventoId: evento.id, establecimientoId: a.tambo, tipo: 'PARTO', madreId: otra.id, estadoAnterior: 'EN_ORDENE' } }),
    ).rejects.toThrow();
    // Detalle declarado en otro tambo.
    await expect(
      prisma.parto.create({ data: { eventoId: evento.id, establecimientoId: b.tambo, tipo: 'PARTO', madreId: a.vaca.id, estadoAnterior: 'EN_ORDENE' } }),
    ).rejects.toThrow();
    await expect(
      prisma.parto.create({ data: { eventoId: evento.id, establecimientoId: a.tambo, tipo: 'PARTO', madreId: a.vaca.id, estadoAnterior: 'EN_ORDENE' } }),
    ).resolves.toBeDefined();
  });

  it('2. el servicio de genética es de la misma vaca, del mismo tambo y de tipo servicio', async () => {
    const a = await tamboConVaca('a');
    const b = await tamboConVaca('b');
    const otra = await crearAnimalDirecto(a.tambo, '202');
    const servicioOtraVaca = await crearServicioDirecto({ ...a.base, animalId: otra.id, fecha: '2026-01-01' });
    const servicioOtroTambo = await crearServicioDirecto({ ...b.base, fecha: '2026-01-01' });
    const tacto = await crearTactoDirecto({ ...a.base, fecha: '2026-03-01' });
    const servicioPropio = await crearServicioDirecto({ ...a.base, fecha: '2026-01-02' });

    for (const [ajeno, nombre] of [
      [servicioOtraVaca.id, 'de otra vaca'],
      [servicioOtroTambo.id, 'de otro tambo'],
      [tacto.id, 'un tacto'],
    ] as const) {
      await expect(crearPartoDirecto({ ...a.base, fecha: '2026-10-05', servicioId: ajeno }), nombre).rejects.toThrow();
    }
    await expect(crearPartoDirecto({ ...a.base, fecha: '2026-10-05', servicioId: servicioPropio.id })).resolves.toBeDefined();
  });

  it('2b. servicioId y servicioTipo van juntos y el tipo tiene que ser SERVICIO', async () => {
    const { base, tambo } = await tamboConVaca();
    const servicio = await crearServicioDirecto({ ...base, fecha: '2026-01-01' });
    const evento = await prisma.evento.create({
      data: { establecimientoId: tambo, animalId: base.animalId, tipo: 'PARTO', fecha: aFecha('2026-10-05'), registradoPorId: base.registradoPorId },
    });
    const datos = { eventoId: evento.id, establecimientoId: tambo, tipo: 'PARTO' as const, madreId: base.animalId, estadoAnterior: 'EN_ORDENE' as const };
    await expect(prisma.parto.create({ data: { ...datos, servicioId: servicio.id } })).rejects.toThrow(); // falta el tipo
    await expect(prisma.parto.create({ data: { ...datos, servicioTipo: 'SERVICIO' } })).rejects.toThrow(); // falta el id
    await expect(prisma.parto.create({ data: { ...datos, servicioId: servicio.id, servicioTipo: 'TACTO' } })).rejects.toThrow();
  });

  it('3. la cría tiene madre del mismo tambo', async () => {
    const a = await tamboConVaca('a');
    const b = await tamboConVaca('b');
    await expect(crearAnimalDirecto(a.tambo, 'X1', { estado: 'RECIEN_NACIDO', madreId: b.vaca.id })).rejects.toThrow();
    await expect(crearAnimalDirecto(a.tambo, 'X1', { estado: 'RECIEN_NACIDO', madreId: a.vaca.id })).resolves.toBeDefined();
  });

  it('4. la cría viva es hija de la madre del parto y del mismo tambo, y no está en dos partos', async () => {
    const a = await tamboConVaca('a');
    const b = await tamboConVaca('b');
    const otra = await crearAnimalDirecto(a.tambo, '202');
    const hijaDeOtra = await crearAnimalDirecto(a.tambo, 'H1', { estado: 'RECIEN_NACIDO', madreId: otra.id });
    const hijaDeB = await crearAnimalDirecto(b.tambo, 'H2', { estado: 'RECIEN_NACIDO', madreId: b.vaca.id });
    const sinMadre = await crearAnimalDirecto(a.tambo, 'H3', { estado: 'RECIEN_NACIDO' });
    const hijaPropia = await crearAnimalDirecto(a.tambo, 'H4', { estado: 'RECIEN_NACIDO', madreId: a.vaca.id });

    // El parto de la vaca A se arma con una cría muerta (sin animal) y se le intenta colgar cada animal.
    const parto = await crearPartoDirecto({ ...a.base, fecha: '2026-10-05', crias: [{ nacidaMuerta: true }] });
    const cria = (animalId: string, orden: number, eventoId = parto.id, establecimientoId = a.tambo) =>
      prisma.criaParto.create({
        data: { establecimientoId, eventoId, madreId: a.vaca.id, orden, sexo: 'HEMBRA', nacidaMuerta: false, animalId },
      });
    await expect(cria(hijaDeOtra.id, 2), 'hija de otra madre').rejects.toThrow();
    await expect(cria(hijaDeB.id, 2), 'animal de otro tambo').rejects.toThrow();
    await expect(cria(sinMadre.id, 2), 'sin madre').rejects.toThrow();
    // Un parto de OTRO tambo no acepta crías declaradas con el tambo A.
    const partoB = await crearPartoDirecto({ ...b.base, fecha: '2026-10-05', crias: [{ nacidaMuerta: true }] });
    await expect(cria(hijaPropia.id, 2, partoB.id), 'parto de otro tambo').rejects.toThrow();
    await expect(cria(hijaPropia.id, 2)).resolves.toBeDefined();
    // La misma cría viva en un segundo parto de la misma madre: rechazada.
    const parto2 = await crearPartoDirecto({ ...a.base, fecha: '2026-12-05', crias: [{ nacidaMuerta: true }] });
    await expect(cria(hijaPropia.id, 2, parto2.id), 'misma cría en dos partos').rejects.toThrow();
  });

  it('5. el lote previo es del mismo tambo', async () => {
    const a = await tamboConVaca('a');
    const b = await tamboConVaca('b');
    const loteB = await crearLote(b.tambo, 'Del B');
    const loteA = await crearLote(a.tambo, 'Del A');
    await expect(crearPartoDirecto({ ...a.base, fecha: '2026-10-05', loteAnteriorId: loteB.id })).rejects.toThrow();
    await expect(crearSecadoDirecto({ ...a.base, fecha: '2026-11-01', loteAnteriorId: loteB.id })).rejects.toThrow();
    await expect(crearPartoDirecto({ ...a.base, fecha: '2026-10-05', loteAnteriorId: loteA.id })).resolves.toBeDefined();
    await expect(crearSecadoDirecto({ ...a.base, fecha: '2026-11-01', loteAnteriorId: loteA.id })).resolves.toBeDefined();
  });
});

describe('Cría viva sin número y muerta sin animal; demás CHECK', () => {
  it('una cría viva exige animal y una nacida muerta no puede tenerlo', async () => {
    const { base, tambo, vaca } = await tamboConVaca();
    const parto = await crearPartoDirecto({ ...base, fecha: '2026-10-05', crias: [{ nacidaMuerta: true }] });
    const hija = await crearAnimalDirecto(tambo, 'H1', { estado: 'RECIEN_NACIDO', madreId: vaca.id });
    const datos = { establecimientoId: tambo, eventoId: parto.id, madreId: vaca.id, sexo: 'HEMBRA' as const };
    await expect(prisma.criaParto.create({ data: { ...datos, orden: 2, nacidaMuerta: false, animalId: null } })).rejects.toThrow(); // viva sin animal
    await expect(prisma.criaParto.create({ data: { ...datos, orden: 2, nacidaMuerta: true, animalId: hija.id } })).rejects.toThrow(); // muerta con animal
    await expect(prisma.criaParto.create({ data: { ...datos, orden: 2, nacidaMuerta: false, animalId: hija.id } })).resolves.toBeDefined();
  });

  it('el orden es 1 o 2 y no se repite; las observaciones tienen 1 a 200 caracteres', async () => {
    const { base, tambo, vaca } = await tamboConVaca();
    const parto = await crearPartoDirecto({ ...base, fecha: '2026-10-05', crias: [{ nacidaMuerta: true }] });
    const datos = { establecimientoId: tambo, eventoId: parto.id, madreId: vaca.id, sexo: 'MACHO' as const, nacidaMuerta: true };
    await expect(prisma.criaParto.create({ data: { ...datos, orden: 1 } })).rejects.toThrow(); // repetido
    await expect(prisma.criaParto.create({ data: { ...datos, orden: 3 } })).rejects.toThrow();
    await expect(prisma.criaParto.create({ data: { ...datos, orden: 0 } })).rejects.toThrow();
    await expect(prisma.criaParto.create({ data: { ...datos, orden: 2, observaciones: '' } })).rejects.toThrow();
    await expect(prisma.criaParto.create({ data: { ...datos, orden: 2, observaciones: 'x'.repeat(201) } })).rejects.toThrow();
    await expect(prisma.criaParto.create({ data: { ...datos, orden: 2, observaciones: 'x'.repeat(200) } })).resolves.toBeDefined();
  });

  it('el estado previo del parto no puede ser recién nacida ni baja, y el del secado solo en ordeñe', async () => {
    const { base, tambo } = await tamboConVaca();
    for (const estadoAnterior of ['RECIEN_NACIDO', 'BAJA'] as const) {
      const e = await prisma.evento.create({
        data: { establecimientoId: tambo, animalId: base.animalId, tipo: 'PARTO', fecha: aFecha('2026-10-05'), registradoPorId: base.registradoPorId },
      });
      await expect(
        prisma.parto.create({ data: { eventoId: e.id, establecimientoId: tambo, tipo: 'PARTO', madreId: base.animalId, estadoAnterior } }),
      ).rejects.toThrow();
    }
    const s = await prisma.evento.create({
      data: { establecimientoId: tambo, animalId: base.animalId, tipo: 'SECADO', fecha: aFecha('2026-10-06'), registradoPorId: base.registradoPorId },
    });
    await expect(
      prisma.secado.create({ data: { eventoId: s.id, establecimientoId: tambo, tipo: 'SECADO', estadoAnterior: 'SECA' } }),
    ).rejects.toThrow();
    await expect(
      prisma.secado.create({ data: { eventoId: s.id, establecimientoId: tambo, tipo: 'SECADO', estadoAnterior: 'EN_ORDENE' } }),
    ).resolves.toBeDefined();
  });

  it('un lote previo exige el indicador tuvoLoteAnterior en true', async () => {
    const { base, tambo } = await tamboConVaca();
    const lote = await crearLote(tambo, 'Ordeñe');
    await expect(crearPartoDirecto({ ...base, fecha: '2026-10-05', loteAnteriorId: lote.id, tuvoLoteAnterior: false })).rejects.toThrow();
    await expect(crearSecadoDirecto({ ...base, fecha: '2026-11-01', loteAnteriorId: lote.id, tuvoLoteAnterior: false })).rejects.toThrow();
  });
});

describe('Eliminar un lote que figura como lote previo (RF-37)', () => {
  it('lo elimina y deja el lote previo del historial como "eliminado" sin tocar nada más', async () => {
    const { base, tambo } = await tamboConVaca();
    const lote = await crearLote(tambo, 'Ordeñe');
    const parto = await crearPartoDirecto({ ...base, fecha: '2026-10-05', loteAnteriorId: lote.id });
    const secado = await crearSecadoDirecto({ ...base, fecha: '2026-11-01', loteAnteriorId: lote.id });
    const sinLote = await crearSecadoDirecto({ ...base, fecha: '2026-11-02' });

    await prisma.lote.delete({ where: { id: lote.id } });

    const p = await prisma.parto.findUniqueOrThrow({ where: { eventoId: parto.id } });
    expect(p.loteAnteriorId).toBeNull();
    expect(p.tuvoLoteAnterior).toBe(true); // "lote previo eliminado", no "sin lote previo"
    expect(p.establecimientoId).toBe(tambo); // la columna obligatoria no se toca
    const s = await prisma.secado.findUniqueOrThrow({ where: { eventoId: secado.id } });
    expect(s.loteAnteriorId).toBeNull();
    expect(s.tuvoLoteAnterior).toBe(true);
    expect(s.establecimientoId).toBe(tambo);
    // Un secado sin lote previo sigue igual.
    const n = await prisma.secado.findUniqueOrThrow({ where: { eventoId: sinLote.id } });
    expect([n.tuvoLoteAnterior, n.loteAnteriorId]).toEqual([false, null]);
    expect(await verificarInvariantes()).toEqual([]);
  });

  it('un lote con animales activos sigue sin poder eliminarse, aunque sea lote previo', async () => {
    const { base, tambo } = await tamboConVaca();
    const lote = await crearLote(tambo, 'Ordeñe');
    await crearAnimalDirecto(tambo, '300', { loteId: lote.id });
    const parto = await crearPartoDirecto({ ...base, fecha: '2026-10-05', loteAnteriorId: lote.id });
    await expect(prisma.lote.delete({ where: { id: lote.id } })).rejects.toThrow();
    expect((await prisma.parto.findUniqueOrThrow({ where: { eventoId: parto.id } })).loteAnteriorId).toBe(lote.id);
  });
});

describe('Invariantes (verificarInvariantes)', () => {
  it('detecta un parto sin crías', async () => {
    const { base, tambo } = await tamboConVaca();
    const e = await prisma.evento.create({
      data: { establecimientoId: tambo, animalId: base.animalId, tipo: 'PARTO', fecha: aFecha('2026-10-05'), registradoPorId: base.registradoPorId },
    });
    await prisma.parto.create({ data: { eventoId: e.id, establecimientoId: tambo, tipo: 'PARTO', madreId: base.animalId, estadoAnterior: 'EN_ORDENE' } });
    expect(await verificarInvariantes()).toEqual(['parto sin crías (1)']);
  });
});
