import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { crearServicioDirecto, crearTactoDirecto, limpiarBase, prepararVaca } from './ayudas.js';

// RF-22: operaciones simultáneas sobre el mismo animal. Cada carrera se repite varias veces y
// se aceptan SOLO los resultados que enumera la spec (no un orden fijo: depende de quién
// llega primero). Un fallo intermitente es un error real: no se reintenta.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const RONDAS = 8;

// Coherencia de lo que quedó guardado para un animal (RF-22):
//  - entre los eventos no anulados, en orden de registro, ninguno tiene una fecha anterior
//    a la de otro registrado antes;
//  - nunca un servicio no anulado registrado justo después de un tacto "preñada" vigente;
//  - nunca dos eventos con el mismo momento de registro (también lo impide la base).
async function verificarCoherencia(animalId: string) {
  const eventos = await prisma.evento.findMany({
    where: { animalId },
    orderBy: { creadoEn: 'asc' },
    select: { id: true, tipo: true, fecha: true, creadoEn: true, anuladoEn: true, tacto: { select: { resultado: true } } },
  });
  expect(new Set(eventos.map((e) => e.creadoEn.getTime())).size).toBe(eventos.length);
  const vigentes = eventos.filter((e) => !e.anuladoEn);
  for (let i = 1; i < vigentes.length; i++) {
    const anterior = vigentes[i - 1]!;
    const actual = vigentes[i]!;
    expect(actual.fecha.getTime()).toBeGreaterThanOrEqual(anterior.fecha.getTime());
    if (actual.tipo === 'SERVICIO') {
      expect(anterior.tipo === 'TACTO' && anterior.tacto?.resultado === 'PRENADA').toBe(false);
    }
  }
}

describe('concurrencia sobre el mismo animal (RF-22)', () => {
  it('un servicio y un tacto "preñada" a la vez: los dos guardados en orden coherente, o el servicio rechazado', async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { agente, vaca, tambo, usuarioId } = await prepararVaca({ numero: `C${ronda}`, nombreTambo: `T${ronda}`, email: `t${ronda}@prueba.test` });
      await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-08-01' });

      const [rServicio, rTacto] = await Promise.all([
        agente.post(`/api/animales/${vaca.id}/servicios`).send({ fecha: '2026-11-01', tipo: 'INSEMINACION' }),
        agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-01', resultado: 'PRENADA' }),
      ]);
      // El tacto siempre se acepta (la fecha es igual a la del servicio o hay servicio base).
      expect(rTacto.status).toBe(201);
      // El servicio: 201 (se procesó antes del tacto) o 409 (ya había preñez vigente).
      expect([201, 409]).toContain(rServicio.status);
      await verificarCoherencia(vaca.id);

      const guardados = await prisma.evento.count({ where: { animalId: vaca.id, tipo: 'SERVICIO' } });
      expect(guardados).toBe(rServicio.status === 201 ? 2 : 1);
    }
  });

  it('dos servicios a la vez: los dos se guardan con momentos de registro distintos', async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { agente, vaca } = await prepararVaca({ numero: `D${ronda}`, nombreTambo: `T${ronda}`, email: `t${ronda}@prueba.test` });
      const respuestas = await Promise.all([
        agente.post(`/api/animales/${vaca.id}/servicios`).send({ fecha: '2026-11-01', tipo: 'INSEMINACION' }),
        agente.post(`/api/animales/${vaca.id}/servicios`).send({ fecha: '2026-11-01', tipo: 'MONTA_NATURAL' }),
      ]);
      expect(respuestas.map((r) => r.status)).toEqual([201, 201]);
      await verificarCoherencia(vaca.id);
    }
  });

  it('dos anulaciones del mismo evento: una 200 y una 409', async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { agente, vaca, tambo, usuarioId } = await prepararVaca({ numero: `E${ronda}`, nombreTambo: `T${ronda}`, email: `t${ronda}@prueba.test` });
      const tacto = await crearTactoDirecto({
        establecimientoId: tambo,
        animalId: vaca.id,
        registradoPorId: usuarioId,
        fecha: '2026-10-01',
        resultado: 'VACIA',
      });
      const respuestas = await Promise.all([
        agente.post(`/api/tactos/${tacto.id}/anular`).send({ motivo: 'Primera' }),
        agente.post(`/api/tactos/${tacto.id}/anular`).send({ motivo: 'Segunda' }),
      ]);
      expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
      const guardado = await prisma.evento.findUniqueOrThrow({ where: { id: tacto.id } });
      // El motivo guardado es el de la que ganó.
      const ganadora = respuestas.findIndex((r) => r.status === 200);
      expect(guardado.motivoAnulacion).toBe(ganadora === 0 ? 'Primera' : 'Segunda');
    }
  });

  it('anular el último y el anterior a la vez: el último siempre 200; el anterior 200 (si fue después) o 409', async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { agente, vaca, tambo, usuarioId } = await prepararVaca({ numero: `F${ronda}`, nombreTambo: `T${ronda}`, email: `t${ronda}@prueba.test` });
      const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
      const s1 = await crearServicioDirecto({ ...base, fecha: '2026-08-01' });
      const s2 = await crearServicioDirecto({ ...base, fecha: '2026-09-01' });
      const [rUltimo, rAnterior] = await Promise.all([
        agente.post(`/api/servicios/${s2.id}/anular`).send({ motivo: 'Ultimo' }),
        agente.post(`/api/servicios/${s1.id}/anular`).send({ motivo: 'Anterior' }),
      ]);
      expect(rUltimo.status).toBe(200);
      expect([200, 409]).toContain(rAnterior.status);
      const e1 = await prisma.evento.findUniqueOrThrow({ where: { id: s1.id } });
      expect(e1.anuladoEn !== null).toBe(rAnterior.status === 200);
      await verificarCoherencia(vaca.id);
    }
  });

  it('una anulación y un registro a la vez: el registro se guarda; la anulación 200 o 409, sin incoherencias', async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { agente, vaca, tambo, usuarioId } = await prepararVaca({ numero: `G${ronda}`, nombreTambo: `T${ronda}`, email: `t${ronda}@prueba.test` });
      const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
      await crearTactoDirecto({ ...base, fecha: '2026-09-01', resultado: 'VACIA' });
      const s1 = await crearServicioDirecto({ ...base, fecha: '2026-10-01' });
      const [rAnular, rRegistro] = await Promise.all([
        agente.post(`/api/servicios/${s1.id}/anular`).send({ motivo: 'Error' }),
        agente.post(`/api/animales/${vaca.id}/servicios`).send({ fecha: '2026-10-01', tipo: 'INSEMINACION' }),
      ]);
      // El registro tiene la misma fecha que s1: se acepta antes o después de la anulación.
      expect(rRegistro.status).toBe(201);
      // La anulación: 200 si entró antes, 409 si el nuevo servicio ya era el último.
      expect([200, 409]).toContain(rAnular.status);
      const e1 = await prisma.evento.findUniqueOrThrow({ where: { id: s1.id } });
      expect(e1.anuladoEn !== null).toBe(rAnular.status === 200);
      await verificarCoherencia(vaca.id);
    }
  });

  it('anular un tacto "preñada" y registrar un servicio a la vez: nunca un servicio sobre la preñez vigente', async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { agente, vaca, tambo, usuarioId } = await prepararVaca({ numero: `H${ronda}`, nombreTambo: `T${ronda}`, email: `t${ronda}@prueba.test` });
      const base = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId };
      await crearServicioDirecto({ ...base, fecha: '2026-08-01' });
      const tacto = await crearTactoDirecto({ ...base, fecha: '2026-09-01', resultado: 'PRENADA' });
      const [rAnular, rServicio] = await Promise.all([
        agente.post(`/api/tactos/${tacto.id}/anular`).send({ motivo: 'Error' }),
        agente.post(`/api/animales/${vaca.id}/servicios`).send({ fecha: '2026-10-01', tipo: 'INSEMINACION' }),
      ]);
      // Anular primero y servir después (200, 201), o el servicio llega con la preñez vigente (409)
      // y entonces la anulación se procesa igual (200).
      expect(rAnular.status).toBe(200);
      expect([201, 409]).toContain(rServicio.status);
      await verificarCoherencia(vaca.id);
    }
  });
});
