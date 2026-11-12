import { prisma } from '../db.js';
import { compararNumeros } from '../animales/orden.js';
import { motivoATexto } from '../bajas/validacion.js';
import { decimasALitros, redondearDecimas } from '../produccion/formato.js';
import { topeInforme } from '../topes.js';

// Informe de litros de leche (spec 008, RF-17 a RF-25, RF-37).
//
// A diferencia de los informes de la spec 007, ACÁ las cuentas las hace la base con GROUP BY:
// un tambo grande acumula cientos de miles de registros en 5 años y traerlos todos a Node para
// sumarlos sería lento. La base devuelve una fila por lote, por vaca (miles) o por día (<= 1.827).
// El armado final (orden, redondeo, enlaces) sigue en TypeScript con funciones puras.
//
// Seguridad: el establecimientoId y las fechas viajan como PARÁMETROS de la consulta ($1, $2...),
// nunca pegados al texto del SQL. Los litros se suman como enteros (décimas) y se pasan a texto en
// SQL para no perder bits; así 0,1 + 0,2 da exactamente 0,3 (RF-37).

const aNumero = (texto: string) => Number(texto);
const promedio = (sumaDecimas: number, base: number) => {
  const d = redondearDecimas(sumaDecimas, base);
  return d === null ? null : decimasALitros(d); // null = "—" (sin base de cálculo)
};

type FilaResumen = { suma: string; ordenos: string; vacas: string; vacaDias: string };
type FilaLote = { loteId: string | null; suma: string; vacas: string; vacaDias: string };
type FilaNombreLote = { loteId: string | null; nombre: string | null };
type FilaVaca = { id: string; numero: string; estado: string; motivoBaja: 'VENTA' | 'MUERTE' | 'PARTO_ANULADO' | null; suma: string; dias: string };
type FilaDia = { fecha: string; suma: string; manana: string; tarde: string; vacas: string };

const collator = new Intl.Collator('es', { numeric: true });

export async function informeLeche(establecimientoId: string, desde: string, hasta: string) {
  // Las cinco consultas van en UNA transacción de lectura consistente (RepeatableRead): ven la
  // misma "foto" de la base aunque alguien anule un registro mientras se calcula el informe.
  const { resumen, lotes, nombresLote, vacas, dias } = await prisma.$transaction(
    async (tx) => {
      // Todas leen solo registros NO anulados del tambo de la sesión y con fecha en el período.
      // 1) Resumen: suma, ordeños, vacas distintas y vaca-días (una vaca con registro en un día).
      const resumen = await tx.$queryRaw<FilaResumen[]>`
        SELECT COALESCE(SUM("litrosDecimas"), 0)::text AS suma,
               COUNT(*)::text AS ordenos,
               COUNT(DISTINCT "animalId")::text AS vacas,
               (SELECT COUNT(*) FROM (SELECT 1 FROM producciones
                  WHERE "establecimientoId" = ${establecimientoId}::uuid AND "anuladoEn" IS NULL
                    AND fecha BETWEEN ${desde}::date AND ${hasta}::date
                  GROUP BY "animalId", fecha) vd)::text AS "vacaDias"
        FROM producciones
        WHERE "establecimientoId" = ${establecimientoId}::uuid AND "anuladoEn" IS NULL
          AND fecha BETWEEN ${desde}::date AND ${hasta}::date`;

      // 2) Por lote (el del registro, nulo = "Sin lote"). Primero se junta por (lote, vaca, día)
      // para contar vaca-días; después se suma por lote.
      const lotes = await tx.$queryRaw<FilaLote[]>`
        SELECT "loteId", SUM(litros)::text AS suma, COUNT(DISTINCT "animalId")::text AS vacas, COUNT(*)::text AS "vacaDias"
        FROM (SELECT "loteId", "animalId", fecha, SUM("litrosDecimas") AS litros
              FROM producciones
              WHERE "establecimientoId" = ${establecimientoId}::uuid AND "anuladoEn" IS NULL
                AND fecha BETWEEN ${desde}::date AND ${hasta}::date
              GROUP BY "loteId", "animalId", fecha) vd
        GROUP BY "loteId"`;

      // 3) Nombre de cada lote: el del registro más reciente del grupo (un lote renombrado no se
      // parte en dos filas, y un lote eliminado conserva el nombre copiado en el registro).
      const nombresLote = await tx.$queryRaw<FilaNombreLote[]>`
        SELECT DISTINCT ON ("loteId") "loteId", "loteNombre" AS nombre
        FROM producciones
        WHERE "establecimientoId" = ${establecimientoId}::uuid AND "anuladoEn" IS NULL
          AND fecha BETWEEN ${desde}::date AND ${hasta}::date
        ORDER BY "loteId", fecha DESC, "creadoEn" DESC`;

      // 4) Por vaca: una fila por vaca con registros, con su número, estado y motivo de baja.
      const vacas = await tx.$queryRaw<FilaVaca[]>`
        SELECT a.id, a.numero, a.estado::text AS estado, a."motivoBaja"::text AS "motivoBaja",
               SUM(p."litrosDecimas")::text AS suma, COUNT(DISTINCT p.fecha)::text AS dias
        FROM producciones p
        JOIN animales a ON a.id = p."animalId" AND a."establecimientoId" = p."establecimientoId"
        WHERE p."establecimientoId" = ${establecimientoId}::uuid AND p."anuladoEn" IS NULL
          AND p.fecha BETWEEN ${desde}::date AND ${hasta}::date
        GROUP BY a.id, a.numero, a.estado, a."motivoBaja"`;

      // 5) Por día: litros del día, de cada turno y vacas distintas ordeñadas. Del más reciente al más antiguo.
      const dias = await tx.$queryRaw<FilaDia[]>`
        SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha,
               SUM("litrosDecimas")::text AS suma,
               COALESCE(SUM("litrosDecimas") FILTER (WHERE turno = 'MANANA'), 0)::text AS manana,
               COALESCE(SUM("litrosDecimas") FILTER (WHERE turno = 'TARDE'), 0)::text AS tarde,
               COUNT(DISTINCT "animalId")::text AS vacas
        FROM producciones
        WHERE "establecimientoId" = ${establecimientoId}::uuid AND "anuladoEn" IS NULL
          AND fecha BETWEEN ${desde}::date AND ${hasta}::date
        GROUP BY fecha
        ORDER BY fecha DESC`;

      return { resumen: resumen[0]!, lotes, nombresLote, vacas, dias };
    },
    { isolationLevel: 'RepeatableRead' },
  );

  const suma = aNumero(resumen.suma);
  const ordenos = aNumero(resumen.ordenos);
  const vacaDias = aNumero(resumen.vacaDias);

  // Por lote: litros de mayor a menor y, a igual cantidad, por nombre.
  const nombrePorLote = new Map(nombresLote.map((n) => [n.loteId, n.nombre]));
  const porLote = lotes
    .map((l) => {
      const litros = aNumero(l.suma);
      const dias = aNumero(l.vacaDias);
      return {
        loteId: l.loteId,
        nombre: nombrePorLote.get(l.loteId) ?? null, // null = "Sin lote"
        litrosDecimas: litros,
        vacas: aNumero(l.vacas),
        vacaDias: dias,
      };
    })
    .sort((a, b) => b.litrosDecimas - a.litrosDecimas || collator.compare(a.nombre ?? 'Sin lote', b.nombre ?? 'Sin lote'))
    .map((l) => ({
      loteId: l.loteId,
      nombre: l.nombre,
      litros: decimasALitros(l.litrosDecimas),
      vacas: l.vacas,
      vacaDias: l.vacaDias,
      promedioPorVacaDia: promedio(l.litrosDecimas, l.vacaDias),
    }));

  // Por vaca: orden por promedio EXACTO (suma/dias) de mayor a menor. Se compara en cruz con enteros
  // (suma_a × dias_b contra suma_b × dias_a), sin redondear; si empatan, por número en orden natural.
  const todasVacas = vacas.map((v) => ({ ...v, sumaN: aNumero(v.suma), diasN: aNumero(v.dias) }));
  todasVacas.sort((a, b) => b.sumaN * a.diasN - a.sumaN * b.diasN || compararNumeros(a.numero, b.numero));
  const tope = topeInforme();
  const porVaca = todasVacas.slice(0, tope).map((v) => ({
    animal: {
      id: v.id,
      numero: v.numero,
      activo: v.estado !== 'BAJA',
      motivoBaja: v.estado === 'BAJA' ? motivoATexto(v.motivoBaja ?? 'PARTO_ANULADO') : null,
    },
    litros: decimasALitros(v.sumaN),
    dias: v.diasN,
    promedioPorVacaDia: promedio(v.sumaN, v.diasN),
  }));

  return {
    periodo: { desde, hasta },
    resumen: {
      totalLitros: decimasALitros(suma),
      ordenos,
      vacas: aNumero(resumen.vacas),
      vacaDias,
      promedioPorVacaDia: promedio(suma, vacaDias), // null = "—"
      promedioPorOrdeno: promedio(suma, ordenos),
    },
    porLote,
    porVaca,
    totalVacas: todasVacas.length,
    truncado: todasVacas.length > tope,
    tope,
    porDia: dias.map((d) => ({
      fecha: d.fecha,
      litros: decimasALitros(aNumero(d.suma)),
      vacas: aNumero(d.vacas),
      litrosManana: decimasALitros(aNumero(d.manana)),
      litrosTarde: decimasALitros(aNumero(d.tarde)),
    })),
  };
}
