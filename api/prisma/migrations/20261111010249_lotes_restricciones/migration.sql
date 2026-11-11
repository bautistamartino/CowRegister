-- DropForeignKey
ALTER TABLE "reglas_lote" DROP CONSTRAINT "reglas_lote_loteId_fkey";

-- DropIndex
DROP INDEX "lotes_establecimientoId_nombre_key";

-- CreateIndex
CREATE UNIQUE INDEX "lotes_establecimientoId_id_key" ON "lotes"("establecimientoId", "id");

-- AddForeignKey
ALTER TABLE "reglas_lote" ADD CONSTRAINT "reglas_lote_establecimientoId_loteId_fkey" FOREIGN KEY ("establecimientoId", "loteId") REFERENCES "lotes"("establecimientoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Agregado a mano (Prisma no puede expresarlo en schema.prisma) ───

-- Si ya hubiera lotes con el mismo nombre salvo mayúsculas en un tambo,
-- se frena la migración y se informa (no se borra ni renombra nada).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM lotes GROUP BY "establecimientoId", lower(nombre) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Hay lotes con nombres repetidos (sin distinguir mayúsculas) en un mismo tambo: corregilos antes de migrar';
  END IF;
END $$;

-- Nombre de lote único por tambo SIN distinguir mayúsculas: "Secas" y
-- "secas" no pueden convivir en el mismo tambo (RF-6). Reemplaza al
-- @@unique([establecimientoId, nombre]) que se quitó arriba. Prisma no
-- expresa índices sobre lower(), por eso va acá.
CREATE UNIQUE INDEX "lotes_nombre_unico_sin_mayusculas" ON "lotes" ("establecimientoId", lower("nombre"));

-- El estado BAJA nunca tiene lote destino (RF-16).
ALTER TABLE "reglas_lote" ADD CONSTRAINT "reglas_lote_sin_baja" CHECK ("estado" <> 'BAJA');
