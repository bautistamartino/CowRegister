import { describe, expect, it } from 'vitest';
import {
  type ContextoEdicion,
  ORDEN_CAMPOS,
  evaluarEdicion,
  interpretarCuerpo,
  ordenarCambios,
} from '../src/animales/edicion.js';

// Lógica pura de la spec 005: formato del pedido, tabla omitido / valor / null, "sin cambios",
// reglas de datos (400) y conflictos (409) en el orden de RF-16. No usa la base.

// Atajo: interpreta el cuerpo y devuelve el rechazo o los datos.
function formato(cuerpo: unknown) {
  return interpretarCuerpo(cuerpo);
}

describe('interpretarCuerpo — campos permitidos y formato (RF-2)', () => {
  it('acepta los cuatro datos y normaliza el número', () => {
    const r = formato({ numero: ' ab-12 ', sexo: 'MACHO', fechaNacimiento: '2024-05-01', madre: '77' });
    expect(r).toEqual({ datos: { numero: 'AB-12', sexo: 'MACHO', fechaNacimiento: '2024-05-01', madre: '77' } });
  });

  it('omitido no se toca; null vacía fecha y madre', () => {
    expect(formato({ fechaNacimiento: null, madre: null })).toEqual({ datos: { fechaNacimiento: null, madre: null } });
    expect(formato({ numero: '5' })).toEqual({ datos: { numero: '5' } });
  });

  it('ignora establecimientoId sin error', () => {
    expect(formato({ numero: '5', establecimientoId: 'otro' })).toEqual({ datos: { numero: '5' } });
  });

  it.each([
    ['estado', 'El estado no se cambia a mano: lo cambian los eventos'],
    ['loteId', 'Para cambiar de lote usá «Mover de lote»'],
    ['lote', 'Para cambiar de lote usá «Mover de lote»'],
    ['id', 'El dato «id» no se puede editar'],
    ['fechaBaja', 'El dato «fechaBaja» no se puede editar'],
    ['cualquierCosa', 'El dato «cualquierCosa» no se puede editar'],
  ])('rechaza el campo no editable %s con su mensaje', (campo, mensaje) => {
    expect(formato({ [campo]: 'x', numero: '5' })).toEqual({ rechazo: { estado: 400, mensaje } });
  });

  it('numero y sexo en null dan 400', () => {
    expect(formato({ numero: null })).toMatchObject({ rechazo: { estado: 400, campo: 'numero' } });
    expect(formato({ sexo: null })).toMatchObject({ rechazo: { estado: 400, campo: 'sexo' } });
  });

  it('número vacío, largo o con caracteres inválidos dan 400 con mensaje en español', () => {
    expect(formato({ numero: '   ' })).toMatchObject({ rechazo: { estado: 400, campo: 'numero', mensaje: 'El número del animal es obligatorio' } });
    expect(formato({ numero: 'A'.repeat(21) })).toMatchObject({ rechazo: { estado: 400, campo: 'numero' } });
    expect(formato({ numero: 'a b' })).toMatchObject({ rechazo: { estado: 400, campo: 'numero' } });
    expect(formato({ numero: 12 })).toMatchObject({ rechazo: { estado: 400, campo: 'numero' } });
  });

  it('sexo desconocido, fecha que no es texto y madre que no es texto dan 400', () => {
    expect(formato({ sexo: 'OTRO' })).toMatchObject({ rechazo: { estado: 400, campo: 'sexo' } });
    expect(formato({ fechaNacimiento: 20240101 })).toMatchObject({ rechazo: { estado: 400, campo: 'fechaNacimiento' } });
    expect(formato({ madre: 5 })).toMatchObject({ rechazo: { estado: 400, campo: 'madre' } });
  });

  it('un cuerpo que no es un objeto da 400', () => {
    expect(formato([])).toMatchObject({ rechazo: { estado: 400 } });
    expect(formato(null)).toMatchObject({ rechazo: { estado: 400 } });
    expect(formato('x')).toMatchObject({ rechazo: { estado: 400 } });
  });

  it('{} se acepta como formato (el rechazo es "sin cambios", después de buscar el animal)', () => {
    expect(formato({})).toEqual({ datos: {} });
  });
});

// ─── Reglas de datos ────────────────────────────────────────────────

const madreBase = { id: 'm1', numero: '50', sexo: 'HEMBRA' as const, fechaNacimiento: '2015-01-01' };

function contexto(cambios: Partial<ContextoEdicion> & { animal?: Partial<ContextoEdicion['animal']> } = {}): ContextoEdicion {
  const { animal, ...resto } = cambios;
  return {
    hoy: '2026-11-11',
    madreNueva: undefined,
    esDescendiente: false,
    numeroOcupado: false,
    ...resto,
    animal: {
      id: 'a1',
      numero: '101',
      sexo: 'HEMBRA',
      estado: 'EN_ORDENE',
      fechaNacimiento: '2020-01-01',
      madre: null,
      esCriaDeParto: false,
      tieneEventosOCrias: false,
      ...animal,
    },
  };
}

function evaluar(cuerpo: Record<string, unknown>, ctx: ContextoEdicion = contexto()) {
  const r = interpretarCuerpo(cuerpo);
  if ('rechazo' in r) throw new Error('el formato debería ser válido');
  return evaluarEdicion(r.datos, ctx);
}

describe('evaluarEdicion — "sin cambios" (RF-2)', () => {
  it('{} da 400 "No hay cambios para guardar"', () => {
    expect(evaluar({})).toEqual({ rechazo: { estado: 400, mensaje: 'No hay cambios para guardar' } });
  });

  it('todos los datos iguales a los actuales dan 400', () => {
    const ctx = contexto({ animal: { madre: { id: 'm1', numero: '50', fechaNacimiento: '2015-01-01' } }, madreNueva: madreBase });
    expect(evaluar({ numero: '101', sexo: 'HEMBRA', fechaNacimiento: '2020-01-01', madre: '50' }, ctx)).toMatchObject({
      rechazo: { estado: 400, mensaje: 'No hay cambios para guardar' },
    });
  });

  it('el mismo número escrito en minúsculas es "sin cambios"', () => {
    expect(evaluar({ numero: ' 101 ' })).toMatchObject({ rechazo: { estado: 400, mensaje: 'No hay cambios para guardar' } });
    const ctx = contexto({ animal: { numero: 'AB1' } });
    expect(evaluar({ numero: 'ab1' }, ctx)).toMatchObject({ rechazo: { mensaje: 'No hay cambios para guardar' } });
  });

  it('vaciar una fecha o una madre que ya están vacías es "sin cambios"', () => {
    const ctx = contexto({ animal: { fechaNacimiento: null } });
    expect(evaluar({ fechaNacimiento: null, madre: null }, ctx)).toMatchObject({ rechazo: { mensaje: 'No hay cambios para guardar' } });
  });
});

describe('evaluarEdicion — tabla omitido / valor / null (RF-1)', () => {
  it('un cambio válido por campo devuelve los cambios con antes y después, en el orden fijo', () => {
    const ctx = contexto({ animal: { madre: { id: 'm0', numero: '40', fechaNacimiento: null } }, madreNueva: madreBase });
    const r = evaluar({ madre: '50', fechaNacimiento: '2021-03-04', sexo: 'HEMBRA', numero: '202' }, ctx);
    expect(r).toEqual({
      cambios: [
        { campo: 'NUMERO', valorAnterior: '101', valorNuevo: '202' },
        { campo: 'FECHA_NACIMIENTO', valorAnterior: '2020-01-01', valorNuevo: '2021-03-04' },
        { campo: 'MADRE', valorAnterior: '40', valorNuevo: '50' },
      ],
    });
  });

  it('vaciar la fecha y la madre guarda null como valor nuevo', () => {
    const ctx = contexto({ animal: { madre: { id: 'm0', numero: '40', fechaNacimiento: null } } });
    expect(evaluar({ fechaNacimiento: null, madre: null }, ctx)).toEqual({
      cambios: [
        { campo: 'FECHA_NACIMIENTO', valorAnterior: '2020-01-01', valorNuevo: null },
        { campo: 'MADRE', valorAnterior: '40', valorNuevo: null },
      ],
    });
  });

  it('pasar una recién nacida a macho guarda "hembra" → "macho"', () => {
    const ctx = contexto({ animal: { estado: 'RECIEN_NACIDO' } });
    expect(evaluar({ sexo: 'MACHO' }, ctx)).toEqual({ cambios: [{ campo: 'SEXO', valorAnterior: 'hembra', valorNuevo: 'macho' }] });
  });

  it('solo registra los datos que cambian (los iguales no entran)', () => {
    expect(evaluar({ numero: '999', sexo: 'HEMBRA' })).toEqual({ cambios: [{ campo: 'NUMERO', valorAnterior: '101', valorNuevo: '999' }] });
  });
});

describe('evaluarEdicion — sexo (RF-4)', () => {
  it('un macho solo puede ser recién nacido: vaca en ordeñe a macho da 400', () => {
    expect(evaluar({ sexo: 'MACHO' })).toMatchObject({ rechazo: { estado: 400, campo: 'sexo' } });
  });

  it('con eventos no anulados o crías da 409 con el motivo', () => {
    const ctx = contexto({ animal: { estado: 'RECIEN_NACIDO', tieneEventosOCrias: true } });
    expect(evaluar({ sexo: 'MACHO' }, ctx)).toMatchObject({ rechazo: { estado: 409, campo: 'sexo' } });
  });

  it('hembra recién nacida sin eventos ni crías puede pasar a macho', () => {
    expect(evaluar({ sexo: 'MACHO' }, contexto({ animal: { estado: 'RECIEN_NACIDO' } }))).toHaveProperty('cambios');
  });
});

describe('evaluarEdicion — fecha de nacimiento (RF-5)', () => {
  it('hoy se acepta', () => {
    expect(evaluar({ fechaNacimiento: '2026-11-11' })).toHaveProperty('cambios');
  });
  it('mañana da 400', () => {
    expect(evaluar({ fechaNacimiento: '2026-11-12' })).toMatchObject({ rechazo: { estado: 400, campo: 'fechaNacimiento' } });
  });
  it('31/12/1999 da 400', () => {
    expect(evaluar({ fechaNacimiento: '1999-12-31' })).toMatchObject({ rechazo: { estado: 400, campo: 'fechaNacimiento' } });
  });
  it('una fecha que no existe en el calendario da 400', () => {
    expect(evaluar({ fechaNacimiento: '2021-02-31' })).toMatchObject({ rechazo: { estado: 400, campo: 'fechaNacimiento' } });
  });
  it('vaciada se acepta', () => {
    expect(evaluar({ fechaNacimiento: null })).toEqual({
      cambios: [{ campo: 'FECHA_NACIMIENTO', valorAnterior: '2020-01-01', valorNuevo: null }],
    });
  });
  it('igual o anterior a la de la madre actual da 400; posterior se acepta', () => {
    const ctx = contexto({ animal: { madre: { id: 'm1', numero: '50', fechaNacimiento: '2018-06-01' } } });
    expect(evaluar({ fechaNacimiento: '2018-06-01' }, ctx)).toMatchObject({ rechazo: { estado: 400, campo: 'fechaNacimiento' } });
    expect(evaluar({ fechaNacimiento: '2018-05-31' }, ctx)).toMatchObject({ rechazo: { estado: 400, campo: 'fechaNacimiento' } });
    expect(evaluar({ fechaNacimiento: '2018-06-02' }, ctx)).toHaveProperty('cambios');
  });
  it('se valida contra la madre nueva cuando se cambian las dos a la vez', () => {
    const ctx = contexto({ madreNueva: { ...madreBase, fechaNacimiento: '2022-01-01' } });
    expect(evaluar({ fechaNacimiento: '2021-01-01', madre: '50' }, ctx)).toMatchObject({ rechazo: { estado: 400, campo: 'fechaNacimiento' } });
  });
  it('una madre sin fecha no restringe', () => {
    const ctx = contexto({ animal: { madre: { id: 'm1', numero: '50', fechaNacimiento: null } } });
    expect(evaluar({ fechaNacimiento: '2000-01-01' }, ctx)).toHaveProperty('cambios');
  });
});

describe('evaluarEdicion — madre (RF-6)', () => {
  it('madre inexistente, de otro tambo o de baja: mensaje genérico (madreNueva null)', () => {
    const r = evaluar({ madre: '999' }, contexto({ madreNueva: null }));
    expect(r).toEqual({ rechazo: { estado: 400, campo: 'madre', mensaje: 'No hay una hembra activa con el número 999' } });
  });

  it('un número con formato inválido usa el mismo mensaje genérico', () => {
    const r = evaluar({ madre: ' a b ' }, contexto({ madreNueva: null }));
    expect(r).toEqual({ rechazo: { estado: 400, campo: 'madre', mensaje: 'No hay una hembra activa con el número a b' } });
  });

  it('un macho del propio tambo tiene mensaje propio', () => {
    const r = evaluar({ madre: '50' }, contexto({ madreNueva: { ...madreBase, sexo: 'MACHO' } }));
    expect(r).toMatchObject({ rechazo: { estado: 400, campo: 'madre', mensaje: 'El animal 50 es un macho: la madre tiene que ser una hembra' } });
  });

  it('el mismo animal tiene mensaje propio', () => {
    const r = evaluar({ madre: '101' }, contexto({ madreNueva: { ...madreBase, id: 'a1', numero: '101' } }));
    expect(r).toMatchObject({ rechazo: { estado: 400, campo: 'madre', mensaje: 'Un animal no puede ser su propia madre' } });
  });

  it('ciclo directo (una cría) e indirecto (una nieta): "X ya es descendiente de este animal"', () => {
    // La consulta recursiva de la ruta decide si es descendiente; acá llega el resultado.
    const r = evaluar({ madre: '50' }, contexto({ madreNueva: madreBase, esDescendiente: true }));
    expect(r).toEqual({ rechazo: { estado: 400, campo: 'madre', mensaje: '50 ya es descendiente de este animal' } });
  });

  it('madre nacida el mismo día o después que el animal da 400; antes se acepta', () => {
    expect(evaluar({ madre: '50' }, contexto({ madreNueva: { ...madreBase, fechaNacimiento: '2020-01-01' } }))).toMatchObject({
      rechazo: { estado: 400, campo: 'madre' },
    });
    expect(evaluar({ madre: '50' }, contexto({ madreNueva: { ...madreBase, fechaNacimiento: '2020-06-01' } }))).toMatchObject({
      rechazo: { estado: 400, campo: 'madre' },
    });
    expect(evaluar({ madre: '50' }, contexto({ madreNueva: { ...madreBase, fechaNacimiento: '2019-12-31' } }))).toHaveProperty('cambios');
  });

  it('si la fecha del animal es null o la de la madre es null, no hay comparación', () => {
    expect(evaluar({ madre: '50' }, contexto({ animal: { fechaNacimiento: null }, madreNueva: madreBase }))).toHaveProperty('cambios');
    expect(evaluar({ madre: '50' }, contexto({ madreNueva: { ...madreBase, fechaNacimiento: null } }))).toHaveProperty('cambios');
  });

  it('la fecha de madre se compara contra la fecha nueva del animal si también cambia', () => {
    const ctx = contexto({ madreNueva: { ...madreBase, fechaNacimiento: '2022-01-01' } });
    // fecha nueva 2023 > 2022: válida; la madre es anterior.
    expect(evaluar({ fechaNacimiento: '2023-01-01', madre: '50' }, ctx)).toHaveProperty('cambios');
  });

  it('quitar la madre se acepta', () => {
    const ctx = contexto({ animal: { madre: { id: 'm1', numero: '50', fechaNacimiento: null } } });
    expect(evaluar({ madre: null }, ctx)).toEqual({ cambios: [{ campo: 'MADRE', valorAnterior: '50', valorNuevo: null }] });
  });

  it('la misma madre que ya tiene es "sin cambios"', () => {
    const ctx = contexto({ animal: { madre: { id: 'm1', numero: '50', fechaNacimiento: null } }, madreNueva: madreBase });
    expect(evaluar({ madre: '50' }, ctx)).toMatchObject({ rechazo: { mensaje: 'No hay cambios para guardar' } });
  });
});

describe('evaluarEdicion — cría de parto (RF-7)', () => {
  const cria = { esCriaDeParto: true, estado: 'RECIEN_NACIDO' as const, madre: { id: 'm1', numero: '50', fechaNacimiento: null } };

  it('el número sí se puede cambiar', () => {
    expect(evaluar({ numero: '555' }, contexto({ animal: cria }))).toEqual({
      cambios: [{ campo: 'NUMERO', valorAnterior: '101', valorNuevo: '555' }],
    });
  });

  it.each([
    ['sexo', { sexo: 'MACHO' }],
    ['fecha', { fechaNacimiento: '2021-01-01' }],
    ['fecha vaciada', { fechaNacimiento: null }],
    ['madre null', { madre: null }],
  ])('%s da 409 y explica que viene del parto', (_nombre, cuerpo) => {
    const r = evaluar(cuerpo, contexto({ animal: cria }));
    expect(r).toMatchObject({ rechazo: { estado: 409 } });
    expect((r as { rechazo: { mensaje: string } }).rechazo.mensaje).toContain('parto');
  });
});

describe('evaluarEdicion — número repetido (RF-3)', () => {
  it('número ocupado por otro animal activo da 409', () => {
    expect(evaluar({ numero: '999' }, contexto({ numeroOcupado: true }))).toEqual({
      rechazo: { estado: 409, campo: 'numero', mensaje: 'Ya existe un animal activo con ese número' },
    });
  });
});

describe('evaluarEdicion — orden de rechazos (RF-16)', () => {
  it('sin cambios gana a todo lo demás', () => {
    expect(evaluar({}, contexto({ numeroOcupado: true }))).toMatchObject({ rechazo: { mensaje: 'No hay cambios para guardar' } });
  });

  it('dentro de los 400: sexo-estado antes que fecha antes que madre', () => {
    const ctx = contexto({ madreNueva: null });
    expect(evaluar({ sexo: 'MACHO', fechaNacimiento: '2999-01-01', madre: '9' }, ctx)).toMatchObject({ rechazo: { campo: 'sexo' } });
    expect(evaluar({ fechaNacimiento: '2999-01-01', madre: '9' }, ctx)).toMatchObject({ rechazo: { campo: 'fechaNacimiento' } });
    expect(evaluar({ madre: '9' }, ctx)).toMatchObject({ rechazo: { campo: 'madre' } });
  });

  it('sexo con eventos y fecha inválida a la vez: gana el 400 de la fecha', () => {
    const ctx = contexto({ animal: { estado: 'RECIEN_NACIDO', tieneEventosOCrias: true } });
    expect(evaluar({ sexo: 'MACHO', fechaNacimiento: '2999-01-01' }, ctx)).toMatchObject({ rechazo: { estado: 400, campo: 'fechaNacimiento' } });
  });

  it('cría de parto con sexo y número repetido: gana el 409 de la cría de parto', () => {
    const ctx = contexto({
      animal: { esCriaDeParto: true, estado: 'RECIEN_NACIDO', tieneEventosOCrias: true },
      numeroOcupado: true,
    });
    const r = evaluar({ numero: '999', sexo: 'MACHO' }, ctx);
    expect(r).toMatchObject({ rechazo: { estado: 409 } });
    expect((r as { rechazo: { mensaje: string } }).rechazo.mensaje).toContain('parto');
  });

  it('número repetido y sexo con eventos: gana el de sexo', () => {
    const ctx = contexto({ animal: { estado: 'RECIEN_NACIDO', tieneEventosOCrias: true }, numeroOcupado: true });
    expect(evaluar({ numero: '999', sexo: 'MACHO' }, ctx)).toMatchObject({ rechazo: { estado: 409, campo: 'sexo' } });
  });

  it('madre inexistente y número repetido: gana el 400 de la madre', () => {
    const ctx = contexto({ madreNueva: null, numeroOcupado: true });
    expect(evaluar({ numero: '999', madre: '888' }, ctx)).toMatchObject({ rechazo: { estado: 400, campo: 'madre' } });
  });
});

describe('ordenarCambios (RF-15)', () => {
  it('el orden fijo es número, sexo, fecha de nacimiento, madre, lote', () => {
    expect(ORDEN_CAMPOS).toEqual(['NUMERO', 'SEXO', 'FECHA_NACIMIENTO', 'MADRE', 'LOTE']);
    const desordenados = (['LOTE', 'MADRE', 'NUMERO', 'FECHA_NACIMIENTO', 'SEXO'] as const).map((campo) => ({ campo }));
    expect(ordenarCambios(desordenados).map((c) => c.campo)).toEqual(ORDEN_CAMPOS);
  });
});
