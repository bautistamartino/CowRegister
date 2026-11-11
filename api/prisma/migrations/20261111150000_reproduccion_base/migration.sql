-- CreateEnum
CREATE TYPE "TipoEvento" AS ENUM ('SERVICIO', 'TACTO');

-- CreateEnum
CREATE TYPE "TipoServicio" AS ENUM ('INSEMINACION', 'MONTA_NATURAL');

-- CreateEnum
CREATE TYPE "ResultadoTacto" AS ENUM ('PRENADA', 'VACIA');

-- CreateTable
CREATE TABLE "semen_toros" (
    "id" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "raza" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semen_toros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos" (
    "id" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "tipo" "TipoEvento" NOT NULL,
    "fecha" DATE NOT NULL,
    "registradoPorId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladoEn" TIMESTAMP(3),
    "anuladoPorId" UUID,
    "motivoAnulacion" TEXT,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios" (
    "eventoId" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "tipo" "TipoEvento" NOT NULL DEFAULT 'SERVICIO',
    "tipoServicio" "TipoServicio" NOT NULL,
    "semenId" UUID,

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("eventoId")
);

-- CreateTable
CREATE TABLE "tactos" (
    "eventoId" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "tipo" "TipoEvento" NOT NULL DEFAULT 'TACTO',
    "resultado" "ResultadoTacto" NOT NULL,
    "fechaProbableIndicada" DATE,
    "anomalias" TEXT,

    CONSTRAINT "tactos_pkey" PRIMARY KEY ("eventoId")
);

-- CreateIndex
CREATE UNIQUE INDEX "semen_toros_establecimientoId_id_key" ON "semen_toros"("establecimientoId", "id");

-- CreateIndex
CREATE INDEX "eventos_animalId_fecha_creadoEn_idx" ON "eventos"("animalId", "fecha", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_establecimientoId_id_tipo_key" ON "eventos"("establecimientoId", "id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_animalId_creadoEn_key" ON "eventos"("animalId", "creadoEn");

-- CreateIndex
CREATE INDEX "servicios_semenId_idx" ON "servicios"("semenId");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_establecimientoId_eventoId_tipo_key" ON "servicios"("establecimientoId", "eventoId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "tactos_establecimientoId_eventoId_tipo_key" ON "tactos"("establecimientoId", "eventoId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_establecimientoId_id_key" ON "usuarios"("establecimientoId", "id");

-- AddForeignKey
ALTER TABLE "semen_toros" ADD CONSTRAINT "semen_toros_establecimientoId_fkey" FOREIGN KEY ("establecimientoId") REFERENCES "establecimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_establecimientoId_fkey" FOREIGN KEY ("establecimientoId") REFERENCES "establecimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_establecimientoId_animalId_fkey" FOREIGN KEY ("establecimientoId", "animalId") REFERENCES "animales"("establecimientoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_establecimientoId_registradoPorId_fkey" FOREIGN KEY ("establecimientoId", "registradoPorId") REFERENCES "usuarios"("establecimientoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_establecimientoId_anuladoPorId_fkey" FOREIGN KEY ("establecimientoId", "anuladoPorId") REFERENCES "usuarios"("establecimientoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_establecimientoId_eventoId_tipo_fkey" FOREIGN KEY ("establecimientoId", "eventoId", "tipo") REFERENCES "eventos"("establecimientoId", "id", "tipo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_establecimientoId_semenId_fkey" FOREIGN KEY ("establecimientoId", "semenId") REFERENCES "semen_toros"("establecimientoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tactos" ADD CONSTRAINT "tactos_establecimientoId_eventoId_tipo_fkey" FOREIGN KEY ("establecimientoId", "eventoId", "tipo") REFERENCES "eventos"("establecimientoId", "id", "tipo") ON DELETE RESTRICT ON UPDATE CASCADE;




-- ─── Agregado a mano (Prisma no puede expresarlo en schema.prisma) ───
-- Tablas nuevas: no hay datos previos que verificar.

-- El nombre del catálogo es único por tambo SIN distinguir mayúsculas, contando también
-- las entradas desactivadas (nunca se borran). Es un índice sobre lower("nombre"), que
-- Prisma no modela. Así tampoco pasan dos altas simultáneas del mismo nombre.
CREATE UNIQUE INDEX "semen_toros_nombre_unico_sin_mayusculas"
    ON "semen_toros" ("establecimientoId", lower("nombre"));

-- El nombre se guarda ya normalizado (sin espacios en los extremos) y de 1 a 50 caracteres.
ALTER TABLE "semen_toros" ADD CONSTRAINT "semen_toros_nombre_valido"
    CHECK ("nombre" = btrim("nombre") AND char_length("nombre") BETWEEN 1 AND 50);

-- La raza es NULL ("sin raza") o un texto de 1 a 50 caracteres sin espacios en los extremos.
ALTER TABLE "semen_toros" ADD CONSTRAINT "semen_toros_raza_valida"
    CHECK ("raza" IS NULL OR ("raza" = btrim("raza") AND char_length("raza") BETWEEN 1 AND 50));

-- Ningún evento puede ser anterior al 01/01/2000.
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_fecha_minima"
    CHECK ("fecha" >= DATE '2000-01-01');

-- La anulación se guarda completa: o no hay ninguna de las tres columnas o están todas.
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_anulacion_completa"
    CHECK (
      ("anuladoEn" IS NULL AND "anuladoPorId" IS NULL AND "motivoAnulacion" IS NULL)
      OR ("anuladoEn" IS NOT NULL AND "anuladoPorId" IS NOT NULL AND "motivoAnulacion" IS NOT NULL)
    );

-- El motivo tiene de 1 a 200 caracteres sin contar los extremos.
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_motivo_valido"
    CHECK ("motivoAnulacion" IS NULL OR char_length(btrim("motivoAnulacion")) BETWEEN 1 AND 200);

-- "tipo" de cada detalle es constante: junto con la clave compuesta (establecimientoId,
-- eventoId, tipo) hacia "eventos", un servicio solo puede colgar de un evento SERVICIO
-- y un tacto solo de un evento TACTO.
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_tipo"
    CHECK ("tipo" = 'SERVICIO');

ALTER TABLE "tactos" ADD CONSTRAINT "tactos_tipo"
    CHECK ("tipo" = 'TACTO');

-- La fecha probable indicada solo existe en un tacto "preñada".
ALTER TABLE "tactos" ADD CONSTRAINT "tactos_fecha_probable_solo_prenada"
    CHECK ("fechaProbableIndicada" IS NULL OR "resultado" = 'PRENADA');

-- Las anomalías son NULL (sin anomalías) o un texto de 1 a 200 caracteres.
ALTER TABLE "tactos" ADD CONSTRAINT "tactos_anomalias_largo"
    CHECK ("anomalias" IS NULL OR char_length("anomalias") BETWEEN 1 AND 200);
