import { describe, expect, it } from 'vitest';
import { actualizarCopia, formatearFechaHora } from '../src/sinconexion/copia';
import { AlmacenMemoria } from '../src/sinconexion/almacenMemoria';
import { ApiError, type AnimalCopia, type CopiaLocal } from '../src/compartido/api';

// Tests de la copia local (spec 009, RF-4 a RF-9): usan el almacén en memoria y una
// "descarga" falsa, así no hace falta navegador ni servidor.

const propietario = { usuarioId: 'u1', establecimientoId: 'e1' };

function animal(numero: string): AnimalCopia {
  return {
    ficha: {
      id: `id-${numero}`,
      numero,
      sexo: 'HEMBRA',
      estado: 'EN_ORDENE',
      fechaNacimiento: null,
      lote: null,
      madre: null,
      crias: [],
      parto: null,
    },
    eventos: { situacion: null, eventos: [] },
    historial: { total: 0, truncado: false, tope: 500, ultimoEventoNoAnuladoId: null, entradas: [] },
    produccion: { registros: [], total: 0, mostrados: 0, truncado: false, tope: 200, promedio30Dias: null, ultimoRegistro: null },
  };
}

function copia(generadaEn: string, numeros: string[]): CopiaLocal {
  return {
    generadaEn,
    totalAnimales: numeros.length,
    lotes: [{ id: 'l1', nombre: 'Ordeñe', descripcion: null, cantidadAnimales: numeros.length, destinoDe: ['EN_ORDENE'] }],
    animales: numeros.map(animal),
  };
}

const VIEJA = copia('2026-11-10T12:00:00.000Z', ['1', '2']);
const NUEVA = copia('2026-11-12T12:00:00.000Z', ['1', '2', '3']);

// Deja guardada la copia vieja en un almacén y recién después activa las fallas simuladas.
async function almacenConVieja(fallas: Parameters<AlmacenMemoria['configurar']>[0] = {}) {
  const almacen = new AlmacenMemoria();
  await almacen.reemplazarCopia(VIEJA, propietario);
  almacen.configurar(fallas);
  return almacen;
}

async function comprobarVieja(almacen: AlmacenMemoria) {
  const meta = await almacen.leerMeta();
  expect(meta?.generadaEn).toBe(VIEJA.generadaEn);
  expect(meta?.totalAnimales).toBe(2);
  expect((await almacen.leerAnimales()).map((a) => a.ficha.numero).sort()).toEqual(['1', '2']);
}

describe('actualizarCopia', () => {
  it('primera descarga exitosa: guarda la copia completa y el propietario', async () => {
    const almacen = new AlmacenMemoria();
    const r = await actualizarCopia({ almacen, propietario, descargar: async () => NUEVA });
    expect(r).toMatchObject({ ok: true, primera: true, generadaEn: NUEVA.generadaEn, totalAnimales: 3 });
    const meta = await almacen.leerMeta();
    expect(meta?.propietario).toEqual(propietario);
    expect(meta?.lotes).toHaveLength(1);
    expect(await almacen.leerAnimales()).toHaveLength(3);
  });

  it('guarda el semen que trae la copia (spec 010) y rechaza uno que no es una lista', async () => {
    const almacen = new AlmacenMemoria();
    const semen = [{ id: 'sm1', nombre: 'Toro Alfa', raza: null }];
    const r = await actualizarCopia({ almacen, propietario, descargar: async () => ({ ...NUEVA, semen }) });
    expect(r.ok).toBe(true);
    expect((await almacen.leerMeta())?.semen).toEqual(semen);

    const otro = new AlmacenMemoria();
    const mala = await actualizarCopia({ almacen: otro, propietario, descargar: async () => ({ ...NUEVA, semen: 'no es una lista' as never }) });
    expect(mala).toMatchObject({ ok: false, motivo: 'servidor' });
    expect(await otro.leerMeta()).toBeNull();
  });

  it('actualización exitosa: reemplaza todo y deja de ser primera', async () => {
    const almacen = await almacenConVieja();
    const r = await actualizarCopia({ almacen, propietario, descargar: async () => NUEVA });
    expect(r).toMatchObject({ ok: true, primera: false, generadaEn: NUEVA.generadaEn });
    expect((await almacen.leerMeta())?.generadaEn).toBe(NUEVA.generadaEn);
    expect(await almacen.leerAnimales()).toHaveLength(3);
  });

  it('la actualización reemplaza: un animal que ya no está en el servidor desaparece', async () => {
    const almacen = await almacenConVieja();
    await actualizarCopia({ almacen, propietario, descargar: async () => copia('2026-11-12T13:00:00.000Z', ['2']) });
    expect((await almacen.leerAnimales()).map((a) => a.ficha.numero)).toEqual(['2']);
  });

  it('falla de red al actualizar: conserva la copia anterior completa y su fecha', async () => {
    const almacen = await almacenConVieja();
    const r = await actualizarCopia({
      almacen,
      propietario,
      descargar: async () => {
        throw new ApiError(0, 'No se pudo conectar con el servidor. Revisá tu conexión.');
      },
    });
    expect(r).toMatchObject({ ok: false, primera: false, motivo: 'red', conservada: true, generadaEn: VIEJA.generadaEn });
    await comprobarVieja(almacen);
  });

  it('falla a mitad de la escritura: la transacción se deshace y queda la anterior completa', async () => {
    const almacen = await almacenConVieja({ fallarEnAnimal: 1 }); // se rompe al escribir el 2.º animal
    const r = await actualizarCopia({
      almacen,
      propietario: { usuarioId: 'otro', establecimientoId: 'e1' },
      descargar: async () => NUEVA,
    });
    expect(r).toMatchObject({ ok: false, motivo: 'almacen', conservada: true, generadaEn: VIEJA.generadaEn });
    await comprobarVieja(almacen);
    // ... y el propietario tampoco cambió a medias.
    expect((await almacen.leerMeta())?.propietario).toEqual(propietario);
  });

  it('sin espacio: avisa, conserva la anterior y no muestra la nueva como actualizada', async () => {
    const almacen = await almacenConVieja({ capacidad: 2 }); // entran 2 animales; la nueva trae 3
    const r = await actualizarCopia({ almacen, propietario, descargar: async () => NUEVA });
    expect(r).toMatchObject({
      ok: false,
      motivo: 'espacio',
      mensaje: 'No hay espacio en la tablet para guardar los datos sin conexión',
      conservada: true,
      generadaEn: VIEJA.generadaEn,
    });
    await comprobarVieja(almacen);
  });

  it('primera descarga fallida: no deja nada guardado', async () => {
    const almacen = new AlmacenMemoria();
    const r = await actualizarCopia({
      almacen,
      propietario,
      descargar: async () => {
        throw new ApiError(0, 'sin red');
      },
    });
    expect(r).toMatchObject({ ok: false, primera: true, motivo: 'red', conservada: false, generadaEn: null });
    expect(await almacen.leerMeta()).toBeNull();
    expect(await almacen.leerAnimales()).toEqual([]);
  });

  it('primera descarga sin espacio: no deja una copia parcial', async () => {
    const almacen = new AlmacenMemoria();
    almacen.configurar({ capacidad: 1 });
    const r = await actualizarCopia({ almacen, propietario, descargar: async () => NUEVA });
    expect(r).toMatchObject({ ok: false, primera: true, motivo: 'espacio', conservada: false });
    expect(await almacen.leerMeta()).toBeNull();
    expect(await almacen.leerAnimales()).toEqual([]);
  });

  it('tope (422): muestra el mensaje de la API y conserva la anterior', async () => {
    const almacen = await almacenConVieja();
    const mensaje = 'El tambo tiene más animales de los que entran en la tablet (5000). Pedí ayuda para usarlo sin conexión';
    const r = await actualizarCopia({
      almacen,
      propietario,
      descargar: async () => {
        throw new ApiError(422, mensaje);
      },
    });
    expect(r).toMatchObject({ ok: false, motivo: 'tope', mensaje, conservada: true, generadaEn: VIEJA.generadaEn });
    await comprobarVieja(almacen);
  });

  it('tope (422) en la primera descarga: no guarda nada', async () => {
    const almacen = new AlmacenMemoria();
    const r = await actualizarCopia({
      almacen,
      propietario,
      descargar: async () => {
        throw new ApiError(422, 'El tambo tiene más animales de los que entran en la tablet (5000). Pedí ayuda para usarlo sin conexión');
      },
    });
    expect(r).toMatchObject({ ok: false, primera: true, motivo: 'tope', conservada: false });
    expect(await almacen.leerMeta()).toBeNull();
  });

  it('respuesta que no tiene la forma de la copia (portal de WiFi con 200): no guarda y conserva', async () => {
    const almacen = await almacenConVieja();
    for (const rara of [null, undefined, '<html>portal</html>', { generadaEn: 'x' }, { ...NUEVA, totalAnimales: 99 }]) {
      const r = await actualizarCopia({ almacen, propietario, descargar: async () => rara as unknown as CopiaLocal });
      expect(r).toMatchObject({ ok: false, motivo: 'servidor', conservada: true });
    }
    await comprobarVieja(almacen);
  });

  it('error del servidor (500): motivo "servidor" y conserva la anterior', async () => {
    const almacen = await almacenConVieja();
    const r = await actualizarCopia({
      almacen,
      propietario,
      descargar: async () => {
        throw new ApiError(500, 'Error 500');
      },
    });
    expect(r).toMatchObject({ ok: false, motivo: 'servidor', conservada: true });
    await comprobarVieja(almacen);
  });
});

describe('formatearFechaHora', () => {
  it('muestra la hora de Argentina (UTC-3) como dd/mm/aaaa hh:mm', () => {
    expect(formatearFechaHora('2026-11-12T15:05:00.000Z')).toBe('12/11/2026 12:05');
    // 02:30 UTC todavía es el día anterior en Argentina.
    expect(formatearFechaHora('2026-11-13T02:30:00.000Z')).toBe('12/11/2026 23:30');
  });
});
