# Memoria del proyecto

Estado actual y decisiones importantes. La actualiza el implementador al terminar cada spec, y cualquiera que tome una decisión de diseño. Lo más reciente va arriba en cada sección.

## Estado

- **Etapa 1 — Base del sistema** (ver [docs/plan.md](docs/plan.md))
  - Hecho: 1.0 preparación, 1.1 esqueleto, 1.2 base de datos, 1.3 login y seguridad, 1.4 lotes y destino de cada estado (spec [001-lotes](specs/001-lotes/spec.md)), 1.5 animales y 1.6 buscador (spec [002-animales-buscador](specs/002-animales-buscador/spec.md)): alta manual, carga desde planilla con vista previa, listado, ficha y buscador por número.
  - 1.7 cierre (2026-11-11): 275 tests y typecheck en verde; las ramas apiladas se juntaron en `main`. Falta que el usuario cree el repositorio en GitHub y haga el primer `git push` (los agentes no hacen push).
- **Siguiente: Etapa 2 — Reproducción** con `/sdd` (servicios, tactos con fecha probable de parto, partos con alta del ternero, secados), en una sesión nueva. Antes de la Etapa 3 hace falta una spec chica de **editar animal y mover de lote a mano** (la ficha es solo lectura).
- Hay una API de gestión de usuarios (`/api/usuarios`) **sin pantalla** todavía.

## Decisiones

- **2026-11-11 — Animales y buscador (spec 002):**
  - `animales` → `lotes` y madre → animal con claves foráneas compuestas (establecimientoId, id) y `ON DELETE RESTRICT`: un animal nunca apunta a un lote o madre de otro tambo, y no se borra un lote con animales ni una madre con crías. Para eso `Animal` tiene `@@unique([establecimientoId, id])`.
  - `DELETE /api/lotes/:id` primero desasigna a los animales dados de baja y después borra; un lote con animales activos sigue dando 409. Con esto queda resuelto el riesgo del lote en paralelo (alta y borrado simultáneos: la base lo impide).
  - Hechos **a mano** en el SQL de la migración (Prisma no los modela): CHECK de número normalizado (mayúsculas, solo letras sin tildes, dígitos, guion y punto, 1 a 20) y CHECK de que un animal no sea su propia madre, más el índice único parcial de número entre activos. Antes de cada migración nueva, `migrate diff` tiene que dar vacío y no proponer ningún `DROP` de esto.
  - El número se guarda y se busca **en mayúsculas**; el orden del listado es **natural** (A2 antes que A10), con tope de 2.000 resultados y aviso.
  - La carga desde planilla usa un parser de JSON de 1 MB **solo en sus rutas** (el resto de la API sigue con el límite chico); el texto crudo se revalida entero al confirmar y se guardan las filas correctas de ese instante en una transacción, con hasta 3 reintentos si otro usuario ocupa un número (después 409).
  - En la planilla, las madres que están en la misma planilla se resuelven con **un único `createMany` con ids generados de antemano**, sin actualizar fila por fila.
  - La web de la planilla bloquea el botón de confirmar si no hay filas correctas o si el texto cambió después de la vista previa (hay que volver a revisarlo); lo pegado nunca se pierde al corregir.
  - **Corregido:** un veterinario (o un pedido sin sesión) con JSON mal formado ahora recibe 403 (401), no 400: en `api/src/app.ts` la sesión y el rol de las tres rutas de carga se controlan antes de los parsers de JSON.
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

`main` tiene toda la Etapa 1 (las ramas apiladas `setup/...` → `spec/002-animales-buscador` quedaron contenidas en ella). Desde ahora cada spec sale de `main` en su propia rama y vuelve a `main` al terminar.

## Riesgos pendientes

- **Etapa 3 (bajas):** agregar `CHECK (estado <> 'BAJA' OR "loteId" IS NULL)` en `animales` junto con las bajas. Hoy la spec 001 asume que un animal dado de baja no tiene lote, pero la base no lo garantiza.

- **Spec chica antes de la Etapa 3:** editar un animal (número, sexo, fecha, madre) y moverlo de lote a mano; hoy la ficha es solo lectura.

## Pendiente de definir con el responsable

- Si los litros se cargan a mano o se importan del equipo de ordeñe.
- Destino final de los terneros.
- Otros informes.
