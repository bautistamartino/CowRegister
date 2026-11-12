import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';

// Spec 007 (T2): la migración "informes_indice_eventos" crea un índice para leer los eventos de todo
// el tambo por tipo y fecha. Se comprueba directo en PostgreSQL, sin pasar por la API.

afterAll(() => prisma.$disconnect());

describe('índice de eventos para los informes', () => {
  it('existe un índice (establecimientoId, tipo, fecha) en eventos', async () => {
    const filas = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'eventos' AND indexname = 'eventos_establecimientoId_tipo_fecha_idx'`;
    expect(filas).toHaveLength(1);
    // PostgreSQL devuelve la definición normalizada: solo importan las tres columnas y su orden.
    expect(filas[0]!.indexdef).toMatch(/\("establecimientoId", tipo, fecha\)/);
  });

  it('el índice por animal y fecha de la lectura del historial sigue estando', async () => {
    const filas = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'eventos' AND indexdef LIKE '%("animalId", fecha, "creadoEn")%'`;
    expect(filas).toHaveLength(1);
  });
});
