-- Spec 015: acciones nuevas de la auditoría del administrador.
-- Va SOLA en su migración: PostgreSQL no deja usar un valor de enum recién agregado dentro de la
-- misma transacción, y Prisma corre cada migración en una. El CHECK que usa estos valores se
-- recrea en la migración siguiente (tambo_estado_y_registro).
ALTER TYPE "AccionAdmin" ADD VALUE 'TAMBO_BAJA';
ALTER TYPE "AccionAdmin" ADD VALUE 'TAMBO_REACTIVADO';
ALTER TYPE "AccionAdmin" ADD VALUE 'CONTRASENA_RESTABLECIDA';
ALTER TYPE "AccionAdmin" ADD VALUE 'USUARIO_REACTIVADO';
