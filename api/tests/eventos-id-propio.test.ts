import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { crearAnimalDirecto, crearUsuario, limpiarBase, prepararVaca, verificarInvariantes } from './ayudas.js';

// Spec 010, RF-4 y RF-5: las cinco cargas aceptan un `id` propio de la tablet y reenviarlas no
// duplica nada. Reloj fijado: "hoy" en Argentina = 11/11/2026.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const GENERICO = 'Ese identificador de registro ya se usó con otros datos';

type Tipo = 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO' | 'BAJA';
type Carga = {
  ruta: string;
  cuerpo: Record<string, unknown>;
  otro: Record<string, unknown>; // el mismo pedido con un dato distinto
  idDe: (body: any) => string; // el id del evento dentro de la respuesta 201
};

// Un pedido válido por tipo (la vaca de `prepararVaca` está en ordeñe y sin eventos).
const CARGAS: Record<Tipo, Carga> = {
  SERVICIO: {
    ruta: 'servicios',
    cuerpo: { fecha: '2026-11-01', tipo: 'INSEMINACION' },
    otro: { fecha: '2026-11-01', tipo: 'MONTA_NATURAL' },
    idDe: (b) => b.id,
  },
  TACTO: {
    ruta: 'tactos',
    cuerpo: { fecha: '2026-11-01', resultado: 'VACIA', anomalias: 'quiste, retención' },
    otro: { fecha: '2026-11-02', resultado: 'VACIA' },
    idDe: (b) => b.id,
  },
  PARTO: {
    ruta: 'partos',
    cuerpo: { fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: 'c1' }, { sexo: 'MACHO', nacidaMuerta: true }] },
    otro: { fecha: '2026-11-01', crias: [{ sexo: 'MACHO', numero: 'c1' }] },
    idDe: (b) => b.evento.id,
  },
  SECADO: { ruta: 'secados', cuerpo: { fecha: '2026-11-01' }, otro: { fecha: '2026-11-02' }, idDe: (b) => b.evento.id },
  BAJA: {
    ruta: 'baja',
    cuerpo: { motivo: 'venta', fecha: '2026-11-01', observaciones: 'Al frigorífico' },
    otro: { motivo: 'muerte', fecha: '2026-11-01' },
    idDe: (b) => b.id,
  },
};
const TIPOS = Object.keys(CARGAS) as Tipo[];

// Lo que el 201 de cada tipo llama "evento" (la baja devuelve su objeto plano; parto y secado { evento, avisos }).
const eventoDe = (tipo: Tipo, body: any) => (tipo === 'PARTO' || tipo === 'SECADO' ? body.evento : body);
const avisosDe = (tipo: Tipo, body: any) => (tipo === 'PARTO' || tipo === 'SECADO' ? body.avisos : []);

// Cuántas filas hay de todo lo que una carga puede duplicar.
async function contar(tambo: string) {
  return {
    eventos: await prisma.evento.count({ where: { establecimientoId: tambo } }),
    detalles: [
      await prisma.servicio.count({ where: { establecimientoId: tambo } }),
      await prisma.tacto.count({ where: { establecimientoId: tambo } }),
      await prisma.parto.count({ where: { establecimientoId: tambo } }),
      await prisma.secado.count({ where: { establecimientoId: tambo } }),
      await prisma.baja.count({ where: { establecimientoId: tambo } }),
    ],
    crias: await prisma.criaParto.count({ where: { establecimientoId: tambo } }),
    animales: await prisma.animal.count({ where: { establecimientoId: tambo } }),
  };
}

describe('id propio (RF-4)', () => {
  it.each(TIPOS)('%s: se guarda el evento con el id que mandó la tablet', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const id = randomUUID();
    const c = CARGAS[tipo];
    const res = await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(201);
    expect(c.idDe(res.body)).toBe(id);
    expect((await prisma.evento.findUniqueOrThrow({ where: { id } })).tipo).toBe(tipo);
  });

  it.each(TIPOS)('%s: el id en mayúsculas se guarda en minúsculas', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const id = randomUUID();
    const c = CARGAS[tipo];
    const res = await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id: id.toUpperCase() }).expect(201);
    expect(c.idDe(res.body)).toBe(id);
  });

  it.each(TIPOS)('%s: sin id el servidor genera uno', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const c = CARGAS[tipo];
    const res = await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send(c.cuerpo).expect(201);
    expect(c.idDe(res.body)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(TIPOS)('%s: un id mal formado es 400 con mensaje y no guarda nada', async (tipo) => {
    const { agente, tambo, vaca } = await prepararVaca();
    const c = CARGAS[tipo];
    for (const id of ['abc', 123, '', {}]) {
      const res = await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(400);
      // Un error de campo viaja en `detalles`, como todos los de zod en esta API.
      expect(res.body.detalles).toEqual([{ campo: 'id', mensaje: 'El identificador del registro tiene que ser un UUID válido' }]);
    }
    expect((await contar(tambo)).eventos).toBe(0);
  });
});

describe('reenvío del mismo evento (RF-5)', () => {
  it.each(TIPOS)('%s: reenviar igual da 200 con la misma forma, sin duplicar nada', async (tipo) => {
    const { agente, tambo, vaca } = await prepararVaca();
    const c = CARGAS[tipo];
    const id = randomUUID();
    const primera = await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(201);
    const antes = await contar(tambo);
    const estadoAntes = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });

    const segunda = await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(200);
    // Misma forma en los cinco tipos: { evento, avisos, yaExistia: true }.
    expect(Object.keys(segunda.body).sort()).toEqual(['avisos', 'evento', 'yaExistia']);
    expect(segunda.body.yaExistia).toBe(true);
    // El evento es el mismo que devolvió el 201 y los avisos también.
    expect(segunda.body.evento).toEqual(eventoDe(tipo, primera.body));
    expect(segunda.body.avisos).toEqual(avisosDe(tipo, primera.body));

    expect(await contar(tambo)).toEqual(antes);
    const estadoDespues = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect(estadoDespues.estado).toBe(estadoAntes.estado);
    expect(estadoDespues.loteId).toBe(estadoAntes.loteId);
    expect(await verificarInvariantes({ estadoVaca: true })).toEqual([]);
  });

  it('el reenvío de un parto con crías vivas no vuelve a dar de alta las crías ni cambia el lote', async () => {
    const { agente, tambo, vaca } = await prepararVaca({ estado: 'SECA' });
    const c = CARGAS.PARTO;
    const id = randomUUID();
    await agente.post(`/api/animales/${vaca.id}/partos`).send({ ...c.cuerpo, id }).expect(201);
    const madre = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    const crias = await prisma.animal.findMany({ where: { establecimientoId: tambo, madreId: vaca.id }, select: { id: true } });
    expect(crias).toHaveLength(1);

    await agente.post(`/api/animales/${vaca.id}/partos`).send({ ...c.cuerpo, id }).expect(200);
    expect(await prisma.animal.findMany({ where: { establecimientoId: tambo, madreId: vaca.id }, select: { id: true } })).toEqual(crias);
    const despues = await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } });
    expect([despues.estado, despues.loteId]).toEqual([madre.estado, madre.loteId]);
  });

  it('un parto reenviado devuelve los avisos que se dieron la primera vez, aunque el lote ya cambió', async () => {
    const { agente, tambo, vaca } = await prepararVaca();
    // Sin lotes de destino: el aviso 1 (la madre queda sin lote) y el 3 (la cría) salen en el primer envío.
    await prisma.reglaLote.deleteMany({ where: { establecimientoId: tambo } });
    const id = randomUUID();
    const c = CARGAS.PARTO;
    const primera = await agente.post(`/api/animales/${vaca.id}/partos`).send({ ...c.cuerpo, id }).expect(201);
    expect(primera.body.avisos.length).toBeGreaterThan(0);

    // Después aparece un lote y la madre se mueve a mano: hoy los avisos serían otros.
    const lote = await prisma.lote.create({ data: { establecimientoId: tambo, nombre: 'Nuevo' } });
    await prisma.animal.update({ where: { id: vaca.id }, data: { loteId: lote.id } });
    const segunda = await agente.post(`/api/animales/${vaca.id}/partos`).send({ ...c.cuerpo, id }).expect(200);
    expect(segunda.body.avisos).toEqual(primera.body.avisos);
  });

  it.each(['SERVICIO', 'TACTO', 'SECADO'] as const)('%s: si el evento se anuló después, el reenvío igual da 200 con el evento anulado', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const c = CARGAS[tipo];
    const id = randomUUID();
    await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(201);
    await agente.post(`/api/${c.ruta}/${id}/anular`).send({ motivo: 'Error de carga' }).expect(200);
    const res = await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(200);
    expect(res.body.yaExistia).toBe(true);
    expect(res.body.evento.anulacion).toMatchObject({ motivo: 'Error de carga' });
  });

  it('la baja reenviada con la vaca ya de baja da 200 y no 404', async () => {
    const { agente, vaca } = await prepararVaca();
    const id = randomUUID();
    const c = CARGAS.BAJA;
    await agente.post(`/api/animales/${vaca.id}/baja`).send({ ...c.cuerpo, id }).expect(201);
    expect((await prisma.animal.findUniqueOrThrow({ where: { id: vaca.id } })).estado).toBe('BAJA');
    const res = await agente.post(`/api/animales/${vaca.id}/baja`).send({ ...c.cuerpo, id }).expect(200);
    expect(res.body).toMatchObject({ yaExistia: true, evento: { id, motivo: 'venta', fecha: '2026-11-01' }, avisos: [] });
  });

  it('el reenvío no vuelve a evaluar las reglas (una vaca ya preñada acepta el servicio reenviado)', async () => {
    const { agente, vaca } = await prepararVaca();
    const id = randomUUID();
    await agente.post(`/api/animales/${vaca.id}/servicios`).send({ ...CARGAS.SERVICIO.cuerpo, id }).expect(201);
    await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-05', resultado: 'PRENADA' }).expect(201);
    // Un servicio nuevo ahora daría 409 (preñez vigente), pero el reenvío del primero es "ya estaba guardado".
    await agente.post(`/api/animales/${vaca.id}/servicios`).send({ ...CARGAS.SERVICIO.cuerpo, id }).expect(200);
    await agente.post(`/api/animales/${vaca.id}/servicios`).send({ ...CARGAS.SERVICIO.cuerpo, fecha: '2026-11-06' }).expect(409);
  });
});

describe('el mismo id con otros datos (RF-5): 409 genérico', () => {
  it.each(TIPOS)('%s: otros datos', async (tipo) => {
    const { agente, tambo, vaca } = await prepararVaca();
    const c = CARGAS[tipo];
    const id = randomUUID();
    await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(201);
    const antes = await contar(tambo);
    // La baja deja a la vaca inactiva: con otros datos y animal no accesible gana el 404 de siempre.
    const res = await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.otro, id });
    expect(res.status).toBe(tipo === 'BAJA' ? 404 : 409);
    if (tipo !== 'BAJA') expect(res.body.error).toBe(GENERICO);
    expect(await contar(tambo)).toEqual(antes);
  });

  it.each(TIPOS)('%s: otro animal del mismo tambo', async (tipo) => {
    const { agente, tambo, vaca } = await prepararVaca();
    const otra = await crearAnimalDirecto(tambo, '202');
    const c = CARGAS[tipo];
    const id = randomUUID();
    await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(201);
    const antes = await contar(tambo);
    const res = await agente.post(`/api/animales/${otra.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(409);
    expect(res.body.error).toBe(GENERICO);
    expect(await contar(tambo)).toEqual(antes);
  });

  it.each(['SERVICIO', 'TACTO'] as const)('%s: otro usuario (mismo tambo)', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const vet = await crearUsuario(agente, 'VETERINARIO', 'vet@prueba.test');
    const c = CARGAS[tipo];
    const id = randomUUID();
    await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(201);
    const res = await vet.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(409);
    expect(res.body.error).toBe(GENERICO);
  });

  it.each(['PARTO', 'SECADO'] as const)('%s: otro usuario (encargado)', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const c = CARGAS[tipo];
    const id = randomUUID();
    await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(201);
    const res = await encargado.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(409);
    expect(res.body.error).toBe(GENERICO);
  });

  it('baja: otro usuario con el animal ya de baja no es "el mismo": 404 de siempre', async () => {
    const { agente, vaca } = await prepararVaca();
    const encargado = await crearUsuario(agente, 'ENCARGADO', 'encargado@prueba.test');
    const id = randomUUID();
    await agente.post(`/api/animales/${vaca.id}/baja`).send({ ...CARGAS.BAJA.cuerpo, id }).expect(201);
    await encargado.post(`/api/animales/${vaca.id}/baja`).send({ ...CARGAS.BAJA.cuerpo, id }).expect(404);
  });

  it.each(TIPOS.filter((t) => t !== 'SERVICIO'))('un id ya usado por un servicio no sirve para un %s (otro tipo)', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    const id = randomUUID();
    await agente.post(`/api/animales/${vaca.id}/servicios`).send({ ...CARGAS.SERVICIO.cuerpo, id }).expect(201);
    const c = CARGAS[tipo];
    const res = await agente.post(`/api/animales/${vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(409);
    expect(res.body.error).toBe(GENERICO);
  });

  it.each(TIPOS)('%s: un id que es de otro tambo da el mismo 409 genérico y no revela de quién es', async (tipo) => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const c = CARGAS[tipo];
    const id = randomUUID();
    await b.agente.post(`/api/animales/${b.vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(201);

    const res = await a.agente.post(`/api/animales/${a.vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(409);
    expect(res.body).toEqual({ error: GENERICO });
    expect(await prisma.evento.count({ where: { establecimientoId: a.tambo } })).toBe(0);
    // Y el evento del otro tambo quedó como estaba.
    expect((await prisma.evento.findUniqueOrThrow({ where: { id } })).establecimientoId).toBe(b.tambo);
  });

  it.each(TIPOS)('%s: nombrar el animal de otro tambo con un id existente sigue dando el 404 de siempre', async (tipo) => {
    const a = await prepararVaca({ nombreTambo: 'Tambo A', email: 'a@prueba.test' });
    const b = await prepararVaca({ nombreTambo: 'Tambo B', email: 'b@prueba.test' });
    const c = CARGAS[tipo];
    const id = randomUUID();
    await b.agente.post(`/api/animales/${b.vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(201);
    const real = await a.agente.post(`/api/animales/${b.vaca.id}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(404);
    const inexistente = await a.agente.post(`/api/animales/${randomUUID()}/${c.ruta}`).send({ ...c.cuerpo, id }).expect(404);
    expect(real.body).toEqual(inexistente.body);
  });
});
