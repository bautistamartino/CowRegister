# Memoria del proyecto

Estado actual y decisiones importantes. La actualiza el implementador al terminar cada spec, y cualquiera que tome una decisión de diseño. Lo más reciente va arriba en cada sección.

## Estado

- **Etapa 1 — Base del sistema** (ver [docs/plan.md](docs/plan.md))
  - Hecho: 1.0 preparación, 1.1 esqueleto, 1.2 base de datos, 1.3 login y seguridad, 1.4 lotes y destino de cada estado (spec [001-lotes](specs/001-lotes/spec.md)).
  - Siguiente: 1.5 animales + 1.6 buscador, en una sola spec (`/sdd`). Carga decidida: alta manual de a una y pegar desde planilla con vista previa (ver [docs/requerimientos.md](docs/requerimientos.md) › Carga de animales). El rodeo existente está en papel o en una planilla digital.
- Hay una API de gestión de usuarios (`/api/usuarios`) **sin pantalla** todavía.

## Decisiones

- **2026-11-10 — Lotes (spec 001):**
  - `reglas_lote` → `lotes` con clave foránea compuesta (establecimientoId, loteId) y `ON DELETE RESTRICT`: un destino nunca apunta a otro tambo y no se puede borrar un lote que es destino.
  - Hechos **a mano** en el SQL de la migración (Prisma no los modela): índice único sobre `lower(nombre)` por tambo y CHECK que impide una regla para BAJA. Antes de cada migración nueva, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (en `api/`) tiene que dar una migración vacía; si propone un `DROP` de esos objetos, no aplicarla.
  - RF-19 (destinos de los tambos ya registrados) es una **migración de datos**: se ejecuta una sola vez. El test lee el bloque `DO $$` del `migration.sql` entre los marcadores.
  - `prisma migrate dev` falla en un entorno no interactivo cuando hay advertencias: se crea la carpeta de la migración a mano y se aplica con `prisma migrate deploy`.
  - Los lotes iniciales se crean en el registro, en la misma transacción que el tambo y el dueño (todo o nada).
  - Un id mal formado responde 404, igual que uno inexistente o de otro tambo.
  - La web maneja el 401 en un solo lugar (`web/src/api.ts`): cualquier 401 fuera de `/auth/yo` y `/auth/login` lleva al login.
  - El menú es una ruta de layout de React Router (`componentes/Layout.tsx`) que envuelve las páginas con sesión.
- **2026-11-10 — Sistema de agentes:** coordinador como skill `/sdd`, subagentes planificador, implementador y revisor (`.claude/agents/`). Cambios chicos con `/feature`.
- **2026-11-10 — Tests:** Vitest + supertest sobre la base `cowregister_test`. `LIMITE_INTENTOS_LOGIN` permite subir el límite de intentos en los tests.
- **2026-11-10 — Sesiones en la base** (no JWT): se pueden revocar. Cookie httpOnly + SameSite=Lax, 30 días.
- **2026-11-10 — Prisma fijado en 7.10.1:** la etiqueta `latest` de npm apuntaba a una 8.0.0-rc.
- **2026-11-10 — Stack:** React + Vite + TS, Express + TS, PostgreSQL 18 + Prisma.

## Ramas

Las ramas de la Etapa 1 están apiladas y todavía no existe `main`: `setup/estructura-inicial` → `etapa1/esqueleto` → `etapa1/base-de-datos` → `etapa1/login` → `config/agentes` → `spec/001-lotes`. Se juntan en `main` al cerrar la etapa.

## Riesgos pendientes

- **Paso 1.5 (animales), sugerido por el revisor en la spec 001:** en `DELETE /api/lotes/:id` (`api/src/rutas/lotes.ts`), el conteo de animales activos y el borrado no se bloquean entre sí (READ COMMITTED). Cuando exista la API de animales, un animal asignado en paralelo podría quedar con `loteId` null. Resolverlo en el plan de 1.5 (por ejemplo, `SELECT … FOR UPDATE` sobre el lote en el DELETE y en la asignación de animales).

- **Etapa 3 (bajas):** agregar `CHECK (estado <> 'BAJA' OR "loteId" IS NULL)` en `animales` junto con las bajas. Hoy la spec 001 asume que un animal dado de baja no tiene lote, pero la base no lo garantiza.

## Pendiente de definir con el responsable

- Si los litros se cargan a mano o se importan del equipo de ordeñe.
- Destino final de los terneros.
- Otros informes.
