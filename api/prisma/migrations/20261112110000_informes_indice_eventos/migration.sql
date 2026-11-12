-- Spec 007 (informes): los informes leen los eventos de TODO el tambo filtrando por tipo y fecha.
-- El único índice de fecha que había empieza por "animalId" y no sirve para esa consulta.
-- Es solo un índice: no cambia ninguna regla ni ningún dato.

-- CreateIndex
CREATE INDEX "eventos_establecimientoId_tipo_fecha_idx" ON "eventos"("establecimientoId", "tipo", "fecha");
