import type { Prisma, EstadoAnimal, Sexo } from '../generated/prisma/client.js';

// Bloqueo por animal (spec 003, RF-22). Toda operación que registra o anula un evento de un
// animal empieza por acá, dentro de una transacción.
//
// `SELECT ... FOR UPDATE` bloquea la fila del animal hasta que termina la transacción: otra
// operación sobre el mismo animal espera, y cuando sigue, lee lo que la primera ya guardó.
// Así "último evento", "preñez vigente" y el orden de los eventos se controlan sobre datos
// firmes y las operaciones simultáneas se resuelven de a una. Se bloquea UNA sola fila por
// operación, por lo que no hay interbloqueos.

export type AnimalBloqueado = {
  sexo: Sexo;
  estado: EstadoAnimal;
  nacimiento: string | null; // AAAA-MM-DD
  loteId: string | null; // lote actual (la 004 lo guarda como "lote previo" de partos y secados)
};

/**
 * Bloquea la fila del animal activo del tambo y devuelve sus datos, o `null` si no existe,
 * es de otro tambo o está de baja (el llamador responde 404). Los textos se castean en SQL
 * (`::text`) para recibir siempre strings, sin depender de cómo el adaptador lee fechas y enums.
 */
export async function bloquearAnimal(
  tx: Prisma.TransactionClient,
  animalId: string,
  establecimientoId: string,
): Promise<AnimalBloqueado | null> {
  const filas = await tx.$queryRaw<AnimalBloqueado[]>`
    SELECT "sexo"::text AS "sexo", "estado"::text AS "estado", "fechaNacimiento"::text AS "nacimiento",
           "loteId"::text AS "loteId"
    FROM "animales"
    WHERE "id" = ${animalId}::uuid
      AND "establecimientoId" = ${establecimientoId}::uuid
      AND "estado" <> 'BAJA'
    FOR UPDATE`;
  return filas[0] ?? null;
}

/**
 * Momento de registro del próximo evento (o cambio manual) del animal: el mayor entre la hora real y
 * 1 ms después del último momento ya usado por CUALQUIER evento del animal (anulados incluidos) o
 * CUALQUIER cambio manual suyo (spec 010, RF-2). Con la fila bloqueada y `UNIQUE (animalId, creadoEn)`,
 * nunca hay empates en el orden de los eventos, aunque el reloj del servidor se atrase. Que también
 * mire los cambios manuales asegura que un evento nunca quede "antes" de un cambio de lote anterior
 * (el aviso 8 de la spec 005 compara justo esos dos momentos). Son dos agregados con índice
 * (`eventos (animalId, creadoEn)` y `cambios_animal (animalId, creadoEn)`).
 */
export async function siguienteRegistro(tx: Prisma.TransactionClient, animalId: string): Promise<Date> {
  const [eventos, cambios] = await Promise.all([
    tx.evento.aggregate({ where: { animalId }, _max: { creadoEn: true } }),
    tx.cambioAnimal.aggregate({ where: { animalId }, _max: { creadoEn: true } }),
  ]);
  const ultimo = Math.max(eventos._max.creadoEn?.getTime() ?? -Infinity, cambios._max.creadoEn?.getTime() ?? -Infinity);
  const minimo = Number.isFinite(ultimo) ? ultimo + 1 : 0;
  return new Date(Math.max(Date.now(), minimo));
}

// Animal de baja por venta o muerte, bloqueado (spec 006, revertir una baja).
export type AnimalDeBajaBloqueado = { numero: string; estado: EstadoAnimal; fechaBaja: string | null };

/**
 * Bloquea (`FOR UPDATE`) la fila de un animal del tambo que esté de baja POR VENTA O MUERTE y
 * devuelve su número, o `null` si no existe, es de otro tambo, está activo (también uno ya
 * revertido) o está de baja por "parto anulado" (el llamador responde el mismo 404 en todos los casos).
 */
export async function bloquearAnimalDeBaja(
  tx: Prisma.TransactionClient,
  animalId: string,
  establecimientoId: string,
): Promise<AnimalDeBajaBloqueado | null> {
  const filas = await tx.$queryRaw<AnimalDeBajaBloqueado[]>`
    SELECT "numero", "estado"::text AS "estado", "fechaBaja"::text AS "fechaBaja"
    FROM "animales"
    WHERE "id" = ${animalId}::uuid
      AND "establecimientoId" = ${establecimientoId}::uuid
      AND "estado" = 'BAJA'
      AND "motivoBaja" IN ('VENTA', 'MUERTE')
    FOR UPDATE`;
  return filas[0] ?? null;
}
