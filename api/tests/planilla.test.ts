import { describe, expect, it } from 'vitest';
import { analizarPlanilla, leerPlanilla, sinLotePorEstado, type ContextoPlanilla } from '../src/animales/planilla.js';
import { HttpError } from '../src/errores.js';

// Tests de las funciones puras de la planilla (spec 002, T3). No usan la base.

// Arma el texto de una planilla: celdas separadas por tabulación y filas por salto de línea.
const texto = (...filas: string[][]) => filas.map((f) => f.join('\t')).join('\n');

const HOY = '2026-11-10';
const ctx = (existentes: ContextoPlanilla['existentes'] = new Map()): ContextoPlanilla => ({ hoy: HOY, existentes });
const analizar = (t: string, c = ctx()) => analizarPlanilla(leerPlanilla(t).filas, c);

// Mensaje del error general (HttpError 400) que lanza leerPlanilla.
function errorDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(400);
    return (e as HttpError).message;
  }
  throw new Error('No lanzó ningún error');
}

describe('leerPlanilla: separación en filas y celdas (RF-14)', () => {
  it('separa por tabulación y por salto de línea, con LF y con CRLF', () => {
    const esperado = [
      { fila: 1, celdas: ['101', 'HEMBRA', '', 'SECA', ''] },
      { fila: 2, celdas: ['102', 'MACHO', '', 'RECIEN NACIDO', ''] },
    ];
    expect(leerPlanilla('101\tHEMBRA\t\tSECA\t\n102\tMACHO\t\tRECIEN NACIDO\t').filas).toEqual(esperado);
    expect(leerPlanilla('101\tHEMBRA\t\tSECA\t\r\n102\tMACHO\t\tRECIEN NACIDO\t\r\n').filas).toEqual(esperado);
  });

  it('recorta los extremos de cada celda (incluido el espacio de no separación)', () => {
    const { filas } = leerPlanilla(' 101 \t hembra \t\tseca\t');
    expect(filas[0]!.celdas).toEqual(['101', 'hembra', '', 'seca', '']);
  });

  it('una celda entre comillas puede tener tabulaciones y saltos de línea, y "" es una comilla', () => {
    const { filas } = leerPlanilla('"10\t1"\tHEMBRA\t\t"SE\r\nCA"\t"di ""x"""\n102\tH\t\tSECA\t');
    expect(filas).toHaveLength(2);
    expect(filas[0]!.celdas).toEqual(['10\t1', 'HEMBRA', '', 'SE\r\nCA', 'di "x"']);
    // El salto de línea de adentro de las comillas no crea una fila nueva.
    expect(filas[1]!.fila).toBe(2);
  });

  it('comillas sin cerrar rechazan todo el texto y dicen en qué fila empezaron', () => {
    const msg = errorDe(() => leerPlanilla('101\tH\t\tSECA\t\n102\tH\t\t"SECA\t\n103\tH\t\tSECA\t'));
    expect(msg).toContain('fila 2');
    expect(msg.toLowerCase()).toContain('comillas');
  });

  it('las filas vacías se ignoran pero cuentan en la numeración (RF-11)', () => {
    const { filas } = leerPlanilla('101\tH\t\tSECA\t\n\n  \t \t\t\t\n\n102\tH\t\tSECA\t\n');
    expect(filas.map((f) => f.fila)).toEqual([1, 5]);
  });

  it('texto vacío o de solo espacios: error en español', () => {
    expect(errorDe(() => leerPlanilla(''))).toMatch(/pegá/i);
    expect(errorDe(() => leerPlanilla('  \n \t \n'))).toMatch(/pegá/i);
  });

  it('sin ninguna tabulación: mensaje específico de RF-17', () => {
    expect(errorDe(() => leerPlanilla('101 H SECA\n102 H SECA'))).toBe(
      'Las columnas tienen que estar separadas por tabulación: copiá las celdas desde Excel o Google Sheets',
    );
    // Una sola columna (solo números) tampoco tiene tabulaciones.
    expect(errorDe(() => leerPlanilla('101\n102'))).toMatch(/tabulación/);
  });

  it('límites: 500 filas con datos pasan, 501 no; el encabezado y las vacías no cuentan', () => {
    const fila = (n: number) => `${n}\tHEMBRA\t\tSECA\t`;
    const con = (n: number) => Array.from({ length: n }, (_, i) => fila(i + 1)).join('\n');
    expect(leerPlanilla(con(500)).filas).toHaveLength(500);
    expect(errorDe(() => leerPlanilla(con(501)))).toMatch(/500/);
    const conExtras = `Número\tSexo\tFecha de nacimiento\tEstado\tMadre\n\n${con(500)}\n\n`;
    expect(leerPlanilla(conExtras).filas).toHaveLength(500);
  });

  it('más de 100.000 caracteres: error en español', () => {
    expect(errorDe(() => leerPlanilla('a\t'.repeat(50_001)))).toMatch(/100\.000/);
    expect(() => leerPlanilla('1\t'.repeat(50_000))).not.toThrow();
  });
});

describe('leerPlanilla: encabezado (RF-15)', () => {
  it('el encabezado exacto se ignora, sin importar mayúsculas ni tildes', () => {
    const t = 'NÚMERO\tsexo\tFecha de Nacimiento\tEstado\tNúmero de la madre\n101\tH\t\tSECA\t';
    const { filas } = leerPlanilla(t);
    expect(filas).toHaveLength(1);
    expect(filas[0]!.fila).toBe(2);
  });

  it('acepta las variantes de nombre de cada columna', () => {
    for (const [c1, c3, c5] of [
      ['caravana', 'nacimiento', 'madre'],
      ['numero', 'fecha nacimiento', 'numero madre'],
    ]) {
      const { filas } = leerPlanilla(`${c1}\tsexo\t${c3}\testado\t${c5}\n101\tH\t\tSECA\t`);
      expect(filas).toHaveLength(1);
    }
  });

  it('el encabezado puede estar después de filas vacías (es la primera fila no vacía)', () => {
    const { filas } = leerPlanilla('\n\nnumero\tsexo\tnacimiento\testado\tmadre\n101\tH\t\tSECA\t');
    expect(filas.map((f) => f.fila)).toEqual([4]);
  });

  it('un encabezado parcial, o uno que está más abajo, se trata como datos', () => {
    // Solo coinciden 4 de las 5 columnas.
    expect(leerPlanilla('numero\tsexo\tnacimiento\testado\tabuela\n101\tH\t\tSECA\t').filas).toHaveLength(2);
    // Orden de columnas distinto.
    expect(leerPlanilla('sexo\tnumero\tnacimiento\testado\tmadre\n101\tH\t\tSECA\t').filas).toHaveLength(2);
    // Está más abajo de una fila de datos.
    const abajo = '101\tH\t\tSECA\t\nnumero\tsexo\tnacimiento\testado\tmadre';
    expect(leerPlanilla(abajo).filas).toHaveLength(2);
  });

  it('solo el encabezado, sin datos: error en español', () => {
    expect(errorDe(() => leerPlanilla('numero\tsexo\tnacimiento\testado\tmadre\n'))).toMatch(/filas con datos/);
  });
});

describe('analizarPlanilla: valores de cada fila (RF-12, RF-16)', () => {
  it('sexo: hembra, macho, H, M (sin importar mayúsculas)', () => {
    const f = analizar(
      texto(
        ['1', 'hembra', '', 'seca', ''],
        ['2', 'H', '', 'seca', ''],
        ['3', 'Macho', '', 'recién nacido', ''],
        ['4', 'm', '', 'recien nacido', ''],
      ),
    );
    expect(f.map((x) => x.ok)).toEqual([true, true, true, true]);
    expect(f.map((x) => x.sexo)).toEqual(['HEMBRA', 'HEMBRA', 'MACHO', 'MACHO']);
  });

  it('sexo inválido o vacío: error de fila con mensaje', () => {
    const f = analizar(texto(['1', 'vaca', '', 'seca', ''], ['2', '', '', 'seca', '']));
    expect(f[0]).toMatchObject({ ok: false, motivo: 'El sexo tiene que ser hembra, macho, H o M' });
    expect(f[1]).toMatchObject({ ok: false, motivo: 'El sexo es obligatorio' });
  });

  it('estados con y sin tildes y en cualquier combinación de mayúsculas', () => {
    const f = analizar(
      texto(
        ['1', 'H', '', 'En Ordeñe', ''],
        ['2', 'H', '', 'en ordene', ''],
        ['3', 'H', '', 'VAQUILLONA', ''],
        ['4', 'H', '', 'Recién  Nacido', ''],
      ),
    );
    expect(f.map((x) => x.estado)).toEqual(['EN_ORDENE', 'EN_ORDENE', 'VAQUILLONA', 'RECIEN_NACIDO']);
    expect(f.every((x) => x.ok)).toBe(true);
  });

  it('estado inválido (incluido "baja") o vacío', () => {
    const f = analizar(texto(['1', 'H', '', 'baja', ''], ['2', 'H', '', '', '']));
    expect(f[0]!.motivo).toBe('El estado tiene que ser recién nacido, vaquillona, en ordeñe o seca');
    expect(f[1]!.motivo).toBe('El estado es obligatorio');
  });

  it('un macho solo puede ser recién nacido (RF-5)', () => {
    const f = analizar(texto(['1', 'M', '', 'seca', '']));
    expect(f[0]).toMatchObject({ ok: false, motivo: 'Un macho solo puede tener el estado recién nacido' });
  });

  it('número inválido o vacío usa los mismos mensajes que el alta manual', () => {
    const f = analizar(texto(['', 'H', '', 'seca', ''], ['1 2', 'H', '', 'seca', ''], ['ñ1', 'H', '', 'seca', '']));
    expect(f[0]!.motivo).toBe('El número del animal es obligatorio');
    expect(f[1]!.motivo).toMatch(/letras sin tildes/);
    expect(f[2]!.ok).toBe(false);
  });

  it('el número se normaliza a mayúsculas', () => {
    expect(analizar(texto(['a-12', 'H', '', 'seca', '']))[0]).toMatchObject({ ok: true, numero: 'A-12' });
  });

  it('fechas: 5/3/2021, 05/03/2021 y 2021-03-05 son la misma fecha', () => {
    const f = analizar(
      texto(['1', 'H', '5/3/2021', 'seca', ''], ['2', 'H', '05/03/2021', 'seca', ''], ['3', 'H', '2021-03-05', 'seca', '']),
    );
    expect(f.map((x) => x.fechaNacimiento)).toEqual(['2021-03-05', '2021-03-05', '2021-03-05']);
    expect(f.every((x) => x.ok)).toBe(true);
  });

  it('fechas con formato no aceptado o inválidas dan error de fila', () => {
    const f = analizar(
      texto(
        ['1', 'H', '5/3/21', 'seca', ''],
        ['2', 'H', 'marzo 2021', 'seca', ''],
        ['3', 'H', '31/02/2021', 'seca', ''],
        ['4', 'H', '2099-01-01', 'seca', ''],
        ['5', 'H', '1/1/1999', 'seca', ''],
      ),
    );
    expect(f.every((x) => !x.ok)).toBe(true);
    expect(f[0]!.motivo).toMatch(/día\/mes\/año/);
    expect(f[1]!.motivo).toMatch(/día\/mes\/año/);
    expect(f[2]!.motivo).toBe('La fecha de nacimiento no es una fecha válida');
    expect(f[3]!.motivo).toBe('La fecha de nacimiento no puede ser futura');
    expect(f[4]!.motivo).toMatch(/anterior al 01\/01\/2000/);
  });

  it('cantidad de columnas distinta de 5: error de fila', () => {
    const f = analizar(texto(['1', 'H', '', 'seca'], ['2', 'H', '', 'seca', '', 'sobra'], ['3', 'H', '', 'seca', '']));
    expect(f[0]).toMatchObject({ ok: false, motivo: 'La fila tiene 4 columnas y tienen que ser 5' });
    expect(f[1]).toMatchObject({ ok: false, motivo: 'La fila tiene 6 columnas y tienen que ser 5' });
    expect(f[2]!.ok).toBe(true);
  });

  it('los números de fila son los de la planilla pegada', () => {
    const f = analizar('numero\tsexo\tnacimiento\testado\tmadre\n\n1\tH\t\tseca\t\n\n2\tx\t\tseca\t');
    expect(f.map((x) => x.fila)).toEqual([3, 5]);
  });
});

describe('analizarPlanilla: duplicados (RF-12)', () => {
  it('la segunda fila con el mismo número es error y nombra la primera (también en minúsculas)', () => {
    const f = analizar(texto(['a1', 'H', '', 'seca', ''], ['x', 'H', '', 'seca', ''], ['A1', 'H', '', 'seca', '']));
    expect(f[0]!.ok).toBe(true);
    expect(f[2]).toMatchObject({ ok: false, motivo: 'El número A1 ya aparece en la fila 1' });
  });

  it('número ya activo en el tambo: error', () => {
    const existentes = new Map([['101', { id: 'e1', sexo: 'HEMBRA' as const, fechaNacimiento: null }]]);
    const f = analizar(texto(['101', 'H', '', 'seca', ''], ['102', 'H', '', 'seca', '']), ctx(existentes));
    expect(f[0]).toMatchObject({ ok: false, motivo: 'Ya existe un animal activo con el número 101' });
    expect(f[1]!.ok).toBe(true);
  });

  it('un número que no está en el contexto (por ejemplo, solo de otro tambo) se acepta', () => {
    expect(analizar(texto(['500', 'H', '', 'seca', '']))[0]!.ok).toBe(true);
  });
});

describe('analizarPlanilla: madres (RF-13)', () => {
  const MADRE_EXISTENTE = { id: 'madre-id', sexo: 'HEMBRA' as const, fechaNacimiento: '2018-01-01' };

  it('madre que es un animal activo del tambo: la cría se vincula con ese animal', () => {
    const f = analizar(texto(['201', 'M', '1/1/2026', 'recién nacido', '100']), ctx(new Map([['100', MADRE_EXISTENTE]])));
    expect(f[0]).toMatchObject({ ok: true, vinculo: { tipo: 'existente', id: 'madre-id' } });
  });

  it('madre existente que es macho: error de inexistente', () => {
    const macho = { id: 'm', sexo: 'MACHO' as const, fechaNacimiento: null };
    const f = analizar(texto(['201', 'M', '', 'recién nacido', '100']), ctx(new Map([['100', macho]])));
    expect(f[0]).toMatchObject({ ok: false, motivo: 'No hay una hembra activa con el número 100' });
  });

  it('madre existente con fecha igual o posterior a la de la cría: error', () => {
    const f = analizar(texto(['201', 'H', '1/1/2017', 'vaquillona', '100']), ctx(new Map([['100', MADRE_EXISTENTE]])));
    expect(f[0]).toMatchObject({ ok: false, motivo: 'La fecha de nacimiento tiene que ser posterior a la de la madre' });
  });

  it('madre en la planilla, aunque aparezca en una fila posterior', () => {
    const f = analizar(texto(['201', 'M', '', 'recién nacido', '100'], ['100', 'H', '', 'seca', '']));
    expect(f.map((x) => x.ok)).toEqual([true, true]);
    expect(f[0]!.vinculo).toEqual({ tipo: 'fila', fila: 2 });
  });

  it('madre en la planilla que es macho: error', () => {
    const f = analizar(texto(['201', 'M', '', 'recién nacido', '100'], ['100', 'M', '', 'recién nacido', '']));
    expect(f[0]).toMatchObject({ ok: false, motivo: 'No hay una hembra activa con el número 100' });
    expect(f[1]!.ok).toBe(true);
  });

  it('fechas madre-cría entre filas de la planilla: la madre debe ser anterior', () => {
    const mal = analizar(texto(['201', 'H', '1/1/2020', 'vaquillona', '100'], ['100', 'H', '1/1/2020', 'seca', '']));
    expect(mal[0]).toMatchObject({ ok: false, motivo: 'La fecha de nacimiento tiene que ser posterior a la de la madre' });
    const bien = analizar(texto(['201', 'H', '1/1/2021', 'vaquillona', '100'], ['100', 'H', '1/1/2020', 'seca', '']));
    expect(bien.every((x) => x.ok)).toBe(true);
    // Si una de las dos no tiene fecha no hay nada que comparar.
    const sinFecha = analizar(texto(['201', 'H', '', 'vaquillona', '100'], ['100', 'H', '1/1/2020', 'seca', '']));
    expect(sinFecha.every((x) => x.ok)).toBe(true);
  });

  it('madre en una fila con error: la cría también, y el motivo nombra la fila', () => {
    const f = analizar(texto(['201', 'M', '', 'recién nacido', '100'], ['100', 'vaca', '', 'seca', '']));
    expect(f[0]).toMatchObject({ ok: false, motivo: 'La madre (fila 2) tiene error' });
  });

  it('el error se propaga por toda la cadena de crías', () => {
    const f = analizar(texto(['3', 'M', '', 'recién nacido', '2'], ['2', 'H', '', 'vaquillona', '1'], ['1', 'x', '', 'seca', '']));
    expect(f[0]!.motivo).toBe('La madre (fila 2) tiene error');
    expect(f[1]!.motivo).toBe('La madre (fila 3) tiene error');
  });

  it('madre que es la misma fila: error', () => {
    const f = analizar(texto(['100', 'H', '', 'seca', '100']));
    expect(f[0]!.ok).toBe(false);
    expect(f[0]!.motivo).toMatch(/propia madre/);
  });

  it('ciclo de dos filas: las dos tienen error', () => {
    const f = analizar(texto(['1', 'H', '', 'seca', '2'], ['2', 'H', '', 'seca', '1'], ['3', 'H', '', 'seca', '']));
    expect(f[0]!.ok).toBe(false);
    expect(f[1]!.ok).toBe(false);
    expect(f[0]!.motivo).toMatch(/ciclo/);
    expect(f[2]!.ok).toBe(true);
  });

  it('ciclo de tres filas: las tres tienen error, y una cría que cuelga del ciclo también', () => {
    const f = analizar(
      texto(
        ['1', 'H', '', 'seca', '3'],
        ['2', 'H', '', 'seca', '1'],
        ['3', 'H', '', 'seca', '2'],
        ['4', 'M', '', 'recién nacido', '1'],
      ),
    );
    expect(f.slice(0, 3).every((x) => !x.ok && /ciclo/.test(x.motivo!))).toBe(true);
    expect(f[3]).toMatchObject({ ok: false, motivo: 'La madre (fila 1) tiene error' });
  });

  it('madre que no existe en el tambo ni en la planilla: error', () => {
    const f = analizar(texto(['201', 'M', '', 'recién nacido', '999']));
    expect(f[0]).toMatchObject({ ok: false, motivo: 'No hay una hembra activa con el número 999' });
  });

  it('madre con formato de número inválido: mismo mensaje de inexistente', () => {
    const f = analizar(texto(['201', 'M', '', 'recién nacido', 'ñ 1']));
    expect(f[0]!.ok).toBe(false);
    expect(f[0]!.motivo).toMatch(/No hay una hembra activa/);
  });

  it('madre del tambo que además es una fila: la fila es duplicado y la cría se vincula con la existente', () => {
    const f = analizar(
      texto(['100', 'H', '', 'seca', ''], ['201', 'M', '', 'recién nacido', '100']),
      ctx(new Map([['100', MADRE_EXISTENTE]])),
    );
    expect(f[0]).toMatchObject({ ok: false, motivo: 'Ya existe un animal activo con el número 100' });
    expect(f[1]).toMatchObject({ ok: true, vinculo: { tipo: 'existente', id: 'madre-id' } });
  });

  it('madre repetida como fila dos veces: la cría se vincula con la primera fila', () => {
    const f = analizar(texto(['100', 'H', '', 'seca', ''], ['100', 'H', '', 'seca', ''], ['201', 'M', '', 'recién nacido', '100']));
    expect(f[1]!.ok).toBe(false);
    expect(f[2]).toMatchObject({ ok: true, vinculo: { tipo: 'fila', fila: 1 } });
  });
});

describe('sinLotePorEstado (RF-19)', () => {
  it('cuenta solo las filas correctas cuyo estado no tiene lote destino', () => {
    const f = analizar(
      texto(
        ['1', 'H', '', 'seca', ''],
        ['2', 'H', '', 'seca', ''],
        ['3', 'H', '', 'vaquillona', ''],
        ['4', 'H', '', 'en ordeñe', ''],
        ['5', 'x', '', 'seca', ''],
      ),
    );
    const reglas = new Map([['EN_ORDENE', 'lote-1']]);
    expect(sinLotePorEstado(f, reglas)).toEqual([
      { estado: 'VAQUILLONA', cantidad: 1 },
      { estado: 'SECA', cantidad: 2 },
    ]);
  });
});
