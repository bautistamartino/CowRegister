-- Spec 004 (partos y secados), paso 1 de 2.
-- Suma los tipos de evento PARTO y SECADO. Va en una migración propia porque PostgreSQL no deja
-- USAR un valor nuevo de un enum en la misma transacción en que se agrega: la migración
-- siguiente (partos_secados) ya los usa en sus CHECK y valores por defecto.
ALTER TYPE "TipoEvento" ADD VALUE 'PARTO';
ALTER TYPE "TipoEvento" ADD VALUE 'SECADO';
