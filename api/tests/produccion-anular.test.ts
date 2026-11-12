import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { app, crearAnimalDirecto, crearBajaRegistradaDirecta, crearProduccionDirecta, crearUsuario, limpiarBase, prepararVaca } from './ayudas.js';

// Spec 008: POST /api/animales/:id/produccion/:registroId/anular (RF-9 a RF-11, RF-26, RF-27, RF-36).

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const ID_INEXISTENTE = '00000000-0000-7000-8000-000000000000';
const url = (animalId: string, registroId: string) => `/api/animales/${animalId}/produccion/${registroId}/anular`;
const MOTIVO = { motivo: 'Error de tipeo' };

// Prepara una vaca con un registro cargado a mano.
async function conRegistro(opciones: Parameters<typeof prepararVaca>[0] = {}) {
  const base = await prepararVaca(opciones);
  const registro = await crearProduccionDirecta({ establecimientoId: base.tambo, animalId: base.vaca.id, registradoPorId: base.usuarioId, fecha: '2026-11-10', litros: 25 });
  return { ...base, registro };
}

describe('anular un registro (RF-9)', () => {
  it('200, marca quién, cuándo y el motivo, sin borrar ni tocar lo demás', async () => {
    const { agente, vaca, registro } = await conRegistro();
    const res = await agente.post(url(vaca.id, registro.id)).send(MOTIVO).expect(200);
    expect(res.body).toMatchObject({ id: registro.id, litros: 25, turno: 'manana', anulado: { por: 'Dueño', motivo: 'Error de tipeo' } });
    expect(res.body.anulado.en).toBeTruthy();

    const fila = await prisma.produccion.findUniqueOrThrow({ where: { id: registro.id } });
    expect(fila.anuladoEn).toBeInstanceOf(Date);
    expect(fila.anuladoPorId).toBeTruthy();
    expect(fila).toMatchObject({ motivoAnulacion: 'Error de tipeo', litrosDecimas: 250 });
    expect(await prisma.produccion.count()).toBe(1);
  });

  it('el encargado también anula', async () => {
    const { agente, vaca, registro } = await conRegistro();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const res = await encargado.post(url(vaca.id, registro.id)).send(MOTIVO).expect(200);
    expect(res.body.anulado.por).toBe('Usuario ENCARGADO');
  });

  it('se puede anular cualquier registro no anulado, no solo el último', async () => {
    const { agente, tambo, vaca, usuarioId, registro } = await conRegistro();
    await crearProduccionDirecta({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-11-11' });
    await agente.post(url(vaca.id, registro.id)).send(MOTIVO).expect(200);
  });

  it('se puede anular aunque la vaca ya esté seca (no hace falta que esté en ordeñe)', async () => {
    const { agente, vaca, registro } = await conRegistro();
    await prisma.animal.update({ where: { id: vaca.id }, data: { estado: 'SECA' } });
    await agente.post(url(vaca.id, registro.id)).send(MOTIVO).expect(200);
  });

  it('el motivo se recorta y aguanta exactamente 200 caracteres', async () => {
    const { agente, vaca, registro } = await conRegistro();
    const motivo = 'a'.repeat(200);
    const res = await agente.post(url(vaca.id, registro.id)).send({ motivo: `  ${motivo}  ` }).expect(200);
    expect(res.body.anulado.motivo).toBe(motivo);
  });

  it('las respuestas no incluyen hashes ni el id ni el email de ningún usuario', async () => {
    const { agente, vaca, registro, usuarioId } = await conRegistro();
    const res = await agente.post(url(vaca.id, registro.id)).send(MOTIVO).expect(200);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toMatch(/passwordHash|tokenHash|dueno@prueba\.test/);
    expect(texto).not.toContain(usuarioId);
  });
});

describe('motivo inválido: 400 (RF-10)', () => {
  it.each([
    ['ausente', {}],
    ['vacío', { motivo: '' }],
    ['solo espacios', { motivo: '    ' }],
    ['de 201 caracteres', { motivo: 'a'.repeat(201) }],
    ['que no es texto', { motivo: 5 }],
  ])('motivo %s', async (_nombre, cuerpo) => {
    const { agente, vaca, registro } = await conRegistro();
    await agente.post(url(vaca.id, registro.id)).send(cuerpo).expect(400);
    expect((await prisma.produccion.findUniqueOrThrow({ where: { id: registro.id } })).anuladoEn).toBeNull();
  });

  it('el 400 sale antes que el 404', async () => {
    const { agente } = await prepararVaca();
    await agente.post(url(ID_INEXISTENTE, ID_INEXISTENTE)).send({ motivo: '' }).expect(400);
  });
});

describe('ya anulado: 409 (RF-10)', () => {
  it('anular dos veces el mismo registro da 409 la segunda', async () => {
    const { agente, vaca, registro } = await conRegistro();
    await agente.post(url(vaca.id, registro.id)).send(MOTIVO).expect(200);
    const res = await agente.post(url(vaca.id, registro.id)).send({ motivo: 'Otro motivo' }).expect(409);
    expect(res.body.error).toMatch(/ya está anulad|ya fue anulad/);
    expect((await prisma.produccion.findUniqueOrThrow({ where: { id: registro.id } })).motivoAnulacion).toBe('Error de tipeo');
  });
});

describe('404 idéntico (RF-10, RF-26)', () => {
  it('vaca o registro inexistente, mal formado, de otro tambo, de otra vaca o vaca de baja', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const regA = await crearProduccionDirecta({ establecimientoId: a.tambo, animalId: a.vaca.id, registradoPorId: a.usuarioId, fecha: '2026-11-10' });
    const regB = await crearProduccionDirecta({ establecimientoId: b.tambo, animalId: b.vaca.id, registradoPorId: b.usuarioId, fecha: '2026-11-10' });
    const otraDeA = await crearAnimalDirecto(a.tambo, '102');
    const regOtraDeA = await crearProduccionDirecta({ establecimientoId: a.tambo, animalId: otraDeA.id, registradoPorId: a.usuarioId, fecha: '2026-11-10' });
    const deBaja = await crearAnimalDirecto(a.tambo, '103');
    const regBaja = await crearProduccionDirecta({ establecimientoId: a.tambo, animalId: deBaja.id, registradoPorId: a.usuarioId, fecha: '2026-11-10' });
    await crearBajaRegistradaDirecta({ establecimientoId: a.tambo, animalId: deBaja.id, registradoPorId: a.usuarioId, fecha: '2026-11-10' });

    const casos: Array<[string, string]> = [
      [ID_INEXISTENTE, regA.id], // vaca inexistente
      [a.vaca.id, ID_INEXISTENTE], // registro inexistente
      ['no-es-uuid', regA.id], // vaca mal formada
      [a.vaca.id, 'no-es-uuid'], // registro mal formado
      [b.vaca.id, regB.id], // vaca de otro tambo con su registro (el tambo A los pide)
      [a.vaca.id, regB.id], // vaca propia con registro de otro tambo
      [b.vaca.id, regA.id], // vaca de otro tambo con registro propio
      [a.vaca.id, regOtraDeA.id], // registro de otra vaca del mismo tambo
      [deBaja.id, regBaja.id], // vaca de baja
    ];
    const mensajes = new Set<string>();
    for (const [animalId, registroId] of casos) {
      const res = await a.agente.post(url(animalId, registroId)).send(MOTIVO).expect(404);
      mensajes.add(res.body.error);
    }
    expect(mensajes.size).toBe(1);
    // Nada quedó anulado.
    expect(await prisma.produccion.count({ where: { anuladoEn: { not: null } } })).toBe(0);
  });
});

describe('permisos (RF-27)', () => {
  it('el veterinario recibe 403 con el mensaje exacto, también con JSON roto', async () => {
    const { agente, vaca, registro } = await conRegistro();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const res = await vet.post(url(vaca.id, registro.id)).send(MOTIVO).expect(403);
    expect(res.body.error).toBe('Esta acción la tiene que hacer un dueño o encargado');
    await vet.post(url(vaca.id, registro.id)).set('Content-Type', 'application/json').send('{roto').expect(403);
    expect((await prisma.produccion.findUniqueOrThrow({ where: { id: registro.id } })).anuladoEn).toBeNull();
  });

  it('sin sesión: 401, también con JSON roto', async () => {
    const { vaca, registro } = await conRegistro();
    await request(app).post(url(vaca.id, registro.id)).send(MOTIVO).expect(401);
    await request(app).post(url(vaca.id, registro.id)).set('Content-Type', 'application/json').send('{roto').expect(401);
  });

  it('ignora un establecimientoId enviado en el cuerpo', async () => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const regB = await crearProduccionDirecta({ establecimientoId: b.tambo, animalId: b.vaca.id, registradoPorId: b.usuarioId, fecha: '2026-11-10' });
    await a.agente.post(url(b.vaca.id, regB.id)).send({ ...MOTIVO, establecimientoId: b.tambo }).expect(404);
    expect((await prisma.produccion.findUniqueOrThrow({ where: { id: regB.id } })).anuladoEn).toBeNull();
  });
});
