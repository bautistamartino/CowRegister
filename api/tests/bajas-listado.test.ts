import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { buscarBajasPorNumero, textoAvisoNumeroDeBaja } from '../src/bajas/numero-de-baja.js';
import {
  app,
  crearAnimalDirecto,
  crearBajaRegistradaDirecta,
  crearCambioDirecto,
  crearPartoDirecto,
  crearServicioDirecto,
  crearUsuario,
  limpiarBase,
  prepararVaca,
} from './ayudas.js';

// Spec 006: GET /api/bajas y GET /api/bajas/:id (RF-12, RF-13, RF-17) y el helper del aviso de número (RF-14).

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';

// Un tambo con su dueño, listo para sembrar bajas.
async function tamboBase(opciones: Parameters<typeof prepararVaca>[0] = {}) {
  const t = await prepararVaca({ numero: 'BASE', ...opciones });
  // Siembra un animal activo y lo da de baja (directo en la base) con el motivo y la fecha pedidos.
  const baja = async (
    numero: string,
    fecha: string,
    motivo: 'VENTA' | 'MUERTE' = 'VENTA',
    extra: Partial<Parameters<typeof crearBajaRegistradaDirecta>[0]> = {},
    sexo: 'HEMBRA' | 'MACHO' = 'HEMBRA',
  ) => {
    const animal = await crearAnimalDirecto(t.tambo, numero, { sexo });
    await crearBajaRegistradaDirecta({ establecimientoId: t.tambo, animalId: animal.id, registradoPorId: t.usuarioId, fecha, motivo, ...extra });
    return animal;
  };
  return { ...t, baja };
}

describe('listado de bajas (RF-12)', () => {
  it('vacío: 200 con la lista vacía', async () => {
    const { agente } = await tamboBase();
    const res = await agente.get('/api/bajas').expect(200);
    expect(res.body).toEqual({ total: 0, mostrados: 0, truncado: false, bajas: [] });
  });

  it('número, sexo, fecha y motivo; la más reciente primero y, a igual fecha, la registrada después primero', async () => {
    const { agente, baja } = await tamboBase();
    const vieja = await baja('A1', '2026-10-01', 'MUERTE', {}, 'MACHO');
    const mismaFechaPrimero = await baja('A2', '2026-11-05');
    const mismaFechaDespues = await baja('A3', '2026-11-05');
    const reciente = await baja('A4', '2026-11-09');
    const res = await agente.get('/api/bajas').expect(200);
    expect(res.body.bajas.map((b: { numero: string }) => b.numero)).toEqual(['A4', 'A3', 'A2', 'A1']);
    expect(res.body.bajas[0]).toEqual({ id: reciente.id, numero: 'A4', sexo: 'HEMBRA', fecha: '2026-11-09', motivo: 'venta' });
    expect(res.body.bajas[3]).toEqual({ id: vieja.id, numero: 'A1', sexo: 'MACHO', fecha: '2026-10-01', motivo: 'muerte' });
    expect(res.body).toMatchObject({ total: 4, mostrados: 4, truncado: false });
    expect([mismaFechaPrimero.id, mismaFechaDespues.id]).toHaveLength(2);
  });

  it('filtra por motivo; un motivo inválido o repetido da 400', async () => {
    const { agente, baja } = await tamboBase();
    await baja('V1', '2026-11-01', 'VENTA');
    await baja('M1', '2026-11-02', 'MUERTE');
    const ventas = await agente.get('/api/bajas?motivo=venta').expect(200);
    expect(ventas.body.bajas.map((b: { numero: string }) => b.numero)).toEqual(['V1']);
    const muertes = await agente.get('/api/bajas?motivo=muerte').expect(200);
    expect(muertes.body.bajas.map((b: { numero: string }) => b.numero)).toEqual(['M1']);
    for (const malo of ['VENTA', 'parto_anulado', '', 'otro']) {
      await agente.get(`/api/bajas?motivo=${malo}`).expect(400);
    }
    await agente.get('/api/bajas?motivo=venta&motivo=muerte').expect(400);
  });

  it('filtra por número exacto y normalizado; un número con varias bajas las muestra todas; sin coincidencias, vacío', async () => {
    const { agente, baja } = await tamboBase();
    await baja('A10', '2026-11-01');
    await baja('A100', '2026-11-02');
    const primera = await baja('X7', '2026-09-01');
    // Mismo número dado de baja dos veces (el primero ya vendido; el segundo lo reutilizó): dos bajas.
    const segunda = await baja('X7', '2026-11-03', 'MUERTE');
    const exacto = await agente.get('/api/bajas?numero=a10').expect(200);
    expect(exacto.body.bajas.map((b: { numero: string }) => b.numero)).toEqual(['A10']); // "A100" no es "A10"
    const varias = await agente.get('/api/bajas?numero=%20x7%20').expect(200);
    expect(varias.body.bajas.map((b: { id: string }) => b.id)).toEqual([segunda.id, primera.id]);
    const ninguna = await agente.get('/api/bajas?numero=ZZZ').expect(200);
    expect(ninguna.body.bajas).toEqual([]);
    const invalido = await agente.get('/api/bajas?numero=a%20b').expect(200); // caracteres no permitidos: no coincide con nada
    expect(invalido.body.bajas).toEqual([]);
    const vacio = await agente.get('/api/bajas?numero=').expect(200); // vacío = sin filtro
    expect(vacio.body.total).toBe(4);
  });

  it('no lista las bajas "parto anulado", ni las revertidas, ni los animales activos', async () => {
    const { agente, tambo, usuarioId, baja } = await tamboBase();
    await baja('OK1', '2026-11-01');
    await crearAnimalDirecto(tambo, 'PA1', { estado: 'BAJA', motivoBaja: 'PARTO_ANULADO' });
    await baja('REV1', '2026-11-02', 'VENTA', { anulacion: { porId: usuarioId, motivo: 'error' } }); // revertida: animal activo
    const res = await agente.get('/api/bajas').expect(200);
    expect(res.body.bajas.map((b: { numero: string }) => b.numero)).toEqual(['OK1']);
  });

  it('tope de 2.000 con el total y el aviso (fixture masivo directo en la base)', { timeout: 60_000 }, async () => {
    const { agente, tambo, usuarioId } = await tamboBase();
    const cantidad = 2005;
    const ids = Array.from({ length: cantidad }, () => randomUUID());
    // Todo en una transacción: la base comprueba la coherencia animal-baja-evento al confirmar.
    await prisma.$transaction(
      async (tx) => {
        await tx.animal.createMany({
          data: ids.map((id, i) => ({
            id,
            establecimientoId: tambo,
            numero: `M${i}`,
            sexo: 'HEMBRA' as const,
            estado: 'BAJA' as const,
            fechaBaja: new Date('2026-11-01T00:00:00Z'),
            motivoBaja: 'VENTA' as const,
          })),
        });
        await tx.evento.createMany({
          data: ids.map((id, i) => ({
            id: ids[i]!.replace(/^./, 'e'),
            establecimientoId: tambo,
            animalId: id,
            tipo: 'BAJA' as const,
            fecha: new Date('2026-11-01T00:00:00Z'),
            registradoPorId: usuarioId,
          })),
        });
        await tx.baja.createMany({
          data: ids.map((id) => ({
            eventoId: id.replace(/^./, 'e'),
            establecimientoId: tambo,
            tipo: 'BAJA' as const,
            animalId: id,
            motivo: 'VENTA' as const,
            estadoAnterior: 'EN_ORDENE' as const,
          })),
        });
      },
      { timeout: 50_000 },
    );
    const res = await agente.get('/api/bajas').expect(200);
    expect(res.body).toMatchObject({ total: cantidad, mostrados: 2000, truncado: true });
    expect(res.body.bajas).toHaveLength(2000);
  });
});

describe('ficha de baja (RF-13)', () => {
  it('datos, estado previo, madre y crías con sus marcas, la baja, los eventos y los cambios', async () => {
    const { agente, tambo, usuarioId } = await tamboBase();
    const madre = await crearAnimalDirecto(tambo, 'MADRE1');
    const vaca = await crearAnimalDirecto(tambo, 'V1', { estado: 'SECA', madreId: madre.id, fechaNacimiento: '2023-04-01' });
    const criaActiva = await crearAnimalDirecto(tambo, 'C10', { madreId: vaca.id });
    const criaActiva2 = await crearAnimalDirecto(tambo, 'C9', { madreId: vaca.id });
    const criaVendida = await crearAnimalDirecto(tambo, 'C2', { madreId: vaca.id });
    const criaPartoAnulado = await crearAnimalDirecto(tambo, 'C3', { madreId: vaca.id, estado: 'BAJA', motivoBaja: 'PARTO_ANULADO' });
    await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: criaVendida.id, registradoPorId: usuarioId, fecha: '2026-11-02', motivo: 'MUERTE' });
    await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-08-01' });
    await crearCambioDirecto(tambo, vaca.id, { campo: 'NUMERO', valorAnterior: 'V0', valorNuevo: 'V1', usuarioNombre: 'Pedro' });
    await agente.post(`/api/animales/${vaca.id}/baja`).send({ motivo: 'venta', fecha: '2026-11-05', observaciones: 'Vendida en la feria' }).expect(201);

    const res = (await agente.get(`/api/bajas/${vaca.id}`).expect(200)).body;
    expect(res).toMatchObject({
      id: vaca.id,
      numero: 'V1',
      sexo: 'HEMBRA',
      fechaNacimiento: '2023-04-01',
      estadoAnterior: 'SECA',
      baja: { motivo: 'venta', fecha: '2026-11-05', observaciones: 'Vendida en la feria', registradoPor: 'Dueño' },
      madre: { id: madre.id, numero: 'MADRE1', activa: true, motivoBaja: null },
    });
    expect(res.baja.registradoEn).toBeTruthy();
    // Crías activas con orden natural; de baja con su motivo ("parto anulado" también, para mostrarla sin acceso).
    expect(res.crias).toEqual([
      { id: criaActiva2.id, numero: 'C9' },
      { id: criaActiva.id, numero: 'C10' },
    ]);
    expect(res.criasDeBaja).toEqual([
      { id: criaVendida.id, numero: 'C2', motivo: 'muerte' },
      { id: criaPartoAnulado.id, numero: 'C3', motivo: 'parto_anulado' },
    ]);
    // Eventos: la baja y el servicio, la baja primero (más reciente).
    expect(res.eventos.map((e: { tipo: string }) => e.tipo)).toEqual(['BAJA', 'SERVICIO']);
    expect(res.eventos[0].baja).toMatchObject({ motivo: 'venta', observaciones: 'Vendida en la feria' });
    expect(res.cambios).toMatchObject({ total: 1, cambios: [{ campo: 'NUMERO', valorAnterior: 'V0', valorNuevo: 'V1', usuarioNombre: 'Pedro' }] });
    expect(JSON.stringify(res)).not.toMatch(/passwordHash|tokenHash|@prueba\.test/);
  });

  it('la madre de baja figura con su motivo; la de "parto anulado" también, sin acceso a su ficha', async () => {
    const { agente, tambo, usuarioId } = await tamboBase();
    const madreVendida = await crearAnimalDirecto(tambo, 'MV');
    const hija = await crearAnimalDirecto(tambo, 'H1', { madreId: madreVendida.id });
    await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: madreVendida.id, registradoPorId: usuarioId, fecha: '2026-10-01', motivo: 'MUERTE' });
    await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: hija.id, registradoPorId: usuarioId, fecha: '2026-11-01' });
    let res = (await agente.get(`/api/bajas/${hija.id}`).expect(200)).body;
    expect(res.madre).toMatchObject({ id: madreVendida.id, activa: false, motivoBaja: 'muerte' });

    const madrePA = await crearAnimalDirecto(tambo, 'MPA', { estado: 'BAJA', motivoBaja: 'PARTO_ANULADO' });
    await prisma.animal.update({ where: { id: hija.id }, data: { madreId: madrePA.id } });
    res = (await agente.get(`/api/bajas/${hija.id}`).expect(200)).body;
    expect(res.madre).toMatchObject({ activa: false, motivoBaja: 'parto_anulado' });
    await agente.get(`/api/bajas/${madrePA.id}`).expect(404); // sin acceso a su ficha
  });

  it('los cambios traen los últimos 100 y el total', async () => {
    const { agente, tambo, baja } = await tamboBase();
    const vaca = await baja('V1', '2026-11-01');
    const base = Date.now() - 1_000_000;
    await prisma.cambioAnimal.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        establecimientoId: tambo,
        animalId: vaca.id,
        campo: 'NUMERO' as const,
        valorAnterior: `A${i}`,
        valorNuevo: `A${i + 1}`,
        usuarioId: randomUUID(),
        usuarioNombre: 'Usuario',
        creadoEn: new Date(base + i * 1000),
      })),
    });
    const res = (await agente.get(`/api/bajas/${vaca.id}`).expect(200)).body;
    expect(res.cambios.total).toBe(101);
    expect(res.cambios.cambios).toHaveLength(100);
    expect(res.cambios.cambios[0].valorNuevo).toBe('A101'); // el más nuevo primero
  });

  it('404 idéntico para un animal activo, revertido, de otro tambo, inexistente, mal formado y "parto anulado"', async () => {
    const { agente, tambo, usuarioId, baja } = await tamboBase();
    const activo = await crearAnimalDirecto(tambo, 'ACT');
    const revertido = await baja('REV', '2026-11-01', 'VENTA', { anulacion: { porId: usuarioId, motivo: 'error' } });
    const otro = await prepararVaca({ nombreTambo: 'Otro', email: 'otro@prueba.test' });
    const ajeno = await crearAnimalDirecto(otro.tambo, 'AJ');
    await crearBajaRegistradaDirecta({ establecimientoId: otro.tambo, animalId: ajeno.id, registradoPorId: otro.usuarioId, fecha: '2026-11-01' });
    const porParto = await crearAnimalDirecto(tambo, 'PA', { estado: 'BAJA', motivoBaja: 'PARTO_ANULADO' });

    const respuestas = [] as { status: number; body: unknown }[];
    for (const id of [activo.id, revertido.id, ajeno.id, ID_INEXISTENTE, 'no-es-un-id', porParto.id]) {
      respuestas.push(await agente.get(`/api/bajas/${id}`));
    }
    for (const r of respuestas) expect(r.status).toBe(404);
    expect(new Set(respuestas.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });
});

describe('aislamiento entre dos tambos y permisos (RF-17)', () => {
  it('cada tambo ve solo sus bajas en el listado y en la ficha; el número de otro tambo no aparece', async () => {
    const a = await tamboBase({ email: 'a@prueba.test', nombreTambo: 'Tambo A' });
    const b = await tamboBase({ email: 'b@prueba.test', nombreTambo: 'Tambo B' });
    const deA = await a.baja('COMUN', '2026-11-01');
    const deB = await b.baja('COMUN', '2026-11-02');
    await b.baja('SOLOB', '2026-11-03');

    const listaA = (await a.agente.get('/api/bajas').expect(200)).body;
    expect(listaA.bajas.map((x: { id: string }) => x.id)).toEqual([deA.id]);
    const listaB = (await b.agente.get('/api/bajas?numero=comun').expect(200)).body;
    expect(listaB.bajas.map((x: { id: string }) => x.id)).toEqual([deB.id]);
    expect((await a.agente.get('/api/bajas?numero=SOLOB').expect(200)).body.bajas).toEqual([]);
    await a.agente.get(`/api/bajas/${deB.id}`).expect(404);
    await a.agente.get(`/api/bajas/${deA.id}`).expect(200);
  });

  it('los tres roles leen; sin sesión 401; ninguna respuesta lleva hashes ni emails', async () => {
    const { agente, baja } = await tamboBase();
    const vaca = await baja('V1', '2026-11-01');
    for (const [rol, email] of [['DUENO', 'd2@prueba.test'], ['ENCARGADO', 'e@prueba.test'], ['VETERINARIO', 'v@prueba.test']] as const) {
      const quien = await crearUsuario(agente, rol, email);
      const lista = await quien.get('/api/bajas').expect(200);
      const ficha = await quien.get(`/api/bajas/${vaca.id}`).expect(200);
      expect(JSON.stringify([lista.body, ficha.body])).not.toMatch(/passwordHash|tokenHash|@prueba\.test/);
    }
    await request(app).get('/api/bajas').expect(401);
    await request(app).get(`/api/bajas/${vaca.id}`).expect(401);
  });
});

describe('aviso de número de un animal de baja (helper de RF-14)', () => {
  it('devuelve la baja vigente más reciente por número; ignora "parto anulado", revertidas y otros tambos', async () => {
    const a = await tamboBase({ email: 'a@prueba.test', nombreTambo: 'Tambo A' });
    const b = await tamboBase({ email: 'b@prueba.test', nombreTambo: 'Tambo B' });
    await a.baja('N1', '2026-09-01', 'VENTA');
    await a.baja('N1', '2026-11-03', 'MUERTE'); // la más reciente
    await a.baja('N2', '2026-10-01', 'VENTA', { anulacion: { porId: a.usuarioId, motivo: 'error' } });
    await crearAnimalDirecto(a.tambo, 'N3', { estado: 'BAJA', motivoBaja: 'PARTO_ANULADO' });
    await b.baja('N4', '2026-10-10');

    const mapa = await buscarBajasPorNumero(prisma, a.tambo, ['N1', 'N2', 'N3', 'N4', 'N5']);
    expect([...mapa.keys()]).toEqual(['N1']);
    expect(mapa.get('N1')).toEqual({ motivo: 'muerte', fecha: '2026-11-03' });
    expect(textoAvisoNumeroDeBaja('N1', mapa.get('N1')!)).toBe('El número N1 perteneció a un animal dado de baja por muerte el 03/11/2026');
    expect((await buscarBajasPorNumero(prisma, a.tambo, [])).size).toBe(0);
  });
});
