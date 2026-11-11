import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { app, limpiarBase, registrarTambo } from './ayudas.js';

// Mensajes de error de validación (constitución §2: siempre en español).
// Cubre las mejoras 1 y 4 que sugirió el revisor en la validación de la spec 001.

beforeEach(limpiarBase);
afterAll(() => prisma.$disconnect());

type Detalle = { campo: string; mensaje: string };

// Ninguna parte de la respuesta puede tener los mensajes por defecto de zod en inglés.
function esperarEnEspañol(body: { error: string; detalles?: Detalle[] }) {
  const textos = [body.error, ...(body.detalles ?? []).map((d) => d.mensaje)];
  for (const texto of textos) {
    expect(texto).not.toMatch(/invalid|expected|received|required/i);
  }
}

describe('Mensajes de validación', () => {
  it('un cuerpo que no es un objeto da un error en español, sin campo vacío', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/lotes').send([1, 2]).expect(400);

    esperarEnEspañol(res.body);
    // Un error de todo el pedido (no de un campo) va en "error", no en "detalles" con campo "".
    expect(res.body.detalles ?? []).not.toContainEqual(expect.objectContaining({ campo: '' }));
    expect(res.body.error).toMatch(/se esperaba objeto/i);
  });

  it('un campo con un tipo inesperado da un error en español', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@prueba.test', password: 123 }).expect(400);
    esperarEnEspañol(res.body);
    expect(res.body.detalles).toContainEqual(expect.objectContaining({ campo: 'password' }));
  });

  it('editar un lote sin datos explica qué falta en el mensaje principal', async () => {
    const { agente } = await registrarTambo();
    const { body: lotes } = await agente.get('/api/lotes').expect(200);

    const res = await agente.patch(`/api/lotes/${lotes[0].id}`).send({}).expect(400);
    expect(res.body.error).toBe('Indicá el nombre o la descripción a cambiar');
    expect(res.body.detalles ?? []).not.toContainEqual(expect.objectContaining({ campo: '' }));
  });

  it('los errores de un campo siguen yendo en "detalles" con su campo', async () => {
    const { agente } = await registrarTambo();
    const res = await agente.post('/api/lotes').send({ nombre: '   ' }).expect(400);
    expect(res.body.error).toBe('Datos inválidos');
    expect(res.body.detalles).toContainEqual({ campo: 'nombre', mensaje: 'El nombre del lote es obligatorio' });
  });
});
