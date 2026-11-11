import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { crearAnimalDirecto, limpiarBase, prepararVaca, verificarInvariantes } from './ayudas.js';

// RF-31: operaciones simultáneas que REGISTRAN (spec 004). Hay una prueba por cada fila de la
// tabla de la spec. Cada carrera se repite varias veces y solo se aceptan los resultados que
// enumera la tabla (no un orden fijo: depende de quién llega primero a la base). Un fallo
// intermitente es un error real: no se reintenta. Al final de cada ronda se comprueban los
// invariantes de RF-33 con una consulta por invariante (verificarInvariantes).
// Las filas de ANULACIÓN (RF-32) se prueban en la tarea T3.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const RONDAS = 6;
type Agente = ReturnType<typeof request.agent>;
type Respuesta = { status: number; body: any };

const viva = (numero: string) => ({ sexo: 'HEMBRA', numero });
const parto = (agente: Agente, animalId: string, fecha: string, crias: unknown[]) =>
  agente.post(`/api/animales/${animalId}/partos`).send({ fecha, crias }) as unknown as Promise<Respuesta>;
const secado = (agente: Agente, animalId: string, fecha: string) =>
  agente.post(`/api/animales/${animalId}/secados`).send({ fecha }) as unknown as Promise<Respuesta>;
const servicio = (agente: Agente, animalId: string, fecha: string) =>
  agente.post(`/api/animales/${animalId}/servicios`).send({ fecha, tipo: 'INSEMINACION' }) as unknown as Promise<Respuesta>;
const tactoVacia = (agente: Agente, animalId: string, fecha: string) =>
  agente.post(`/api/animales/${animalId}/tactos`).send({ fecha, resultado: 'VACIA' }) as unknown as Promise<Respuesta>;

// Un solo tambo para todas las rondas: cada ronda usa vacas nuevas.
async function tamboBase() {
  const t = await prepararVaca({ numero: 'BASE' });
  const vacaNueva = (ronda: number, nombre = 'V') => crearAnimalDirecto(t.tambo, `${nombre}${ronda}`, { estado: 'EN_ORDENE' });
  return { ...t, vacaNueva };
}

const invariantes = async () => expect(await verificarInvariantes({ estadoVaca: true })).toEqual([]);
const estados = (rs: Respuesta[]) => rs.map((r) => r.status);

describe('parto × parto de la misma vaca (RF-31)', () => {
  it('a menos de 200 días: uno 201 y el otro 409; o, si entró primero el posterior, el anterior 400 (fecha)', async () => {
    const { agente, vacaNueva } = await tamboBase();
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const vaca = await vacaNueva(ronda);
      // [fecha 01/10 (la anterior), fecha 10/10 (la posterior)]
      const r = await Promise.all([
        parto(agente, vaca.id, '2026-10-01', [viva(`A${ronda}`)]),
        parto(agente, vaca.id, '2026-10-10', [viva(`B${ronda}`)]),
      ]);
      const par = JSON.stringify(estados(r));
      // Entró primero la anterior: la posterior 409. Entró primero la posterior: la anterior 400.
      expect(['[201,409]', '[400,201]']).toContain(par);
      expect(await prisma.parto.count({ where: { madreId: vaca.id } })).toBe(1);
      await invariantes();
    }
  });

  it('a 200 días o más: ambos 201 en orden coherente, o el de fecha anterior 400 (fecha)', async () => {
    const { agente, vacaNueva } = await tamboBase();
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const vaca = await vacaNueva(ronda);
      const r = await Promise.all([
        parto(agente, vaca.id, '2026-01-01', [viva(`A${ronda}`)]),
        parto(agente, vaca.id, '2026-10-01', [viva(`B${ronda}`)]),
      ]);
      const par = JSON.stringify(estados(r));
      expect(['[201,201]', '[400,201]']).toContain(par);
      expect(await prisma.parto.count({ where: { madreId: vaca.id } })).toBe(par === '[201,201]' ? 2 : 1);
      await invariantes();
    }
  });
});

describe('parto con el mismo número de cría (RF-31, RF-35)', () => {
  it('dos partos de otras vacas con el mismo número: uno 201 y el otro 409 (número existente)', async () => {
    const { agente, vacaNueva } = await tamboBase();
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const a = await vacaNueva(ronda, 'A');
      const b = await vacaNueva(ronda, 'B');
      const r = await Promise.all([parto(agente, a.id, '2026-10-01', [viva(`D${ronda}`)]), parto(agente, b.id, '2026-10-01', [viva(`D${ronda}`)])]);
      expect(estados(r).sort()).toEqual([201, 409]);
      expect(r.find((x) => x.status === 409)?.body.error).toBe('Ya existe un animal activo con ese número');
      expect(await prisma.animal.count({ where: { numero: `D${ronda}` } })).toBe(1);
      expect(await prisma.parto.count({ where: { madreId: { in: [a.id, b.id] } } })).toBe(1);
      await invariantes();
    }
  });

  it('dos partos de dos crías con los números cruzados: sin interbloqueos, uno 201 y el otro 409', async () => {
    const { agente, vacaNueva } = await tamboBase();
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const a = await vacaNueva(ronda, 'A');
      const b = await vacaNueva(ronda, 'B');
      const r = await Promise.all([
        parto(agente, a.id, '2026-10-01', [viva(`X${ronda}`), viva(`Y${ronda}`)]),
        parto(agente, b.id, '2026-10-01', [viva(`Y${ronda}`), viva(`X${ronda}`)]),
      ]);
      expect(estados(r).sort()).toEqual([201, 409]);
      await invariantes();
    }
  });

  it('un parto y el alta de un animal (spec 002) con el mismo número: uno 201 y el otro 409', async () => {
    const { agente, vacaNueva } = await tamboBase();
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const vaca = await vacaNueva(ronda);
      const r = await Promise.all([
        parto(agente, vaca.id, '2026-10-01', [viva(`N${ronda}`)]),
        agente.post('/api/animales').send({ numero: `N${ronda}`, sexo: 'HEMBRA', estado: 'VAQUILLONA' }) as unknown as Promise<Respuesta>,
      ]);
      expect(estados(r).sort()).toEqual([201, 409]);
      expect(await prisma.animal.count({ where: { numero: `N${ronda}` } })).toBe(1);
      // Si el parto perdió, la vaca no cambió y no hay parto guardado.
      expect(await prisma.parto.count({ where: { madreId: vaca.id } })).toBe(r[0]!.status === 201 ? 1 : 0);
      await invariantes();
    }
  });
});

describe('parto × secado de la misma vaca (RF-31)', () => {
  // [fecha del parto, fecha del secado]
  const casos: Array<[string, string]> = [
    ['2026-10-10', '2026-10-01'], // si el parto entra primero, el secado es de fecha anterior (400)
    ['2026-10-10', '2026-10-10'], // misma fecha: ambos 201
    ['2026-10-01', '2026-10-10'], // si el secado entra primero, el parto es de fecha anterior (400)
  ];
  it.each(casos)('parto del %s y secado del %s: resultados aceptables y estado coherente', async (fParto, fSecado) => {
    const { agente, vacaNueva } = await tamboBase();
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const vaca = await vacaNueva(ronda);
      const [rp, rs] = await Promise.all([parto(agente, vaca.id, fParto, [viva(`P${ronda}`)]), secado(agente, vaca.id, fSecado)]);
      // El parto: 201, o 400 (fecha) si el secado entró primero con fecha posterior.
      expect([201, 400]).toContain(rp.status);
      // El secado: 201, o 400 (fecha anterior al parto) o 409 (según el estado en que quedó la vaca).
      expect([201, 400, 409]).toContain(rs.status);
      // Al menos uno se guardó (el primero en entrar nunca falla).
      expect(rp.status === 201 || rs.status === 201).toBe(true);
      expect(await prisma.parto.count({ where: { madreId: vaca.id } })).toBe(rp.status === 201 ? 1 : 0);
      expect(await prisma.secado.count({ where: { eventoId: { in: (await prisma.evento.findMany({ where: { animalId: vaca.id }, select: { id: true } })).map((e) => e.id) } } })).toBe(rs.status === 201 ? 1 : 0);
      await invariantes();
    }
  });
});

describe('parto × servicio o tacto de la misma vaca (RF-31)', () => {
  const casos: Array<[string, string, 'servicio' | 'tacto']> = [
    ['2026-10-01', '2026-09-20', 'servicio'], // servicio anterior al parto: si el parto entra primero, el servicio 400
    ['2026-10-01', '2026-10-05', 'servicio'], // servicio posterior: si entra primero, el parto 400
    ['2026-10-01', '2026-10-01', 'servicio'],
    ['2026-10-01', '2026-09-20', 'tacto'],
    ['2026-10-01', '2026-10-05', 'tacto'],
  ];
  it.each(casos)('parto del %s y %s del %s: ambos 201 en orden coherente o uno 201 y el otro 409 o 400', async (fParto, fOtro, tipo) => {
    const { agente, vacaNueva } = await tamboBase();
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const vaca = await vacaNueva(ronda);
      const otro = tipo === 'servicio' ? servicio(agente, vaca.id, fOtro) : tactoVacia(agente, vaca.id, fOtro);
      const [rp, ro] = await Promise.all([parto(agente, vaca.id, fParto, [viva(`P${ronda}`)]), otro]);
      expect([201, 400, 409]).toContain(rp.status);
      expect([201, 400, 409]).toContain(ro.status);
      expect(rp.status === 201 || ro.status === 201).toBe(true);
      await invariantes();
    }
  });
});

describe('secado × secado de la misma vaca (RF-31)', () => {
  it('uno 201 y el otro 409', async () => {
    const { agente, vacaNueva } = await tamboBase();
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const vaca = await vacaNueva(ronda);
      const r = await Promise.all([secado(agente, vaca.id, '2026-10-01'), secado(agente, vaca.id, '2026-10-01')]);
      expect(estados(r).sort()).toEqual([201, 409]);
      expect(await prisma.evento.count({ where: { animalId: vaca.id, tipo: 'SECADO' } })).toBe(1);
      await invariantes();
    }
  });
});

describe('secado × servicio o tacto de la misma vaca (RF-31)', () => {
  const casos: Array<[string, 'servicio' | 'tacto']> = [
    ['2026-09-20', 'servicio'],
    ['2026-10-05', 'servicio'],
    ['2026-09-20', 'tacto'],
    ['2026-10-05', 'tacto'],
  ];
  it.each(casos)('secado del 01/10 y %s del %s: ambos 201 o uno 201 y el otro 400 (fecha anterior)', async (fOtro, tipo) => {
    const { agente, vacaNueva } = await tamboBase();
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const vaca = await vacaNueva(ronda);
      const otro = tipo === 'servicio' ? servicio(agente, vaca.id, fOtro) : tactoVacia(agente, vaca.id, fOtro);
      const [rs, ro] = await Promise.all([secado(agente, vaca.id, '2026-10-01'), otro]);
      // El secado solo falla por fecha (400) si el otro evento, de fecha posterior, entró primero.
      expect([201, 400]).toContain(rs.status);
      expect([201, 400, 409]).toContain(ro.status);
      expect(rs.status === 201 || ro.status === 201).toBe(true);
      await invariantes();
    }
  });
});

describe('parto × cambio del lote destino (RF-14, RF-31)', () => {
  // Quitar la regla del estado y eliminar su lote, a la vez que se registra el parto.
  it.each(['EN_ORDENE', 'RECIEN_NACIDO'] as const)(
    'lote destino de "%s": parto 201 con el lote, 201 sin lote y con aviso, o 409 de "lote destino ya no existe"',
    async (estado) => {
      const { agente, tambo, vacaNueva } = await tamboBase();
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const vaca = await vacaNueva(ronda);
        const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: `Destino ${estado} ${ronda}` } });
        await agente.put(`/api/reglas-lote/${estado}`).send({ loteId: lote.id }).expect(200);

        const [rp] = await Promise.all([
          parto(agente, vaca.id, '2026-10-01', [viva(`L${ronda}`)]),
          (async () => {
            await agente.delete(`/api/reglas-lote/${estado}`);
            return agente.delete(`/api/lotes/${lote.id}`); // 204, o 409 si el parto ya lo ocupó
          })(),
        ]);
        expect([201, 409]).toContain(rp.status);
        const loteSigue = (await prisma.lote.count({ where: { id: lote.id } })) === 1;
        if (rp.status === 409) {
          expect(rp.body.error).toBe('El lote destino ya no existe, volvé a intentar');
          expect(await prisma.parto.count({ where: { madreId: vaca.id } })).toBe(0);
          expect(await prisma.animal.count({ where: { numero: `L${ronda}` } })).toBe(0);
        } else {
          const afectado =
            estado === 'EN_ORDENE'
              ? await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })
              : await prisma.animal.findFirstOrThrow({ where: { numero: `L${ronda}` } });
          const codigoAviso = estado === 'EN_ORDENE' ? 'SIN_LOTE_MADRE_EN_ORDENE' : 'SIN_LOTE_CRIA';
          const codigos = rp.body.avisos.map((a: { codigo: string }) => a.codigo);
          if (afectado.loteId === lote.id) {
            // Con el lote asignado, el lote no pudo eliminarse.
            expect(loteSigue).toBe(true);
            expect(codigos).not.toContain(codigoAviso);
          } else {
            expect(afectado.loteId).toBeNull();
            expect(codigos).toContain(codigoAviso);
          }
        }
        await invariantes();
      }
    },
  );
});
