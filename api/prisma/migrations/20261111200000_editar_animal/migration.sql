-- Spec 005 (editar animal y mover de lote a mano). Estructura generada con prisma migrate diff
-- (sin las dos diferencias conocidas de lote previo de la spec 004, que NO se aplican),
-- más el bloque manual del final (lo que Prisma no puede expresar).

-- CreateEnum
-- El orden de las opciones es el orden fijo de los cambios de un mismo guardado (RF-15).
CREATE TYPE "CampoCambio" AS ENUM ('NUMERO', 'SEXO', 'FECHA_NACIMIENTO', 'MADRE', 'LOTE');

-- CreateTable
CREATE TABLE "cambios_animal" (
    "id" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "animalId" UUID NOT NULL,
    "campo" "CampoCambio" NOT NULL,
    "valorAnterior" TEXT,
    "valorNuevo" TEXT,
    "usuarioId" UUID NOT NULL,
    "usuarioNombre" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cambios_animal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cambios_animal_animalId_creadoEn_idx" ON "cambios_animal"("animalId", "creadoEn");

-- AddForeignKey
-- Clave compuesta: el historial es del tambo de su animal. No hay claves a lote, madre ni
-- usuario a propósito: el historial guarda texto copiado y no debe impedir eliminar un lote.
ALTER TABLE "cambios_animal" ADD CONSTRAINT "cambios_animal_establecimientoId_animalId_fkey" FOREIGN KEY ("establecimientoId", "animalId") REFERENCES "animales"("establecimientoId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── A mano (Prisma no lo expresa) ─────────────────────────────────

-- No se registra un cambio que no cambió nada (antes igual a después; NULL cuenta como valor).
ALTER TABLE "cambios_animal" ADD CONSTRAINT "cambios_valores_distintos"
  CHECK ("valorAnterior" IS DISTINCT FROM "valorNuevo");

-- El nombre del usuario copiado no puede estar vacío.
ALTER TABLE "cambios_animal" ADD CONSTRAINT "cambios_usuario_nombre"
  CHECK (length(btrim("usuarioNombre")) > 0);

-- El historial solo se agrega: ningún UPDATE ni DELETE de fila (constitución §3 y §6).
-- TRUNCATE no dispara este trigger, así que los tests pueden limpiar la tabla.
CREATE FUNCTION "cambios_animal_solo_agregar"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El historial de cambios solo se agrega: no se modifica ni se borra';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cambios_animal_solo_agregar"
  BEFORE UPDATE OR DELETE ON "cambios_animal"
  FOR EACH ROW EXECUTE FUNCTION "cambios_animal_solo_agregar"();
