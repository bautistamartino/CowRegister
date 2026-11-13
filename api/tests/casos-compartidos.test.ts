import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { fijarReloj } from '../src/reloj.js';
import {
  crearAnimalDirecto,
  crearBajaRegistradaDirecta,
  crearPartoDirecto,
  crearSecadoDirecto,
  crearSemenDirecto,
  crearServicioDirecto,
  crearTactoDirecto,
  crearUsuario,
  limpiarBase,
  registrarTambo,
} from './ayudas.js';

// Tabla de casos COMPARTIDA (spec 010, RF-23): compartido/casos-reglas-eventos.json.
//
// Esta es la mitad de la API: cada caso arma el tambo con los helpers de ayudas.ts, carga las `previas`
// (lo que la tablet cargó antes, en orden) y el `pedido` contra las RUTAS REALES, con el rol del caso y el
// reloj fijado en `hoy`, y compara el código y el mensaje con `esperado`. Así queda probado que la tabla
// describe lo que de verdad hace el servidor. La web (web/tests/casos-compartidos.test.ts) corre la misma
// tabla contra sus reglas locales: si las dos mitades pasan, dan el mismo resultado y el mismo mensaje.
//
// Los casos `soloServidor` también corren acá: describen lo que solo el servidor puede decidir (algo que
// pasó después de la última copia, descrito en `alServidor`).

type Rol = 'DUENO' | 'ENCARGADO' | 'VETERINARIO';
type TipoCarga = 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO' | 'BAJA' | 'ANULACION';
type Datos = Record<string, unknown>;

type EventoBase = {
  ref: string;
  tipo: 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO';
  fecha: string;
  tipoServicio?: 'INSEMINACION' | 'MONTA_NATURAL';
  semen?: string | null;
  resultado?: 'PRENADA' | 'VACIA';
  fechaProbableIndicada?: string | null;
  anomalias?: string | null;
  crias?: { sexo: 'HEMBRA' | 'MACHO'; numero?: string; nacidaMuerta?: boolean }[];
  anulacion?: { motivo: string };
};

type Caso = {
  id: string;
  descripcion: string;
  tipo: TipoCarga;
  rol: Rol;
  hoy: string;
  base: {
    animales: { ref: string; numero: string; sexo: 'HEMBRA' | 'MACHO'; estado: 'RECIEN_NACIDO' | 'VAQUILLONA' | 'EN_ORDENE' | 'SECA'; nacimiento: string | null; eventos: EventoBase[] }[];
    semen: { ref: string; nombre: string; activo: boolean }[];
  };
  previas: { tipo: TipoCarga; animal: string; datos: Datos; estado: 'esperando' | 'enviado'; ref?: string }[];
  pedido: { animal: string; datos: Datos };
  esperado: { resultado: 'ok' | 'rechazo'; codigo: number; mensaje?: string; campo?: string };
  soloServidor?: boolean;
  motivoSoloServidor?: string;
  alServidor?: {
    desactivarSemen?: string[];
    bajaAnimales?: string[];
    ocuparNumeros?: string[];
    eventosEnAnimales?: { numero: string; fecha: string }[];
  };
};

const RUTA_TABLA = new URL('../../compartido/casos-reglas-eventos.json', import.meta.url);
const { casos } = JSON.parse(readFileSync(RUTA_TABLA, 'utf8')) as { casos: Caso[] };

afterEach(() => fijarReloj(null));
afterAll(() => prisma.$disconnect());

const RUTA_ANULAR = { SERVICIO: 'servicios', TACTO: 'tactos', PARTO: 'partos', SECADO: 'secados' } as const;
const RUTA_CARGA = { SERVICIO: 'servicios', TACTO: 'tactos', PARTO: 'partos', SECADO: 'secados', BAJA: 'baja' } as const;

describe('la tabla de casos compartida', () => {
  it('tiene casos con ids únicos y cada soloServidor explica su motivo', () => {
    expect(casos.length).toBeGreaterThan(50);
    expect(new Set(casos.map((c) => c.id)).size).toBe(casos.length);
    for (const c of casos.filter((x) => x.soloServidor)) {
      expect(c.motivoSoloServidor, c.id).toBeTruthy();
    }
  });
});

describe('casos compartidos contra las rutas reales de la API', () => {
  it.each(casos.map((c) => [c.id, c] as const))('%s', async (_id, caso) => {
    await limpiarBase();
    fijarReloj(new Date(`${caso.hoy}T15:00:00.000Z`)); // las 12:00 en Argentina: "hoy" es el del caso

    const { agente: agenteDueno, perfil } = await registrarTambo();
    const tambo = perfil.establecimiento.id;
    const agente = caso.rol === 'DUENO' ? agenteDueno : await crearUsuario(agenteDueno, caso.rol, `${caso.rol.toLowerCase()}@prueba.test`);

    // ── Base: lo que tenía la copia ──
    const ids = new Map<string, string>(); // ref -> id real (animales, semen y eventos)
    for (const s of caso.base.semen) ids.set(s.ref, (await crearSemenDirecto(tambo, s.nombre, { activo: s.activo })).id);
    for (const a of caso.base.animales) {
      const animal = await crearAnimalDirecto(tambo, a.numero, { sexo: a.sexo, estado: a.estado, fechaNacimiento: a.nacimiento });
      ids.set(a.ref, animal.id);
      for (const e of a.eventos) {
        const comunes = {
          establecimientoId: tambo,
          animalId: animal.id,
          registradoPorId: perfil.id,
          fecha: e.fecha,
          ...(e.anulacion && { anulacion: { porId: perfil.id, motivo: e.anulacion.motivo } }),
        };
        let evento;
        if (e.tipo === 'SERVICIO') {
          evento = await crearServicioDirecto({ ...comunes, tipoServicio: e.tipoServicio ?? 'INSEMINACION', semenId: e.semen ? ids.get(e.semen)! : null });
        } else if (e.tipo === 'TACTO') {
          evento = await crearTactoDirecto({ ...comunes, resultado: e.resultado ?? 'PRENADA', fechaProbableIndicada: e.fechaProbableIndicada ?? null, anomalias: e.anomalias ?? null });
        } else if (e.tipo === 'PARTO') {
          evento = await crearPartoDirecto({ ...comunes, ...(e.crias && { crias: e.crias }) });
        } else {
          evento = await crearSecadoDirecto(comunes);
        }
        ids.set(e.ref, evento.id);
      }
    }

    // ── Lo que pasó en el servidor después de la copia (solo los casos soloServidor) ──
    const alServidor = caso.alServidor ?? {};
    for (const ref of alServidor.desactivarSemen ?? []) await prisma.semenToro.update({ where: { id: ids.get(ref)! }, data: { activo: false } });
    for (const ref of alServidor.bajaAnimales ?? []) {
      await crearBajaRegistradaDirecta({ establecimientoId: tambo, animalId: ids.get(ref)!, registradoPorId: perfil.id, fecha: '2026-11-01' });
    }
    for (const numero of alServidor.ocuparNumeros ?? []) await crearAnimalDirecto(tambo, numero, { estado: 'RECIEN_NACIDO' });
    for (const { numero, fecha } of alServidor.eventosEnAnimales ?? []) {
      const animal = await prisma.animal.findFirstOrThrow({ where: { establecimientoId: tambo, numero } });
      await crearServicioDirecto({ establecimientoId: tambo, animalId: animal.id, registradoPorId: perfil.id, fecha });
    }

    // ── Convierte lo del caso (con refs) en el cuerpo y la URL reales ──
    const idDe = (ref: unknown) => {
      const clave = String(ref);
      if (!ids.has(clave)) ids.set(clave, randomUUID()); // una ref que no existe: un UUID que tampoco existe
      return ids.get(clave)!;
    };
    const armar = (tipo: TipoCarga, animalRef: string, datos: Datos, idEvento?: string) => {
      if (tipo === 'ANULACION') {
        const { eventoId, tipoEvento, motivo } = datos as { eventoId: string; tipoEvento: keyof typeof RUTA_ANULAR; motivo: string };
        return { url: `/api/${RUTA_ANULAR[tipoEvento]}/${idDe(eventoId)}/anular`, cuerpo: { motivo } };
      }
      const cuerpo: Datos = { ...datos, ...(idEvento && { id: idEvento }) };
      if (typeof cuerpo.semenId === 'string') cuerpo.semenId = idDe(cuerpo.semenId);
      return { url: `/api/animales/${idDe(animalRef)}/${RUTA_CARGA[tipo]}`, cuerpo };
    };

    // ── Previas: lo que la tablet cargó antes. Tienen que haberse aceptado (son parte de la situación). ──
    for (const [i, previa] of caso.previas.entries()) {
      const idEvento = previa.ref ? idDe(previa.ref) : randomUUID();
      const { url, cuerpo } = armar(previa.tipo, previa.animal, previa.datos, idEvento);
      const res = await agente.post(url).send(cuerpo);
      expect([200, 201], `la previa ${i + 1} (${previa.tipo}) tendría que aceptarse: ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
    }

    // ── Pedido ──
    const { url, cuerpo } = armar(caso.tipo, caso.pedido.animal, caso.pedido.datos, caso.tipo === 'ANULACION' ? undefined : randomUUID());
    const res = await agente.post(url).send(cuerpo);

    expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(caso.esperado.codigo);
    if (caso.esperado.resultado === 'rechazo') {
      // Un error de un campo trae el mensaje en `detalles`; uno general, en `error`.
      const detalle = res.body.detalles?.[0] as { campo: string; mensaje: string } | undefined;
      expect(detalle?.mensaje ?? res.body.error).toBe(caso.esperado.mensaje);
      expect(detalle?.campo).toBe(caso.esperado.campo);
    }
  });
});
