-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('DUENO', 'ENCARGADO', 'VETERINARIO');

-- CreateEnum
CREATE TYPE "Sexo" AS ENUM ('HEMBRA', 'MACHO');

-- CreateEnum
CREATE TYPE "EstadoAnimal" AS ENUM ('RECIEN_NACIDO', 'VAQUILLONA', 'EN_ORDENE', 'SECA', 'BAJA');

-- CreateTable
CREATE TABLE "establecimientos" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "establecimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes" (
    "id" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reglas_lote" (
    "id" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "estado" "EstadoAnimal" NOT NULL,
    "loteId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reglas_lote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "animales" (
    "id" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "sexo" "Sexo" NOT NULL,
    "estado" "EstadoAnimal" NOT NULL,
    "fechaNacimiento" DATE,
    "madreId" UUID,
    "loteId" UUID,
    "fechaBaja" DATE,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "animales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_establecimientoId_idx" ON "usuarios"("establecimientoId");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_establecimientoId_nombre_key" ON "lotes"("establecimientoId", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "reglas_lote_establecimientoId_estado_key" ON "reglas_lote"("establecimientoId", "estado");

-- CreateIndex
CREATE INDEX "animales_establecimientoId_numero_idx" ON "animales"("establecimientoId", "numero");

-- CreateIndex
CREATE INDEX "animales_loteId_idx" ON "animales"("loteId");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_establecimientoId_fkey" FOREIGN KEY ("establecimientoId") REFERENCES "establecimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_establecimientoId_fkey" FOREIGN KEY ("establecimientoId") REFERENCES "establecimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reglas_lote" ADD CONSTRAINT "reglas_lote_establecimientoId_fkey" FOREIGN KEY ("establecimientoId") REFERENCES "establecimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reglas_lote" ADD CONSTRAINT "reglas_lote_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animales" ADD CONSTRAINT "animales_establecimientoId_fkey" FOREIGN KEY ("establecimientoId") REFERENCES "establecimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animales" ADD CONSTRAINT "animales_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "lotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animales" ADD CONSTRAINT "animales_madreId_fkey" FOREIGN KEY ("madreId") REFERENCES "animales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Agregado a mano (Prisma no puede expresarlo en schema.prisma) ───

-- El número de caravana no se puede repetir entre los animales ACTIVOS
-- de un mismo tambo. Los dados de baja quedan fuera del índice, así un
-- número viejo puede volver a usarse sin perder el historial.
CREATE UNIQUE INDEX "animales_numero_activo_unico"
    ON "animales" ("establecimientoId", "numero")
    WHERE "estado" <> 'BAJA';

-- Un animal está dado de baja si y solo si tiene fecha de baja.
ALTER TABLE "animales" ADD CONSTRAINT "animales_baja_con_fecha"
    CHECK (("estado" = 'BAJA') = ("fechaBaja" IS NOT NULL));
