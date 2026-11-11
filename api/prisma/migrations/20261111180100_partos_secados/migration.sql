-- Spec 004 (partos y secados), paso 2 de 2. Estructura generada con prisma migrate diff,
-- más el bloque manual del final (lo que Prisma no puede expresar).
-- Requiere la migración anterior (partos_tipos_evento), que agrega PARTO y SECADO al enum.

-- CreateEnum
CREATE TYPE "MotivoBaja" AS ENUM ('PARTO_ANULADO');

-- AlterTable
ALTER TABLE "animales" ADD COLUMN     "motivoBaja" "MotivoBaja";

-- CreateTable
CREATE TABLE "partos" (
    "eventoId" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "tipo" "TipoEvento" NOT NULL DEFAULT 'PARTO',
    "madreId" UUID NOT NULL,
    "estadoAnterior" "EstadoAnimal" NOT NULL,
    "tuvoLoteAnterior" BOOLEAN NOT NULL DEFAULT false,
    "loteAnteriorId" UUID,
    "servicioId" UUID,
    "servicioTipo" "TipoEvento",

    CONSTRAINT "partos_pkey" PRIMARY KEY ("eventoId")
);

-- CreateTable
CREATE TABLE "secados" (
    "eventoId" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "tipo" "TipoEvento" NOT NULL DEFAULT 'SECADO',
    "estadoAnterior" "EstadoAnimal" NOT NULL,
    "tuvoLoteAnterior" BOOLEAN NOT NULL DEFAULT false,
    "loteAnteriorId" UUID,

    CONSTRAINT "secados_pkey" PRIMARY KEY ("eventoId")
);

-- CreateTable
CREATE TABLE "crias_parto" (
    "id" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "eventoId" UUID NOT NULL,
    "madreId" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "sexo" "Sexo" NOT NULL,
    "nacidaMuerta" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "animalId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crias_parto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partos_loteAnteriorId_idx" ON "partos"("loteAnteriorId");

-- CreateIndex
CREATE INDEX "partos_servicioId_idx" ON "partos"("servicioId");

-- CreateIndex
CREATE UNIQUE INDEX "partos_establecimientoId_eventoId_tipo_madreId_key" ON "partos"("establecimientoId", "eventoId", "tipo", "madreId");

-- CreateIndex
CREATE UNIQUE INDEX "partos_establecimientoId_eventoId_madreId_key" ON "partos"("establecimientoId", "eventoId", "madreId");

-- CreateIndex
CREATE INDEX "secados_loteAnteriorId_idx" ON "secados"("loteAnteriorId");

-- CreateIndex
CREATE UNIQUE INDEX "secados_establecimientoId_eventoId_tipo_key" ON "secados"("establecimientoId", "eventoId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "crias_parto_eventoId_orden_key" ON "crias_parto"("eventoId", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "crias_parto_animalId_key" ON "crias_parto"("animalId");

-- CreateIndex
CREATE UNIQUE INDEX "crias_parto_establecimientoId_animalId_madreId_key" ON "crias_parto"("establecimientoId", "animalId", "madreId");

-- CreateIndex
CREATE UNIQUE INDEX "animales_establecimientoId_id_madreId_key" ON "animales"("establecimientoId", "id", "madreId");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_establecimientoId_id_tipo_animalId_key" ON "eventos"("establecimientoId", "id", "tipo", "animalId");

-- AddForeignKey
ALTER TABLE "partos" ADD CONSTRAINT "partos_establecimientoId_eventoId_tipo_madreId_fkey" FOREIGN KEY ("establecimientoId", "eventoId", "tipo", "madreId") REFERENCES "eventos"("establecimientoId", "id", "tipo", "animalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partos" ADD CONSTRAINT "partos_establecimientoId_servicioId_servicioTipo_madreId_fkey" FOREIGN KEY ("establecimientoId", "servicioId", "servicioTipo", "madreId") REFERENCES "eventos"("establecimientoId", "id", "tipo", "animalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secados" ADD CONSTRAINT "secados_establecimientoId_eventoId_tipo_fkey" FOREIGN KEY ("establecimientoId", "eventoId", "tipo") REFERENCES "eventos"("establecimientoId", "id", "tipo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crias_parto" ADD CONSTRAINT "crias_parto_establecimientoId_eventoId_madreId_fkey" FOREIGN KEY ("establecimientoId", "eventoId", "madreId") REFERENCES "partos"("establecimientoId", "eventoId", "madreId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crias_parto" ADD CONSTRAINT "crias_parto_establecimientoId_animalId_madreId_fkey" FOREIGN KEY ("establecimientoId", "animalId", "madreId") REFERENCES "animales"("establecimientoId", "id", "madreId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══ SQL ESCRITO A MANO (Prisma no lo modela) ═══════════════════════════════════════════

-- Animal de baja sin lote (RF-34). PRIMERO se desasignan las bajas que ya existieran (hoy no
-- hay ninguna, pero la regla tiene que valer también para datos previos) y DESPUÉS se agrega
-- el CHECK; en el orden inverso la migración fallaría con datos viejos.
UPDATE "animales" SET "loteId" = NULL WHERE "estado" = 'BAJA' AND "loteId" IS NOT NULL;

ALTER TABLE "animales" ADD CONSTRAINT "animales_baja_sin_lote"
  CHECK ("estado" <> 'BAJA' OR "loteId" IS NULL);

-- El motivo de baja solo existe en una baja (no se exige en las bajas viejas).
ALTER TABLE "animales" ADD CONSTRAINT "animales_motivo_baja_coherente"
  CHECK ("motivoBaja" IS NULL OR "estado" = 'BAJA');

-- Lote previo de partos y secados (RF-36.5 y RF-37). Clave foránea compuesta
-- (establecimientoId, loteAnteriorId): el lote previo es del mismo tambo. Con loteAnteriorId
-- nulo no se controla (MATCH SIMPLE). Al ELIMINAR el lote, ON DELETE SET NULL ("loteAnteriorId")
-- (PostgreSQL 15 o superior) anula SOLO esa columna: nunca toca establecimientoId, que es
-- obligatoria. tuvoLoteAnterior sigue en true y distingue "lote previo eliminado" de "sin lote".
ALTER TABLE "partos" ADD CONSTRAINT "partos_loteAnterior_fkey"
  FOREIGN KEY ("establecimientoId", "loteAnteriorId") REFERENCES "lotes" ("establecimientoId", "id")
  ON DELETE SET NULL ("loteAnteriorId");

ALTER TABLE "secados" ADD CONSTRAINT "secados_loteAnterior_fkey"
  FOREIGN KEY ("establecimientoId", "loteAnteriorId") REFERENCES "lotes" ("establecimientoId", "id")
  ON DELETE SET NULL ("loteAnteriorId");

-- partos: tipo constante, estados previos posibles, lote previo coherente con su indicador
-- y servicio de genética con su tipo (ambos nulos o ambos completos, y de tipo SERVICIO).
ALTER TABLE "partos" ADD CONSTRAINT "partos_tipo" CHECK ("tipo" = 'PARTO');
ALTER TABLE "partos" ADD CONSTRAINT "partos_estado_anterior"
  CHECK ("estadoAnterior" IN ('VAQUILLONA', 'EN_ORDENE', 'SECA'));
ALTER TABLE "partos" ADD CONSTRAINT "partos_lote_anterior_coherente"
  CHECK ("loteAnteriorId" IS NULL OR "tuvoLoteAnterior");
ALTER TABLE "partos" ADD CONSTRAINT "partos_servicio_coherente"
  CHECK (("servicioId" IS NULL) = ("servicioTipo" IS NULL) AND ("servicioTipo" IS NULL OR "servicioTipo" = 'SERVICIO'));

-- secados: tipo constante, solo se seca una vaca en ordeñe y lote previo coherente.
ALTER TABLE "secados" ADD CONSTRAINT "secados_tipo" CHECK ("tipo" = 'SECADO');
ALTER TABLE "secados" ADD CONSTRAINT "secados_estado_anterior" CHECK ("estadoAnterior" = 'EN_ORDENE');
ALTER TABLE "secados" ADD CONSTRAINT "secados_lote_anterior_coherente"
  CHECK ("loteAnteriorId" IS NULL OR "tuvoLoteAnterior");

-- crias_parto: orden 1 o 2; viva con animal o muerta sin animal (nunca otra combinación);
-- observaciones de 1 a 200 caracteres, así "sin observaciones" siempre es NULL.
ALTER TABLE "crias_parto" ADD CONSTRAINT "crias_orden" CHECK ("orden" IN (1, 2));
ALTER TABLE "crias_parto" ADD CONSTRAINT "crias_viva_o_muerta"
  CHECK (("nacidaMuerta" AND "animalId" IS NULL) OR (NOT "nacidaMuerta" AND "animalId" IS NOT NULL));
ALTER TABLE "crias_parto" ADD CONSTRAINT "crias_observaciones_largo"
  CHECK ("observaciones" IS NULL OR char_length("observaciones") BETWEEN 1 AND 200);
