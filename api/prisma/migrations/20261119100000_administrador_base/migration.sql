-- Spec 014: administrador de la plataforma.
-- Las tablas y los índices comunes los genera Prisma; lo marcado "A MANO" no lo modela Prisma
-- (por eso `prisma migrate diff` no debe proponer nada sobre esos objetos).

-- ─── A MANO (1/5): nombre de tambo único (RF-27, RF-34) ───────────────────────
-- Primero se resuelven los duplicados que ya existan: el tambo más antiguo (creadoEn, luego id)
-- conserva el nombre y los más nuevos pasan a "<nombre> (2)", "(3)"... sin borrar nada ni fallar.
-- La clave de comparación ignora mayúsculas y espacios de más (al principio, al final y repetidos).
-- El bloque va entre los marcadores INICIO/FIN porque el test api/tests/base-admin.test.ts lo lee
-- de este archivo y lo ejecuta: no cambiar los marcadores.

-- INICIO DEDUPE NOMBRES
DO $$
DECLARE
  repetido  RECORD;
  candidato text;
  n         integer;
BEGIN
  FOR repetido IN
    SELECT id, nombre
    FROM (
      SELECT id, nombre, "creadoEn",
             row_number() OVER (
               PARTITION BY lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g'))
               ORDER BY "creadoEn", id
             ) AS posicion
      FROM establecimientos
    ) ordenados
    WHERE posicion > 1
    ORDER BY "creadoEn", id
  LOOP
    n := 2;
    LOOP
      -- El nombre nuevo sale del nombre ya normalizado (espacios colapsados) más " (n)".
      candidato := regexp_replace(btrim(repetido.nombre), '\s+', ' ', 'g') || ' (' || n || ')';
      -- Se repite hasta que el nombre nuevo no choque con ningún otro tambo.
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM establecimientos
        WHERE lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g')) = lower(candidato)
          AND id <> repetido.id
      );
      n := n + 1;
    END LOOP;
    UPDATE establecimientos SET nombre = candidato WHERE id = repetido.id;
  END LOOP;
END $$;
-- FIN DEDUPE NOMBRES

CREATE UNIQUE INDEX "establecimientos_nombre_unico"
  ON "establecimientos" (lower(regexp_replace(btrim("nombre"), '\s+', ' ', 'g')));

-- CreateEnum
CREATE TYPE "AccionAdmin" AS ENUM ('INGRESO', 'INGRESO_FALLIDO', 'TAMBO_CREADO');

-- CreateTable
CREATE TABLE "administradores" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "administradores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones_admin" (
    "id" UUID NOT NULL,
    "administradorId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sesiones_admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria_admin" (
    "id" UUID NOT NULL,
    "accion" "AccionAdmin" NOT NULL,
    "administradorId" UUID NOT NULL,
    "establecimientoId" UUID,
    "tamboNombre" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_admin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "administradores_email_key" ON "administradores"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_admin_tokenHash_key" ON "sesiones_admin"("tokenHash");

-- CreateIndex
CREATE INDEX "sesiones_admin_administradorId_idx" ON "sesiones_admin"("administradorId");

-- CreateIndex
CREATE INDEX "auditoria_admin_administradorId_creadoEn_idx" ON "auditoria_admin"("administradorId", "creadoEn");

-- AddForeignKey
ALTER TABLE "sesiones_admin" ADD CONSTRAINT "sesiones_admin_administradorId_fkey" FOREIGN KEY ("administradorId") REFERENCES "administradores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_admin" ADD CONSTRAINT "auditoria_admin_administradorId_fkey" FOREIGN KEY ("administradorId") REFERENCES "administradores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── A MANO (2/5): un solo administrador ──────────────────────────────────────
-- El índice único sobre una constante ((true)) admite una sola fila en la tabla: la decisión de
-- la spec ("un solo administrador") queda garantizada en la base, también con dos altas
-- simultáneas. Cuando se quiera más de uno, una migración posterior lo quita.
CREATE UNIQUE INDEX "administradores_uno_solo" ON "administradores" ((true));

-- ─── A MANO (3/5): email del administrador normalizado ────────────────────────
-- Siempre en minúsculas y sin espacios en los extremos (igual que el de los usuarios).
ALTER TABLE "administradores" ADD CONSTRAINT "administradores_email_normalizado"
  CHECK ("email" = lower(btrim("email")));

-- ─── A MANO (4/5): email único entre administradores y usuarios (RF-7, RF-8) ──
-- Cada tabla ya tiene su índice único; esto cubre el cruce entre las dos. La función toma un
-- bloqueo asesor (pg_advisory_xact_lock) con la clave del email: dos altas simultáneas del mismo
-- email, aunque vayan a tablas distintas, se ponen en fila. La segunda espera a que termine la
-- primera (el bloqueo se suelta al confirmar) y entonces ve su fila y falla. El error usa el código
-- 23505 (violación de unicidad), que Prisma entrega como P2002 y la API traduce a 409.
CREATE FUNCTION "email_unico_entre_cuentas"() RETURNS trigger AS $$
DECLARE
  clave text := lower(btrim(NEW."email"));
  existe boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(clave, 0));
  IF TG_TABLE_NAME = 'usuarios' THEN
    SELECT EXISTS (SELECT 1 FROM "administradores" WHERE lower(btrim("email")) = clave) INTO existe;
  ELSE
    SELECT EXISTS (SELECT 1 FROM "usuarios" WHERE lower(btrim("email")) = clave) INTO existe;
  END IF;
  IF existe THEN
    RAISE EXCEPTION 'Ya existe una cuenta con ese email' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "usuarios_email_unico_entre_cuentas"
  BEFORE INSERT OR UPDATE OF "email" ON "usuarios"
  FOR EACH ROW EXECUTE FUNCTION "email_unico_entre_cuentas"();

CREATE TRIGGER "administradores_email_unico_entre_cuentas"
  BEFORE INSERT OR UPDATE OF "email" ON "administradores"
  FOR EACH ROW EXECUTE FUNCTION "email_unico_entre_cuentas"();

-- ─── A MANO (5/5): auditoría solo-agregar y coherente ─────────────────────────
-- Constitución: los registros de auditoría solo se agregan. TRUNCATE no dispara este disparador,
-- así que limpiarBase() de los tests sigue funcionando.
CREATE FUNCTION "auditoria_admin_solo_agregar"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría del administrador solo se agrega: no se modifica ni se borra';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "auditoria_admin_solo_agregar"
  BEFORE UPDATE OR DELETE ON "auditoria_admin"
  FOR EACH ROW EXECUTE FUNCTION "auditoria_admin_solo_agregar"();

-- TAMBO_CREADO exige el id y el nombre del tambo; las demás acciones no llevan ninguno.
-- (La spec 015 que sume acciones con ALTER TYPE ... ADD VALUE tendrá que ampliar este CHECK.)
ALTER TABLE "auditoria_admin" ADD CONSTRAINT "auditoria_admin_coherente"
  CHECK (
    ("accion" = 'TAMBO_CREADO' AND "establecimientoId" IS NOT NULL AND "tamboNombre" IS NOT NULL)
    OR ("accion" <> 'TAMBO_CREADO' AND "establecimientoId" IS NULL AND "tamboNombre" IS NULL)
  );
