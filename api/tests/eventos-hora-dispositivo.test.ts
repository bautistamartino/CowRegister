import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import { limpiarBase, prepararVaca } from './ayudas.js';

// Spec 010, RF-3: las cinco cargas aceptan `cargadoEnDispositivo`, la hora en que se cargó el evento
// en la tablet. Es solo informativa: se guarda aparte de `creadoEn`. Reloj del servidor fijado en las
// 12:00 de Argentina (15:00 UTC) del 11/11/2026.

beforeEach(() => {
  fijarReloj(new Date('2026-11-11T15:00:00Z'));
  return limpiarBase();
});
afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const MENSAJE = 'La hora de carga de la tablet no es una fecha y hora válida';

type Tipo = 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO' | 'BAJA';
const CARGAS: Record<Tipo, { ruta: string; cuerpo: Record<string, unknown> }> = {
  SERVICIO: { ruta: 'servicios', cuerpo: { fecha: '2026-11-01', tipo: 'INSEMINACION' } },
  TACTO: { ruta: 'tactos', cuerpo: { fecha: '2026-11-01', resultado: 'VACIA' } },
  PARTO: { ruta: 'partos', cuerpo: { fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: 'c1' }] } },
  SECADO: { ruta: 'secados', cuerpo: { fecha: '2026-11-01' } },
  BAJA: { ruta: 'baja', cuerpo: { motivo: 'venta', fecha: '2026-11-01' } },
};
const TIPOS = Object.keys(CARGAS) as Tipo[];
const leer = (id: string) => prisma.evento.findUniqueOrThrow({ where: { id } });

// Carga un evento con `extra` y devuelve el id que se le guardó (con id propio, así no importa la forma del 201).
let contador = 0; // cada carga usa su propio tambo (el email del dueño es único)
async function cargar(tipo: Tipo, extra: Record<string, unknown>, esperado = 201) {
  contador += 1;
  const { agente, vaca } = await prepararVaca({ nombreTambo: `Tambo ${contador}`, email: `dueno${contador}@prueba.test` });
  const id = randomUUID();
  const res = await agente.post(`/api/animales/${vaca.id}/${CARGAS[tipo].ruta}`).send({ ...CARGAS[tipo].cuerpo, id, ...extra }).expect(esperado);
  return { agente, vaca, id, res };
}

describe('hora informativa válida', () => {
  it.each(TIPOS)('%s: se guarda aparte de creadoEn, que sigue siendo la hora del servidor', async (tipo) => {
    const antes = Date.now();
    const { id } = await cargar(tipo, { cargadoEnDispositivo: '2026-11-11T08:15:00-03:00' });
    const fila = await leer(id);
    expect(fila.cargadoEnDispositivo?.toISOString()).toBe('2026-11-11T11:15:00.000Z');
    expect(fila.creadoEn.getTime()).toBeGreaterThanOrEqual(antes - 5000); // hora real del servidor, no la de la tablet
  });

  it('una hora de la tablet de hace un año no cambia creadoEn ni el orden de los eventos', async () => {
    const { agente, vaca } = await prepararVaca();
    const a = await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-01', resultado: 'VACIA', cargadoEnDispositivo: '2030-01-01T00:00:00Z' }).expect(201);
    const b = await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-01', resultado: 'VACIA', cargadoEnDispositivo: '2025-01-01T00:00:00Z' }).expect(201);
    const eventos = (await agente.get(`/api/animales/${vaca.id}/eventos`).expect(200)).body.eventos;
    // Del más reciente al más antiguo: el que llegó último primero, sin importar la hora de la tablet.
    expect(eventos.map((e: { id: string }) => e.id)).toEqual([b.body.id, a.body.id]);
  });
});

describe('ausente, nula o con formato inválido', () => {
  it.each(TIPOS)('%s: sin el campo o con null se guarda sin ese dato', async (tipo) => {
    const sin = await cargar(tipo, {});
    expect((await leer(sin.id)).cargadoEnDispositivo).toBeNull();
    const nulo = await cargar(tipo, { cargadoEnDispositivo: null });
    expect((await leer(nulo.id)).cargadoEnDispositivo).toBeNull();
  });

  it.each(TIPOS)('%s: un formato inválido es 400 con el mensaje y no guarda nada', async (tipo) => {
    const { agente, vaca } = await prepararVaca();
    for (const valor of ['mañana', '2026-11-11', '2026-02-31T10:00:00Z', 12345, {}, '2026-11-11T10:00:00']) {
      const res = await agente
        .post(`/api/animales/${vaca.id}/${CARGAS[tipo].ruta}`)
        .send({ ...CARGAS[tipo].cuerpo, cargadoEnDispositivo: valor })
        .expect(400);
      expect(res.body.detalles).toEqual([{ campo: 'cargadoEnDispositivo', mensaje: MENSAJE }]);
    }
    expect(await prisma.evento.count()).toBe(0);
  });
});

describe('reloj de la tablet desfasado: el evento se guarda igual y sin el dato', () => {
  it.each(TIPOS)('%s: más de 5 minutos adelantada', async (tipo) => {
    const { id } = await cargar(tipo, { cargadoEnDispositivo: '2026-11-11T12:06:00-03:00' }); // el servidor marca 12:00
    expect((await leer(id)).cargadoEnDispositivo).toBeNull();
  });

  it('exactamente 5 minutos adelantada todavía se guarda', async () => {
    const { id } = await cargar('SERVICIO', { cargadoEnDispositivo: '2026-11-11T12:05:00-03:00' });
    expect((await leer(id)).cargadoEnDispositivo?.toISOString()).toBe('2026-11-11T15:05:00.000Z');
  });

  it.each(TIPOS)('%s: anterior al 01/01/2000', async (tipo) => {
    const { id } = await cargar(tipo, { cargadoEnDispositivo: '1999-12-31T23:59:59Z' });
    expect((await leer(id)).cargadoEnDispositivo).toBeNull();
  });
});

describe('la base impide una hora anterior al 2000 (CHECK)', () => {
  it('un UPDATE o INSERT directo con una hora de 1999 falla', async () => {
    const { id } = await cargar('SECADO', {});
    await expect(
      prisma.evento.update({ where: { id }, data: { cargadoEnDispositivo: new Date('1999-12-31T23:59:59Z') } }),
    ).rejects.toThrow(/eventos_hora_dispositivo_rango|check/i);
    await prisma.evento.update({ where: { id }, data: { cargadoEnDispositivo: new Date('2000-01-01T00:00:00Z') } });
  });

  it('los avisos tienen que ser una lista JSON', async () => {
    const { id } = await cargar('SECADO', {});
    await expect(prisma.$executeRaw`UPDATE "eventos" SET "avisosAlAceptar" = '{}'::jsonb WHERE "id" = ${id}::uuid`).rejects.toThrow(
      /eventos_avisos_es_lista|check/i,
    );
  });
});

describe('se devuelve en las lecturas del historial (RF-3)', () => {
  it('aparece en /eventos, /historial, la copia local y la ficha de baja, y es null si no vino', async () => {
    const { agente, vaca } = await prepararVaca();
    const hora = '2026-11-11T08:15:00-03:00';
    const conHora = await agente.post(`/api/animales/${vaca.id}/servicios`).send({ fecha: '2026-11-01', tipo: 'INSEMINACION', cargadoEnDispositivo: hora }).expect(201);
    const sinHora = await agente.post(`/api/animales/${vaca.id}/tactos`).send({ fecha: '2026-11-02', resultado: 'VACIA' }).expect(201);
    expect(conHora.body.cargadoEnDispositivo).toBe('2026-11-11T11:15:00.000Z');
    expect(sinHora.body.cargadoEnDispositivo).toBeNull();

    const eventos = (await agente.get(`/api/animales/${vaca.id}/eventos`).expect(200)).body.eventos;
    expect(eventos.map((e: any) => e.cargadoEnDispositivo)).toEqual([null, '2026-11-11T11:15:00.000Z']);

    const historial = (await agente.get(`/api/animales/${vaca.id}/historial`).expect(200)).body.entradas;
    const deHistorial = historial.filter((e: any) => e.clase === 'EVENTO').map((e: any) => e.evento.cargadoEnDispositivo);
    expect(deHistorial).toEqual([null, '2026-11-11T11:15:00.000Z']);

    const copia = (await agente.get('/api/copia-local').expect(200)).body;
    const deCopia = copia.animales[0].eventos.eventos.map((e: any) => e.cargadoEnDispositivo);
    expect(deCopia).toEqual([null, '2026-11-11T11:15:00.000Z']);

    const baja = await agente.post(`/api/animales/${vaca.id}/baja`).send({ motivo: 'muerte', fecha: '2026-11-03', cargadoEnDispositivo: hora }).expect(201);
    const ficha = (await agente.get(`/api/bajas/${vaca.id}`).expect(200)).body;
    const eventoBaja = ficha.eventos.find((e: any) => e.tipo === 'BAJA');
    expect(eventoBaja.cargadoEnDispositivo).toBe('2026-11-11T11:15:00.000Z');
    expect(baja.body.id).toBe(eventoBaja.id);
  });

  it('no cambia al anular el evento', async () => {
    const { agente, vaca } = await prepararVaca();
    const hora = '2026-11-11T08:15:00-03:00';
    const s = await agente.post(`/api/animales/${vaca.id}/servicios`).send({ fecha: '2026-11-01', tipo: 'INSEMINACION', cargadoEnDispositivo: hora }).expect(201);
    const antes = await leer(s.body.id);
    const anulado = await agente.post(`/api/servicios/${s.body.id}/anular`).send({ motivo: 'Error' }).expect(200);
    expect(anulado.body.cargadoEnDispositivo).toBe('2026-11-11T11:15:00.000Z');
    const despues = await leer(s.body.id);
    expect(despues.cargadoEnDispositivo).toEqual(antes.cargadoEnDispositivo);
    expect(despues.avisosAlAceptar).toEqual(antes.avisosAlAceptar);
  });
});
