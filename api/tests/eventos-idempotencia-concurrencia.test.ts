import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { crearAnimalDirecto, limpiarBase, prepararVaca, verificarInvariantes } from './ayudas.js';

// Spec 010, RF-6: dos cargas con el mismo `id` al MISMO TIEMPO guardan una sola y la otra recibe
// "ya estaba guardado" (200) o 409; nunca un 500. Cada carrera se repite varias veces.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const RONDAS = 6;
const GENERICO = 'Ese identificador de registro ya se usó con otros datos';

type Tipo = 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO' | 'BAJA';
const CARGAS: Record<Tipo, { ruta: string; cuerpo: Record<string, unknown>; otro: Record<string, unknown> }> = {
  SERVICIO: { ruta: 'servicios', cuerpo: { fecha: '2026-11-01', tipo: 'INSEMINACION' }, otro: { fecha: '2026-11-01', tipo: 'MONTA_NATURAL' } },
  TACTO: { ruta: 'tactos', cuerpo: { fecha: '2026-11-01', resultado: 'VACIA' }, otro: { fecha: '2026-11-02', resultado: 'VACIA' } },
  PARTO: {
    ruta: 'partos',
    cuerpo: { fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: 'c1' }] },
    otro: { fecha: '2026-11-01', crias: [{ sexo: 'MACHO', numero: 'c1' }] },
  },
  SECADO: { ruta: 'secados', cuerpo: { fecha: '2026-11-01' }, otro: { fecha: '2026-11-02' } },
  BAJA: { ruta: 'baja', cuerpo: { motivo: 'venta', fecha: '2026-11-01' }, otro: { motivo: 'muerte', fecha: '2026-11-01' } },
};
const TIPOS = Object.keys(CARGAS) as Tipo[];

describe('mismo id, mismo animal, a la vez', () => {
  it.each(TIPOS)('%s: iguales: una se crea (201) y la otra es "ya estaba guardado" (200)', async (tipo) => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { agente, tambo, vaca } = await prepararVaca({ numero: `A${ronda}`, nombreTambo: `T${ronda}`, email: `t${ronda}@prueba.test` });
      const id = randomUUID();
      const c = CARGAS[tipo];
      const [a, b] = await Promise.all([
        agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }),
        agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }),
      ]);
      expect([a.status, b.status].sort(), `ronda ${ronda}: ${JSON.stringify([a.body, b.body])}`).toEqual([200, 201]);
      expect(await prisma.evento.count({ where: { establecimientoId: tambo } })).toBe(1);
      expect(await prisma.criaParto.count({ where: { establecimientoId: tambo } })).toBe(tipo === 'PARTO' ? 1 : 0);
    }
    expect(await verificarInvariantes({ estadoVaca: true })).toEqual([]);
  });

  it.each(TIPOS)('%s: con otros datos: una se crea y la otra es 409 genérico (o 404 si la baja ya dejó la vaca inactiva)', async (tipo) => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { agente, tambo, vaca } = await prepararVaca({ numero: `A${ronda}`, nombreTambo: `T${ronda}`, email: `t${ronda}@prueba.test` });
      const id = randomUUID();
      const c = CARGAS[tipo];
      const [a, b] = await Promise.all([
        agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }),
        agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.otro, id }),
      ]);
      const estados = [a.status, b.status].sort();
      expect(estados[0], `ronda ${ronda}`).toBe(201);
      // 409 genérico; en la baja, si la primera ya dio de baja a la vaca, el animal no es accesible y no es "el mismo": 404.
      expect([409, 404]).toContain(estados[1]);
      const perdedora = a.status === 201 ? b : a;
      if (perdedora.status === 409) expect(perdedora.body.error).toBe(GENERICO);
      expect(await prisma.evento.count({ where: { establecimientoId: tambo } })).toBe(1);
    }
  });
});

describe('mismo id sobre dos animales distintos, a la vez', () => {
  it.each(TIPOS)('%s: uno se crea y el otro recibe 409 genérico (nunca 500)', async (tipo) => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { agente, tambo, vaca } = await prepararVaca({ numero: `A${ronda}`, nombreTambo: `T${ronda}`, email: `t${ronda}@prueba.test` });
      const otra = await crearAnimalDirecto(tambo, `B${ronda}`);
      const id = randomUUID();
      const c = CARGAS[tipo];
      // Cada parto usa su propio número de cría: así el único choque posible es el del `id`.
      const cuerpoOtra = tipo === 'PARTO' ? { ...c.cuerpo, crias: [{ sexo: 'HEMBRA', numero: 'c9' }] } : c.cuerpo;
      const [a, b] = await Promise.all([
        agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }),
        agente.post(`/api/animales/${otra.id}/${c.ruta}`).send({ ...cuerpoOtra, id }),
      ]);
      expect([a.status, b.status].sort(), `ronda ${ronda}: ${JSON.stringify([a.body, b.body])}`).toEqual([201, 409]);
      const perdedora = a.status === 201 ? b : a;
      expect(perdedora.body.error).toBe(GENERICO);
      expect(await prisma.evento.count({ where: { establecimientoId: tambo } })).toBe(1);
    }
    expect(await verificarInvariantes({ estadoVaca: true })).toEqual([]);
  });
});

describe('muchos reenvíos a la vez', () => {
  it('cinco envíos simultáneos del mismo parto: uno se crea, cuatro "ya estaba guardado", una sola fila', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    const id = randomUUID();
    const c = CARGAS.PARTO;
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id })),
    );
    expect(resultados.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(await prisma.evento.count({ where: { establecimientoId: tambo } })).toBe(1);
    expect(await prisma.animal.count({ where: { establecimientoId: tambo, madreId: vaca.id } })).toBe(1);
  });

  it('una baja simultánea con su reenvío: 201 y 200, y la vaca queda de baja una sola vez', async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { agente, tambo, vaca } = await prepararVaca({ numero: `A${ronda}`, nombreTambo: `T${ronda}`, email: `t${ronda}@prueba.test` });
      const id = randomUUID();
      const [a, b] = await Promise.all([
        agente.post(`/api/animales/${vaca.id}/baja`).send({ ...CARGAS.BAJA.cuerpo, id }),
        agente.post(`/api/animales/${vaca.id}/baja`).send({ ...CARGAS.BAJA.cuerpo, id }),
      ]);
      expect([a.status, b.status].sort(), `ronda ${ronda}: ${JSON.stringify([a.body, b.body])}`).toEqual([200, 201]);
      expect(await prisma.baja.count({ where: { establecimientoId: tambo } })).toBe(1);
    }
    expect(await verificarInvariantes()).toEqual([]);
  });
});
