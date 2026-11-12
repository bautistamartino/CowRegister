-- Spec 006 (bajas por venta o muerte), paso 2 de 2. Estructura generada con prisma migrate diff
-- (sin los dos DROP de las claves de lote previo de la spec 004 ni los ADD VALUE, que ya hizo la
-- migración anterior), más el bloque manual del final (lo que Prisma no puede expresar).
-- Requiere la migración anterior (bajas_enums).

-- CreateTable
CREATE TABLE "bajas" (
    "eventoId" UUID NOT NULL,
    "establecimientoId" UUID NOT NULL,
    "tipo" "TipoEvento" NOT NULL DEFAULT 'BAJA',
    "animalId" UUID NOT NULL,
    "motivo" "MotivoBaja" NOT NULL,
    "observaciones" TEXT,
    "estadoAnterior" "EstadoAnimal" NOT NULL,
    "tuvoLoteAnterior" BOOLEAN NOT NULL DEFAULT false,
    "loteAnteriorId" UUID,
    "vigente" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "bajas_pkey" PRIMARY KEY ("eventoId")
);

-- CreateIndex
CREATE INDEX "bajas_loteAnteriorId_idx" ON "bajas"("loteAnteriorId");

-- CreateIndex
CREATE UNIQUE INDEX "bajas_establecimientoId_eventoId_tipo_animalId_key" ON "bajas"("establecimientoId", "eventoId", "tipo", "animalId");

-- AddForeignKey
-- Clave compuesta al evento: la baja es de un evento de tipo BAJA, del mismo animal y del mismo
-- tambo (RF-18.3).
ALTER TABLE "bajas" ADD CONSTRAINT "bajas_establecimientoId_eventoId_tipo_animalId_fkey" FOREIGN KEY ("establecimientoId", "eventoId", "tipo", "animalId") REFERENCES "eventos"("establecimientoId", "id", "tipo", "animalId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══ SQL ESCRITO A MANO (Prisma no lo modela) ═══════════════════════════════════════════

-- Lote previo (igual que partos y secados, spec 004): clave foránea compuesta
-- (establecimientoId, loteAnteriorId). Al ELIMINAR el lote, ON DELETE SET NULL ("loteAnteriorId")
-- (PostgreSQL 15 o superior) anula SOLO esa columna y nunca toca establecimientoId, que es
-- obligatoria. tuvoLoteAnterior sigue en true y distingue "lote previo eliminado" de "sin lote".
ALTER TABLE "bajas" ADD CONSTRAINT "bajas_loteAnterior_fkey"
  FOREIGN KEY ("establecimientoId", "loteAnteriorId") REFERENCES "lotes" ("establecimientoId", "id")
  ON DELETE SET NULL ("loteAnteriorId");

-- bajas: tipo constante; el motivo de una baja REGISTRADA es venta o muerte ("parto anulado" sigue
-- sin evento); observaciones de 1 a 200 caracteres (así "sin observaciones" siempre es NULL); el
-- estado previo nunca es BAJA; y lote previo coherente con su indicador.
ALTER TABLE "bajas" ADD CONSTRAINT "bajas_tipo" CHECK ("tipo" = 'BAJA');
ALTER TABLE "bajas" ADD CONSTRAINT "bajas_motivo" CHECK ("motivo" IN ('VENTA', 'MUERTE'));
ALTER TABLE "bajas" ADD CONSTRAINT "bajas_observaciones_largo"
  CHECK ("observaciones" IS NULL OR char_length("observaciones") BETWEEN 1 AND 200);
ALTER TABLE "bajas" ADD CONSTRAINT "bajas_estado_anterior" CHECK ("estadoAnterior" <> 'BAJA');
ALTER TABLE "bajas" ADD CONSTRAINT "bajas_lote_anterior_coherente"
  CHECK ("loteAnteriorId" IS NULL OR "tuvoLoteAnterior");

-- A lo sumo UNA baja vigente por animal (RF-18.2). Es un índice (y no un disparador de conteo)
-- porque con dos transacciones simultáneas ambas pasarían el conteo: el índice las serializa y
-- la segunda falla. "vigente" es true al registrar la baja y pasa a false al revertirla.
CREATE UNIQUE INDEX "bajas_una_vigente_por_animal" ON "bajas" ("animalId") WHERE "vigente";

-- Índice del listado de bajas de un tambo (solo las vigentes).
CREATE INDEX "bajas_establecimientoId_vigente_idx" ON "bajas" ("establecimientoId") WHERE "vigente";

-- animales: toda baja NUEVA tiene fecha y motivo (RF-18.1). Se crea NOT VALID para no rechazar
-- bajas viejas sin motivo (hoy no debería haber ninguna): PostgreSQL controla igual cada fila
-- que se inserta o modifica desde ahora, pero no revisa las que ya estaban.
ALTER TABLE "animales" ADD CONSTRAINT "animales_baja_con_fecha_y_motivo"
  CHECK ("estado" <> 'BAJA' OR ("fechaBaja" IS NOT NULL AND "motivoBaja" IS NOT NULL)) NOT VALID;

-- animales: un animal activo no tiene fecha de baja (también tras revertir). El motivo ya lo
-- cubre animales_motivo_baja_coherente (spec 004).
ALTER TABLE "animales" ADD CONSTRAINT "animales_activo_sin_baja"
  CHECK ("estado" = 'BAJA' OR "fechaBaja" IS NULL);

-- Coherencia animal–baja–evento (RF-18.2: "manda la baja registrada"). Disparador DIFERIDO: se
-- comprueba al CONFIRMAR la transacción, no sentencia por sentencia, así el código puede escribir
-- el evento, la baja y el animal en cualquier orden. Para el animal afectado exige:
--   (a) cada baja suya: vigente equivale a que su evento no esté anulado;
--   (b) si está de baja por VENTA o MUERTE: exactamente una baja vigente, con el mismo motivo y la
--       misma fecha (la del evento);
--   (c) si está activo o de baja por "parto anulado": ninguna baja vigente.
CREATE FUNCTION "bajas_coherencia"() RETURNS trigger AS $$
DECLARE
  ids uuid[];
  v_id uuid;
  v_estado "EstadoAnimal";
  v_motivo "MotivoBaja";
  v_fecha date;
  v_vigentes integer;
BEGIN
  -- Qué animales hay que revisar según la tabla que cambió.
  IF TG_TABLE_NAME = 'animales' THEN
    ids := ARRAY[NEW."id"];
  ELSIF TG_OP = 'DELETE' THEN
    ids := ARRAY[OLD."animalId"];
  ELSIF TG_OP = 'UPDATE' AND OLD."animalId" <> NEW."animalId" THEN
    ids := ARRAY[OLD."animalId", NEW."animalId"];
  ELSE
    ids := ARRAY[NEW."animalId"];
  END IF;

  FOREACH v_id IN ARRAY ids LOOP
    -- (a) vigente <=> evento sin anular
    IF EXISTS (
      SELECT 1 FROM "bajas" b JOIN "eventos" e ON e."id" = b."eventoId"
      WHERE b."animalId" = v_id AND b."vigente" <> (e."anuladoEn" IS NULL)
    ) THEN
      RAISE EXCEPTION 'Coherencia de bajas: una baja del animal % está vigente con su evento anulado, o anulada con su evento vigente', v_id
        USING ERRCODE = '23514';
    END IF;

    SELECT "estado", "motivoBaja", "fechaBaja" INTO v_estado, v_motivo, v_fecha FROM "animales" WHERE "id" = v_id;
    CONTINUE WHEN NOT FOUND;

    SELECT count(*) INTO v_vigentes FROM "bajas" WHERE "animalId" = v_id AND "vigente";

    IF v_estado = 'BAJA' AND v_motivo IN ('VENTA', 'MUERTE') THEN
      -- (b) exactamente una baja vigente, igual en motivo y fecha
      IF v_vigentes <> 1 THEN
        RAISE EXCEPTION 'Coherencia de bajas: el animal % está de baja por % y tiene % bajas vigentes (tiene que tener exactamente una)', v_id, v_motivo, v_vigentes
          USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM "bajas" b JOIN "eventos" e ON e."id" = b."eventoId"
        WHERE b."animalId" = v_id AND b."vigente" AND b."motivo" = v_motivo AND e."fecha" = v_fecha
      ) THEN
        RAISE EXCEPTION 'Coherencia de bajas: la fecha o el motivo de baja del animal % no coinciden con los de su baja vigente', v_id
          USING ERRCODE = '23514';
      END IF;
    ELSIF v_vigentes > 0 THEN
      -- (c) activo (o baja por "parto anulado") con una baja vigente
      RAISE EXCEPTION 'Coherencia de bajas: el animal % no está de baja por venta o muerte pero tiene una baja vigente', v_id
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- En animales solo importan estos tres datos; en eventos, solo los de tipo BAJA. Las tres
-- tablas disparan la misma comprobación, que se hace una vez por fila al confirmar.
CREATE CONSTRAINT TRIGGER "animales_bajas_coherencia"
  AFTER INSERT OR UPDATE OF "estado", "motivoBaja", "fechaBaja" ON "animales"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "bajas_coherencia"();

CREATE CONSTRAINT TRIGGER "bajas_bajas_coherencia"
  AFTER INSERT OR UPDATE OR DELETE ON "bajas"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "bajas_coherencia"();

CREATE CONSTRAINT TRIGGER "eventos_bajas_coherencia"
  AFTER INSERT OR UPDATE ON "eventos"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW."tipo" = 'BAJA') EXECUTE FUNCTION "bajas_coherencia"();

-- Las bajas solo se agregan (constitución §3 y §6, RF-18.6): una baja revertida queda anulada,
-- nunca se borra. Se impide el DELETE de la fila; su evento ya está protegido por la clave
-- foránea (RESTRICT). TRUNCATE no dispara este disparador, así que los tests pueden limpiar la tabla.
CREATE FUNCTION "bajas_solo_agregar"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Las bajas solo se agregan: una baja revertida no se borra';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bajas_solo_agregar"
  BEFORE DELETE ON "bajas"
  FOR EACH ROW EXECUTE FUNCTION "bajas_solo_agregar"();
