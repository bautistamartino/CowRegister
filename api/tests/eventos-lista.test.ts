import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import {
  app,
  crearBajaDirecta,
  crearPartoDirecto,
  crearSecadoDirecto,
  crearSemenDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
  registrarTambo,
} from './ayudas.js';

// Tests de GET /api/animales/:id/eventos: RF-23 a RF-27.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';
const url = (animalId: string) => `/api/animales/${animalId}/eventos`;

describe('situación y lista de una hembra (RF-23 a RF-25)', () => {
  it('una hembra sin eventos: situación "sin servicio" y lista vacía', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.get(url(vaca.id)).expect(200);
    expect(res.body.eventos).toEqual([]);
    expect(res.body.situacion).toEqual({
      estado: 'SIN_SERVICIO',
      ultimoServicio: null,
      ultimoTacto: null,
      fechaProbableParto: null,
      fechaReferencia: null,
    });
  });

  it('una recién nacida también tiene situación (sin servicio) y lista vacía', async () => {
    const { agente, vaca } = await prepararVaca({ estado: 'RECIEN_NACIDO' });
    const res = await agente.get(url(vaca.id)).expect(200);
    expect(res.body.situacion.estado).toBe('SIN_SERVICIO');
    expect(res.body.eventos).toEqual([]);
  });

  it('un macho: situación null y lista vacía', async () => {
    const { agente, vaca } = await prepararVaca({ sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
    const res = await agente.get(url(vaca.id)).expect(200);
    expect(res.body).toEqual({ situacion: null, eventos: [] });
  });

  it('servida: último servicio con semen y fecha de referencia con días', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const semen = await crearSemenDirecto(tambo, 'Toro 1', { raza: 'Holando' });
    await crearServicioDirecto({
      establecimientoId: tambo,
      animalId: vaca.id,
      registradoPorId: usuarioId,
      fecha: '2026-11-01',
      semenId: semen.id,
      tipoServicio: 'MONTA_NATURAL',
    });
    const { situacion } = (await agente.get(url(vaca.id)).expect(200)).body;
    expect(situacion.estado).toBe('SERVIDA');
    expect(situacion.ultimoServicio).toMatchObject({ fecha: '2026-11-01', tipoServicio: 'MONTA_NATURAL', semen: { id: semen.id, nombre: 'Toro 1' } });
    expect(situacion.fechaProbableParto).toBeNull();
    expect(situacion.fechaReferencia).toEqual({ fecha: '2027-08-11', dias: 273 });
  });

  it('preñada: último tacto, fecha probable y días; vencida con días negativos', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearServicioDirecto({ ...base, fecha: '2025-12-31' });
    await crearTactoDirecto({ ...base, fecha: '2026-02-01', resultado: 'PRENADA', anomalias: 'Ninguna' });
    const { situacion } = (await agente.get(url(vaca.id)).expect(200)).body;
    expect(situacion.estado).toBe('PRENADA');
    expect(situacion.ultimoTacto).toMatchObject({ fecha: '2026-02-01', resultado: 'PRENADA', anomalias: 'Ninguna' });
    expect(situacion.fechaProbableParto).toEqual({ fecha: '2026-10-10', dias: -32, vencida: true });
    expect(situacion.fechaReferencia).toBeNull();
  });

  it('lista del más reciente al más antiguo; a igual fecha, por registro; anulados con su marca', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    const s1 = await crearServicioDirecto({ ...base, fecha: '2026-08-01' });
    const t1 = await crearTactoDirecto({ ...base, fecha: '2026-09-01', resultado: 'PRENADA', fechaProbableIndicada: '2027-05-01' });
    const s2 = await crearServicioDirecto({ ...base, fecha: '2026-09-01', anulacion: { porId: usuarioId, motivo: 'Error de carga' } });
    const res = await agente.get(url(vaca.id)).expect(200);
    // s2 y t1 tienen la misma fecha: s2 se registró después, va primero (más reciente)
    expect(res.body.eventos.map((e: { id: string }) => e.id)).toEqual([s2.id, t1.id, s1.id]);
    const [anulado, tacto, servicio] = res.body.eventos;
    expect(anulado.anulacion).toMatchObject({ motivo: 'Error de carga', por: 'Dueño' });
    expect(typeof anulado.anulacion.en).toBe('string');
    expect(tacto.anulacion).toBeNull();
    expect(tacto).toMatchObject({
      tipo: 'TACTO',
      registradoPor: 'Dueño',
      tacto: { resultado: 'PRENADA', fechaProbableIndicada: '2027-05-01', fechaProbable: '2027-05-01', anomalias: null },
      servicio: null,
    });
    expect(typeof tacto.registradoEn).toBe('string');
    expect(servicio).toMatchObject({ tipo: 'SERVICIO', fecha: '2026-08-01', servicio: { tipoServicio: 'INSEMINACION', semen: null }, tacto: null });
    // El evento anulado no cuenta: la situación se calcula sin él (preñada, no servida)
    expect(res.body.situacion.estado).toBe('PRENADA');
  });

  it('un tacto "vacía" y uno anulado no tienen fecha probable resuelta', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearTactoDirecto({ ...base, fecha: '2026-08-01', resultado: 'PRENADA', fechaProbableIndicada: '2027-01-01' });
    await crearTactoDirecto({ ...base, fecha: '2026-09-01', resultado: 'VACIA' });
    await crearTactoDirecto({
      ...base,
      fecha: '2026-10-01',
      resultado: 'PRENADA',
      fechaProbableIndicada: '2027-06-01',
      anulacion: { porId: usuarioId, motivo: 'Error' },
    });
    const { eventos } = (await agente.get(url(vaca.id)).expect(200)).body;
    expect(eventos.map((e: { tacto: { fechaProbable: string | null } }) => e.tacto.fechaProbable)).toEqual([null, null, '2027-01-01']);
  });
});

describe('quién registró y qué se filtra (RF-26)', () => {
  it('muestra solo el nombre del usuario; el JSON no lleva hashes, tokens ni emails', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'veterinaria@prueba.test');
    const veterinaria = await prisma.usuario.findFirstOrThrow({ where: { email: 'veterinaria@prueba.test' } });
    const dueno = await prisma.usuario.findFirstOrThrow({ where: { email: 'dueno@prueba.test' } });
    const semen = await crearSemenDirecto(tambo, 'Toro 1');
    await crearServicioDirecto({
      establecimientoId: tambo,
      animalId: vaca.id,
      registradoPorId: veterinaria.id,
      fecha: '2026-10-01',
      semenId: semen.id,
      anulacion: { porId: dueno.id, motivo: 'Error' },
    });
    for (const quien of [agente, vet]) {
      const res = await quien.get(url(vaca.id)).expect(200);
      const texto = JSON.stringify(res.body);
      expect(res.body.eventos[0].registradoPor).toBe('Usuario VETERINARIO');
      expect(res.body.eventos[0].anulacion.por).toBe('Dueño');
      expect(texto).not.toMatch(/passwordHash|tokenHash|argon2|@prueba\.test/i);
    }
    // Las respuestas de registrar y anular tampoco llevan datos de acceso.
    const nuevo = await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-10-02', resultado: 'VACIA' }).expect(201);
    expect(JSON.stringify(nuevo.body)).not.toMatch(/passwordHash|tokenHash|argon2|@prueba\.test/i);
    const anulado = await agente.post(`/api/tactos/${nuevo.body.id}/anular`).send({ motivo: 'x' }).expect(200);
    expect(JSON.stringify(anulado.body)).not.toMatch(/passwordHash|tokenHash|argon2|@prueba\.test/i);
  });

  it('el veterinario ve la situación y la lista', async () => {
    const { agente, vaca } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'veterinaria@prueba.test');
    await vet.get(url(vaca.id)).expect(200);
  });
});

describe('aislamiento y errores (RF-27)', () => {
  it('sin sesión: 401', async () => {
    const { vaca } = await prepararVaca();
    await request(app).get(url(vaca.id)).expect(401);
  });

  it('animal inexistente, mal formado, de otro tambo o de baja: el mismo 404', async () => {
    const { agente, tambo, usuarioId } = await prepararVaca();
    const ajeno = await prepararVaca({ nombreTambo: 'Ajeno', email: 'ajeno@prueba.test' });
    await crearServicioDirecto({
      establecimientoId: ajeno.tambo,
      animalId: ajeno.vaca.id,
      registradoPorId: ajeno.usuarioId,
      fecha: '2026-10-01',
    });
    const baja = await prisma.animal.create({
      data: { establecimientoId: tambo, numero: '555', sexo: 'HEMBRA', estado: 'BAJA', fechaBaja: new Date('2026-10-01') },
    });
    await crearServicioDirecto({ establecimientoId: tambo, animalId: baja.id, registradoPorId: usuarioId, fecha: '2026-05-01' });
    const respuestas = [];
    for (const id of [ID_INEXISTENTE, 'no-es-un-uuid', ajeno.vaca.id, baja.id]) {
      respuestas.push((await agente.get(url(id)).expect(404)).body);
    }
    expect(new Set(respuestas.map((r) => JSON.stringify(r))).size).toBe(1);
    // y el otro tambo no ve los eventos de este
    const otro = await registrarTambo('Otro', 'otro@prueba.test');
    await otro.agente.get(url(ajeno.vaca.id)).expect(404);
  });
});

// ─── Partos, secados y crías en la lista (spec 004, RF-38, RF-40, RF-41) ───

describe('partos y secados en la lista (RF-38)', () => {
  it('el parto muestra sus crías (viva con enlace, muerta con sexo y observaciones, dada de baja), la genética y el lote previo', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    const semen = await crearSemenDirecto(tambo, 'Toro Alfa', { raza: 'Holando' });
    const servicio = await crearServicioDirecto({ ...base, fecha: '2026-01-05', semenId: semen.id });
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Lote previo' } });
    const baja = await crearBajaDirecta(tambo, 'BAJA1', { madreId: vaca.id, motivoBaja: 'PARTO_ANULADO' });
    // Un parto anterior, con una cría ya dada de baja.
    const anterior = await crearPartoDirecto({ ...base, fecha: '2025-09-01', crias: [{ sexo: 'HEMBRA', animalId: baja.id }] });
    const parto = await crearPartoDirecto({
      ...base,
      fecha: '2026-10-10',
      estadoAnterior: 'SECA',
      loteAnteriorId: lote.id,
      servicioId: servicio.id,
      crias: [
        { sexo: 'HEMBRA', numero: 'VIVA1' },
        { sexo: 'MACHO', nacidaMuerta: true, observaciones: 'Sin vida' },
      ],
    });

    const { eventos } = (await agente.get(url(vaca.id)).expect(200)).body;
    const delParto = eventos.find((e: { id: string }) => e.id === parto.id);
    const viva = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: tambo, numero: 'VIVA1' } });
    expect(delParto).toMatchObject({
      tipo: 'PARTO',
      fecha: '2026-10-10',
      registradoPor: 'Dueño',
      servicio: null,
      tacto: null,
      secado: null,
      parto: {
        estadoAnterior: 'SECA',
        loteAnterior: { id: lote.id, nombre: 'Lote previo' },
        genetica: { fechaServicio: '2026-01-05', semen: { id: semen.id, nombre: 'Toro Alfa' } },
        crias: [
          { orden: 1, sexo: 'HEMBRA', nacidaMuerta: false, observaciones: null, animal: { id: viva.id, numero: 'VIVA1', activo: true } },
          { orden: 2, sexo: 'MACHO', nacidaMuerta: true, observaciones: 'Sin vida', animal: null },
        ],
      },
    });
    const delAnterior = eventos.find((e: { id: string }) => e.id === anterior.id);
    expect(delAnterior.parto.crias[0].animal).toEqual({ id: baja.id, numero: 'BAJA1', activo: false });
    expect(delAnterior.parto.genetica).toBeNull();
    expect(delAnterior.parto.loteAnterior).toBe('SIN_LOTE');
  });

  it('la genética con un servicio sin semen figura con semen null ("sin dato"); el nombre del semen es el actual', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    const servicio = await crearServicioDirecto({ ...base, fecha: '2026-01-05' });
    await crearPartoDirecto({ ...base, fecha: '2026-10-10', servicioId: servicio.id });
    let { eventos } = (await agente.get(url(vaca.id)).expect(200)).body;
    expect(eventos[0].parto.genetica).toEqual({ fechaServicio: '2026-01-05', semen: null });

    const otra = await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test' });
    const semen = await crearSemenDirecto(otra.tambo, 'Viejo', { activo: false });
    const b = { establecimientoId: otra.tambo, animalId: otra.vaca.id, registradoPorId: otra.usuarioId };
    const s2 = await crearServicioDirecto({ ...b, fecha: '2026-01-05', semenId: semen.id });
    await crearPartoDirecto({ ...b, fecha: '2026-10-10', servicioId: s2.id });
    await prisma.semenToro.update({ where: { id: semen.id }, data: { nombre: 'Nombre nuevo' } });
    ({ eventos } = (await otra.agente.get(url(otra.vaca.id)).expect(200)).body);
    expect(eventos[0].parto.genetica.semen).toEqual({ id: semen.id, nombre: 'Nombre nuevo' });
  });

  it('el lote previo: "sin lote previo", "lote previo eliminado" y con nombre', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Se va' } });
    const conLote = await crearSecadoDirecto({ ...base, fecha: '2026-03-01', loteAnteriorId: lote.id });
    const parto = await crearPartoDirecto({ ...base, fecha: '2026-06-01', loteAnteriorId: lote.id });
    const sinLote = await crearSecadoDirecto({ ...base, fecha: '2026-10-01' });
    const por = async () => {
      const { eventos } = (await agente.get(url(vaca.id)).expect(200)).body;
      const f = (id: string) => eventos.find((e: { id: string }) => e.id === id);
      return [f(conLote.id).secado.loteAnterior, f(parto.id).parto.loteAnterior, f(sinLote.id).secado.loteAnterior];
    };
    expect(await por()).toEqual([{ id: lote.id, nombre: 'Se va' }, { id: lote.id, nombre: 'Se va' }, 'SIN_LOTE']);
    await agente.delete(`/api/lotes/${lote.id}`).expect(204);
    expect(await por()).toEqual(['ELIMINADO', 'ELIMINADO', 'SIN_LOTE']);
  });

  it('partos y secados entran en el orden total y los anulados llevan su marca', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    const parto = await crearPartoDirecto({ ...base, fecha: '2026-03-01' });
    const secado = await crearSecadoDirecto({ ...base, fecha: '2026-09-01', anulacion: { porId: usuarioId, motivo: 'Cargué mal' } });
    const res = await agente.get(url(vaca.id)).expect(200);
    expect(res.body.eventos.map((e: { id: string }) => e.id)).toEqual([secado.id, parto.id]);
    expect(res.body.eventos[0].anulacion).toMatchObject({ motivo: 'Cargué mal', por: 'Dueño' });
    expect(res.body.eventos[0].secado).toMatchObject({ estadoAnterior: 'EN_ORDENE' });
    // El secado anulado no cuenta; el parto sí: la situación queda "sin servicio".
    expect(res.body.situacion.estado).toBe('SIN_SERVICIO');
  });

  it('el veterinario ve partos, secados y crías; sin hashes ni emails', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'veterinaria@prueba.test');
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearPartoDirecto({ ...base, fecha: '2026-03-01', anulacion: { porId: usuarioId, motivo: 'Error' } });
    await crearSecadoDirecto({ ...base, fecha: '2026-09-01' });
    const res = await vet.get(url(vaca.id)).expect(200);
    expect(res.body.eventos.map((e: { tipo: string }) => e.tipo)).toEqual(['SECADO', 'PARTO']);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|argon2|@prueba\.test/i);
  });

  it('aislamiento: los partos de un tambo no se ven desde otro (404)', async () => {
    const a = await prepararVaca({ nombreTambo: 'A', email: 'a@prueba.test' });
    await crearPartoDirecto({ establecimientoId: a.tambo, animalId: a.vaca.id, registradoPorId: a.usuarioId, fecha: '2026-03-01' });
    const b = await registrarTambo('B', 'b@prueba.test');
    await b.agente.get(url(a.vaca.id)).expect(404);
  });
});

describe('"del ciclo anterior" en la situación (RF-40)', () => {
  it('tras un parto, el último servicio y tacto anteriores llevan cicloAnterior; sin parto no', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearServicioDirecto({ ...base, fecha: '2026-01-10' });
    await crearTactoDirecto({ ...base, fecha: '2026-03-01', resultado: 'PRENADA' });
    let { situacion } = (await agente.get(url(vaca.id)).expect(200)).body;
    expect(situacion.ultimoServicio.cicloAnterior).toBe(false);
    expect(situacion.ultimoTacto.cicloAnterior).toBe(false);

    const parto = await crearPartoDirecto({ ...base, fecha: '2026-10-20' });
    ({ situacion } = (await agente.get(url(vaca.id)).expect(200)).body);
    expect(situacion.estado).toBe('SIN_SERVICIO');
    expect(situacion.fechaProbableParto).toBeNull();
    expect(situacion.ultimoServicio.cicloAnterior).toBe(true);
    expect(situacion.ultimoTacto.cicloAnterior).toBe(true);

    // Con el parto anulado desaparece la marca y vuelve la preñez.
    await prisma.evento.update({ where: { id: parto.id }, data: { anuladoEn: new Date(), anuladoPorId: usuarioId, motivoAnulacion: 'Error' } });
    ({ situacion } = (await agente.get(url(vaca.id)).expect(200)).body);
    expect(situacion.estado).toBe('PRENADA');
    expect(situacion.ultimoServicio.cicloAnterior).toBe(false);
  });

  it('un servicio posterior al parto no es del ciclo anterior', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    await crearTactoDirecto({ ...base, fecha: '2026-03-01', resultado: 'VACIA' });
    await crearPartoDirecto({ ...base, fecha: '2026-04-20' });
    await crearServicioDirecto({ ...base, fecha: '2026-07-01' });
    const { situacion } = (await agente.get(url(vaca.id)).expect(200)).body;
    expect(situacion.estado).toBe('SERVIDA');
    expect(situacion.ultimoServicio.cicloAnterior).toBe(false);
    expect(situacion.ultimoTacto.cicloAnterior).toBe(true);
  });
});
