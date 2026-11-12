import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { fijarTopes } from '../src/topes.js';
import {
  crearAnimalDirecto,
  crearBajaDirecta,
  crearBajaRegistradaDirecta,
  crearCambioDirecto,
  crearPartoDirecto,
  crearProduccionDirecta,
  crearSecadoDirecto,
  crearSemenDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  limpiarBase,
  prepararVaca,
} from './ayudas.js';

// Spec 009, RF-4 y RF-11 (paridad): cada animal de la copia tiene que ser IDÉNTICO a lo que dan las
// rutas individuales (ficha, eventos, historial y producción). Es la red de seguridad de las
// consultas masivas con SQL a mano. Reloj fijado en las 12:00 ART del 11/11/2026.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => {
  fijarReloj(null);
  fijarTopes(null);
});
afterAll(() => prisma.$disconnect());

type Agente = Awaited<ReturnType<typeof prepararVaca>>['agente'];

// Compara cada animal de la copia con las cuatro rutas individuales.
async function compararConRutas(agente: Agente) {
  const copia = (await agente.get('/api/copia-local').expect(200)).body;
  expect(copia.animales.length).toBeGreaterThan(0);
  for (const animal of copia.animales) {
    const id = animal.ficha.id;
    const ficha = (await agente.get(`/api/animales/${id}`).expect(200)).body;
    const eventos = (await agente.get(`/api/animales/${id}/eventos`).expect(200)).body;
    const historial = (await agente.get(`/api/animales/${id}/historial`).expect(200)).body;
    const produccion = (await agente.get(`/api/animales/${id}/produccion`).expect(200)).body;
    delete produccion.sugerencia; // la copia no la trae (la web la calcula con la hora del dispositivo)
    expect(animal.ficha, `ficha de ${animal.ficha.numero}`).toEqual(ficha);
    expect(animal.eventos, `eventos de ${animal.ficha.numero}`).toEqual(eventos);
    expect(animal.historial, `historial de ${animal.ficha.numero}`).toEqual(historial);
    expect(animal.produccion, `producción de ${animal.ficha.numero}`).toEqual(produccion);
  }
  return copia;
}

// Un tambo con de todo: lotes, servicios, tactos, parto con genética, secado, cambios, baja de cría,
// producción con anulados, un macho, una vaquillona y un animal dado de baja (que no va en la copia).
async function sembrarTamboCompleto() {
  const base = await prepararVaca({ numero: '101' });
  const { tambo, usuarioId, vaca } = base;
  const loteA = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Lote A' } });
  const loteB = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Lote B' } });
  await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: loteA.id, fechaNacimiento: new Date('2022-01-10T00:00:00Z') } });
  const semen = await crearSemenDirecto(tambo, 'Toro Pampa', { raza: 'Holando' });

  // Vaca 101: servicio, tacto preñada, un servicio anulado, producción y cambios manuales.
  const comunes = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
  await crearServicioDirecto({ ...comunes, fecha: '2026-03-01', semenId: semen.id });
  await crearTactoDirecto({ ...comunes, fecha: '2026-04-15', resultado: 'PRENADA' });
  await crearServicioDirecto({ ...comunes, fecha: '2026-05-01', anulacion: { porId: usuarioId, motivo: 'Error de carga' } });
  for (const [fecha, turno, litros] of [
    ['2026-11-08', 'MANANA', 14.2],
    ['2026-11-08', 'TARDE', 11.1],
    ['2026-11-09', 'MANANA', 15],
    ['2026-11-10', 'MANANA', 0],
    ['2026-11-10', 'TARDE', 9.9],
  ] as const) {
    await crearProduccionDirecta({ ...comunes, fecha, turno, litros, loteId: loteA.id, loteNombre: 'Lote A' });
  }
  await crearProduccionDirecta({ ...comunes, fecha: '2026-11-11', turno: 'MANANA', litros: 99, anulacion: { porId: usuarioId, motivo: 'Mal cargado' } });
  await crearProduccionDirecta({ ...comunes, fecha: '2026-11-11', turno: 'MANANA', litros: 13.7 });
  await crearCambioDirecto(tambo, vaca.id, { campo: 'LOTE', valorAnterior: null, valorNuevo: 'Lote A', usuarioNombre: 'Dueño' });
  await crearCambioDirecto(tambo, vaca.id, { campo: 'NUMERO', valorAnterior: '100', valorNuevo: '101', usuarioNombre: 'Dueño' });

  // Vaca 102: parto con servicio y semen (genética), cría viva, cría de baja, secado.
  const v102 = await crearAnimalDirecto(tambo, '102', { estado: 'SECA', loteId: loteB.id });
  const c102 = { establecimientoId: tambo, animalId: v102.id, registradoPorId: usuarioId };
  const serv102 = await crearServicioDirecto({ ...c102, fecha: '2025-12-01', semenId: semen.id });
  await crearTactoDirecto({ ...c102, fecha: '2026-01-20', resultado: 'PRENADA' });
  await crearPartoDirecto({
    ...c102,
    fecha: '2026-09-10',
    servicioId: serv102.id,
    loteAnteriorId: loteA.id,
    crias: [{ sexo: 'HEMBRA', numero: 'C102' }, { sexo: 'MACHO', nacidaMuerta: true, observaciones: 'Nació muerta' }],
  });
  await crearBajaDirecta(tambo, 'C102B', { madreId: v102.id });
  await crearSecadoDirecto({ ...c102, fecha: '2026-11-05', loteAnteriorId: loteA.id });
  await crearProduccionDirecta({ ...c102, fecha: '2026-11-02', turno: 'TARDE', litros: 8 });

  // Otros: macho, vaquillonas (A2 antes que A10 en el orden natural) y un animal vendido (NO va).
  await crearAnimalDirecto(tambo, 'T1', { sexo: 'MACHO', estado: 'RECIEN_NACIDO' });
  await crearAnimalDirecto(tambo, 'V10', { estado: 'VAQUILLONA', fechaNacimiento: '2025-05-05' });
  await crearAnimalDirecto(tambo, 'V2', { estado: 'VAQUILLONA' });
  const vendida = await crearAnimalDirecto(tambo, '555');
  await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: vendida.id, registradoPorId: usuarioId, fecha: '2026-10-01' });
  return base;
}

describe('paridad con las rutas individuales (RF-4, RF-11)', () => {
  it('un tambo completo: cada animal de la copia es idéntico al de las rutas individuales', async () => {
    const { agente } = await sembrarTamboCompleto();
    const copia = await compararConRutas(agente);
    // Todos los activos, ninguno de baja (la cría de baja y el vendido quedan afuera).
    const numeros = copia.animales.map((a: any) => a.ficha.numero).sort();
    expect(numeros).toEqual(['101', '102', 'C102', 'T1', 'V10', 'V2']);
  });

  it('con topes bajos (historial y producción cortados) sigue siendo idéntico, con su aviso', async () => {
    const { agente, vaca } = await sembrarTamboCompleto();
    fijarTopes({ historial: 2, produccionFicha: 3 });
    const copia = await compararConRutas(agente);
    const de101 = copia.animales.find((a: any) => a.ficha.id === vaca.id);
    expect(de101.produccion).toMatchObject({ mostrados: 3, truncado: true, tope: 3 });
    expect(de101.produccion.total).toBeGreaterThan(3);
    expect(de101.historial.truncado).toBe(true);
  });

  it('el orden de producción respeta el de las rutas a igual fecha y turno (el más reciente primero)', async () => {
    const { agente, tambo, usuarioId, vaca } = await prepararVaca({ numero: '1' });
    // Dos registros del mismo ordeño (uno anulado) con creadoEn distinto.
    const c = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-11-10', turno: 'MANANA' as const };
    await crearProduccionDirecta({ ...c, litros: 5, creadoEn: new Date('2026-11-10T10:00:00Z'), anulacion: { porId: usuarioId, motivo: 'x', en: new Date('2026-11-10T11:00:00Z') } });
    await crearProduccionDirecta({ ...c, litros: 6, creadoEn: new Date('2026-11-10T12:00:00Z') });
    await compararConRutas(agente);
  });
});

describe('volumen: 2.000 animales (RF-4, RF-8)', () => {
  it('responde completa, idéntica en una muestra y en un tiempo cómodo', async () => {
    const { agente, tambo, usuarioId } = await prepararVaca({ numero: 'V0000' });
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Lote grande' } });
    await prisma.animal.createMany({
      data: Array.from({ length: 1999 }, (_, i) => ({
        establecimientoId: tambo,
        numero: `V${String(i + 1).padStart(4, '0')}`,
        sexo: 'HEMBRA' as const,
        estado: 'EN_ORDENE' as const,
        loteId: lote.id,
      })),
    });
    const animales = await prisma.animal.findMany({ where: { establecimientoId: tambo }, select: { id: true } });
    expect(animales).toHaveLength(2000);
    // Tres registros de producción por vaca (6.000 filas).
    await prisma.produccion.createMany({
      data: animales.flatMap((a) =>
        [8, 9, 10].map((dia) => ({
          establecimientoId: tambo,
          animalId: a.id,
          fecha: new Date(`2026-11-${String(dia).padStart(2, '0')}T00:00:00Z`),
          turno: 'MANANA' as const,
          litrosDecimas: 100 + dia,
          registradoPorId: usuarioId,
          loteId: lote.id,
          loteNombre: 'Lote grande',
        })),
      ),
    });

    const inicio = Date.now();
    const res = await agente.get('/api/copia-local').expect(200);
    const ms = Date.now() - inicio;
    console.log(`Copia de 2.000 animales: ${ms} ms, ${(JSON.stringify(res.body).length / 1e6).toFixed(1)} MB sin comprimir`);
    expect(res.body.totalAnimales).toBe(2000);
    expect(res.body.animales).toHaveLength(2000);
    expect(ms).toBeLessThan(20_000);

    // Muestra de 15 animales repartidos contra las rutas individuales.
    for (const i of [0, 1, 7, 99, 250, 500, 777, 1000, 1234, 1500, 1750, 1900, 1950, 1998, 1999]) {
      const animal = res.body.animales[i];
      const id = animal.ficha.id;
      const produccion = (await agente.get(`/api/animales/${id}/produccion`).expect(200)).body;
      delete produccion.sugerencia;
      expect(animal.ficha).toEqual((await agente.get(`/api/animales/${id}`).expect(200)).body);
      expect(animal.eventos).toEqual((await agente.get(`/api/animales/${id}/eventos`).expect(200)).body);
      expect(animal.historial).toEqual((await agente.get(`/api/animales/${id}/historial`).expect(200)).body);
      expect(animal.produccion).toEqual(produccion);
    }
  }, 120_000);
});
