import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  crearAnimalDeBajaPartoAnulado,
  crearAnimalDirecto,
  crearBajaRegistradaDirecta,
  crearServicioDirecto,
  limpiarBase,
  prepararVaca,
  verificarInvariantes,
} from './ayudas.js';

// Estos tests NO pasan por la API: insertan directo en la base para comprobar que las garantías de
// las migraciones "bajas_enums" y "bajas_base" están en PostgreSQL (RF-18, spec 006). Aunque la API
// tuviera un error, la base tiene que rechazar estos datos.
//
// Ojo con el disparador de coherencia animal–baja–evento: es DIFERIDO, o sea que se comprueba al
// CONFIRMAR la transacción (no sentencia por sentencia). Por eso los casos que lo prueban usan una
// sola sentencia (se confirma sola) o una transacción que termina en un estado incoherente.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

const aFecha = (texto: string) => new Date(`${texto}T00:00:00.000Z`);

// Un tambo con una vaca "101" en ordeñe, lista para darla de baja.
async function tamboConVaca(sufijo = 'a') {
  const t = await prepararVaca({ nombreTambo: `Tambo ${sufijo}`, email: `${sufijo}@prueba.test`, numero: '101' });
  const base = { establecimientoId: t.tambo, animalId: t.vaca.id, registradoPorId: t.usuarioId };
  return { ...t, base };
}

const crearLote = (establecimientoId: string, nombre: string) => prisma.lote.create({ data: { establecimientoId, nombre } });

// Datos válidos de un evento BAJA y de su detalle, para armar variantes rotas en cada test.
function datosEventoBaja(base: { establecimientoId: string; animalId: string; registradoPorId: string }, fecha = '2026-11-01') {
  return { id: crypto.randomUUID(), ...base, tipo: 'BAJA' as const, fecha: aFecha(fecha) };
}
function datosDetalle(
  base: { establecimientoId: string; animalId: string },
  eventoId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    eventoId,
    establecimientoId: base.establecimientoId,
    tipo: 'BAJA' as const,
    animalId: base.animalId,
    motivo: 'VENTA' as const,
    estadoAnterior: 'EN_ORDENE' as const,
    ...extra,
  };
}

describe('Fecha, motivo y lote del animal (RF-18.1)', () => {
  it('rechaza un animal de baja sin fecha o sin motivo (CHECK animales_baja_con_fecha_y_motivo)', async () => {
    const { tambo, vaca } = await tamboConVaca();
    // Sin motivo
    await expect(
      prisma.animal.update({ where: { id: vaca.id }, data: { estado: 'BAJA', fechaBaja: aFecha('2026-11-01'), loteId: null } }),
    ).rejects.toThrow(/animales_baja_con_fecha_y_motivo/);
    // Sin fecha
    await expect(
      prisma.animal.update({ where: { id: vaca.id }, data: { estado: 'BAJA', motivoBaja: 'PARTO_ANULADO', loteId: null } }),
    ).rejects.toThrow(/animales_baja_con_fecha_y_motivo/);
    // Con los dos (y un motivo que no exige baja registrada) sí se acepta
    await expect(crearAnimalDeBajaPartoAnulado(tambo, '102')).resolves.toBeDefined();
  });

  it('rechaza un animal activo con fecha de baja (CHECK animales_activo_sin_baja) o con motivo', async () => {
    const { vaca } = await tamboConVaca();
    await expect(prisma.animal.update({ where: { id: vaca.id }, data: { fechaBaja: aFecha('2026-11-01') } })).rejects.toThrow(
      /animales_activo_sin_baja/,
    );
    await expect(prisma.animal.update({ where: { id: vaca.id }, data: { motivoBaja: 'PARTO_ANULADO' } })).rejects.toThrow(
      /animales_motivo_baja_coherente/,
    );
  });

  it('rechaza un animal de baja con lote', async () => {
    const { tambo, base } = await tamboConVaca();
    const lote = await crearLote(tambo, 'Ordeñe');
    await expect(
      prisma.animal.create({
        data: {
          establecimientoId: tambo,
          numero: '7',
          sexo: 'HEMBRA',
          estado: 'BAJA',
          fechaBaja: aFecha('2026-11-01'),
          motivoBaja: 'PARTO_ANULADO',
          loteId: lote.id,
        },
      }),
    ).rejects.toThrow(/animales_baja_sin_lote/);
    // Una baja registrada deja al animal sin lote aunque lo tuviera antes (la siembra lo desasigna)
    const conLote = await crearAnimalDirecto(tambo, '8', { loteId: lote.id });
    await crearBajaRegistradaDirecta({ ...base, animalId: conLote.id, fecha: '2026-11-01', loteAnteriorId: lote.id });
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: conLote.id } })).loteId).toBeNull();
  });

  it('tras revertir la baja, el animal activo no puede conservar fecha ni motivo', async () => {
    const { vaca, base, usuarioId } = await tamboConVaca();
    const evento = await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01' });
    // Revertir dejando la fecha: la base lo rechaza al confirmar
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.animal.update({ where: { id: vaca.id }, data: { estado: 'EN_ORDENE', motivoBaja: null } });
        await tx.baja.update({ where: { eventoId: evento.id }, data: { vigente: false } });
        await tx.evento.update({
          where: { id: evento.id },
          data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'Carga equivocada' },
        });
      }),
    ).rejects.toThrow(/animales_activo_sin_baja/);
    // Revertir completo: se acepta
    await prisma.$transaction(async (tx) => {
      await tx.animal.update({ where: { id: vaca.id }, data: { estado: 'EN_ORDENE', fechaBaja: null, motivoBaja: null } });
      await tx.baja.update({ where: { eventoId: evento.id }, data: { vigente: false } });
      await tx.evento.update({
        where: { id: evento.id },
        data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'Carga equivocada' },
      });
    });
    expect(await verificarInvariantes()).toEqual([]);
  });
});

describe('Una sola baja vigente y coherencia con el animal (RF-18.2)', () => {
  it('rechaza una segunda baja vigente del mismo animal (índice único parcial)', async () => {
    const { base } = await tamboConVaca();
    await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01' });
    const evento2 = datosEventoBaja(base, '2026-11-02');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.evento.create({ data: { ...evento2, creadoEn: new Date() } });
        await tx.baja.create({ data: datosDetalle(base, evento2.id, { vigente: true }) });
      }),
    ).rejects.toThrow(/bajas_una_vigente_por_animal/);
  });

  it('acepta una segunda baja si la primera ya está revertida (anulada)', async () => {
    const { base, vaca, usuarioId } = await tamboConVaca();
    const primera = await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01' });
    await prisma.$transaction(async (tx) => {
      await tx.animal.update({ where: { id: vaca.id }, data: { estado: 'EN_ORDENE', fechaBaja: null, motivoBaja: null } });
      await tx.baja.update({ where: { eventoId: primera.id }, data: { vigente: false } });
      await tx.evento.update({
        where: { id: primera.id },
        data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'Carga equivocada' },
      });
    });
    await expect(crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-03', motivo: 'MUERTE' })).resolves.toBeDefined();
    expect(await prisma.baja.count({ where: { animalId: vaca.id } })).toBe(2);
    expect(await prisma.baja.count({ where: { animalId: vaca.id, vigente: true } })).toBe(1);
    expect(await verificarInvariantes()).toEqual([]);
  });

  it('con dos bajas simultáneas del mismo animal, una sola se confirma', async () => {
    // Repetido varias veces: es una carrera, y el índice único parcial tiene que ganarla siempre.
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      await limpiarBase();
      const { base, vaca } = await tamboConVaca();
      const resultados = await Promise.allSettled([
        crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01', motivo: 'VENTA' }),
        crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01', motivo: 'MUERTE' }),
      ]);
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(await prisma.baja.count({ where: { animalId: vaca.id, vigente: true } })).toBe(1);
      expect(await verificarInvariantes()).toEqual([]);
    }
  });

  it('rechaza que la fecha o el motivo del animal difieran de los de su baja vigente (disparador diferido)', async () => {
    const { base, vaca } = await tamboConVaca();
    await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01', motivo: 'VENTA' });
    await expect(prisma.animal.update({ where: { id: vaca.id }, data: { fechaBaja: aFecha('2026-11-02') } })).rejects.toThrow(
      /coherencia/i,
    );
    await expect(prisma.animal.update({ where: { id: vaca.id }, data: { motivoBaja: 'MUERTE' } })).rejects.toThrow(/coherencia/i);
    // Cambiar la fecha del evento sin cambiar la del animal tampoco se acepta
    await expect(prisma.evento.updateMany({ where: { animalId: vaca.id, tipo: 'BAJA' }, data: { fecha: aFecha('2026-10-30') } })).rejects.toThrow(
      /coherencia/i,
    );
    // Ni cambiar el motivo de la baja sin tocar al animal
    await expect(prisma.baja.updateMany({ where: { animalId: vaca.id }, data: { motivo: 'MUERTE' } })).rejects.toThrow(/coherencia/i);
    expect(await verificarInvariantes()).toEqual([]);
  });

  it('acepta cambiar fecha y motivo del animal Y de la baja en la misma transacción (el control es al confirmar)', async () => {
    const { base, vaca } = await tamboConVaca();
    const evento = await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01', motivo: 'VENTA' });
    await prisma.$transaction(async (tx) => {
      await tx.animal.update({ where: { id: vaca.id }, data: { fechaBaja: aFecha('2026-11-02'), motivoBaja: 'MUERTE' } });
      await tx.evento.update({ where: { id: evento.id }, data: { fecha: aFecha('2026-11-02') } });
      await tx.baja.update({ where: { eventoId: evento.id }, data: { motivo: 'MUERTE' } });
    });
    expect(await verificarInvariantes()).toEqual([]);
  });

  it('rechaza un animal de baja por venta o muerte sin baja vigente', async () => {
    const { tambo } = await tamboConVaca();
    await expect(
      prisma.animal.create({
        data: {
          establecimientoId: tambo,
          numero: '55',
          sexo: 'HEMBRA',
          estado: 'BAJA',
          fechaBaja: aFecha('2026-11-01'),
          motivoBaja: 'VENTA',
        },
      }),
    ).rejects.toThrow(/coherencia/i);
  });

  it('rechaza pasar a activo a un animal con baja vigente, y una baja vigente sobre un animal activo', async () => {
    const { base, vaca } = await tamboConVaca();
    await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01' });
    // Reactivar al animal sin marcar la baja como anulada
    await expect(
      prisma.animal.update({ where: { id: vaca.id }, data: { estado: 'EN_ORDENE', fechaBaja: null, motivoBaja: null } }),
    ).rejects.toThrow(/coherencia/i);
    // Baja vigente creada sobre un animal que sigue activo
    const otra = await crearAnimalDirecto(base.establecimientoId, '202');
    const evento = datosEventoBaja({ ...base, animalId: otra.id });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.evento.create({ data: { ...evento, creadoEn: new Date() } });
        await tx.baja.create({ data: datosDetalle({ ...base, animalId: otra.id }, evento.id, { vigente: true }) });
      }),
    ).rejects.toThrow(/coherencia/i);
  });

  it('exige que "vigente" equivalga a que el evento no esté anulado', async () => {
    const { base, vaca, usuarioId } = await tamboConVaca();
    const evento = await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01' });
    // Anular el evento dejando la baja vigente
    await expect(
      prisma.evento.update({
        where: { id: evento.id },
        data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'Error' },
      }),
    ).rejects.toThrow(/coherencia/i);
    // Marcar la baja como no vigente dejando el evento sin anular (y al animal de baja)
    await expect(prisma.baja.update({ where: { eventoId: evento.id }, data: { vigente: false } })).rejects.toThrow(/coherencia/i);
    expect((await prisma.baja.findUniqueOrThrow({ where: { eventoId: evento.id } })).vigente).toBe(true);
    expect(vaca.id).toBe(base.animalId);
  });

  it('una baja por "parto anulado" sin evento sigue siendo válida (el disparador la excluye)', async () => {
    const { tambo } = await tamboConVaca();
    const cria = await crearAnimalDeBajaPartoAnulado(tambo, 'C1');
    expect(cria).toMatchObject({ estado: 'BAJA', motivoBaja: 'PARTO_ANULADO' });
    await expect(prisma.animal.update({ where: { id: cria.id }, data: { sexo: 'MACHO' } })).resolves.toBeDefined();
    expect(await verificarInvariantes()).toEqual([]);
  });
});

describe('La baja es del tambo, del animal y del tipo correctos (RF-18.3)', () => {
  it('rechaza una baja cuyo evento es de otro tambo', async () => {
    const a = await tamboConVaca('a');
    const b = await tamboConVaca('b');
    const evento = datosEventoBaja(a.base);
    await prisma.evento.create({ data: { ...evento, creadoEn: new Date() } });
    // El detalle dice que es del tambo b, pero el evento es del tambo a
    await expect(
      prisma.baja.create({ data: datosDetalle({ establecimientoId: b.tambo, animalId: a.vaca.id }, evento.id, { vigente: false }) }),
    ).rejects.toThrow();
  });

  it('rechaza una baja cuyo animal no es el del evento', async () => {
    const { base, tambo } = await tamboConVaca();
    const otra = await crearAnimalDirecto(tambo, '202');
    const evento = datosEventoBaja(base);
    await prisma.evento.create({ data: { ...evento, creadoEn: new Date() } });
    await expect(
      prisma.baja.create({ data: datosDetalle({ establecimientoId: tambo, animalId: otra.id }, evento.id, { vigente: false }) }),
    ).rejects.toThrow();
  });

  it('rechaza una baja que cuelga de un evento de otro tipo, y un detalle con tipo distinto de BAJA', async () => {
    const { base } = await tamboConVaca();
    const servicio = await crearServicioDirecto({ ...base, fecha: '2026-10-01' });
    // El detalle dice tipo BAJA pero el evento es un SERVICIO: la clave compuesta no encuentra el destino
    await expect(prisma.baja.create({ data: datosDetalle(base, servicio.id, { vigente: false }) })).rejects.toThrow();
    // Y el detalle no puede declararse de otro tipo (CHECK bajas_tipo)
    await expect(
      prisma.baja.create({ data: datosDetalle(base, servicio.id, { vigente: false, tipo: 'SERVICIO' }) }),
    ).rejects.toThrow(/bajas_tipo|violates/);
  });

  it('acepta la baja bien formada (control) y valida sus CHECK', async () => {
    const { base, tambo } = await tamboConVaca();
    await expect(crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01', observaciones: 'x'.repeat(200) })).resolves.toBeDefined();
    const otra = await crearAnimalDirecto(tambo, '202');
    const otraBase = { ...base, animalId: otra.id };
    // observaciones: de 1 a 200 caracteres o nulas
    for (const obs of ['', 'x'.repeat(201)]) {
      const evento = datosEventoBaja(otraBase);
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.evento.create({ data: { ...evento, creadoEn: new Date() } });
          await tx.baja.create({ data: datosDetalle(otraBase, evento.id, { vigente: false, observaciones: obs }) });
        }),
      ).rejects.toThrow(/bajas_observaciones_largo/);
    }
    // estado previo: nunca BAJA
    const evento = datosEventoBaja(otraBase);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.evento.create({ data: { ...evento, creadoEn: new Date() } });
        await tx.baja.create({ data: datosDetalle(otraBase, evento.id, { vigente: false, estadoAnterior: 'BAJA' }) });
      }),
    ).rejects.toThrow(/bajas_estado_anterior/);
    // lote previo con su indicador: un lote sin tuvoLoteAnterior es incoherente
    const lote = await crearLote(tambo, 'Ordeñe');
    const evento2 = datosEventoBaja(otraBase);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.evento.create({ data: { ...evento2, creadoEn: new Date() } });
        await tx.baja.create({
          data: datosDetalle(otraBase, evento2.id, { vigente: false, loteAnteriorId: lote.id, tuvoLoteAnterior: false }),
        });
      }),
    ).rejects.toThrow(/bajas_lote_anterior_coherente/);
  });
});

describe('Anulación completa de la baja (RF-18.4)', () => {
  it('rechaza anular el evento BAJA con la anulación incompleta, y acepta la completa', async () => {
    const { base, vaca, usuarioId } = await tamboConVaca();
    // Evento con la baja ya revertida (animal activo), para probar solo el CHECK del evento
    const evento = await crearBajaRegistradaDirecta({
      ...base,
      fecha: '2026-11-01',
      anulacion: { porId: usuarioId, motivo: 'Cargada por error' },
    });
    const nuevo = await prisma.evento.findUniqueOrThrow({ where: { id: evento.id } });
    expect(nuevo.anuladoEn).not.toBeNull();
    // Sembrar una baja anulada a medias
    const otro = datosEventoBaja({ ...base, animalId: (await crearAnimalDirecto(base.establecimientoId, '202')).id });
    await expect(prisma.evento.create({ data: { ...otro, creadoEn: new Date(), anuladoEn: new Date() } })).rejects.toThrow(
      /eventos_anulacion_completa/,
    );
    await expect(
      prisma.evento.update({ where: { id: evento.id }, data: { motivoAnulacion: null } }),
    ).rejects.toThrow(/eventos_anulacion_completa/);
    expect(vaca.id).toBe(base.animalId);
  });
});

describe('Valores cerrados del tipo y del motivo (RF-18.5)', () => {
  it('el enum de motivos tiene venta, muerte y parto anulado, y el de tipos suma BAJA', async () => {
    const motivos = await prisma.$queryRawUnsafe<Array<{ v: string }>>(`SELECT unnest(enum_range(NULL::"MotivoBaja"))::text AS v`);
    expect(motivos.map((m) => m.v).sort()).toEqual(['MUERTE', 'PARTO_ANULADO', 'VENTA']);
    const tipos = await prisma.$queryRawUnsafe<Array<{ v: string }>>(`SELECT unnest(enum_range(NULL::"TipoEvento"))::text AS v`);
    expect(tipos.map((t) => t.v)).toContain('BAJA');
  });

  it('rechaza un motivo fuera de la lista y, en una baja registrada, el motivo "parto anulado"', async () => {
    const { tambo, base } = await tamboConVaca();
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "animales" SET "motivoBaja" = 'ROBO' WHERE id = '${base.animalId}'::uuid`),
    ).rejects.toThrow();
    const evento = datosEventoBaja(base);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.evento.create({ data: { ...evento, creadoEn: new Date() } });
        await tx.baja.create({ data: datosDetalle(base, evento.id, { vigente: false, motivo: 'PARTO_ANULADO' }) });
      }),
    ).rejects.toThrow(/bajas_motivo/);
    expect(tambo).toBe(base.establecimientoId);
  });

  it('las bajas existentes por "parto anulado" siguen siendo válidas, también al editarlas', async () => {
    const { tambo } = await tamboConVaca();
    const cria = await crearAnimalDeBajaPartoAnulado(tambo, 'C9');
    await expect(prisma.animal.update({ where: { id: cria.id }, data: { numero: 'C10' } })).resolves.toBeDefined();
    expect(await verificarInvariantes()).toEqual([]);
  });
});

describe('Los historiales de baja solo se agregan (RF-18.6)', () => {
  it('revertir no borra ninguna fila: la baja y su evento quedan, anulados', async () => {
    const { base, vaca, usuarioId } = await tamboConVaca();
    const evento = await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01' });
    const antes = { eventos: await prisma.evento.count(), bajas: await prisma.baja.count() };
    await prisma.$transaction(async (tx) => {
      await tx.animal.update({ where: { id: vaca.id }, data: { estado: 'EN_ORDENE', fechaBaja: null, motivoBaja: null } });
      await tx.baja.update({ where: { eventoId: evento.id }, data: { vigente: false } });
      await tx.evento.update({
        where: { id: evento.id },
        data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'Carga equivocada' },
      });
    });
    expect({ eventos: await prisma.evento.count(), bajas: await prisma.baja.count() }).toEqual(antes);
    expect((await prisma.baja.findUniqueOrThrow({ where: { eventoId: evento.id } })).vigente).toBe(false);
  });

  it('la base rechaza borrar una baja, vigente o revertida, y borrar su evento', async () => {
    const { base, vaca, usuarioId } = await tamboConVaca();
    const evento = await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01' });
    await expect(prisma.baja.delete({ where: { eventoId: evento.id } })).rejects.toThrow(/solo se agrega/i);
    await expect(prisma.evento.delete({ where: { id: evento.id } })).rejects.toThrow();
    // Revertida también
    await prisma.$transaction(async (tx) => {
      await tx.animal.update({ where: { id: vaca.id }, data: { estado: 'EN_ORDENE', fechaBaja: null, motivoBaja: null } });
      await tx.baja.update({ where: { eventoId: evento.id }, data: { vigente: false } });
      await tx.evento.update({
        where: { id: evento.id },
        data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'Carga equivocada' },
      });
    });
    await expect(prisma.baja.delete({ where: { eventoId: evento.id } })).rejects.toThrow(/solo se agrega/i);
    expect(await prisma.baja.count()).toBe(1);
  });
});

describe('Lote previo de la baja', () => {
  it('si se elimina el lote previo queda como "eliminado": sin id, con el indicador y sin tocar el tambo', async () => {
    const { base, tambo } = await tamboConVaca();
    const lote = await crearLote(tambo, 'Ordeñe');
    const evento = await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01', loteAnteriorId: lote.id });
    expect(await prisma.baja.findUniqueOrThrow({ where: { eventoId: evento.id } })).toMatchObject({
      loteAnteriorId: lote.id,
      tuvoLoteAnterior: true,
    });
    // El lote ya no tiene animales (la baja lo dejó sin lote), así que se puede eliminar
    await prisma.lote.delete({ where: { id: lote.id } });
    expect(await prisma.baja.findUniqueOrThrow({ where: { eventoId: evento.id } })).toMatchObject({
      loteAnteriorId: null,
      tuvoLoteAnterior: true,
      establecimientoId: tambo,
    });
  });

  it('rechaza un lote previo de otro tambo', async () => {
    const a = await tamboConVaca('a');
    const b = await tamboConVaca('b');
    const loteB = await crearLote(b.tambo, 'Ordeñe');
    await expect(crearBajaRegistradaDirecta({ ...a.base, fecha: '2026-11-01', loteAnteriorId: loteB.id })).rejects.toThrow();
  });
});

describe('Invariantes de bajas (RF-16 de la spec)', () => {
  it('no marcan nada con bajas bien formadas, y marcan la cría vinculada después de la baja de su madre (e)', async () => {
    const { base, tambo, vaca } = await tamboConVaca();
    // Cría vinculada ANTES de la baja: bien
    const antes = await crearAnimalDirecto(tambo, 'C1', { madreId: vaca.id });
    await prisma.animal.update({ where: { id: antes.id }, data: { creadoEn: new Date(Date.now() - 60_000) } });
    await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01', creadoEn: new Date() });
    expect(await verificarInvariantes()).toEqual([]);
    // Cría vinculada DESPUÉS de la baja: la consulta del invariante (e) la marca
    const despues = await crearAnimalDirecto(tambo, 'C2', { madreId: vaca.id });
    await prisma.animal.update({ where: { id: despues.id }, data: { creadoEn: new Date(Date.now() + 60_000) } });
    expect(await verificarInvariantes()).toEqual(['cría vinculada a una madre después de la baja de esa madre (1)']);
  });

  it('marcan un cambio de madre posterior a la baja de la madre', async () => {
    const { base, tambo, vaca } = await tamboConVaca();
    const cria = await crearAnimalDirecto(tambo, 'C1');
    await crearBajaRegistradaDirecta({ ...base, fecha: '2026-11-01', creadoEn: new Date() });
    await prisma.animal.update({ where: { id: cria.id }, data: { madreId: vaca.id } });
    await prisma.cambioAnimal.create({
      data: {
        establecimientoId: tambo,
        animalId: cria.id,
        campo: 'MADRE',
        valorAnterior: null,
        valorNuevo: '101',
        usuarioId: crypto.randomUUID(),
        usuarioNombre: 'Alguien',
        creadoEn: new Date(Date.now() + 60_000),
      },
    });
    expect(await verificarInvariantes()).toContain('cría vinculada a una madre después de la baja de esa madre (1)');
  });
});
