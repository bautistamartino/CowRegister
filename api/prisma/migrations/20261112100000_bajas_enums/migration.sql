-- Spec 006 (bajas por venta o muerte), paso 1 de 2.
-- Suma el tipo de evento BAJA y los motivos de baja VENTA y MUERTE. Va en una migración propia
-- porque PostgreSQL no deja USAR un valor nuevo de un enum en la misma transacción en que se
-- agrega: la migración siguiente (bajas_base) ya lo usa en un valor por defecto y en sus CHECK.
-- (Precedente: partos_tipos_evento.)
ALTER TYPE "TipoEvento" ADD VALUE 'BAJA';
ALTER TYPE "MotivoBaja" ADD VALUE 'VENTA';
ALTER TYPE "MotivoBaja" ADD VALUE 'MUERTE';
