# Tareas — 001 Lotes y destino de cada estado

Plan: [plan.md](plan.md) · Spec: [spec.md](spec.md)

- [x] **T1** — Migración `lotes_restricciones`: en `schema.prisma`, clave foránea compuesta (establecimientoId, loteId) con `onDelete: Restrict`, `@@unique([establecimientoId, id])` en `Lote` y quitar el `@@unique` de nombre. A mano en el SQL: verificación de repetidos, índice único sobre `lower(nombre)` y CHECK sin BAJA. Primero se escribe `api/tests/base-lotes.test.ts`, que inserta directo en la base para probar cada garantía.
  - RF: RF-6, RF-9, RF-16, RF-17, RF-31
  - Hecho cuando: `base-lotes.test.ts` pasa (falla insertar "Secas"/"secas", una regla BAJA, una regla hacia un lote de otro tambo y una regla hacia un lote inexistente, y falla borrar un lote que es destino); `prisma migrate diff` desde las migraciones hasta el schema no propone ningún `DROP` de lo agregado a mano; `npm run typecheck` sin errores.

- [x] **T2** — Normalización y validación: `normalizarNombre`, `nombreLoteSchema` (1 a 50 caracteres contados en code points después de NFC) y `descripcionLoteSchema` (hasta 200; vacía pasa a `null`) en `api/src/validacion.ts`, con `api/tests/validacion.test.ts` escrito primero.
  - RF: RF-4, RF-5, RF-27
  - Hecho cuando: `validacion.test.ts` pasa con espacios y tabulaciones en los extremos, espacios internos repetidos, nombre vacío o de solo espacios, 50 y 51 caracteres con ñ/é, forma descompuesta y descripción vacía o de 201 caracteres.

- [ ] **T3** — Lotes iniciales en el registro: `api/src/lotes/estados.ts`, `api/src/lotes/iniciales.ts` (`crearLotesIniciales`) y `api/src/auth/registro.ts` (`crearTamboConDueno`: establecimiento, lotes, reglas y por último el dueño, en una sola transacción); la ruta de registro pasa a usarlo. Tests primero en `api/tests/lotes-iniciales.test.ts`.
  - RF: RF-18
  - Hecho cuando: los tests comprueban que un tambo recién registrado tiene los 4 lotes con sus 4 reglas y que, si la creación del dueño falla (email repetido), no queda establecimiento, lotes ni reglas; `auth.test.ts` sigue en verde.

- [ ] **T4** — Migración de datos `lotes_iniciales_existentes`: un solo bloque `DO $$ … $$` entre los marcadores `-- INICIO lotes iniciales` y `-- FIN lotes iniciales`, que completa solo los estados sin destino reutilizando o creando el lote. Tests primero en `lotes-iniciales.test.ts`, ejecutando el bloque leído del archivo.
  - RF: RF-19
  - Hecho cuando: el test confirma que un tambo sin reglas recibe los 4 lotes y destinos, que un lote propio "  terneros" se reutiliza sin duplicarse y que una SECA apuntando a "Secas viejas" queda igual y no se crea "Secas"; la migración se aplica sin errores sobre la base de desarrollo.

- [ ] **T5** — API de lectura y alta de lotes: `api/src/rutas/lotes.ts` con GET lista, GET por id y POST, montada en `app.ts`; helper `esErrorPrisma` en `errores.ts` y `crearUsuario` en `tests/ayudas.ts`. Tests primero en `api/tests/lotes.test.ts`.
  - RF: RF-1, RF-2, RF-4 a RF-6, RF-20 a RF-22, RF-27
  - Hecho cuando: pasan los tests de orden sin mayúsculas, cantidad de animales activos (no cuenta BAJA), `destinoDe`, alta con y sin descripción, nombre repetido (409), dos tambos con el mismo nombre, aislamiento entre dos tambos en listar, ver y crear (incluido un `establecimientoId` enviado por el cliente, que se ignora), 404 con id mal formado, y veterinario con 200 al listar y 403 al crear.

- [ ] **T6** — Edición y eliminación de lotes: PATCH y DELETE en `rutas/lotes.ts` (`updateMany`/`deleteMany` filtrados por tambo, transacción en DELETE, mensaje de bloqueo armado y traducción de P2002 y P2003). Tests primero en `lotes.test.ts`.
  - RF: RF-3, RF-6, RF-7 a RF-9, RF-20 a RF-22, RF-27, RF-31, RF-32
  - Hecho cuando: pasan los tests de renombrar (a otro nombre existente da 409; a sí mismo o cambiando solo las mayúsculas da 200), borrar la descripción, eliminar sin animales o con solo animales dados de baja (204), bloqueo con "El lote tiene 3 animales", "El lote es destino de En ordeñe" y los dos motivos juntos, PATCH y DELETE sobre un lote ya eliminado (404), aislamiento entre dos tambos en editar y eliminar, y veterinario con 403 también con un id de otro tambo.

- [ ] **T7** — API de destinos: `api/src/rutas/reglas-lote.ts` con GET, PUT `/:estado` y DELETE `/:estado`, montada en `app.ts`. Tests primero en `api/tests/reglas-lote.test.ts`.
  - RF: RF-11 a RF-17, RF-20 a RF-22, RF-31
  - Hecho cuando: pasan los tests de los 4 estados siempre presentes, reemplazo del destino, PUT repetido sin cambios, quitar destino (también repetido), un lote destino de dos estados, BAJA (400), `loteId` de otro tambo, inexistente, mal formado o recién eliminado (404), aislamiento entre dos tambos en listar, configurar y quitar, y veterinario con 403; `npm test` y `npm run typecheck` completos en verde.

- [ ] **T8** — Web, menú y sesión: `componentes/Layout.tsx` (nombres recortados con "…", `NavLink` a Inicio y Lotes, botón "Cerrar sesión" que lleva al login sin confirmar), ruta de layout en `App.tsx`, `Inicio.tsx` sin barra propia, manejador de 401 en `api.ts` registrado en `auth.tsx`, y CSS (`.boton-secundario` a 48 px y estilos del menú). La página `/lotes` puede quedar como un título provisorio hasta T9.
  - RF: RF-23 a RF-26, RF-28 a RF-30
  - Hecho cuando: en el navegador, a 768 px y 375 px y en modo claro y oscuro, el menú aparece solo con la sesión iniciada, marca la sección actual con `aria-current="page"`, sus controles miden al menos 48 px, no hay scroll horizontal con nombres de tambo y usuario de 100 caracteres, "Cerrar sesión" lleva al login y, si se borra la sesión en la base, la siguiente acción lleva al login; `npm run typecheck` sin errores.

- [ ] **T9** — Web, pantalla Lotes: avisos de estados sin destino, `select` de destino por estado, formulario de alta, tarjetas con edición, eliminación con confirmación y mensajes de error de la API; modo lectura para el veterinario. Tipos `Lote` y `ReglaLote` en `api.ts` y estilos de `select`, `textarea`, tarjetas y avisos.
  - RF: RF-1 a RF-17, RF-21, RF-26, RF-27
  - Hecho cuando: en el navegador, a 768 px y 375 px y en modo claro y oscuro, un dueño crea, renombra, borra la descripción y elimina lotes, ve el mensaje 409 al eliminar uno que es destino, cambia y quita destinos y ve aparecer el aviso; un veterinario ve todo sin controles de edición; todos los controles miden al menos 48 px y no hay scroll horizontal; `npm run typecheck` sin errores.

- [ ] **T10** — Cierre: correr `npm test` y `npm run typecheck`, repasar los criterios de aceptación de la spec uno por uno, actualizar `MEMORY.md` (estado, decisiones de esta spec y la nota sobre los índices hechos a mano y `migrate diff`) y marcar 1.4 en `docs/plan.md`.
  - RF: todos (verificación final)
  - Hecho cuando: los tests y el chequeo de tipos están en verde, todos los criterios de aceptación de `spec.md` están verificados, `MEMORY.md` está actualizado y `docs/plan.md` tiene `[x] 1.4`.
