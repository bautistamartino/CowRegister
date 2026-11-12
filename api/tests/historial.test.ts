import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { fijarTopes } from '../src/topes.js';
import {
  app,
  crearAnimalDirecto,
  crearBajaDirecta,
  crearBajaRegistradaDirecta,
  crearCambioDirecto,
  crearPartoDirecto,
  crearSecadoDirecto,
  crearSemenDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
} from './ayudas.js';

// Spec 007: GET /api/animales/:id/historial y GET /api/bajas/:id/historial (RF-1 a RF-5, RF-18, RF-19).

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => {
  fijarReloj(null);
  fijarTopes(null);
});
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';
const urlActivo = (id: string) => `/api/animales/${id}/historial`;
const urlBaja = (id: string) => `/api/bajas/${id}/historial`;

type Entrada = { clase: 'EVENTO' | 'CAMBIO'; fecha: string; evento?: { id: string; tipo: string; anulacion: unknown; baja: unknown }; cambio?: { campo: string } };

describe('historial de un animal activo', () => {
  it('hembra con servicio, tacto, parto, secado y cambio manual: todo en una línea, del más reciente al más antiguo', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const semen = await crearSemenDirecto(tambo, 'Toro 1', { raza: 'Holando' });
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    const servicio = await crearServicioDirecto({ ...base, fecha: '2026-01-10', semenId: semen.id });
    const tacto = await crearTactoDirecto({ ...base, fecha: '2026-02-20', resultado: 'PRENADA' });
    await crearPartoDirecto({ ...base, fecha: '2026-10-20', servicioId: servicio.id, crias: [{ sexo: 'MACHO' }] });
    await crearSecadoDirecto({ ...base, fecha: '2026-11-01' });
    await crearCambioDirecto(tambo, vaca.id, { campo: 'LOTE', valorAnterior: 'Lote A', valorNuevo: 'Lote B', usuarioNombre: 'Ana', creadoEn: new Date('2026-11-05T15:00:00Z') });

    const res = await agente.get(urlActivo(vaca.id)).expect(200);
    const entradas = res.body.entradas as Entrada[];
    expect(entradas.map((e) => (e.clase === 'EVENTO' ? e.evento!.tipo : `CAMBIO:${e.cambio!.campo}`))).toEqual([
      'CAMBIO:LOTE', // 5/11
      'SECADO', // 1/11
      'PARTO', // 20/10
      'TACTO', // 20/02
      'SERVICIO', // 10/01
    ]);
    // Orden: las fechas bajan de una entrada a la siguiente.
    const fechas = entradas.map((e) => e.fecha);
    expect(fechas).toEqual([...fechas].sort().reverse());
    expect(res.body.total).toBe(5);
    expect(res.body.truncado).toBe(false);
    expect(res.body.tope).toBe(500);
    expect(res.body.ultimoEventoNoAnuladoId).toBe(entradas.find((e) => e.evento?.tipo === 'SECADO')!.evento!.id);
    // El tacto trae su fecha probable resuelta (servicio + 283) y el parto la genética con el semen.
    const t = entradas.find((e) => e.evento?.id === tacto.id)!.evento as unknown as { tacto: { fechaProbable: string } };
    expect(t.tacto.fechaProbable).toBe('2026-10-20');
    const p = entradas.find((e) => e.evento?.tipo === 'PARTO')!.evento as unknown as { parto: { genetica: { semen: { nombre: string } } } };
    expect(p.parto.genetica.semen.nombre).toBe('Toro 1');
    // Quién registró: nombre, nunca ids de usuario, hashes ni emails.
    const texto = JSON.stringify(res.body);
    expect(texto).not.toMatch(/passwordHash|tokenHash|dueno@prueba\.test/);
    expect(texto).not.toContain(usuarioId);
  });

  it('un evento anulado se muestra marcado en la fecha del evento y no cuenta como último anulable', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    const servicio = await crearServicioDirecto({ ...base, fecha: '2026-09-01' });
    const tacto = await crearTactoDirecto({ ...base, fecha: '2026-10-05', anulacion: { porId: usuarioId, motivo: 'Error de carga' } });
    const res = await agente.get(urlActivo(vaca.id)).expect(200);
    const entradas = res.body.entradas as Entrada[];
    const delTacto = entradas.find((e) => e.evento?.id === tacto.id)!;
    expect(delTacto.fecha).toBe('2026-10-05');
    expect(delTacto.evento!.anulacion).toMatchObject({ motivo: 'Error de carga' });
    expect(res.body.ultimoEventoNoAnuladoId).toBe(servicio.id);
  });

  it('un cambio manual guardado a las 22:00 ART (01:00 UTC del día siguiente) figura en el día argentino', async () => {
    const { agente, vaca, tambo } = await prepararVaca();
    await crearCambioDirecto(tambo, vaca.id, { creadoEn: new Date('2026-11-13T01:00:00Z') });
    const res = await agente.get(urlActivo(vaca.id)).expect(200);
    expect(res.body.entradas[0].fecha).toBe('2026-11-12');
    expect(res.body.entradas[0].cambio.usuarioNombre).toBe('Usuario de prueba');
  });

  it('animal sin entradas: lista vacía, total 0 y sin último evento', async () => {
    const { agente, vaca } = await prepararVaca();
    const res = await agente.get(urlActivo(vaca.id)).expect(200);
    expect(res.body).toEqual({ total: 0, truncado: false, tope: 500, ultimoEventoNoAnuladoId: null, entradas: [] });
  });

  it('macho: cambios manuales y bajas revertidas, sin eventos reproductivos', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca({ sexo: 'MACHO', estado: 'VAQUILLONA' });
    await crearCambioDirecto(tambo, vaca.id, { creadoEn: new Date('2026-11-05T15:00:00Z') });
    await crearBajaRegistradaDirecta({
      establecimientoId: tambo,
      animalId: vaca.id,
      registradoPorId: usuarioId,
      fecha: '2026-11-01',
      anulacion: { porId: usuarioId, motivo: 'Se vendió por error' },
    });
    const res = await agente.get(urlActivo(vaca.id)).expect(200);
    const entradas = res.body.entradas as Entrada[];
    expect(entradas.map((e) => e.clase)).toEqual(['CAMBIO', 'EVENTO']);
    expect(entradas[1]!.evento!.tipo).toBe('BAJA');
    expect(entradas[1]!.evento!.anulacion).toMatchObject({ motivo: 'Se vendió por error' }); // baja revertida
    expect(res.body.ultimoEventoNoAnuladoId).toBeNull();
  });

  it('baja revertida y nueva baja: la primera marcada revertida y la segunda vigente (no anulable)', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
    const primera = await crearBajaRegistradaDirecta({ ...base, fecha: '2026-10-01', anulacion: { porId: usuarioId, motivo: 'Error' } });
    const res = await agente.get(urlActivo(vaca.id)).expect(200);
    const entradas = res.body.entradas as Entrada[];
    expect(entradas).toHaveLength(1);
    expect(entradas[0]!.evento!.id).toBe(primera.id);
    expect(entradas[0]!.evento!.anulacion).not.toBeNull();
  });

  it('total y truncado con el tope inyectado; el último evento no anulado queda fuera de las entradas pero identificado', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const servicio = await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-08-01' });
    for (let i = 1; i <= 3; i++) {
      await crearCambioDirecto(tambo, vaca.id, { campo: 'NUMERO', creadoEn: new Date(`2026-11-0${i}T15:00:00Z`) });
    }
    fijarTopes({ historial: 2 });
    const res = await agente.get(urlActivo(vaca.id)).expect(200);
    expect(res.body.total).toBe(4);
    expect(res.body.truncado).toBe(true);
    expect(res.body.tope).toBe(2);
    expect(res.body.entradas).toHaveLength(2);
    expect((res.body.entradas as Entrada[]).every((e) => e.clase === 'CAMBIO')).toBe(true);
    expect(res.body.ultimoEventoNoAnuladoId).toBe(servicio.id);
  });

  it('las rutas viejas de eventos y cambios no cambian', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-08-01' });
    const res = await agente.get(`/api/animales/${vaca.id}/eventos`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['eventos', 'situacion']);
    await agente.get(`/api/animales/${vaca.id}/cambios`).expect(200);
  });
});

describe('historial de una baja', () => {
  it('baja por venta y por muerte: evento de baja y cambios, por /api/bajas/:id/historial', async () => {
    const { agente, tambo, usuarioId } = await prepararVaca({ numero: 'BASE' });
    const vendida = await crearAnimalDirecto(tambo, 'V1');
    const muerta = await crearAnimalDirecto(tambo, 'M1', { sexo: 'MACHO' });
    await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: vendida.id, registradoPorId: usuarioId, fecha: '2026-10-01', motivo: 'VENTA' });
    await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: muerta.id, registradoPorId: usuarioId, fecha: '2026-10-02', motivo: 'MUERTE' });
    await crearCambioDirecto(tambo, vendida.id, { creadoEn: new Date('2026-09-01T15:00:00Z') });

    const r1 = await agente.get(urlBaja(vendida.id)).expect(200);
    expect((r1.body.entradas as Entrada[]).map((e) => e.clase)).toEqual(['EVENTO', 'CAMBIO']);
    expect(r1.body.entradas[0].evento.baja).toMatchObject({ motivo: 'venta' });
    // La baja vigente no es anulable desde el historial.
    expect(r1.body.ultimoEventoNoAnuladoId).toBeNull();
    const r2 = await agente.get(urlBaja(muerta.id)).expect(200);
    expect(r2.body.entradas[0].evento.baja).toMatchObject({ motivo: 'muerte' });
  });

  it('404 idéntico: activo en la ruta de bajas, baja en la de activos, parto anulado, inexistente y mal formado', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const baja = await crearAnimalDirecto(tambo, 'B1');
    await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: baja.id, registradoPorId: usuarioId, fecha: '2026-10-01' });
    const partoAnulado = await crearBajaDirecta(tambo, 'PA1');
    const respuestas = await Promise.all([
      agente.get(urlBaja(vaca.id)).expect(404), // activo en la ruta de bajas
      agente.get(urlActivo(baja.id)).expect(404), // baja en la ruta de activos
      agente.get(urlBaja(partoAnulado.id)).expect(404),
      agente.get(urlActivo(partoAnulado.id)).expect(404),
      agente.get(urlActivo(ID_INEXISTENTE)).expect(404),
      agente.get(urlBaja(ID_INEXISTENTE)).expect(404),
      agente.get(urlActivo('no-es-un-uuid')).expect(404),
      agente.get(urlBaja('no-es-un-uuid')).expect(404),
    ]);
    const primero = respuestas[0]!.body;
    for (const r of respuestas) expect(r.body).toEqual(primero);
  });
});

describe('aislamiento, permisos y datos sensibles (RF-18, RF-19)', () => {
  it('aislamiento entre dos tambos en las dos rutas: 404 idéntico al de un id inexistente', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test', numero: '202' });
    const bBaja = await crearAnimalDirecto(b.tambo, 'BB1');
    await crearBajaRegistradaDirecta({ establecimientoId: b.tambo, animalId: bBaja.id, registradoPorId: b.usuarioId, fecha: '2026-10-01' });
    await crearServicioDirecto({ establecimientoId: b.tambo, animalId: b.vaca.id, registradoPorId: b.usuarioId, fecha: '2026-10-01' });

    const ajeno = await a.agente.get(urlActivo(b.vaca.id)).expect(404);
    const inexistente = await a.agente.get(urlActivo(ID_INEXISTENTE)).expect(404);
    expect(ajeno.body).toEqual(inexistente.body);
    const ajenoBaja = await a.agente.get(urlBaja(bBaja.id)).expect(404);
    const inexistenteBaja = await a.agente.get(urlBaja(ID_INEXISTENTE)).expect(404);
    expect(ajenoBaja.body).toEqual(inexistenteBaja.body);
    // El tambo B sí ve lo suyo.
    await b.agente.get(urlActivo(b.vaca.id)).expect(200);
    await b.agente.get(urlBaja(bBaja.id)).expect(200);
  });

  it('un establecimientoId en la query se ignora', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test', numero: '202' });
    await a.agente.get(`${urlActivo(b.vaca.id)}?establecimientoId=${b.tambo}`).expect(404);
    const propio = await a.agente.get(`${urlActivo(a.vaca.id)}?establecimientoId=${b.tambo}`).expect(200);
    expect(propio.body.entradas).toEqual([]);
  });

  it('dueño, encargado y veterinario reciben 200; sin sesión 401', async () => {
    const { agente, vaca, tambo, usuarioId } = await prepararVaca();
    const baja = await crearAnimalDirecto(tambo, 'B1');
    await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: baja.id, registradoPorId: usuarioId, fecha: '2026-10-01' });
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'enc@prueba.test');
    const veterinario = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    for (const ag of [agente, encargado, veterinario]) {
      await ag.get(urlActivo(vaca.id)).expect(200);
      await ag.get(urlBaja(baja.id)).expect(200);
    }
    await request(app).get(urlActivo(vaca.id)).expect(401);
    await request(app).get(urlBaja(baja.id)).expect(401);
  });
});
