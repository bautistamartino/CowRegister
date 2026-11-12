-- Spec 008 (producción: litros por vaca). Estructura generada con prisma migrate diff (sin los
-- tres DROP de las claves de lote previo de bajas, partos y secados, que ya vienen arrastradas de
-- las specs 004 y 006), más el bloque manual del final (lo que Prisma no puede expresar).

-- CreateEnum
CREATE TYPE "TurnoOrdeno" AS ENUM ('MANANA', 'TARDE');

-- CreateTable
CREATE TABLE "producciones" (
    "id" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "turno" "TurnoOrdeno" NOT NULL,
    "litrosDecimas" INTEGER NOT NULL,
    "loteId" UUID,
    "loteNombre" TEXT,
    "registradoPorId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "anuladoEn" TIMESTAMP(3),
    "anuladoPorId" UUID,
    "motivoAnulacion" TEXT,

    CONSTRAINT "producciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "producciones_establecimientoId_fecha_idx" ON "producciones"("establecimientoId", "fecha");

-- CreateIndex
CREATE INDEX "producciones_animalId_fecha_turno_idx" ON "producciones"("animalId", "fecha", "turno");

-- AddForeignKey
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_establecimientoId_fkey" FOREIGN KEY ("establecimientoId") REFERENCES "establecimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Claves compuestas: la vaca y los usuarios son siempre del mismo tambo que el registro.
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_establecimientoId_animalId_fkey" FOREIGN KEY ("establecimientoId", "animalId") REFERENCES "animales"("establecimientoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_establecimientoId_registradoPorId_fkey" FOREIGN KEY ("establecimientoId", "registradoPorId") REFERENCES "usuarios"("establecimientoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_establecimientoId_anuladoPorId_fkey" FOREIGN KEY ("establecimientoId", "anuladoPorId") REFERENCES "usuarios"("establecimientoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══ SQL ESCRITO A MANO (Prisma no lo modela) ═══════════════════════════════════════════

-- Una sola carga VIGENTE por vaca, fecha y turno (RF-6, RF-28). Es un índice único parcial (y no
-- un conteo en el código) porque con dos transacciones simultáneas ambas pasarían el conteo: el
-- índice las serializa y la segunda falla. Al anular un registro deja de estar en el índice y se
-- puede cargar otro para ese ordeño (RF-11).
CREATE UNIQUE INDEX "producciones_un_vigente_por_ordeno"
  ON "producciones" ("animalId", "fecha", "turno") WHERE "anuladoEn" IS NULL;

-- Litros en décimas: de 0,0 a 99,9 (RF-2).
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_litros_rango"
  CHECK ("litrosDecimas" BETWEEN 0 AND 999);

-- Fecha del ordeño: no anterior al 01/01/2000 (la regla "no futura" depende del reloj y la
-- controla la API).
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_fecha_minima"
  CHECK ("fecha" >= DATE '2000-01-01');

-- Anulación: las tres columnas nulas (vigente) o las tres con valor (anulado).
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_anulacion_completa"
  CHECK (("anuladoEn" IS NULL AND "anuladoPorId" IS NULL AND "motivoAnulacion" IS NULL)
      OR ("anuladoEn" IS NOT NULL AND "anuladoPorId" IS NOT NULL AND "motivoAnulacion" IS NOT NULL));

-- Motivo de la anulación: de 1 a 200 caracteres y ya recortado (sin espacios en los extremos).
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_motivo_largo"
  CHECK ("motivoAnulacion" IS NULL
      OR (char_length("motivoAnulacion") BETWEEN 1 AND 200 AND "motivoAnulacion" = btrim("motivoAnulacion")));

-- Lote copiado: o no hay (nulo, "Sin lote") o hay id Y nombre no vacío. No tiene clave foránea a
-- propósito: el registro conserva el nombre aunque se renombre o elimine el lote.
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_lote_coherente"
  CHECK (("loteId" IS NULL AND "loteNombre" IS NULL)
      OR ("loteId" IS NOT NULL AND "loteNombre" IS NOT NULL AND char_length(btrim("loteNombre")) > 0));

-- Solo se agrega (constitución §3): nunca se borra, y la única modificación posible es pasar de
-- "no anulado" a "anulado" completando las tres columnas de anulación (y actualizadoEn). TRUNCATE
-- no dispara estos triggers, así que limpiarBase() de los tests sigue funcionando.
CREATE FUNCTION "producciones_solo_agregar"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'La producción solo se agrega: no se borra, se anula';
  END IF;
  IF OLD."anuladoEn" IS NOT NULL THEN
    RAISE EXCEPTION 'La producción solo se agrega: un registro anulado no se modifica';
  END IF;
  IF NEW."anuladoEn" IS NULL THEN
    RAISE EXCEPTION 'La producción solo se agrega: no se edita, se anula';
  END IF;
  -- Todo lo demás tiene que quedar igual.
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."establecimientoId" IS DISTINCT FROM OLD."establecimientoId"
     OR NEW."animalId" IS DISTINCT FROM OLD."animalId"
     OR NEW."fecha" IS DISTINCT FROM OLD."fecha"
     OR NEW."turno" IS DISTINCT FROM OLD."turno"
     OR NEW."litrosDecimas" IS DISTINCT FROM OLD."litrosDecimas"
     OR NEW."loteId" IS DISTINCT FROM OLD."loteId"
     OR NEW."loteNombre" IS DISTINCT FROM OLD."loteNombre"
     OR NEW."registradoPorId" IS DISTINCT FROM OLD."registradoPorId"
     OR NEW."creadoEn" IS DISTINCT FROM OLD."creadoEn" THEN
    RAISE EXCEPTION 'La producción solo se agrega: no se edita, se anula';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "producciones_solo_agregar"
  BEFORE UPDATE OR DELETE ON "producciones"
  FOR EACH ROW EXECUTE FUNCTION "producciones_solo_agregar"();
