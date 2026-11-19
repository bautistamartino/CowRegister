-- Spec 015: estado del tambo, registro de bajas y reactivaciones, último ingreso y auditoría ampliada.
-- Lo que genera Prisma va primero; lo marcado "A MANO" no lo modela Prisma (por eso
-- `prisma migrate diff` no debe proponer nada sobre esos objetos).

-- CreateEnum
CREATE TYPE "EstadoTambo" AS ENUM ('ACTIVO', 'BAJA');

-- CreateEnum
CREATE TYPE "TipoCambioEstadoTambo" AS ENUM ('BAJA', 'REACTIVACION');

-- AlterTable: los tambos que ya existían quedan ACTIVOS (valor por defecto), sin registro de baja.
ALTER TABLE "establecimientos" ADD COLUMN "estado" "EstadoTambo" NOT NULL DEFAULT 'ACTIVO';

-- AlterTable: nulo = "nunca ingresó" (hasta el próximo ingreso de cada usuario).
ALTER TABLE "usuarios" ADD COLUMN "ultimoIngresoEn" TIMESTAMP(3);

-- AlterTable: usuario sobre el que actuó el administrador (copias, sin clave foránea).
ALTER TABLE "auditoria_admin" ADD COLUMN "usuarioId" UUID,
ADD COLUMN "usuarioEmail" TEXT;

-- CreateTable
CREATE TABLE "registro_estado_tambo" (
    "id" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "tipo" "TipoCambioEstadoTambo" NOT NULL,
    "motivo" TEXT,
    "administradorId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_estado_tambo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registro_estado_tambo_establecimientoId_creadoEn_idx" ON "registro_estado_tambo"("establecimientoId", "creadoEn");

-- AddForeignKey
ALTER TABLE "registro_estado_tambo" ADD CONSTRAINT "registro_estado_tambo_establecimientoId_fkey" FOREIGN KEY ("establecimientoId") REFERENCES "establecimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_estado_tambo" ADD CONSTRAINT "registro_estado_tambo_administradorId_fkey" FOREIGN KEY ("administradorId") REFERENCES "administradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── A MANO (1/3): el registro es coherente (RF-5) ────────────────────────────
-- BAJA exige motivo de 1 a 200 caracteres (char_length cuenta caracteres, no bytes) y sin espacios
-- en los bordes; REACTIVACION no lleva motivo.
ALTER TABLE "registro_estado_tambo" ADD CONSTRAINT "registro_estado_tambo_coherente"
  CHECK (
    ("tipo" = 'BAJA' AND "motivo" IS NOT NULL
       AND char_length("motivo") BETWEEN 1 AND 200 AND "motivo" = btrim("motivo"))
    OR ("tipo" = 'REACTIVACION' AND "motivo" IS NULL)
  );

-- ─── A MANO (2/3): el registro solo se agrega (RF-16) ─────────────────────────
-- Igual que la auditoría: TRUNCATE no dispara este disparador, así limpiarBase() de los tests
-- sigue funcionando.
CREATE FUNCTION "registro_estado_tambo_solo_agregar"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El registro de bajas y reactivaciones solo se agrega: no se modifica ni se borra';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "registro_estado_tambo_solo_agregar"
  BEFORE UPDATE OR DELETE ON "registro_estado_tambo"
  FOR EACH ROW EXECUTE FUNCTION "registro_estado_tambo_solo_agregar"();

-- ─── A MANO (3/3): CHECK de la auditoría ampliado (RF-32) ─────────────────────
-- Se quita el de la 014 y se recrea con las acciones nuevas. El disparador de solo agregar sigue.
--   TAMBO_CREADO, TAMBO_BAJA, TAMBO_REACTIVADO: tambo (id y nombre), sin usuario.
--   CONTRASENA_RESTABLECIDA, USUARIO_REACTIVADO: tambo y usuario (id y email).
--   INGRESO, INGRESO_FALLIDO: nada.
ALTER TABLE "auditoria_admin" DROP CONSTRAINT "auditoria_admin_coherente";
ALTER TABLE "auditoria_admin" ADD CONSTRAINT "auditoria_admin_coherente"
  CHECK (
    ("accion" IN ('TAMBO_CREADO', 'TAMBO_BAJA', 'TAMBO_REACTIVADO')
       AND "establecimientoId" IS NOT NULL AND "tamboNombre" IS NOT NULL
       AND "usuarioId" IS NULL AND "usuarioEmail" IS NULL)
    OR ("accion" IN ('CONTRASENA_RESTABLECIDA', 'USUARIO_REACTIVADO')
       AND "establecimientoId" IS NOT NULL AND "tamboNombre" IS NOT NULL
       AND "usuarioId" IS NOT NULL AND "usuarioEmail" IS NOT NULL)
    OR ("accion" IN ('INGRESO', 'INGRESO_FALLIDO')
       AND "establecimientoId" IS NULL AND "tamboNombre" IS NULL
       AND "usuarioId" IS NULL AND "usuarioEmail" IS NULL)
  );
