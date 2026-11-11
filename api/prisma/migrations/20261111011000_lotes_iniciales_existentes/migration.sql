-- Migración SOLO DE DATOS (RF-19): no cambia la estructura ni schema.prisma.
--
-- Completa los destinos de los tambos que ya estaban registrados antes de
-- que existieran los lotes iniciales. Prisma corre cada migración una única
-- vez (queda anotada en la tabla _prisma_migrations), así que si después un
-- tambo elimina un lote o quita un destino, esto no lo vuelve a crear.
--
-- Para cada tambo y cada estado con destino:
--   1. Si el estado ya tiene regla (destino), no se toca y no se crea su lote.
--   2. Si no tiene, se busca un lote del tambo cuyo nombre normalizado
--      coincida con el nombre inicial sin distinguir mayúsculas
--      ("  terneros" sirve para "Terneros"). Si no hay, se crea.
--   3. Se crea la regla estado → lote.
--
-- El bloque va entre los marcadores INICIO/FIN porque el test
-- api/tests/lotes-iniciales.test.ts lo lee de este archivo y lo ejecuta:
-- no cambiar los marcadores.

-- INICIO lotes iniciales
DO $$
DECLARE
  tambo   RECORD;
  inicial RECORD;
  lote_id uuid;
BEGIN
  FOR tambo IN SELECT id FROM establecimientos LOOP
    -- Mismos nombres que LOTES_INICIALES en api/src/lotes/iniciales.ts.
    -- Si se cambian allá, esta migración NO cambia (ya se aplicó).
    FOR inicial IN
      SELECT v.estado, v.nombre
      FROM (VALUES
        (1, 'RECIEN_NACIDO'::"EstadoAnimal", 'Terneros'),
        (2, 'VAQUILLONA'::"EstadoAnimal",    'Vaquillonas'),
        (3, 'EN_ORDENE'::"EstadoAnimal",     'En ordeñe'),
        (4, 'SECA'::"EstadoAnimal",          'Secas')
      ) AS v(orden, estado, nombre)
      ORDER BY v.orden
    LOOP
      -- 1. El estado ya tiene destino: se respeta.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM reglas_lote r
        WHERE r."establecimientoId" = tambo.id AND r.estado = inicial.estado
      );

      -- 2. Buscar un lote propio con el mismo nombre normalizado.
      --    regexp_replace convierte cada tramo de espacios o tabulaciones (\s+)
      --    en un solo espacio; después btrim quita el espacio que pueda quedar
      --    en los extremos. Así también se contemplan tabulaciones, que btrim
      --    solo no quitaría. Si hubiera más de uno (por ejemplo "terneros" y
      --    " terneros"), se elige el más antiguo para que el resultado sea fijo.
      --    Si no hay ninguno, SELECT INTO deja lote_id en NULL.
      SELECT l.id INTO lote_id
      FROM lotes l
      WHERE l."establecimientoId" = tambo.id
        AND lower(btrim(regexp_replace(l.nombre, '\s+', ' ', 'g'))) = lower(inicial.nombre)
      ORDER BY l."creadoEn", l.id
      LIMIT 1;

      IF lote_id IS NULL THEN
        -- No choca con el índice único sobre lower(nombre): si existiera un
        -- lote con ese nombre en minúsculas, la búsqueda de arriba lo encontraba.
        INSERT INTO lotes (id, "establecimientoId", nombre, "creadoEn", "actualizadoEn")
        VALUES (uuidv7(), tambo.id, inicial.nombre, now(), now())
        RETURNING id INTO lote_id;
      END IF;

      -- 3. Crear el destino.
      INSERT INTO reglas_lote (id, "establecimientoId", estado, "loteId", "creadoEn", "actualizadoEn")
      VALUES (uuidv7(), tambo.id, inicial.estado, lote_id, now(), now());
    END LOOP;
  END LOOP;
END $$;
-- FIN lotes iniciales
