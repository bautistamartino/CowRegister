import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { tomarLotePrevio } from '../src/bajas/revertir.js';
import {
  crearAnimalDirecto,
  crearPartoDirecto,
  crearSecadoDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  limpiarBase,
  prepararVaca,
  verificarInvariantes,
} from './ayudas.js';

// Spec 006, RF-16: operaciones simultáneas de baja y reversión. Hay una prueba por cada fila de la
// tabla: las de solo bajas y reversiones (T2) van primero y las que cruzan con eventos, edición,
// altas y planillas (T3) van al final. Cada carrera se repite varias veces y solo se aceptan los resultados que enumera la
// tabla (no un orden fijo: depende de quién llegue primero a la base). Un fallo intermitente es un
// error real: no se reintenta. Al final de cada ronda se comprueban los invariantes de la base.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const RONDAS = 8;
type Agente = ReturnType<typeof request.agent>;
type Respuesta = { status: number; body: any };

const baja = (agente: Agente, id: string, fecha = '2026-11-05') =>
  agente.post(`/api/animales/${id}/baja`).send({ motivo: 'venta', fecha }) as unknown as Promise<Respuesta>;
const revertir = (agente: Agente, id: string) =>
  agente.post(`/api/animales/${id}/revertir-baja`).send({ motivoReversion: 'Se cargó mal' }) as unknown as Promise<Respuesta>;
const eliminarLote = (agente: Agente, id: string) => agente.delete(`/api/lotes/${id}`) as unknown as Promise<Respuesta>;
const estados = (rs: Respuesta[]) => rs.map((r) => r.status);
const ordenados = (rs: Respuesta[]) => estados(rs).sort((a, b) => a - b);
const invariantes = async () => expect(await verificarInvariantes()).toEqual([]);

describe('baja × baja del mismo animal (RF-16)', () => {
  it('uno 201 y el otro 404, con una sola baja vigente', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      const rs = await Promise.all([baja(agente, vaca.id), baja(agente, vaca.id)]);
      expect(ordenados(rs)).toEqual([201, 404]);
      expect(await prisma.baja.count({ where: { animalId: vaca.id } })).toBe(1);
      expect(await prisma.evento.count({ where: { animalId: vaca.id, tipo: 'BAJA' } })).toBe(1);
      expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('BAJA');
      await invariantes();
    }
  });
});

describe('revertir × revertir el mismo animal (RF-16)', () => {
  it('uno 200 y el otro 404; el animal queda activo y la baja anulada una sola vez', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      await baja(agente, vaca.id);
      const rs = await Promise.all([revertir(agente, vaca.id), revertir(agente, vaca.id)]);
      expect(ordenados(rs)).toEqual([200, 404]);
      expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('EN_ORDENE');
      expect(await prisma.baja.count({ where: { animalId: vaca.id, vigente: true } })).toBe(0);
      await invariantes();
    }
  });
});

describe('revertir × baja del mismo animal (RF-16)', () => {
  it('revertir siempre 200; la baja 404 (llegó antes) o 201 (llegó después de revertir)', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      await baja(agente, vaca.id, '2026-11-01');
      const rs = await Promise.all([revertir(agente, vaca.id), baja(agente, vaca.id, '2026-11-05')]);
      expect(rs[0]!.status).toBe(200);
      expect([201, 404]).toContain(rs[1]!.status);
      const animal = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
      if (rs[1]!.status === 201) {
        // Revertir fue primero y la nueva baja quedó vigente; la primera, anulada.
        expect(animal.estado).toBe('BAJA');
        expect(await prisma.baja.count({ where: { animalId: vaca.id } })).toBe(2);
        expect(await prisma.baja.count({ where: { animalId: vaca.id, vigente: true } })).toBe(1);
      } else {
        expect(animal.estado).toBe('EN_ORDENE');
        expect(await prisma.baja.count({ where: { animalId: vaca.id, vigente: true } })).toBe(0);
      }
      await invariantes();
    }
  });
});

describe('baja × eliminar el lote del animal (RF-16)', () => {
  it('baja 201 siempre; el lote se elimina (queda "eliminado" en la baja) o la eliminación da 409', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: `Tmp${r}` } });
      const vaca = await crearAnimalDirecto(tambo, `V${r}`, { loteId: lote.id });
      const rs = await Promise.all([baja(agente, vaca.id), eliminarLote(agente, lote.id)]);
      expect(rs[0]!.status).toBe(201);
      const guardada = await prisma.baja.findFirstOrThrow({ where: { animalId: vaca.id } });
      const existe = (await prisma.lote.count({ where: { id: lote.id } })) === 1;
      expect(guardada.tuvoLoteAnterior).toBe(true);
      if (rs[1]!.status === 204) {
        // La baja se guardó primero y sacó al animal del lote; después se eliminó el lote.
        expect(existe).toBe(false);
        expect(guardada.loteAnteriorId).toBeNull();
      } else {
        // El lote todavía tenía al animal: la eliminación se rechazó y el lote previo sigue.
        expect(rs[1]!.status).toBe(409);
        expect(existe).toBe(true);
        expect(guardada.loteAnteriorId).toBe(lote.id);
      }
      await invariantes();
    }
  });
});

describe('revertir × eliminar el lote previo (RF-16)', () => {
  it('revertir 200 siempre: vuelve al lote (y la eliminación 409) o sin lote y con el aviso (y la eliminación 204)', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < RONDAS; r++) {
      const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: `Prev${r}` } });
      const vaca = await crearAnimalDirecto(tambo, `V${r}`, { loteId: lote.id });
      await baja(agente, vaca.id);
      const rs = await Promise.all([revertir(agente, vaca.id), eliminarLote(agente, lote.id)]);
      expect(rs[0]!.status).toBe(200);
      const animal = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
      const existe = (await prisma.lote.count({ where: { id: lote.id } })) === 1;
      if (rs[1]!.status === 409) {
        expect(existe).toBe(true);
        expect(animal.loteId).toBe(lote.id);
        expect(rs[0]!.body.avisos).toEqual([]);
      } else {
        expect(rs[1]!.status).toBe(204);
        expect(existe).toBe(false);
        expect(animal.loteId).toBeNull();
        expect(rs[0]!.body.avisos).toEqual(['El animal volvió a «en ordeñe» y quedó sin lote: su lote anterior ya no existe']);
      }
      await invariantes();
    }
  });
});

describe('revertir: el lote previo desaparece entre la lectura y el guardado (cliente simulado)', () => {
  // Simula la parte de `tx` que usa tomarLotePrevio: la consulta con FOR SHARE.
  const txSimulado = (lotesQueExisten: string[]) =>
    ({
      $queryRaw: async (_s: TemplateStringsArray, ...valores: unknown[]) =>
        lotesQueExisten.includes(String(valores[0])) ? [{ id: valores[0] }] : [],
    }) as never;

  it('lote que existe: devuelve su id', async () => {
    expect(await tomarLotePrevio(txSimulado(['L1']), 'E1', 'L1')).toBe('L1');
  });

  it('lote que ya no existe: null (el animal vuelve sin lote y se arma el aviso "ya no existe")', async () => {
    expect(await tomarLotePrevio(txSimulado([]), 'E1', 'L1')).toBeNull();
  });

  it('sin lote previo no consulta nada y devuelve null', async () => {
    const tx = { $queryRaw: async () => { throw new Error('no debería consultar'); } } as never;
    expect(await tomarLotePrevio(tx, 'E1', null)).toBeNull();
  });
});

// ─── Spec 006, T3: filas de la tabla que cruzan la baja o la reversión con eventos, edición, altas
// y planillas. Mismo criterio: cada carrera se repite, solo se aceptan los resultados de la tabla y al
// final de cada vuelta se comprueban los invariantes. ──────────────────────────────────────────────

const R2 = 5;
const enviar = (agente: Agente, metodo: 'post' | 'patch', url: string, cuerpo: object) =>
  (agente as any)[metodo](url).send(cuerpo) as Promise<Respuesta>;
const anular = (agente: Agente, ruta: string, id: string) =>
  agente.post(`/api/${ruta}/${id}/anular`).send({ motivo: 'Lo cargué mal' }) as unknown as Promise<Respuesta>;
const confirmar = (agente: Agente, texto: string) =>
  agente.post('/api/animales/planilla/confirmar').send({ texto }) as unknown as Promise<Respuesta>;
const activosConNumero = (tambo: string, numero: string) =>
  prisma.animal.count({ where: { establecimientoId: tambo, numero, estado: { not: 'BAJA' } } });
// Par de estados "revertir/otro" como texto, para comparar con los pares aceptables.
const par = (a: Respuesta, b: Respuesta) => `${a.status}/${b.status}`;

type TipoEvento = 'servicios' | 'tactos' | 'partos' | 'secados';
const cuerpoEvento = (tipo: TipoEvento, fecha: string, r: number) =>
  tipo === 'servicios'
    ? { fecha, tipo: 'INSEMINACION' }
    : tipo === 'tactos'
      ? { fecha, resultado: 'VACIA' }
      : tipo === 'partos'
        ? { fecha, crias: [{ sexo: 'HEMBRA', numero: `CP${r}` }] }
        : { fecha };

describe('baja × registrar servicio, tacto, parto o secado del mismo animal (RF-16)', () => {
  it.each(['servicios', 'tactos', 'partos', 'secados'] as const)(
    '%s con fecha anterior a la baja: evento 201 y baja 201, o baja 201 y evento 404',
    async (tipo) => {
      const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
      for (let r = 0; r < R2; r++) {
        const vaca = await crearAnimalDirecto(tambo, `V${r}`);
        const [rb, re] = await Promise.all([baja(agente, vaca.id, '2026-11-05'), enviar(agente, 'post', `/api/animales/${vaca.id}/${tipo}`, cuerpoEvento(tipo, '2026-10-20', r))]);
        expect(rb.status).toBe(201);
        expect([201, 404]).toContain(re.status);
        expect(await prisma.evento.count({ where: { animalId: vaca.id, tipo: { not: 'BAJA' } } })).toBe(re.status === 201 ? 1 : 0);
        await invariantes();
      }
    },
  );

  it.each(['servicios', 'tactos', 'partos', 'secados'] as const)(
    '%s con fecha posterior a la baja: evento 201 y baja 400 (fecha), o baja 201 y evento 404',
    async (tipo) => {
      const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
      for (let r = 0; r < R2; r++) {
        const vaca = await crearAnimalDirecto(tambo, `V${r}`);
        const [rb, re] = await Promise.all([baja(agente, vaca.id, '2026-11-05'), enviar(agente, 'post', `/api/animales/${vaca.id}/${tipo}`, cuerpoEvento(tipo, '2026-11-08', r))]);
        expect(
          (rb.status === 201 && re.status === 404) || (rb.status === 400 && re.status === 201),
          `baja ${rb.status}, evento ${re.status}`,
        ).toBe(true);
        await invariantes();
      }
    },
  );
});

describe('baja × anular servicio, tacto, parto o secado del mismo animal (RF-16)', () => {
  it.each(['servicios', 'tactos', 'partos', 'secados'] as const)('anular un %s: anulación 200 y baja 201, o baja 201 y anulación 404', async (tipo) => {
    const { agente, tambo, usuarioId } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`, { estado: tipo === 'secados' ? 'SECA' : 'EN_ORDENE' });
      const datos = { establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-10-20' };
      const evento =
        tipo === 'servicios'
          ? await crearServicioDirecto(datos)
          : tipo === 'tactos'
            ? await crearTactoDirecto({ ...datos, resultado: 'VACIA' })
            : tipo === 'partos'
              ? await crearPartoDirecto({ ...datos, crias: [{ numero: `CA${r}` }] })
              : await crearSecadoDirecto({ ...datos, estadoAnterior: 'EN_ORDENE' } as any);
      const [rb, ra] = await Promise.all([baja(agente, vaca.id, '2026-11-05'), anular(agente, tipo, evento.id)]);
      // La fecha de la baja (11-05) nunca es anterior al evento (10-20): la baja siempre da 201.
      expect(rb.status).toBe(201);
      expect([200, 404]).toContain(ra.status);
      await invariantes();
    }
  });
});

describe('baja × editar o mover el mismo animal (RF-16)', () => {
  it('editar: ambos con éxito, o baja 201 y edición 404', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      const [rb, re] = await Promise.all([baja(agente, vaca.id), enviar(agente, 'patch', `/api/animales/${vaca.id}`, { numero: `E${r}` })]);
      expect(rb.status).toBe(201);
      expect([200, 404]).toContain(re.status);
      // Si la edición entró, el cambio quedó en el animal de baja; si no, el número es el de antes.
      expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).numero).toBe(re.status === 200 ? `E${r}` : `V${r}`);
      await invariantes();
    }
  });

  it('mover de lote: ambos con éxito (la baja recuerda el lote nuevo), o baja 201 y movimiento 404', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: `Dest${r}` } });
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      const [rb, rm] = await Promise.all([baja(agente, vaca.id), enviar(agente, 'patch', `/api/animales/${vaca.id}/lote`, { loteId: lote.id })]);
      expect(rb.status).toBe(201);
      expect([200, 404]).toContain(rm.status);
      const guardada = await prisma.baja.findFirstOrThrow({ where: { animalId: vaca.id } });
      expect(guardada.loteAnteriorId).toBe(rm.status === 200 ? lote.id : null);
      expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).loteId).toBeNull();
      await invariantes();
    }
  });
});

describe('baja de la cría × anular el parto que la dio de alta (RF-16)', () => {
  it('anulación 200 y baja 404; o baja 201 y anulación 409', async () => {
    const { agente, tambo, usuarioId } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const madre = await crearAnimalDirecto(tambo, `M${r}`);
      const cria = await crearAnimalDirecto(tambo, `C${r}`, { estado: 'RECIEN_NACIDO', madreId: madre.id });
      const parto = await crearPartoDirecto({ establecimientoId: tambo, animalId: madre.id, registradoPorId: usuarioId, fecha: '2026-10-01', crias: [{ animalId: cria.id }] });
      const [rb, ra] = await Promise.all([baja(agente, cria.id, '2026-11-05'), anular(agente, 'partos', parto.id)]);
      expect(
        (ra.status === 200 && rb.status === 404) || (rb.status === 201 && ra.status === 409),
        `baja ${rb.status}, anulación ${ra.status}`,
      ).toBe(true);
      const despues = await prisma.animal.findUniqueOrThrow({ where: { id: cria.id } });
      expect(despues.motivoBaja).toBe(ra.status === 200 ? 'PARTO_ANULADO' : 'VENTA');
      await invariantes();
    }
  });
});

describe('baja de una madre × alta o edición de una cría con esa madre (RF-16)', () => {
  it('alta: ambos con éxito (la cría quedó vinculada antes de la baja) o la cría 400', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const madre = await crearAnimalDirecto(tambo, `M${r}`);
      const [rb, rc] = await Promise.all([
        baja(agente, madre.id),
        enviar(agente, 'post', '/api/animales', { numero: `K${r}`, sexo: 'HEMBRA', estado: 'RECIEN_NACIDO', madre: madre.numero }),
      ]);
      expect(rb.status).toBe(201);
      expect([201, 400]).toContain(rc.status);
      expect(await prisma.animal.count({ where: { numero: `K${r}` } })).toBe(rc.status === 201 ? 1 : 0);
      await invariantes(); // incluye "toda cría de una madre de baja se vinculó antes de la baja"
    }
  });

  it('edición: ambos con éxito o la edición 400', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const madre = await crearAnimalDirecto(tambo, `M${r}`);
      const cria = await crearAnimalDirecto(tambo, `K${r}`, { estado: 'RECIEN_NACIDO' });
      const [rb, re] = await Promise.all([baja(agente, madre.id), enviar(agente, 'patch', `/api/animales/${cria.id}`, { madre: madre.numero })]);
      expect(rb.status).toBe(201);
      expect([200, 400]).toContain(re.status);
      expect((await prisma.animal.findUniqueOrThrow({ where: { id: cria.id } })).madreId).toBe(re.status === 200 ? madre.id : null);
      await invariantes();
    }
  });
});

describe('baja × alta, edición de número, parto o planilla con el número del animal (RF-16)', () => {
  // La baja siempre da 201. El otro entra después (201 o 200) o antes (409; en la planilla, 0 guardados
  // por "número ya existe", que es un error de fila y no un 409). Nunca quedan dos activos con el número.
  it('alta', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `N${r}`);
      const [rb, ro] = await Promise.all([baja(agente, vaca.id), enviar(agente, 'post', '/api/animales', { numero: `N${r}`, sexo: 'HEMBRA', estado: 'VAQUILLONA' })]);
      expect(rb.status).toBe(201);
      expect([201, 409]).toContain(ro.status);
      expect(await activosConNumero(tambo, `N${r}`)).toBe(ro.status === 201 ? 1 : 0);
      await invariantes();
    }
  });

  it('edición del número', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `N${r}`);
      const otro = await crearAnimalDirecto(tambo, `O${r}`);
      const [rb, ro] = await Promise.all([baja(agente, vaca.id), enviar(agente, 'patch', `/api/animales/${otro.id}`, { numero: `N${r}` })]);
      expect(rb.status).toBe(201);
      expect([200, 409]).toContain(ro.status);
      expect(await activosConNumero(tambo, `N${r}`)).toBe(ro.status === 200 ? 1 : 0);
      await invariantes();
    }
  });

  it('parto con una cría con ese número', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `N${r}`);
      const madre = await crearAnimalDirecto(tambo, `M${r}`);
      const [rb, ro] = await Promise.all([
        baja(agente, vaca.id),
        enviar(agente, 'post', `/api/animales/${madre.id}/partos`, { fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: `N${r}` }] }),
      ]);
      expect(rb.status).toBe(201);
      expect([201, 409]).toContain(ro.status);
      expect(await activosConNumero(tambo, `N${r}`)).toBe(ro.status === 201 ? 1 : 0);
      await invariantes();
    }
  });

  it('planilla', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `N${r}`);
      const [rb, ro] = await Promise.all([baja(agente, vaca.id), confirmar(agente, `N${r}\tH\t\tseca\t`)]);
      expect(rb.status).toBe(201);
      expect(ro.status).toBe(200);
      expect([0, 1]).toContain(ro.body.guardados);
      expect(await activosConNumero(tambo, `N${r}`)).toBe(ro.body.guardados);
      await invariantes();
    }
  });
});

describe('revertir × registrar, anular, editar o mover el mismo animal (RF-16)', () => {
  it.each(['servicios', 'tactos', 'partos', 'secados'] as const)('registrar %s: revertir 200 y el otro 201, o el otro 404', async (tipo) => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      await baja(agente, vaca.id, '2026-11-01');
      const [rr, re] = await Promise.all([revertir(agente, vaca.id), enviar(agente, 'post', `/api/animales/${vaca.id}/${tipo}`, cuerpoEvento(tipo, '2026-11-08', r))]);
      expect(rr.status).toBe(200);
      expect([201, 404]).toContain(re.status);
      await invariantes();
    }
  });

  it('anular un servicio: revertir 200 y la anulación 200, o la anulación 404', async () => {
    const { agente, tambo, usuarioId } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      const servicio = await crearServicioDirecto({ establecimientoId: tambo, animalId: vaca.id, registradoPorId: usuarioId, fecha: '2026-10-20' });
      await baja(agente, vaca.id, '2026-11-01');
      const [rr, ra] = await Promise.all([revertir(agente, vaca.id), anular(agente, 'servicios', servicio.id)]);
      expect(rr.status).toBe(200);
      expect([200, 404]).toContain(ra.status);
      await invariantes();
    }
  });

  it('editar: revertir 200 y la edición 200, o la edición 404', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      await baja(agente, vaca.id);
      const [rr, re] = await Promise.all([revertir(agente, vaca.id), enviar(agente, 'patch', `/api/animales/${vaca.id}`, { numero: `E${r}` })]);
      expect(rr.status).toBe(200);
      expect([200, 404]).toContain(re.status);
      await invariantes();
    }
  });

  it('mover: revertir 200 y el movimiento 200, o el movimiento 404', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: `Dest${r}` } });
      const vaca = await crearAnimalDirecto(tambo, `V${r}`);
      await baja(agente, vaca.id);
      const [rr, rm] = await Promise.all([revertir(agente, vaca.id), enviar(agente, 'patch', `/api/animales/${vaca.id}/lote`, { loteId: lote.id })]);
      expect(rr.status).toBe(200);
      expect([200, 404]).toContain(rm.status);
      expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).loteId).toBe(rm.status === 200 ? lote.id : null);
      await invariantes();
    }
  });
});

describe('revertir × alta, edición de número, parto o planilla con el mismo número (RF-16)', () => {
  // Uno gana (200 o 201) y el otro 409; en la planilla, "gana revertir y 0 guardados" o "409 y 1 guardado".
  it('alta', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `N${r}`);
      await baja(agente, vaca.id);
      const [rr, ro] = await Promise.all([revertir(agente, vaca.id), enviar(agente, 'post', '/api/animales', { numero: `N${r}`, sexo: 'HEMBRA', estado: 'VAQUILLONA' })]);
      expect(['200/409', '409/201']).toContain(par(rr, ro));
      expect(await activosConNumero(tambo, `N${r}`)).toBe(1);
      await invariantes();
    }
  });

  it('edición del número', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `N${r}`);
      const otro = await crearAnimalDirecto(tambo, `O${r}`);
      await baja(agente, vaca.id);
      const [rr, ro] = await Promise.all([revertir(agente, vaca.id), enviar(agente, 'patch', `/api/animales/${otro.id}`, { numero: `N${r}` })]);
      expect(['200/409', '409/200']).toContain(par(rr, ro));
      expect(await activosConNumero(tambo, `N${r}`)).toBe(1);
      await invariantes();
    }
  });

  it('parto con una cría con ese número', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `N${r}`);
      const madre = await crearAnimalDirecto(tambo, `M${r}`);
      await baja(agente, vaca.id);
      const [rr, ro] = await Promise.all([revertir(agente, vaca.id), enviar(agente, 'post', `/api/animales/${madre.id}/partos`, { fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: `N${r}` }] })]);
      expect(['200/409', '409/201']).toContain(par(rr, ro));
      expect(await activosConNumero(tambo, `N${r}`)).toBe(1);
      await invariantes();
    }
  });

  it('planilla', async () => {
    const { agente, tambo } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const vaca = await crearAnimalDirecto(tambo, `N${r}`);
      await baja(agente, vaca.id);
      const [rr, ro] = await Promise.all([revertir(agente, vaca.id), confirmar(agente, `N${r}\tH\t\tseca\t`)]);
      expect(ro.status).toBe(200);
      expect([`${rr.status}/${ro.body.guardados}`].filter((x) => x === '200/0' || x === '409/1')).toHaveLength(1);
      expect(await activosConNumero(tambo, `N${r}`)).toBe(1);
      await invariantes();
    }
  });
});

describe('revertir una cría de baja × anular el parto de su madre (RF-16)', () => {
  it('revertir 200 siempre; la anulación 200 (la cría pasa a "parto anulado") o 409', async () => {
    const { agente, tambo, usuarioId } = await prepararVaca({ numero: 'BASE' });
    for (let r = 0; r < R2; r++) {
      const madre = await crearAnimalDirecto(tambo, `M${r}`);
      const cria = await crearAnimalDirecto(tambo, `C${r}`, { estado: 'RECIEN_NACIDO', madreId: madre.id });
      const parto = await crearPartoDirecto({ establecimientoId: tambo, animalId: madre.id, registradoPorId: usuarioId, fecha: '2026-10-01', crias: [{ animalId: cria.id }] });
      await baja(agente, cria.id, '2026-11-01');
      const [rr, ra] = await Promise.all([revertir(agente, cria.id), anular(agente, 'partos', parto.id)]);
      expect(rr.status).toBe(200);
      expect([200, 409]).toContain(ra.status);
      const despues = await prisma.animal.findUniqueOrThrow({ where: { id: cria.id } });
      if (ra.status === 200) expect([despues.estado, despues.motivoBaja]).toEqual(['BAJA', 'PARTO_ANULADO']);
      else expect(despues.estado).toBe('RECIEN_NACIDO');
      await invariantes();
    }
  });
});
