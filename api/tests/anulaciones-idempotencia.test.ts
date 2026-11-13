import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { crearUsuario, limpiarBase, prepararVaca } from './ayudas.js';

// Spec 010, RF-7: la anulación es idempotente por evento + usuario + motivo. Sin `id` propio.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

type Tipo = 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO';
const CARGAS: Record<Tipo, { carga: string; anular: string; cuerpo: Record<string, unknown> }> = {
  SERVICIO: { carga: 'servicios', anular: 'servicios', cuerpo: { fecha: '2026-11-01', tipo: 'INSEMINACION' } },
  TACTO: { carga: 'tactos', anular: 'tactos', cuerpo: { fecha: '2026-11-01', resultado: 'VACIA' } },
  PARTO: { carga: 'partos', anular: 'partos', cuerpo: { fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: 'c1' }] } },
  SECADO: { carga: 'secados', anular: 'secados', cuerpo: { fecha: '2026-11-01' } },
};
const TIPOS = Object.keys(CARGAS) as Tipo[];

// Carga un evento del tipo y devuelve su id.
async function cargarEvento(agente: any, vacaId: string, tipo: Tipo): Promise<string> {
  const res = await agente.post(`/api/animales/${vacaId}/${CARGAS[tipo].carga}`).send(CARGAS[tipo].cuerpo).expect(201);
  return tipo === 'PARTO' || tipo === 'SECADO' ? res.body.evento.id : res.body.id;
}
const anular = (agente: any, tipo: Tipo, id: string, motivo = 'Error de carga') =>
  agente.post(`/api/${CARGAS[tipo].anular}/${id}/anular`).send({ motivo });
const eventoDeRespuesta = (tipo: Tipo, body: any) => (tipo === 'PARTO' || tipo === 'SECADO' ? body.evento : body);

describe('anulación repetida por el mismo usuario y motivo', () => {
  it.each(TIPOS)('%s: la segunda da 200 yaEstabaAnulado y no cambia nada', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const id = await cargarEvento(agente, vaca.id, tipo);
    const primera = await anular(agente, tipo, id).expect(200);
    const guardado = await prisma.evento.findUniqueOrThrow({ where: { id } });
    const animal = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });

    const segunda = await anular(agente, tipo, id).expect(200);
    expect(segunda.body.yaEstabaAnulado).toBe(true);
    expect(primera.body.yaEstabaAnulado).toBeUndefined();
    // La forma de siempre (servicio y tacto: el evento; parto y secado: { evento, avisos }) más el indicador.
    expect(eventoDeRespuesta(tipo, segunda.body)).toMatchObject({ id, anulacion: { motivo: 'Error de carga', por: 'Dueño' } });
    if (tipo === 'PARTO' || tipo === 'SECADO') expect(segunda.body.avisos).toEqual([]);

    expect(await prisma.evento.findUniqueOrThrow({ where: { id } })).toEqual(guardado); // ni anuladoEn
    const despues = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect([despues.estado, despues.loteId, despues.actualizadoEn]).toEqual([animal.estado, animal.loteId, animal.actualizadoEn]);
  });

  it('el motivo se compara después de limpiar espacios', async () => {
    const { agente, vaca } = await prepararVaca();
    const id = await cargarEvento(agente, vaca.id, 'SERVICIO');
    await anular(agente, 'SERVICIO', id, 'Error de carga').expect(200);
    const res = await anular(agente, 'SERVICIO', id, '   Error de carga  ').expect(200);
    expect(res.body.yaEstabaAnulado).toBe(true);
  });

  it.each(TIPOS)('%s: con el animal ya dado de baja también da yaEstabaAnulado (antes del 404)', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const id = await cargarEvento(agente, vaca.id, tipo);
    await anular(agente, tipo, id).expect(200);
    await agente.post(`/api/animales/${vaca.id}/baja`).send({ motivo: 'venta', fecha: '2026-11-02' }).expect(201);
    const res = await anular(agente, tipo, id).expect(200);
    expect(res.body.yaEstabaAnulado).toBe(true);
  });
});

describe('otro usuario u otro motivo: 409 como hoy', () => {
  it.each(TIPOS)('%s: otro motivo', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const id = await cargarEvento(agente, vaca.id, tipo);
    await anular(agente, tipo, id).expect(200);
    const res = await anular(agente, tipo, id, 'Otro motivo').expect(409);
    expect(res.body.error).toBe(`Este ${tipo.toLowerCase()} ya fue anulado`);
  });

  it.each(TIPOS)('%s: otro usuario con el mismo motivo', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const id = await cargarEvento(agente, vaca.id, tipo);
    await anular(agente, tipo, id).expect(200);
    const res = await anular(encargado, tipo, id).expect(409);
    expect(res.body.error).toBe(`Este ${tipo.toLowerCase()} ya fue anulado`);
  });

  it('con el animal de baja, una anulación ajena u otro motivo da 409 (antes daba 404)', async () => {
    const { agente, vaca } = await prepararVaca();
    const id = await cargarEvento(agente, vaca.id, 'SERVICIO');
    await anular(agente, 'SERVICIO', id).expect(200);
    await agente.post(`/api/animales/${vaca.id}/baja`).send({ motivo: 'venta', fecha: '2026-11-02' }).expect(201);
    await anular(agente, 'SERVICIO', id, 'Otro motivo').expect(409);
  });
});

describe('sin anular y con el animal inactivo: el 404 de siempre', () => {
  it.each(TIPOS)('%s', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const id = await cargarEvento(agente, vaca.id, tipo);
    await agente.post(`/api/animales/${vaca.id}/baja`).send({ motivo: 'venta', fecha: '2026-11-02' }).expect(201);
    const res = await anular(agente, tipo, id).expect(404);
    expect(res.body.error).toBe('Evento no encontrado');
  });

  it('un id inexistente o de otro tipo sigue siendo 404', async () => {
    const { agente, vaca } = await prepararVaca();
    const id = await cargarEvento(agente, vaca.id, 'SERVICIO');
    await anular(agente, 'TACTO', id).expect(404);
    await anular(agente, 'SERVICIO', randomUUID()).expect(404);
  });
});

describe('repetida mientras la primera todavía espera el bloqueo', () => {
  it.each(TIPOS)('%s: dos anulaciones iguales a la vez: una anula y la otra "ya estaba anulado"', async (tipo) => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const { agente, vaca } = await prepararVaca({ numero: `R${ronda}`, nombreTambo: `T${ronda}`, email: `r${ronda}@prueba.test` });
      const id = await cargarEvento(agente, vaca.id, tipo);
      const [a, b] = await Promise.all([anular(agente, tipo, id), anular(agente, tipo, id)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const indicadores = [a.body.yaEstabaAnulado, b.body.yaEstabaAnulado].filter(Boolean);
      expect(indicadores).toEqual([true]); // exactamente una fue la repetición
      expect((await prisma.evento.findUniqueOrThrow({ where: { id } })).anuladoEn).not.toBeNull();
    }
  });
});
