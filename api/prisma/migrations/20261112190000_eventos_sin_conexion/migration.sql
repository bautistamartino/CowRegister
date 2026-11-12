-- Spec 010 (eventos sin conexión): dos columnas nuevas en "eventos", que comparten los cinco tipos
-- (servicio, tacto, parto, secado y baja) porque todos viven en esa tabla.
--
--  * cargadoEnDispositivo: hora que tenía la tablet al cargar el evento. Es solo informativa:
--    `creadoEn` sigue siendo la hora del SERVIDOR y es la única que ordena. Es nula si la tablet no
--    la mandó o si venía de un reloj desfasado (más de 5 minutos adelantado o anterior al 2000).
--  * avisosAlAceptar: los avisos que el servidor dio al aceptar el evento por primera vez, para
--    devolverlos idénticos si la tablet reenvía el mismo evento (la respuesta pudo cortarse). Se
--    escribe en el mismo INSERT y no se modifica nunca. Un DEFAULT constante no reescribe la tabla.

-- AlterTable
ALTER TABLE "eventos" ADD COLUMN "cargadoEnDispositivo" TIMESTAMP(3),
ADD COLUMN "avisosAlAceptar" JSONB NOT NULL DEFAULT '[]';


-- ═══ SQL ESCRITO A MANO (Prisma no lo modela) ═══════════════════════════════════════════

-- Rango: si hay hora de la tablet, no puede ser anterior al 01/01/2000. (Que no sea más de 5
-- minutos posterior al servidor depende del reloj y lo controla la API, que en ese caso guarda null.)
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_hora_dispositivo_rango"
  CHECK ("cargadoEnDispositivo" IS NULL OR "cargadoEnDispositivo" >= TIMESTAMP '2000-01-01');

-- Los avisos son siempre una lista JSON (vacía si no hubo ninguno), nunca un objeto, texto ni null JSON.
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_avisos_es_lista"
  CHECK (jsonb_typeof("avisosAlAceptar") = 'array');

-- No hace falta tocar ningún disparador: "eventos" solo tiene el de coherencia de bajas (que mira el
-- tipo BAJA y la tabla "bajas", no estas columnas) y no hay un disparador de "solo agregar" sobre
-- "eventos", "partos" ni "secados". Un test deja asentado que las dos columnas no cambian al anular.
