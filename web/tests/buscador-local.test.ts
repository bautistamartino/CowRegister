import { describe, expect, it } from 'vitest';
import { resolverLocal, type CopiaEnMemoria } from '../src/sinconexion/copiaLocal';
import type { AnimalCopia, EstadoAnimal, Lote, Sexo } from '../src/compartido/api';

// Tests de las lecturas sin conexión (spec 009, RF-9 a RF-17): `resolverLocal` responde desde la
// copia lo mismo que respondería `GET /api/...` del servidor (api/src/rutas/animales.ts).

const LOTE_A = '11111111-1111-4111-8111-111111111111';
const LOTE_B = '22222222-2222-4222-8222-222222222222';
const GENERADA = '2026-11-12T15:05:00.000Z'; // 12:05 en Argentina

const lotes: Lote[] = [
  { id: LOTE_A, nombre: 'Lote A', descripcion: null, cantidadAnimales: 0, destinoDe: [] },
  { id: LOTE_B, nombre: 'Lote B', descripcion: null, cantidadAnimales: 0, destinoDe: [] },
];

function animal(
  numero: string,
  extra: { estado?: Exclude<EstadoAnimal, 'BAJA'>; sexo?: Sexo; lote?: { id: string; nombre: string } | null } = {},
): AnimalCopia {
  return {
    ficha: {
      id: `id-${numero}`,
      numero,
      sexo: extra.sexo ?? 'HEMBRA',
      estado: extra.estado ?? 'EN_ORDENE',
      fechaNacimiento: null,
      lote: extra.lote === undefined ? null : extra.lote,
      madre: null,
      crias: [],
      parto: null,
    },
    eventos: {
      situacion: { estado: 'PRENADA', ultimoServicio: null, ultimoTacto: null, fechaProbableParto: null, fechaReferencia: null },
      eventos: [],
    },
    historial: { total: 1, truncado: false, tope: 500, ultimoEventoNoAnuladoId: null, entradas: [] },
    produccion: { registros: [], total: 0, mostrados: 0, truncado: false, tope: 200, promedio30Dias: 21.5, ultimoRegistro: null },
  };
}

function copiaCon(animales: AnimalCopia[]): CopiaEnMemoria {
  return { generadaEn: GENERADA, lotes, animales };
}

const A = { id: LOTE_A, nombre: 'Lote A' };
const B = { id: LOTE_B, nombre: 'Lote B' };
const copia = copiaCon([
  animal('10', { lote: A }),
  animal('9', { lote: A }),
  animal('A10', { estado: 'SECA', lote: B }),
  animal('A2', { estado: 'VAQUILLONA', lote: null }),
  animal('7', { estado: 'RECIEN_NACIDO', sexo: 'MACHO', lote: B }),
]);

const get = (ruta: string, c: CopiaEnMemoria = copia) => resolverLocal('GET', ruta, c);

// Atajos para los dos tipos de respuesta.
function datos(ruta: string, c: CopiaEnMemoria = copia): any {
  const r = get(ruta, c);
  if (r.tipo !== 'ok') throw new Error(`Se esperaba ok y fue ${JSON.stringify(r)}`);
  return r.datos;
}
function error(ruta: string, c: CopiaEnMemoria = copia) {
  const r = get(ruta, c);
  if (r.tipo !== 'error') throw new Error(`Se esperaba error y fue ${JSON.stringify(r)}`);
  return { status: r.status, mensaje: r.mensaje };
}

describe('listado local (GET /animales)', () => {
  it('trae todos en orden natural, con la forma del listado de la API', () => {
    const r = datos('/animales');
    expect(r.animales.map((a: { numero: string }) => a.numero)).toEqual(['7', '9', '10', 'A2', 'A10']);
    expect(r).toMatchObject({ total: 5, mostrados: 5, truncado: false });
    // Cada fila tiene exactamente id, numero, sexo, estado y lote { nombre } (como el servidor).
    expect(r.animales[2]).toEqual({ id: 'id-10', numero: '10', sexo: 'HEMBRA', estado: 'EN_ORDENE', lote: { nombre: 'Lote A' } });
    expect(r.animales[3].lote).toBeNull();
  });

  it('filtra por estado', () => {
    expect(datos('/animales?estado=SECA').animales.map((a: { numero: string }) => a.numero)).toEqual(['A10']);
    expect(datos('/animales?estado=EN_ORDENE').total).toBe(2);
  });

  it('filtra por lote y por "sin-lote"', () => {
    expect(datos(`/animales?loteId=${LOTE_B}`).animales.map((a: { numero: string }) => a.numero)).toEqual(['7', 'A10']);
    expect(datos('/animales?loteId=sin-lote').animales.map((a: { numero: string }) => a.numero)).toEqual(['A2']);
  });

  it('combina estado y lote', () => {
    expect(datos(`/animales?estado=SECA&loteId=${LOTE_B}`).total).toBe(1);
    expect(datos(`/animales?estado=EN_ORDENE&loteId=${LOTE_B}`).total).toBe(0);
  });

  it('un estado inválido (incluido BAJA o vacío) da 400, como el servidor', () => {
    const esperado = { status: 400, mensaje: 'El estado tiene que ser recién nacido, vaquillona, en ordeñe o seca' };
    expect(error('/animales?estado=BAJA')).toEqual(esperado);
    expect(error('/animales?estado=')).toEqual(esperado);
    expect(error('/animales?estado=VACA')).toEqual(esperado);
  });

  it('un lote mal formado o que no está en la copia da el mismo 404', () => {
    expect(error('/animales?loteId=hola')).toEqual({ status: 404, mensaje: 'Lote no encontrado' });
    expect(error('/animales?loteId=33333333-3333-4333-8333-333333333333')).toEqual({ status: 404, mensaje: 'Lote no encontrado' });
  });

  it('NO recorta en 2.000: devuelve todos y sin "truncado"', () => {
    const muchos = copiaCon(Array.from({ length: 2500 }, (_, i) => animal(String(i + 1))));
    const r = datos('/animales', muchos);
    expect(r.total).toBe(2500);
    expect(r.mostrados).toBe(2500);
    expect(r.truncado).toBe(false);
    expect(r.animales).toHaveLength(2500);
    expect(r.animales[1999].numero).toBe('2000');
    expect(r.animales[2499].numero).toBe('2500');
  });

  it('una copia vacía da un listado vacío', () => {
    expect(datos('/animales', copiaCon([]))).toEqual({ total: 0, mostrados: 0, truncado: false, animales: [] });
  });
});

describe('buscador local (GET /animales/buscar)', () => {
  it('encuentra por número, normalizando mayúsculas y espacios', () => {
    expect(datos('/animales/buscar?numero=a10')).toEqual({ id: 'id-A10', numero: 'A10' });
    expect(datos(`/animales/buscar?numero=${encodeURIComponent('  9 ')}`)).toEqual({ id: 'id-9', numero: '9' });
  });

  it('un número que no existe da 404 con el mensaje del servidor', () => {
    expect(error('/animales/buscar?numero=999')).toEqual({ status: 404, mensaje: 'No hay un animal activo con ese número' });
  });

  it('un número con caracteres no permitidos da el mismo 404 que uno inexistente', () => {
    expect(error(`/animales/buscar?numero=${encodeURIComponent('ñ1')}`)).toEqual({ status: 404, mensaje: 'No hay un animal activo con ese número' });
    expect(error(`/animales/buscar?numero=${encodeURIComponent('1 2')}`).status).toBe(404);
  });

  it('sin número o vacío da 400', () => {
    expect(error('/animales/buscar')).toEqual({ status: 400, mensaje: 'Indicá el número a buscar' });
    expect(error('/animales/buscar?numero=')).toEqual({ status: 400, mensaje: 'Indicá el número a buscar' });
    expect(error('/animales/buscar?numero=%20%20').status).toBe(400);
    expect(error('/animales/buscar?numero=1&numero=2').status).toBe(400); // repetido
  });

  it('"01" y "1" son números distintos (no se quitan los ceros)', () => {
    const c = copiaCon([animal('1'), animal('01')]);
    expect(datos('/animales/buscar?numero=01', c).id).toBe('id-01');
    expect(datos('/animales/buscar?numero=1', c).id).toBe('id-1');
  });
});

describe('ficha local', () => {
  it('devuelve la ficha, los eventos con la situación, el historial y la producción de la copia', () => {
    const a = copia.animales[0]!;
    expect(datos('/animales/id-10')).toBe(a.ficha);
    expect(datos('/animales/id-10/eventos')).toBe(a.eventos);
    expect(datos('/animales/id-10/eventos').situacion.estado).toBe('PRENADA');
    expect(datos('/animales/id-10/historial')).toBe(a.historial);
    expect(datos('/animales/id-10/produccion')).toBe(a.produccion);
  });

  it('el id se decodifica (los enlaces lo codifican)', () => {
    expect(datos('/animales/id-A10').numero).toBe('A10');
    expect(datos(`/animales/${encodeURIComponent('id-A10')}/historial`).total).toBe(1);
  });

  it('un animal que no está en la copia NO se declara inexistente: dice que no está en los datos de la tablet', () => {
    const esperado = {
      status: 404,
      mensaje: 'No encontrado en los datos de la tablet (al día de 12/11/2026 12:05)',
    };
    expect(error('/animales/no-existe')).toEqual(esperado);
    expect(error('/animales/no-existe/eventos')).toEqual(esperado);
    expect(error('/animales/no-existe/historial')).toEqual(esperado);
    expect(error('/animales/no-existe/produccion')).toEqual(esperado);
  });
});

describe('lotes locales (GET /lotes)', () => {
  it('devuelve los lotes de la copia', () => {
    expect(datos('/lotes')).toBe(lotes);
  });
});

describe('lista cerrada: lo demás necesita conexión (RF-12, RF-13)', () => {
  const fuera = [
    '/bajas',
    `/bajas/id-10`,
    '/bajas/id-10/produccion',
    '/bajas/id-10/historial',
    '/informes/inseminacion?desde=2026-01-01&hasta=2026-02-01',
    '/informes/leche',
    '/semen',
    '/reglas-lote',
    '/lotes/abc',
    '/usuarios',
    '/animales/id-10/cambios',
    '/animales/id-10/otra-cosa',
    '/animales/id-10/servicios',
    '/copia-local',
    '/auth/yo',
    '/',
    '',
  ];
  it.each(fuera)('GET %s queda fuera', (ruta) => {
    expect(get(ruta)).toEqual({ tipo: 'fuera' });
  });

  it('cualquier método que no sea GET queda fuera, aunque la ruta esté en la lista', () => {
    for (const metodo of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(resolverLocal(metodo, '/animales/id-10', copia)).toEqual({ tipo: 'fuera' });
      expect(resolverLocal(metodo, '/animales', copia)).toEqual({ tipo: 'fuera' });
      expect(resolverLocal(metodo, '/animales/id-10/produccion', copia)).toEqual({ tipo: 'fuera' });
    }
  });

  it('el método se compara en mayúsculas o minúsculas', () => {
    expect(resolverLocal('get', '/animales', copia).tipo).toBe('ok');
  });
});
