import type { Prisma, TurnoOrdeno } from '../generated/prisma/client.js';
import type { FilaCambio } from '../historial/historial.js';
import type { FilaRegistro } from '../produccion/leer.js';

// Lecturas MASIVAS por tambo para la copia local (spec 009). Armar la copia de 2.000 animales con las
// rutas individuales serían miles de consultas; acá se hace una consulta por tipo de dato con
// funciones de ventana (`row_number() OVER (PARTITION BY animal ...)`): "los N más nuevos de cada animal".
//
// Son consultas a mano (SQL crudo), así que la prueba de paridad (`copia-local-paridad.test.ts`) las
// compara contra las rutas individuales. Reglas para no tener sorpresas con los tipos:
// - los ids, fechas y enums se castean a texto en SQL (`::text`) y los contadores a `int`;
// - los momentos (`timestamp`) se piden como texto ISO con `to_char` y se convierten acá con `new Date`
//   (la base guarda en UTC, que es lo que escribe Prisma).
// Todo se filtra por `establecimientoId` y solo mira animales ACTIVOS.

type Tx = Prisma.TransactionClient;

// "2026-11-12T10:20:30.123Z": el formato de `to_char` que equivale a `Date.toISOString()`.
const ISO_UTC = `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"`;

// ─── Cambios manuales (historial de la spec 005) ────────────────────────────────────────────

type FilaCruda<T> = T & { animalId: string };

/**
 * Los `tope` cambios manuales MÁS NUEVOS de cada animal activo y el total de cambios de cada uno.
 * Mismo orden que la ficha individual: momento descendente, luego dato (campo) y luego id.
 */
export async function leerCambiosDeTambo(tx: Tx, establecimientoId: string, tope: number) {
  const filas = await tx.$queryRawUnsafe<
    FilaCruda<{ id: string; campo: string; valorAnterior: string | null; valorNuevo: string | null; usuarioNombre: string; creadoEn: string; total: number }>[]
  >(
    `SELECT x."animalId"::text AS "animalId", x."id"::text AS "id", x."campo"::text AS "campo",
            x."valorAnterior", x."valorNuevo", x."usuarioNombre",
            to_char(x."creadoEn", '${ISO_UTC}') AS "creadoEn", x."total"::int AS "total"
     FROM (
       SELECT c.*,
              row_number() OVER (PARTITION BY c."animalId" ORDER BY c."creadoEn" DESC, c."campo" ASC, c."id" ASC) AS "rn",
              count(*) OVER (PARTITION BY c."animalId") AS "total"
       FROM "cambios_animal" c
       JOIN "animales" a ON a."id" = c."animalId"
       WHERE c."establecimientoId" = $1::uuid AND a."estado" <> 'BAJA'
     ) x
     WHERE x."rn" <= $2::int
     ORDER BY x."animalId", x."rn"`,
    establecimientoId,
    tope,
  );

  const cambios = new Map<string, FilaCambio[]>();
  const totales = new Map<string, number>();
  for (const f of filas) {
    const lista = cambios.get(f.animalId) ?? [];
    lista.push({
      id: f.id,
      campo: f.campo,
      valorAnterior: f.valorAnterior,
      valorNuevo: f.valorNuevo,
      usuarioNombre: f.usuarioNombre,
      creadoEn: new Date(f.creadoEn),
    });
    cambios.set(f.animalId, lista);
    totales.set(f.animalId, f.total);
  }
  return { cambios, totales };
}

// ─── Producción (spec 008) ──────────────────────────────────────────────────────────────────

export type ProduccionDeAnimal = {
  filas: FilaRegistro[]; // los `tope` más recientes (anulados incluidos)
  total: number;
  sumaDecimas: number; // litros de los últimos 30 días, no anulados
  dias: number; // días distintos con registro en esa ventana
  ultimo: { fecha: Date; turno: TurnoOrdeno; litrosDecimas: number } | null;
};

const aFecha = (texto: string) => new Date(`${texto}T00:00:00.000Z`);

/**
 * Producción de todos los animales activos del tambo: los `tope` registros más recientes de cada uno
 * (fecha y turno descendentes, y a igual ordeño el más reciente cargado), el total, la suma y los
 * días distintos de la ventana `[desde30, hoy]` y el último registro no anulado.
 */
export async function leerProduccionDeTambo(
  tx: Tx,
  establecimientoId: string,
  tope: number,
  desde30: string,
  hoy: string,
): Promise<Map<string, ProduccionDeAnimal>> {
  const registros = await tx.$queryRawUnsafe<
    FilaCruda<{
      id: string;
      fecha: string;
      turno: TurnoOrdeno;
      litrosDecimas: number;
      loteNombre: string | null;
      creadoEn: string;
      registradoPor: string;
      anuladoEn: string | null;
      motivoAnulacion: string | null;
      anuladoPor: string | null;
      total: number;
    }>[]
  >(
    `SELECT x."animalId"::text AS "animalId", x."id"::text AS "id", x."fecha"::text AS "fecha", x."turno"::text AS "turno",
            x."litrosDecimas", x."loteNombre", to_char(x."creadoEn", '${ISO_UTC}') AS "creadoEn",
            ur."nombre" AS "registradoPor",
            to_char(x."anuladoEn", '${ISO_UTC}') AS "anuladoEn", x."motivoAnulacion", ua."nombre" AS "anuladoPor",
            x."total"::int AS "total"
     FROM (
       SELECT p.*,
              row_number() OVER (PARTITION BY p."animalId" ORDER BY p."fecha" DESC, p."turno" DESC, p."creadoEn" DESC) AS "rn",
              count(*) OVER (PARTITION BY p."animalId") AS "total"
       FROM "producciones" p
       JOIN "animales" a ON a."id" = p."animalId"
       WHERE p."establecimientoId" = $1::uuid AND a."estado" <> 'BAJA'
     ) x
     JOIN "usuarios" ur ON ur."id" = x."registradoPorId"
     LEFT JOIN "usuarios" ua ON ua."id" = x."anuladoPorId"
     WHERE x."rn" <= $2::int
     ORDER BY x."animalId", x."rn"`,
    establecimientoId,
    tope,
  );

  // Promedio de 30 días: suma de décimas y días distintos con registro (no anulados).
  const ventana = await tx.$queryRawUnsafe<FilaCruda<{ suma: number; dias: number }>[]>(
    `SELECT "animalId"::text AS "animalId", COALESCE(SUM("litrosDecimas"), 0)::int AS "suma", COUNT(DISTINCT "fecha")::int AS "dias"
     FROM "producciones"
     WHERE "establecimientoId" = $1::uuid AND "anuladoEn" IS NULL AND "fecha" >= $2::date AND "fecha" <= $3::date
     GROUP BY "animalId"`,
    establecimientoId,
    desde30,
    hoy,
  );

  // Último registro no anulado de cada animal (el primero según el mismo orden de la ficha).
  const ultimos = await tx.$queryRawUnsafe<FilaCruda<{ fecha: string; turno: TurnoOrdeno; litrosDecimas: number }>[]>(
    `SELECT DISTINCT ON ("animalId") "animalId"::text AS "animalId", "fecha"::text AS "fecha", "turno"::text AS "turno", "litrosDecimas"
     FROM "producciones"
     WHERE "establecimientoId" = $1::uuid AND "anuladoEn" IS NULL
     ORDER BY "animalId", "fecha" DESC, "turno" DESC, "creadoEn" DESC`,
    establecimientoId,
  );

  const porAnimal = new Map<string, ProduccionDeAnimal>();
  const de = (animalId: string) => {
    let p = porAnimal.get(animalId);
    if (!p) {
      p = { filas: [], total: 0, sumaDecimas: 0, dias: 0, ultimo: null };
      porAnimal.set(animalId, p);
    }
    return p;
  };
  for (const r of registros) {
    const p = de(r.animalId);
    p.total = r.total;
    p.filas.push({
      id: r.id,
      animalId: r.animalId,
      fecha: aFecha(r.fecha),
      turno: r.turno,
      litrosDecimas: r.litrosDecimas,
      loteNombre: r.loteNombre,
      creadoEn: new Date(r.creadoEn),
      registradoPor: { nombre: r.registradoPor },
      anuladoEn: r.anuladoEn ? new Date(r.anuladoEn) : null,
      motivoAnulacion: r.motivoAnulacion,
      anuladoPor: r.anuladoPor === null ? null : { nombre: r.anuladoPor },
    });
  }
  for (const v of ventana) {
    const p = de(v.animalId);
    p.sumaDecimas = v.suma;
    p.dias = v.dias;
  }
  for (const u of ultimos) {
    de(u.animalId).ultimo = { fecha: aFecha(u.fecha), turno: u.turno, litrosDecimas: u.litrosDecimas };
  }
  return porAnimal;
}
