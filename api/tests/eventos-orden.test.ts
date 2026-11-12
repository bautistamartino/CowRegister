import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { crearCambioDirecto, crearServicioDirecto, limpiarBase, prepararVaca } from './ayudas.js';

// Spec 010, RF-1 y RF-2: el orden de los eventos de una vaca es la fecha del evento y, a igual
// fecha, el momento en que el servidor los aceptó. El reloj de la tablet nunca ordena nada.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

describe('orden de llegada entre dispositivos (RF-1)', () => {
  it('un servicio que llega después de un tacto "preñada" del mismo día se rechaza por preñez vigente', async () => {
    const { agente, tambo, usuarioId, vaca } = await prepararVaca();
    await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-08-01' });
    // Dispositivo A: tacto preñada del 01/11. Dispositivo B (cargó antes, sin conexión): servicio del mismo día.
    await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-01', resultado: 'PRENADA' }).expect(201);
    const res = await agente
      .post(`/api/animales/${vaca.id}/servicios`)
      .send({ fecha: '2026-11-01', tipo: 'INSEMINACION', cargadoEnDispositivo: '2026-11-01T07:00:00-03:00' })
      .expect(409);
    expect(res.body.error).toBe('La vaca tiene una preñez vigente: primero registrá un tacto "vacía"');
    expect(await prisma.evento.count({ where: { animalId: vaca.id, tipo: 'SERVICIO' } })).toBe(1);
  });

  it('el que llega primero queda primero, aunque la tablet diga que cargó después', async () => {
    const { agente, vaca } = await prepararVaca();
    const tarde = await agente
      .post(`/api/animales/${vaca.id}/tactos`)
      .send({ fecha: '2026-11-01', resultado: 'VACIA', cargadoEnDispositivo: '2026-11-11T11:50:00-03:00' })
      .expect(201);
    const temprano = await agente
      .post(`/api/animales/${vaca.id}/tactos`)
      .send({ fecha: '2026-11-01', resultado: 'VACIA', cargadoEnDispositivo: '2026-11-01T06:00:00-03:00' })
      .expect(201);
    const [a, b] = await Promise.all([tarde.body.id, temprano.body.id].map((id) => prisma.evento.findUniqueOrThrow({ where: { id } })));
    expect(a.creadoEn.getTime()).toBeLessThan(b.creadoEn.getTime());
    const eventos = (await agente.get(`/api/animales/${vaca.id}/eventos`).expect(200)).body.eventos;
    expect(eventos.map((e: { id: string }) => e.id)).toEqual([temprano.body.id, tarde.body.id]); // el último en llegar, arriba
  });

  it('dos tactos del mismo día valen los dos y manda el último en llegar', async () => {
    const { agente, vaca } = await prepararVaca();
    await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-01', resultado: 'PRENADA', fechaProbableParto: '2027-07-01' }).expect(201);
    await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-01', resultado: 'VACIA' }).expect(201);
    const { situacion, eventos } = (await agente.get(`/api/animales/${vaca.id}/eventos`).expect(200)).body;
    expect(eventos).toHaveLength(2);
    expect(situacion.estado).toBe('VACIA');
  });
});

describe('momento de registro posterior a todo lo anterior (RF-2)', () => {
  // El reloj del servidor no se simula: se siembra un `creadoEn` en el futuro, como si el reloj hubiera retrocedido.
  const FUTURO = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

  it('después de un evento con creadoEn futuro, el evento nuevo queda posterior', async () => {
    const { agente, tambo, usuarioId, vaca } = await prepararVaca();
    const previo = await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-10-01', creadoEn: FUTURO });
    const res = await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-01', resultado: 'VACIA' }).expect(201);
    const nuevo = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(nuevo.creadoEn.getTime()).toBeGreaterThan(previo.creadoEn.getTime());
  });

  it('también cuenta un evento anulado', async () => {
    const { agente, tambo, usuarioId, vaca } = await prepararVaca();
    const previo = await crearServicioDirecto({
      establecimientoId: tambo,
      animalId: vaca.id,
      registradoPorId: usuarioId,
      fecha: '2026-10-01',
      creadoEn: FUTURO,
      anulacion: { porId: usuarioId, motivo: 'Error' },
    });
    const res = await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-01', resultado: 'VACIA' }).expect(201);
    expect((await prisma.evento.findUniqueOrThrow({ where: { id: res.body.id } })).creadoEn.getTime()).toBeGreaterThan(previo.creadoEn.getTime());
  });

  it.each(['servicios', 'tactos', 'secados', 'partos', 'baja'] as const)(
    'con un cambio manual de creadoEn futuro, la carga por %s queda posterior al cambio',
    async (ruta) => {
      const { agente, tambo, vaca } = await prepararVaca();
      const cambio = await crearCambioDirecto(tambo, vaca.id, { campo: 'LOTE', valorAnterior: null, valorNuevo: 'Otro', creadoEn: FUTURO });
      const cuerpos = {
        servicios: { fecha: '2026-11-01', tipo: 'INSEMINACION' },
        tactos: { fecha: '2026-11-01', resultado: 'VACIA' },
        secados: { fecha: '2026-11-01' },
        partos: { fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: 'c1' }] },
        baja: { motivo: 'venta', fecha: '2026-11-01' },
      };
      await agente.post(`/api/animales/${vaca.id}/${ruta}`).send(cuerpos[ruta]).expect(201);
      const evento = await prisma.evento.findFirstOrThrow({ where: { animalId: vaca.id } });
      expect(evento.creadoEn.getTime()).toBeGreaterThan(cambio.creadoEn.getTime());
    },
  );

  it('el aviso 8 no falla por el reloj: anular un secado no avisa de un lote manual que nunca hubo', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    await crearCambioDirecto(tambo, vaca.id, { campo: 'LOTE', valorAnterior: null, valorNuevo: 'Otro', creadoEn: FUTURO });
    const secado = await agente.post(`/api/animales/${vaca.id}/secados`).send({ fecha: '2026-11-01' }).expect(201);
    const res = await agente.post(`/api/secados/${secado.body.evento.id}/anular`).send({ motivo: 'Error' }).expect(200);
    expect(res.body.avisos.map((a: { codigo: string }) => a.codigo)).not.toContain('LOTE_MANUAL_DESCARTADO');
  });

  it('la edición de un animal (spec 005) también queda posterior a los eventos', async () => {
    const { agente, tambo, usuarioId, vaca } = await prepararVaca();
    const previo = await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-10-01', creadoEn: FUTURO });
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Lote manual' } });
    await agente.patch(`/api/animales/${vaca.id}/lote`).send({ loteId: lote.id }).expect(200);
    const cambio = await prisma.cambioAnimal.findFirstOrThrow({ where: { animalId: vaca.id, campo: 'LOTE' } });
    expect(cambio.creadoEn.getTime()).toBeGreaterThan(previo.creadoEn.getTime());
  });
});
