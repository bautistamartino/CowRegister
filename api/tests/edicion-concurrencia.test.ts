import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { crearAnimalDirecto, crearPartoDirecto, limpiarBase, prepararVaca, verificarInvariantes } from './ayudas.js';

// Spec 005, RF-17: operaciones simultáneas que EDITAN. Hay una prueba por cada fila de edición de
// la tabla de la spec y, más abajo, las de mover (T3). Cada carrera se repite varias veces
// y solo se aceptan los resultados que enumera la tabla (no un orden fijo: depende de quién llegue
// primero a la base). Un fallo intermitente es un error real: no se reintenta. Al final de cada
// ronda se comprueban los invariantes (número único, sin ciclos de madres, madre hembra...).

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const RONDAS = 8;
type Agente = ReturnType<typeof request.agent>;
type Respuesta = { status: number; body: any };

const editar = (agente: Agente, id: string, cuerpo: object) =>
  agente.patch(`/api/animales/${id}`).send(cuerpo) as unknown as Promise<Respuesta>;
const estados = (rs: Respuesta[]) => rs.map((r) => r.status);
const ordenados = (rs: Respuesta[]) => estados(rs).sort((a, b) => a - b);

// Invariantes de RF-17 y, además, (e): todo dato cambiado a mano tiene su fila de historial
// (se comprueba para la madre y el número: si el animal los tiene distintos del historial, falta una fila).
const invariantes = async () => expect(await verificarInvariantes()).toEqual([]);

async function tamboBase() {
  const t = await prepararVaca({ numero: 'BASE' });
  const nueva = (numero: string, opciones: Parameters<typeof crearAnimalDirecto>[2] = {}) =>
    crearAnimalDirecto(t.tambo, numero, opciones);
  return { ...t, nueva };
}

// Cantidad de filas de historial de un campo para un animal.
const filas = (animalId: string, campo: 'NUMERO' | 'SEXO' | 'FECHA_NACIMIENTO' | 'MADRE') =>
  prisma.cambioAnimal.count({ where: { animalId, campo } });

describe('A.madre = B × B.madre = A (RF-17)', () => {
  it('uno 200 y el otro 400 (ciclo)', async () => {
    const { agente, nueva } = await tamboBase();
    for (let r = 0; r < RONDAS; r++) {
      const a = await nueva(`A${r}`);
      const b = await nueva(`B${r}`);
      const rs = await Promise.all([editar(agente, a.id, { madre: `B${r}` }), editar(agente, b.id, { madre: `A${r}` })]);
      expect(ordenados(rs)).toEqual([200, 400]);
      const perdedor = rs.find((x) => x.status === 400)!;
      expect(perdedor.body.error).toMatch(/ya es descendiente de este animal/);
      await invariantes();
    }
  });
});

describe('A.madre = B × B.madre = C × C.madre = A (RF-17)', () => {
  it('dos 200 y uno 400 (ciclo de tres)', async () => {
    const { agente, nueva } = await tamboBase();
    for (let r = 0; r < RONDAS; r++) {
      const a = await nueva(`A${r}`);
      const b = await nueva(`B${r}`);
      const c = await nueva(`C${r}`);
      const rs = await Promise.all([
        editar(agente, a.id, { madre: `B${r}` }),
        editar(agente, b.id, { madre: `C${r}` }),
        editar(agente, c.id, { madre: `A${r}` }),
      ]);
      expect(ordenados(rs)).toEqual([200, 200, 400]);
      await invariantes();
    }
  });
});

describe('X.madre = M × M pasa a macho (RF-17)', () => {
  it('madre 200 y sexo 409 (ahora tiene crías); o sexo 200 y madre 400 (es macho)', async () => {
    const { agente, nueva } = await tamboBase();
    for (let r = 0; r < RONDAS; r++) {
      // M es una recién nacida sin crías: puede pasar a macho (sexo-estado) si nadie la nombró madre.
      const m = await nueva(`M${r}`, { estado: 'RECIEN_NACIDO' });
      const x = await nueva(`X${r}`);
      const rs = await Promise.all([editar(agente, x.id, { madre: `M${r}` }), editar(agente, m.id, { sexo: 'MACHO' })]);
      const par = JSON.stringify(estados(rs));
      expect(['[200,409]', '[400,200]']).toContain(par);
      // Coherente con el resultado: o M sigue hembra con su cría, o es macho y X sin madre.
      const guardadaM = await prisma.animal.findUniqueOrThrow({ where: { id: m.id } });
      const guardadaX = await prisma.animal.findUniqueOrThrow({ where: { id: x.id } });
      if (par === '[200,409]') expect([guardadaM.sexo, guardadaX.madreId]).toEqual(['HEMBRA', m.id]);
      else expect([guardadaM.sexo, guardadaX.madreId]).toEqual(['MACHO', null]);
      await invariantes();
    }
  });
});

describe('X.madre = M × M cambia su fecha de nacimiento (RF-17)', () => {
  it('ambos 200 (la edición de M no revisa a sus crías); o madre 400 (fecha de M igual o posterior)', async () => {
    const { agente, nueva } = await tamboBase();
    for (let r = 0; r < RONDAS; r++) {
      const m = await nueva(`M${r}`, { fechaNacimiento: '2020-01-01' });
      const x = await nueva(`X${r}`, { fechaNacimiento: '2022-01-01' });
      // M pasa a nacer en 2023, después que X: si entra antes, la madre da 400.
      const rs = await Promise.all([editar(agente, x.id, { madre: `M${r}` }), editar(agente, m.id, { fechaNacimiento: '2023-01-01' })]);
      const par = JSON.stringify(estados(rs));
      expect(['[200,200]', '[400,200]']).toContain(par);
      await invariantes();
    }
  });
});

describe('número igual en dos ediciones, o en una edición y un alta o parto (RF-17)', () => {
  it('dos ediciones al mismo número: una 200 y la otra 409; el historial solo tiene la ganadora', async () => {
    const { agente, nueva } = await tamboBase();
    for (let r = 0; r < RONDAS; r++) {
      const a = await nueva(`A${r}`);
      const b = await nueva(`B${r}`);
      const rs = await Promise.all([editar(agente, a.id, { numero: `N${r}` }), editar(agente, b.id, { numero: `N${r}` })]);
      expect(ordenados(rs)).toEqual([200, 409]);
      expect(await prisma.animal.count({ where: { numero: `N${r}` } })).toBe(1);
      // (e) el que cambió de número tiene su fila de historial; el otro, ninguna.
      expect((await filas(a.id, 'NUMERO')) + (await filas(b.id, 'NUMERO'))).toBe(1);
      await invariantes();
    }
  });

  it('una edición y un alta al mismo número: uno 200 o 201 y el otro 409', async () => {
    const { agente, nueva } = await tamboBase();
    for (let r = 0; r < RONDAS; r++) {
      const a = await nueva(`A${r}`);
      const rs = await Promise.all([
        editar(agente, a.id, { numero: `N${r}` }),
        agente.post('/api/animales').send({ numero: `N${r}`, sexo: 'HEMBRA', estado: 'VAQUILLONA' }) as unknown as Promise<Respuesta>,
      ]);
      expect(ordenados(rs).map((s) => (s === 201 ? 200 : s))).toEqual([200, 409]);
      expect(await prisma.animal.count({ where: { numero: `N${r}`, estado: { not: 'BAJA' } } })).toBe(1);
      await invariantes();
    }
  });

  it('una edición y un parto con una cría de ese número: uno 200 o 201 y el otro 409 (o el parto 201 con la edición 409)', async () => {
    const { agente, nueva } = await tamboBase();
    for (let r = 0; r < RONDAS; r++) {
      const a = await nueva(`A${r}`);
      const vaca = await nueva(`V${r}`);
      const rs = await Promise.all([
        editar(agente, a.id, { numero: `N${r}` }),
        agente.post(`/api/animales/${vaca.id}/partos`).send({ fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: `N${r}` }] }) as unknown as Promise<Respuesta>,
      ]);
      expect(ordenados(rs).map((s) => (s === 201 ? 200 : s))).toEqual([200, 409]);
      expect(await prisma.animal.count({ where: { numero: `N${r}`, estado: { not: 'BAJA' } } })).toBe(1);
      await invariantes();
    }
  });
});

describe('cambiar el sexo × registrar un evento de la misma vaca (RF-17)', () => {
  it('nunca queda un macho con eventos ni con crías', async () => {
    const { agente, nueva } = await tamboBase();
    for (let r = 0; r < RONDAS; r++) {
      // Recién nacida: puede pasar a macho (sexo-estado) pero todavía no admite servicios (409).
      const a = await nueva(`A${r}`, { estado: 'RECIEN_NACIDO' });
      const rs = await Promise.all([
        editar(agente, a.id, { sexo: 'MACHO' }),
        agente.post(`/api/animales/${a.id}/servicios`).send({ fecha: '2026-11-01', tipo: 'INSEMINACION' }) as unknown as Promise<Respuesta>,
      ]);
      // Sexo 200 y evento rechazado (409: recién nacida o macho); nunca un evento 201 con un macho.
      expect(rs[0].status).toBe(200);
      expect([400, 409]).toContain(rs[1].status);
      expect(await prisma.evento.count({ where: { animalId: a.id } })).toBe(0);
      await invariantes();
    }
  });
});

// ─── Mover de lote (spec 005, T3) ───────────────────────────────────

const moverLote = (agente: Agente, id: string, loteId: string | null) =>
  agente.patch(`/api/animales/${id}/lote`).send({ loteId }) as unknown as Promise<Respuesta>;
const eliminarLote = (agente: Agente, id: string) => agente.delete(`/api/lotes/${id}`) as unknown as Promise<Respuesta>;

describe('mover × eliminar ese lote (RF-11, RF-17)', () => {
  it('mover 200 y eliminación 409; o eliminación 200 y mover 404/409; nunca un animal con un lote inexistente', async () => {
    const { agente, tambo, nueva } = await tamboBase();
    for (let r = 0; r < RONDAS; r++) {
      const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: `Tmp${r}` } });
      const vaca = await nueva(`V${r}`);
      const rs = await Promise.all([moverLote(agente, vaca.id, lote.id), eliminarLote(agente, lote.id)]);
      const guardada = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
      const existe = (await prisma.lote.count({ where: { id: lote.id } })) === 1;
      if (rs[0].status === 200) {
        // Se movió: el lote sigue existiendo, ahora con un animal, y la eliminación fue rechazada.
        expect(rs[1].status).toBe(409);
        expect(existe).toBe(true);
        expect(guardada.loteId).toBe(lote.id);
        expect(await prisma.cambioAnimal.count({ where: { animalId: vaca.id, campo: 'LOTE' } })).toBe(1);
      } else {
        // Se eliminó primero: el movimiento se rechazó sin guardar nada (409 si lo vio desaparecer
        // a mitad de camino; 404 si ya no estaba al empezar).
        expect([404, 409]).toContain(rs[0].status);
        expect(rs[1].status).toBe(204);
        expect(existe).toBe(false);
        expect(guardada.loteId).toBeNull();
        expect(await prisma.cambioAnimal.count({ where: { animalId: vaca.id } })).toBe(0);
      }
      await invariantes();
    }
  });
});

describe('editar o mover × anular el parto de esa cría (RF-17)', () => {
  // Una vaca con un parto cargado directo y una cría viva "C<r>".
  async function vacaConCria(r: number) {
    const t = await tamboBase();
    const vaca = await t.nueva(`V${r}`);
    const evento = await crearPartoDirecto({
      establecimientoId: t.tambo,
      animalId: vaca.id,
      registradoPorId: t.usuarioId,
      fecha: '2026-11-01',
      crias: [{ sexo: 'HEMBRA', numero: `C${r}` }],
    });
    const cria = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: t.tambo, numero: `C${r}` } });
    return { ...t, vaca, evento, cria };
  }

  it('mover la cría: ambos 200 en cualquier orden, o anulación 200 y mover 404; la cría queda de baja sin lote', async () => {
    for (let r = 0; r < RONDAS; r++) {
      await limpiarBase();
      const t = await vacaConCria(r);
      const lote = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: `L${r}` } });
      const rs = await Promise.all([
        moverLote(t.agente, t.cria.id, lote.id),
        t.agente.post(`/api/partos/${t.evento.id}/anular`).send({ motivo: 'Error de carga' }) as unknown as Promise<Respuesta>,
      ]);
      expect(rs[1].status).toBe(200);
      expect([200, 404]).toContain(rs[0].status);
      const cria = await prisma.animal.findUniqueOrThrow({ where: { id: t.cria.id } });
      expect(cria).toMatchObject({ estado: 'BAJA', loteId: null });
      await invariantes();
    }
  });

  it('editar el número de la cría: ambos 200 en cualquier orden, o anulación 200 y edición 404', async () => {
    for (let r = 0; r < RONDAS; r++) {
      await limpiarBase();
      const t = await vacaConCria(r);
      const rs = await Promise.all([
        editar(t.agente, t.cria.id, { numero: `Z${r}` }),
        t.agente.post(`/api/partos/${t.evento.id}/anular`).send({ motivo: 'Error de carga' }) as unknown as Promise<Respuesta>,
      ]);
      expect(rs[1].status).toBe(200);
      expect([200, 404]).toContain(rs[0].status);
      expect((await prisma.animal.findUniqueOrThrow({ where: { id: t.cria.id } })).estado).toBe('BAJA');
      await invariantes();
    }
  });
});

describe('mover × registrar parto o secado de la misma vaca (RF-17)', () => {
  it('secado: ambos 200 y 201; el lote final es el del último que entró', async () => {
    for (let r = 0; r < RONDAS; r++) {
      await limpiarBase();
      const t = await tamboBase();
      const vaca = await t.nueva(`V${r}`);
      const manual = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: `M${r}` } });
      const secas = await prisma.lote.findFirstOrThrow({ where: { establecimientoId: t.tambo, nombre: 'Secas' } });
      const rs = await Promise.all([
        moverLote(t.agente, vaca.id, manual.id),
        t.agente.post(`/api/animales/${vaca.id}/secados`).send({ fecha: '2026-11-05' }) as unknown as Promise<Respuesta>,
      ]);
      expect(estados(rs)).toEqual([200, 201]);
      const guardada = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
      const secado = await prisma.secado.findFirstOrThrow({ where: { eventoId: rs[1].body.evento.id } });
      expect(guardada.estado).toBe('SECA');
      // Si el secado vio el lote manual, entró DESPUÉS del movimiento y la deja en "Secas";
      // si no, el movimiento entró después y la deja en el lote manual.
      if (secado.loteAnteriorId === manual.id) expect(guardada.loteId).toBe(secas.id);
      else {
        expect(secado.loteAnteriorId).toBeNull();
        expect(guardada.loteId).toBe(manual.id);
      }
      await invariantes();
    }
  });

  it('parto: ambos 200 y 201; el lote final es el del último que entró', async () => {
    for (let r = 0; r < RONDAS; r++) {
      await limpiarBase();
      const t = await tamboBase();
      const vaca = await t.nueva(`V${r}`);
      const manual = await prisma.lote.create({ data: { establecimientoId: t.tambo, nombre: `M${r}` } });
      const ordene = await prisma.lote.findFirstOrThrow({ where: { establecimientoId: t.tambo, nombre: 'En ordeñe' } });
      const rs = await Promise.all([
        moverLote(t.agente, vaca.id, manual.id),
        t.agente.post(`/api/animales/${vaca.id}/partos`).send({ fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: `C${r}` }] }) as unknown as Promise<Respuesta>,
      ]);
      expect(estados(rs)).toEqual([200, 201]);
      const guardada = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
      const parto = await prisma.parto.findFirstOrThrow({ where: { eventoId: rs[1].body.evento.id } });
      if (parto.loteAnteriorId === manual.id) expect(guardada.loteId).toBe(ordene.id);
      else {
        expect(parto.loteAnteriorId).toBeNull();
        expect(guardada.loteId).toBe(manual.id);
      }
      await invariantes();
    }
  });
});
