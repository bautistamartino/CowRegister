-- DropForeignKey
ALTER TABLE "animales" DROP CONSTRAINT "animales_loteId_fkey";

-- DropForeignKey
ALTER TABLE "animales" DROP CONSTRAINT "animales_madreId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "animales_establecimientoId_id_key" ON "animales"("establecimientoId", "id");

-- AddForeignKey
ALTER TABLE "animales" ADD CONSTRAINT "animales_establecimientoId_loteId_fkey" FOREIGN KEY ("establecimientoId", "loteId") REFERENCES "lotes"("establecimientoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animales" ADD CONSTRAINT "animales_establecimientoId_madreId_fkey" FOREIGN KEY ("establecimientoId", "madreId") REFERENCES "animales"("establecimientoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ─── Agregado a mano (Prisma no puede expresarlo en schema.prisma) ───

-- Si ya hubiera animales con un número que no cumple el formato, se frena la
-- migración y se informa (no se modifica nada). Hoy la tabla está vacía.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM animales WHERE numero !~ '^[A-Z0-9.-]{1,20}$') THEN
    RAISE EXCEPTION 'Hay animales con un número que no está normalizado: corregilos antes de migrar';
  END IF;
END $$;

-- El número se guarda normalizado: mayúsculas, solo A-Z, 0-9, guion y punto, de 1 a 20
-- caracteres. Así el índice único entre activos (animales_numero_activo_unico,
-- de la migración inicial) compara siempre el valor normalizado, aunque falle la API.
ALTER TABLE "animales" ADD CONSTRAINT "animales_numero_normalizado"
    CHECK ("numero" ~ '^[A-Z0-9.-]{1,20}$');

-- Un animal no puede ser su propia madre.
ALTER TABLE "animales" ADD CONSTRAINT "animales_madre_distinta"
    CHECK ("madreId" IS NULL OR "madreId" <> "id");
