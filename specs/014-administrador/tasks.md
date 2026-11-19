# Tareas — 014 Administrador de la plataforma

Cada tarea empieza escribiendo los tests y termina con `npm test -w api` (o los archivos de la tarea), `npm run typecheck` y commit en la rama `spec/014-administrador`.

- [x] **T1** — Base de datos: tablas del administrador y garantías
  - Tests primero: `api/tests/base-admin.test.ts`. Después, modelos `Administrador`, `SesionAdmin`, `AuditoriaAdmin` y enum `AccionAdmin` en `api/prisma/schema.prisma`; migración `administrador_base` con el SQL a mano comentado (dedupe de nombres con marcadores, índice único de nombre, `administradores_uno_solo`, CHECK de email, disparador de email único entre tablas con bloqueo asesor, disparador y CHECK de la auditoría); `limpiarBase` y ayudas en `api/tests/ayudas.ts`; `npm run db:generate -w api`.
  - RF: RF-1, RF-7, RF-8, RF-27 (base), RF-34
  - Hecho cuando: los tests de la base pasan (incluido el bloque de dedupe ejecutado sobre duplicados sembrados y las dos altas simultáneas), la migración se aplica en `cowregister_test` y en desarrollo sin tocar "Libertad", y `migrate diff` da solo las tres claves foráneas de lote previo.

- [x] **T2** — Sesión del administrador, ingreso unificado y alta única
  - Tests primero: `admin-login.test.ts`, `admin-alta-unica.test.ts`, `email-unico.test.ts` (registro, `POST /api/usuarios` y alta única; el de crear tambo se suma en T3). Después `api/src/admin/{sesionAdmin,middleware,choques,altaUnica}.ts`, login unificado y traducción de choques en `api/src/rutas/auth.ts`, `usuarios.ts` y `auth/registro.ts` (409 de nombre y de email), `api/scripts/crear-administrador.ts`, script `admin:crear` en `api/package.json`, `.env.example`.
  - RF: RF-2, RF-3, RF-4, RF-5, RF-7, RF-9, RF-10, RF-11, RF-15, RF-27 (registro)
  - Hecho cuando: los tres archivos de tests pasan; un ingreso de administrador deja la cookie `sesion_admin` (`path=/api/admin`, token nuevo, 8 horas fijas) y la auditoría; las respuestas de ingreso fallido son idénticas para email inexistente, administrador y usuario; la salida del alta única no contiene la contraseña; los tests existentes de `auth` y `usuarios` siguen en verde.

- [x] **T3** — API `/api/admin`: listado, detalle y crear tambo
  - Tests primero (incluye un tambo con 2 dueños: el listado trae el más antiguo y `duenosAdicionales: 1`): `admin-tambos-lectura.test.ts`, `admin-tambos-crear.test.ts`, `admin-aislamiento.test.ts` (más el caso de crear tambo en `email-unico.test.ts`). Después `api/src/rutas/admin.ts`, `api/src/admin/{listaBlanca,tambos}.ts`, `crearTamboConDueno` con auditoría en la misma transacción, el montaje de un único `requiereAdmin` en `app.ts` antes de los parsers y el límite de creaciones.
  - RF: RF-12, RF-16, RF-17, RF-18, RF-19, RF-20, RF-22, RF-23, RF-24, RF-25, RF-26, RF-27, RF-28, RF-29, RF-30, RF-31
  - Hecho cuando: los tests pasan, incluido el que recorre todas las rutas del administrador (sin sesión 401, rol de tambo 403, cookie del administrador rechazada en las rutas del tambo), el de claves exactas de la lista blanca y el de "falla el alta del dueño: no queda tambo, lotes ni auditoría"; ningún módulo de `api/src/admin/` consulta datos del tambo salvo el conteo de animales activos.

- [x] **T4** — Web: sesión del administrador separada del almacén local
  - Tests primero: `web/tests/sesion-admin.test.ts` y `web/tests/api-admin.test.ts`. Después `web/src/sesion/sesionAdmin.ts`, `auth.tsx` (estado `admin`, `logoutAdmin`, arranque con `/auth/yo` y luego `/admin/yo`), `compartido/api.ts` (rutas `/admin` sin copia local, `/admin/yo` con 401 normal, `alVencerSesion` apaga ambas sesiones), `Rutas.tsx` (`RutaAdmin` y redirecciones) y `App.tsx` con las rutas `/admin` apuntando a pantallas provisorias; `Login.tsx` con el subtítulo "Ingresá".
  - RF: RF-13, RF-14, RF-21
  - Hecho cuando: los tests de la web pasan (el ingreso y el cierre del administrador no tocan el almacén, una tablet con datos de un tambo no se borra ni pide confirmación, sin conexión sale "Esto necesita conexión" sin leer la copia) y `npm run typecheck` está en verde; los tests de la web existentes siguen pasando.

- [x] **T5** — Pantallas del administrador, verificación y cierre
  - Pantallas `web/src/admin/{LayoutAdmin,ListadoTambos,TamboDetalle,TamboNuevo}.tsx` y `adminDatos.ts` con estilos en `estilos.css`; verificación en el navegador (768 px y 375 px, claro y oscuro, controles de 48 px, ingreso, listado, detalle, crear con error de nombre repetido, cierre de sesión, y una tablet con datos de un tambo que no se borran al ingresar el administrador); enmienda a `docs/constitution.md` con la excepción acotada tal como la aprobó el usuario (texto de la spec); actualizar `MEMORY.md` (decisiones: tabla aparte, cookie con `path`, disparador de email, nombre único, un solo administrador, límite aceptado de contraseñas) y `docs/plan.md`; borrar de la base de desarrollo cualquier tambo o administrador de prueba; correr `npm test` y `npm run typecheck` completos.
  - RF: RF-32, RF-33 (y cierre de todos los RF y criterios de aceptación)
  - Hecho cuando: los criterios de aceptación de la spec están marcados, la verificación manual no muestra desbordes ni controles menores de 48 px, la constitución, `MEMORY.md` y `docs/plan.md` están al día, y todo está commiteado con `npm test` y `npm run typecheck` en verde.
