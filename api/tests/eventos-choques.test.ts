import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { crearAnimalDirecto, crearSemenDirecto, crearServicioDirecto, limpiarBase, prepararVaca } from './ayudas.js';

// Spec 010, RF-9: lo que una tablet cargó sin conexión choca con lo que pasó mientras tanto en el
// servidor y se rechaza con la regla que corresponde (specs 003 a 006), sin crear nada a medias.
// Cada caso reenvía con `id` propio, como hace la cola de la tablet.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const conId = (cuerpo: Record<string, unknown>) => ({ ...cuerpo, id: randomUUID() });

describe('choques con el estado real al llegar (RF-9)', () => {
  it('servicio con una preñez vigente que cargó otro dispositivo: 409 y no se guarda', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(`/api/animales/${vaca.id}/servicios`).send({ fecha: '2026-10-01', tipo: 'INSEMINACION' }).expect(201);
    await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-01', resultado: 'PRENADA' }).expect(201);
    const pedido = conId({ fecha: '2026-11-02', tipo: 'INSEMINACION' });
    const res = await agente.post(`/api/animales/${vaca.id}/servicios`).send(pedido).expect(409);
    expect(res.body.error).toBe('La vaca tiene una preñez vigente: primero registrá un tacto "vacía"');
    expect(await prisma.evento.findUnique({ where: { id: pedido.id } })).toBeNull();
  });

  it('un evento con fecha anterior al último que se cargó mientras tanto: 400 sobre la fecha', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-05', resultado: 'VACIA' }).expect(201);
    const res = await agente.post(`/api/animales/${vaca.id}/servicios`).send(conId({ fecha: '2026-11-01', tipo: 'INSEMINACION' })).expect(400);
    expect(res.body.detalles[0].campo).toBe('fecha');
    expect(res.body.detalles[0].mensaje).toContain('anterior a la del último evento');
  });

  it('un secado cuando otro dispositivo ya la secó: 409 por estado', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(`/api/animales/${vaca.id}/secados`).send({ fecha: '2026-11-01' }).expect(201);
    const pedido = conId({ fecha: '2026-11-02' });
    await agente.post(`/api/animales/${vaca.id}/secados`).send(pedido).expect(409);
    expect(await prisma.evento.findUnique({ where: { id: pedido.id } })).toBeNull();
  });

  it('un servicio con un semen que se desactivó después: 409', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    const semen = await crearSemenDirecto(tambo, 'Toro Pampa');
    await prisma.semenToro.update({ where: { id: semen.id }, data: { activo: false } });
    const res = await agente.post(`/api/animales/${vaca.id}/servicios`).send(conId({ fecha: '2026-11-01', tipo: 'INSEMINACION', semenId: semen.id })).expect(409);
    expect(res.body.error).toBe('El semen o toro está desactivado: elegí otro o reactivalo');
  });

  it('anular dos veces el último evento por distintos usuarios: el segundo recibe 409', async () => {
    const { agente, tambo, usuarioId, vaca } = await prepararVaca();
    const s = await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-10-01' });
    await agente.post(`/api/servicios/${s.id}/anular`).send({ motivo: 'Uno' }).expect(200);
    const res = await agente.post(`/api/servicios/${s.id}/anular`).send({ motivo: 'Otro' }).expect(409);
    expect(res.body.error).toBe('Este servicio ya fue anulado');
  });

  it('vaca dada de baja por otro dispositivo: el mismo 404 que un animal inexistente, para las cinco cargas', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(`/api/animales/${vaca.id}/baja`).send({ motivo: 'muerte', fecha: '2026-11-01' }).expect(201);
    const cuerpos: Record<string, Record<string, unknown>> = {
      servicios: { fecha: '2026-11-02', tipo: 'INSEMINACION' },
      tactos: { fecha: '2026-11-02', resultado: 'VACIA' },
      partos: { fecha: '2026-11-02', crias: [{ sexo: 'HEMBRA', numero: 'c1' }] },
      secados: { fecha: '2026-11-02' },
      baja: { motivo: 'venta', fecha: '2026-11-02' },
    };
    for (const [ruta, cuerpo] of Object.entries(cuerpos)) {
      const real = await agente.post(`/api/animales/${vaca.id}/${ruta}`).send(conId(cuerpo)).expect(404);
      const inexistente = await agente.post(`/api/animales/${randomUUID()}/${ruta}`).send(conId(cuerpo)).expect(404);
      expect(real.body).toEqual(inexistente.body);
    }
  });
});

describe('parto con número de cría ocupado después de la última copia (RF-9, RF-20)', () => {
  it('409 con el campo de la cría y no se crea ningún animal, evento ni cría a medias', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await crearAnimalDirecto(tambo, 'C2'); // otro dispositivo ocupó el número
    const pedido = conId({ fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: 'c1' }, { sexo: 'MACHO', numero: 'c2' }] });
    const res = await agente.post(`/api/animales/${vaca.id}/partos`).send(pedido).expect(409);
    expect(res.body.detalles).toEqual([{ campo: 'crias.1.numero', mensaje: 'Ya existe un animal activo con ese número' }]);

    expect(await prisma.animal.count({ where: { establecimientoId: tambo } })).toBe(2); // la vaca y C2
    expect(await prisma.evento.count({ where: { establecimientoId: tambo } })).toBe(0);
    expect(await prisma.criaParto.count({ where: { establecimientoId: tambo } })).toBe(0);
    const madre = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(madre.estado).toBe('EN_ORDENE');
  });
});
