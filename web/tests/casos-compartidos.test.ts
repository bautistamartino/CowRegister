import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnimalCopia, EventoReproductivo, Rol } from '../src/compartido/api';
import type { Enviado, Pendiente, TipoPendiente } from '../src/sinconexion/almacen';
import { validarCarga } from '../src/sinconexion/reglasLocales';
import { construirVista, entradasValidas, numerosEnUso } from '../src/sinconexion/vistaLocal';

// Tabla de casos COMPARTIDA (spec 010, RF-23): compartido/casos-reglas-eventos.json.
//
// Esta es la mitad de la web: cada caso arma la copia desde `base`, convierte las `previas` en pendientes
// esperando o enviados que la copia todavía no refleja, y compara el resultado de las reglas locales con
// `esperado` (código, mensaje y campo). Los mismos casos corren en api/tests/casos-compartidos.test.ts contra las
// rutas reales: si las dos mitades pasan, tablet y servidor dan el mismo resultado y el mismo mensaje.
//
// Los casos `soloServidor` se SALTAN acá (describen algo que la tablet no puede saber), pero un test verifica que
// cada uno explica por qué y cuenta cuántos hay. La tabla es solo DATOS: la web no importa nada de la API.

type EventoBase = {
  ref: string;
  tipo: 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO';
  fecha: string;
  tipoServicio?: 'INSEMINACION' | 'MONTA_NATURAL';
  semen?: string | null;
  resultado?: 'PRENADA' | 'VACIA';
  fechaProbableIndicada?: string | null;
  anomalias?: string | null;
  anulacion?: { motivo: string };
};

type Caso = {
  id: string;
  descripcion: string;
  tipo: Exclude<TipoPendiente, 'LITROS'>;
  rol: Rol;
  hoy: string;
  base: {
    animales: { ref: string; numero: string; sexo: 'HEMBRA' | 'MACHO'; estado: 'RECIEN_NACIDO' | 'VAQUILLONA' | 'EN_ORDENE' | 'SECA'; nacimiento: string | null; eventos: EventoBase[] }[];
    semen: { ref: string; nombre: string; activo: boolean }[];
  };
  previas: { tipo: Exclude<TipoPendiente, 'LITROS'>; animal: string; datos: Record<string, unknown>; estado: 'esperando' | 'enviado'; ref?: string }[];
  pedido: { animal: string; datos: Record<string, unknown> };
  esperado: { resultado: 'ok' | 'rechazo'; codigo: number; mensaje?: string; campo?: string };
  soloServidor?: boolean;
  motivoSoloServidor?: string;
};

const RUTA_TABLA = resolve(import.meta.dirname, '../../compartido/casos-reglas-eventos.json');
const { casos } = JSON.parse(readFileSync(RUTA_TABLA, 'utf8')) as { casos: Caso[] };

// Los eventos de la base de un caso, con la forma de la ficha de la copia (del más reciente al más antiguo).
function eventosDeCopia(base: EventoBase[]): EventoReproductivo[] {
  const lista = base.map((e, i): EventoReproductivo => ({
    id: e.ref,
    tipo: e.tipo,
    fecha: e.fecha,
    registradoPor: 'Dueño',
    // El momento de registro crece con la posición: así el orden a igual fecha es el de la tabla.
    registradoEn: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    anulacion: e.anulacion ? { motivo: e.anulacion.motivo, por: 'Dueño', en: '2026-10-05T12:00:00.000Z' } : null,
    servicio: e.tipo === 'SERVICIO' ? { tipoServicio: e.tipoServicio ?? 'INSEMINACION', semen: null } : null,
    tacto: e.tipo === 'TACTO' ? { resultado: e.resultado ?? 'PRENADA', fechaProbableIndicada: e.fechaProbableIndicada ?? null, fechaProbable: null, anomalias: e.anomalias ?? null } : null,
    parto: null,
    secado: null,
    baja: null,
  }));
  return lista.reverse();
}

function animalDeCopia(a: Caso['base']['animales'][number]): AnimalCopia {
  return {
    ficha: { id: a.ref, numero: a.numero, sexo: a.sexo, estado: a.estado, fechaNacimiento: a.nacimiento, lote: null, madre: null, crias: [], parto: null },
    eventos: { situacion: null, eventos: eventosDeCopia(a.eventos) },
    historial: { total: 0, truncado: false, tope: 500, ultimoEventoNoAnuladoId: null, entradas: [] },
    produccion: { registros: [], total: 0, mostrados: 0, truncado: false, tope: 200, promedio30Dias: null, ultimoRegistro: null },
  };
}

function correr(caso: Caso) {
  const animales = caso.base.animales.map(animalDeCopia);
  const numeroDe = (ref: string) => caso.base.animales.find((a) => a.ref === ref)!.numero;

  // Las previas, en orden de carga: esperando (pendiente) o enviado (aceptado pero que la copia no refleja).
  const pendientes: Pendiente[] = [];
  const enviados: Enviado[] = [];
  for (const [i, previa] of caso.previas.entries()) {
    const comunes = {
      id: previa.ref ?? `previa-${i + 1}`,
      usuarioId: 'u1',
      establecimientoId: 'e1',
      animalId: previa.animal,
      numero: numeroDe(previa.animal),
      tipo: previa.tipo,
      datos: previa.datos,
    };
    if (previa.estado === 'enviado') {
      enviados.push({ ...comunes, aceptadoEn: 1_000 + i, registro: null });
    } else {
      pendientes.push({
        ...comunes,
        cargadoEnDispositivo: '2026-11-12T08:15:00-03:00',
        orden: i + 1,
        estado: 'esperando',
        motivo: null,
        codigoRechazo: null,
        intentos: 0,
        proximoIntento: null,
      });
    }
  }

  const entradas = entradasValidas(pendientes, enviados);
  const vista = construirVista(animales.find((a) => a.ficha.id === caso.pedido.animal)!, entradas, caso.hoy);
  const semen = caso.base.semen.filter((s) => s.activo).map((s) => ({ id: s.ref, nombre: s.nombre, raza: null }));
  return validarCarga({ tipo: caso.tipo, datos: caso.pedido.datos }, vista, { hoy: caso.hoy, rol: caso.rol, semen, numeros: numerosEnUso(animales, entradas) });
}

describe('la tabla de casos compartida', () => {
  it('tiene casos con ids únicos y cada soloServidor explica su motivo', () => {
    expect(casos.length).toBeGreaterThan(50);
    expect(new Set(casos.map((c) => c.id)).size).toBe(casos.length);
    const soloServidor = casos.filter((c) => c.soloServidor);
    expect(soloServidor.length).toBeGreaterThan(0);
    for (const c of soloServidor) expect(c.motivoSoloServidor, c.id).toBeTruthy();
    // Visible en el informe: cuántos casos corre la web y cuántos se saltan.
    console.info(`Casos compartidos: ${casos.length - soloServidor.length} corren en la web y ${soloServidor.length} se saltan (soloServidor)`);
  });
});

describe('casos compartidos contra las reglas locales de la web', () => {
  const deLaWeb = casos.filter((c) => !c.soloServidor);
  it.each(deLaWeb.map((c) => [c.id, c] as const))('%s', (_id, caso) => {
    const r = correr(caso);
    if (caso.esperado.resultado === 'ok') {
      expect(r).toEqual({ ok: true });
    } else {
      expect(r).toEqual({
        ok: false,
        codigo: caso.esperado.codigo,
        mensaje: caso.esperado.mensaje,
        ...(caso.esperado.campo !== undefined && { campo: caso.esperado.campo }),
      });
    }
  });
});
