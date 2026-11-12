-- Spec 009 (modo sin conexión): hora informativa de la carga en la tablet.
-- `creadoEn` sigue siendo la hora del SERVIDOR (de ella dependen el orden y los informes); esta
-- columna guarda aparte la hora que tenía la tablet al cargar y NUNCA se usa para ordenar, validar
-- ni calcular. Es nula en las cargas hechas con conexión directa y en las anteriores a esta migración.

-- AlterTable
ALTER TABLE "producciones" ADD COLUMN "cargadoEnDispositivo" TIMESTAMP(3);


-- ═══ SQL ESCRITO A MANO (Prisma no lo modela) ═══════════════════════════════════════════

-- Rango: si hay hora de la tablet, no puede ser anterior al 01/01/2000. (Que no sea más de 5
-- minutos posterior al servidor depende del reloj y lo controla la API, que en ese caso guarda null.)
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_hora_dispositivo_rango"
  CHECK ("cargadoEnDispositivo" IS NULL OR "cargadoEnDispositivo" >= TIMESTAMP '2000-01-01');

-- El disparador "solo se agrega" compara columnas para impedir cambios: se redefine sumando la
-- columna nueva (la hora de la tablet se escribe solo al insertar y no se puede modificar después,
-- ni siquiera al anular). El resto es idéntico al de la migración produccion_base.
CREATE OR REPLACE FUNCTION "producciones_solo_agregar"() RETURNS trigger AS $$
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
     OR NEW."creadoEn" IS DISTINCT FROM OLD."creadoEn"
     OR NEW."cargadoEnDispositivo" IS DISTINCT FROM OLD."cargadoEnDispositivo" THEN
    RAISE EXCEPTION 'La producción solo se agrega: no se edita, se anula';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
