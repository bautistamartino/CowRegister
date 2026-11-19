# Plan — 014 Administrador de la plataforma

Spec: [spec.md](spec.md) (aprobada, incluida la excepción acotada al principio 1)

## Resumen
El administrador vive en tablas propias (`administradores`, `sesiones_admin`, `auditoria_admin`), con cookie propia y rutas bajo `/api/admin` detrás de **un único** `requiereAdmin`. El ingreso sigue siendo `POST /api/auth/login` (un solo endpoint y contador por IP) que busca en las dos tablas con una sola verificación de contraseña. Las garantías críticas (email único entre administradores y usuarios, nombre de tambo único, un solo administrador, auditoría solo-agregar) van en la base con SQL a mano. En la web, el administrador tiene su estado aparte en `AuthProvider` y **nunca** toca el almacén local ni `ColaProvider`.

## Base de datos

### Modelos nuevos (`api/prisma/schema.prisma`)
- `Administrador`: `id` UUID, `nombre`, `email` (`@unique`, siempre en minúsculas), `passwordHash`, `creadoEn`, `actualizadoEn`. `@@map("administradores")`.
- `SesionAdmin`: `id` UUID, `administradorId` (FK `onDelete: Cascade`), `tokenHash` (`@unique`, SHA-256 como `Sesion`), `expiraEn`, `creadoEn`. `@@map("sesiones_admin")`. Tabla distinta de `sesiones`: así una cookie de uno nunca puede resolverse contra la tabla del otro.
- `AuditoriaAdmin` (solo se agrega, sin `actualizadoEn`): `id` UUID, `accion` (enum `AccionAdmin`: `INGRESO`, `INGRESO_FALLIDO`, `TAMBO_CREADO`), `administradorId` (FK `Restrict`), `establecimientoId` UUID **sin clave foránea** (nulo salvo en `TAMBO_CREADO`) y `tamboNombre` (texto copiado), `creadoEn`. Sin IP ni contraseña. `@@index([administradorId, creadoEn])`. La 015 suma acciones al enum con `ALTER TYPE ... ADD VALUE`.
- `Establecimiento` y `Usuario` no cambian de forma (el tambo del usuario sigue siendo obligatorio: eso es lo que garantiza que `establecimientoId` nunca es nulo en una ruta del tambo).

### Migración `administrador_base` (SQL a mano, cada bloque con comentario)
Se crea con `prisma migrate dev --create-only` y se edita; si es no interactivo, carpeta a mano y `migrate deploy` (ver MEMORY.md).
1. **Nombre de tambo único (RF-27, RF-34).** Primero un bloque `DO $$` entre marcadores `-- INICIO DEDUPE NOMBRES` / `-- FIN DEDUPE NOMBRES` (el test lo ejecuta, como el de la spec 001): para cada grupo de tambos con la misma clave `lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g'))`, el más antiguo (`creadoEn`, luego `id`) conserva el nombre y los demás pasan a `<nombre> (2)`, `(3)`… (se repite hasta que el nombre nuevo no choque). Después, `CREATE UNIQUE INDEX establecimientos_nombre_unico ON establecimientos (lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g')))`. La base de desarrollo hoy tiene solo "Libertad": la migración no cambia nada ahí.
2. **Un solo administrador (decisión de la spec):** `CREATE UNIQUE INDEX administradores_uno_solo ON administradores ((true))`. Cuando se quiera más de uno, una migración lo quita.
3. **CHECK `administradores_email_normalizado`:** `email = lower(btrim(email))`.
4. **Email único entre las dos tablas (RF-7, RF-8).** Función `email_unico_entre_cuentas()` y dos disparadores `BEFORE INSERT OR UPDATE OF email` (en `usuarios` y en `administradores`). La función toma `pg_advisory_xact_lock(hashtextextended(lower(NEW.email), 0))` (serializa dos altas simultáneas del mismo email aunque vayan a tablas distintas; el segundo espera al primero y ve su fila confirmada) y, si el email existe en la **otra** tabla, hace `RAISE EXCEPTION ... USING ERRCODE = '23505'` (violación de unicidad, que Prisma entrega como `P2002` y la API ya traduce a 409). La unicidad dentro de cada tabla sigue en su índice único.
5. **`auditoria_admin`:** disparador `BEFORE UPDATE OR DELETE` que falla (solo se agrega; `TRUNCATE` no lo dispara, así que `limpiarBase` sigue andando) y CHECK de coherencia: `TAMBO_CREADO` exige `establecimientoId` y `tamboNombre`; las otras acciones los exigen nulos.

`migrate diff` esperado después: solo las **tres** claves foráneas de lote previo (bajas, partos y secados); los índices de expresión, disparadores y CHECK no deben aparecer. No aplicar esa propuesta.

### Datos existentes
No hay administradores. Los tambos con nombres repetidos se resuelven en el bloque 1. El dueño actual de "Libertad" no cambia.

## API

### Sesión del administrador (`api/src/admin/`)
- `sesionAdmin.ts`: `COOKIE_ADMIN = 'sesion_admin'`; `iniciarSesionAdmin(res, administradorId)` genera **siempre** un token nuevo (`randomBytes(32)`), guarda solo el hash, `expiraEn` = ahora + **8 horas fijas** (no se renueva con el uso; `LIMITE`/duración leídas de una constante exportada, inyectable para tests); cookie `httpOnly`, `sameSite: 'strict'`, `secure` en producción y **`path: '/api/admin'`**, de modo que el navegador ni siquiera la envía a las rutas del tambo. `buscarSesionAdmin(token)`, `cerrarSesionAdmin`.
- `middleware.ts`: `requiereAdmin` (único). Lee solo `sesion_admin`: válida → `req.administrador`; si no hay sesión de administrador pero la cookie `sesion` de tambo es válida → **403** "No tenés permiso para hacer esto"; si no hay nada → **401** "Tenés que iniciar sesión". Las rutas del tambo siguen usando `requiereSesion`, que solo mira la cookie `sesion` y por eso rechaza (401) la del administrador.
- Montaje: en `app.ts`, **una sola línea** `app.use('/api/admin', requiereAdmin)` antes de los parsers de JSON (así sin sesión es 401 y con rol de tambo 403 aun con JSON roto) y después `app.use('/api/admin', rutasAdmin)`. El router no vuelve a aplicar el control.

### Rutas
| Método y ruta | Rol | Qué hace | RF |
|---|---|---|---|
| `POST /api/auth/login` (existente, ampliada) | público | Login unificado: busca el email en `administradores` y, si no está, en `usuarios`; hace **una** verificación argon2 (contra el hash encontrado o el falso) → tiempo parecido. Administrador correcto: crea `sesiones_admin`, cookie `sesion_admin`, audita `INGRESO`, responde `{ rol: 'ADMIN', id, nombre, email }` (sin `establecimiento`). Contraseña mala con email de administrador: audita `INGRESO_FALLIDO`. Mismo mensaje genérico y mismo `limiteIntentos` en todos los casos | RF-2, 3, 4, 5, 15 |
| `POST /api/auth/registro` (existente) | público | Sin cambios de comportamiento, salvo 409 por email de administrador (cubierto por la base) y 409 "Ya existe un tambo con ese nombre" | RF-7, 27 |
| `POST /api/usuarios` (existente) | dueño | Igual; el email de un administrador da 409 | RF-7 |
| `GET /api/admin/yo` | admin | Perfil del administrador (id, nombre, email) | RF-4 |
| `POST /api/admin/logout` | admin | Borra la sesión de `sesiones_admin` y la cookie | RF-13 |
| `GET /api/admin/tambos` | admin | Listado ordenado por nombre | RF-16, 17, 19, 31 |
| `GET /api/admin/tambos/:id` | admin | Detalle con usuarios; id mal formado o inexistente: 404 | RF-18, 19, 20, 31 |
| `POST /api/admin/tambos` | admin | Crea tambo + dueño + lotes + auditoría `TAMBO_CREADO` en una transacción; 201 con el ítem del listado; no inicia sesión | RF-22 a 28 |

- **Lista blanca** (constantes en `api/src/admin/listaBlanca.ts` y usadas por los tests): ítem de listado `{ id, nombre, creadoEn, dueno: { nombre, email } | null, duenosAdicionales, usuariosActivos, animalesActivos }`; detalle = ítem + `usuarios: [{ nombre, email, rol, activo }]` (la pantalla destaca a los de rol `DUENO`); perfil `{ id, nombre, email }`. El "dueño" del listado es el usuario con rol `DUENO` más antiguo y `duenosAdicionales` es la cantidad de los demás dueños (la pantalla muestra "Ana López +1"); cada dueño ingresa de forma independiente. Se arman con `select` explícito, nunca con un objeto entero.
- **Única consulta sobre datos del tambo:** `contarAnimalesActivos` en `api/src/admin/tambos.ts` (`groupBy` de `animal` por tambo con `estado != BAJA`); ningún otro módulo de `api/src/admin/` importa `animal`, `evento`, `lote` ni `produccion` (lo verifica un test que lee el código fuente de la carpeta).
- **Choques en la base** (`api/src/admin/choques.ts`): tras un `P2002` en el alta, se vuelve a consultar qué chocó (nombre del tambo o email) y se responde 409 "Ya existe un tambo con ese nombre" o "Ya existe una cuenta con ese email"; si no se puede determinar, el 409 genérico del manejador central. Se usa en `POST /admin/tambos`, `POST /auth/registro` y `POST /usuarios`.
- **Límites:** `limiteAdmin` con `express-rate-limit` en `POST /api/admin/tambos` (por defecto 20 por hora; variable `LIMITE_ACCIONES_ADMIN` para los tests). Los ingresos usan el `limiteIntentos` existente (RF-2).
- **Alta de tambo reutilizada:** `crearTamboConDueno` (`api/src/auth/registro.ts`) recibe un parámetro opcional `{ administradorId }`; si viene, crea el registro de auditoría dentro de la misma transacción. La normalización del nombre usa `normalizarNombre` (NFC y espacios colapsados) en las dos vías de alta.

### Alta única del primer administrador
- Lógica en `api/src/admin/altaUnica.ts` (`ejecutarAltaUnica({ argumentos, env, leerPassword, escribir })`), con un envoltorio fino `api/scripts/crear-administrador.ts`. Comando: `npm run admin:crear -w api -- --nombre "Nombre" --email correo@ejemplo.com` (script `"admin:crear": "tsx scripts/crear-administrador.ts"` en `api/package.json`).
- Contraseña: variable de entorno `ADMIN_PASSWORD` pasada en la misma línea del comando (no en `.env`) o, si no está, una entrada por consola **sin eco** (`readline` con la salida silenciada, pedida dos veces). Se valida con `passwordSchema` y se guarda con `hashearPassword`.
- Se detiene sin cambios si ya hay un administrador (`count > 0`) o el email existe en cualquiera de las dos tablas; la carrera de dos ejecuciones la resuelven el índice `administradores_uno_solo` y el disparador (el script traduce el choque al mismo mensaje). Todo lo que escribe sale por `escribir` y nunca incluye la contraseña ni el hash.

## Interfaz (`web/src/`)
- **Estado separado:** `AuthProvider` suma `admin: PerfilAdmin | null` y `logoutAdmin()`, aparte de `usuario`. `login()` mira `rol === 'ADMIN'` en la respuesta: si es administrador **no** llama a `entrar`, así no se evalúa el propietario, no se guarda perfil y no se borra nada; devuelve un resultado que lleva a `/admin`. `SinConexionProvider` y `ColaProvider` solo leen `usuario`, por lo que con un administrador quedan inertes.
- **`web/src/sesion/sesionAdmin.ts`** (puro, sin importar nada de `sinconexion/`): `esPerfilAdmin`, `ingresarAdmin`, `cerrarSesionAdmin`; el test lo corre con `obtenerAlmacen` mockeado para que falle si se lo llama y revisa que el archivo no importe `sinconexion`.
- **Arranque:** `/auth/yo` y, si da 401, `/admin/yo` (agregado a las rutas con 401 normal). Un 401 posterior apaga las dos sesiones en `alVencerSesion`.
- **`api()` (`compartido/api.ts`):** las rutas que empiezan con `/admin` van siempre a la red; sin conexión lanzan "Esto necesita conexión" **sin** consultar la copia local ni la vista local, y un fallo de red no la consulta (RF-13, RF-21).
- **Rutas y guardas (`App.tsx`, `Rutas.tsx`):** `RutaAdmin` (exige `admin`, si no va a `/login`); `RutaPrivada` y `RutaPublica` mandan al administrador a `/admin`. Pantallas bajo `/admin`: `/admin` (listado), `/admin/tambos/nuevo`, `/admin/tambos/:id`. Ninguna usa `Layout` del tambo.
- **Pantallas (`web/src/admin/`):** `LayoutAdmin.tsx` (barra con nombre del administrador y "Cerrar sesión", sin menú del tambo), `ListadoTambos.tsx` (tarjetas/filas con nombre, dueño, alta, usuarios activos, animales activos; botón "Crear tambo"), `TamboDetalle.tsx` (datos y usuarios), `TamboNuevo.tsx` (formulario con errores por campo y el 409 de nombre o email repetido), `adminDatos.ts` (tipos y llamadas). Fechas en hora de Argentina con `horaArgentina.ts`. Controles de 48 px, variables de `estilos.css`, claro y oscuro; en 375 px las filas pasan a tarjetas. En `Login.tsx` el subtítulo pasa a "Ingresá".

## Archivos
- Crear: `api/prisma/migrations/<fecha>_administrador_base/migration.sql`; `api/src/admin/{sesionAdmin,middleware,listaBlanca,tambos,choques,altaUnica}.ts`; `api/src/rutas/admin.ts`; `api/scripts/crear-administrador.ts`; `web/src/admin/{LayoutAdmin,ListadoTambos,TamboDetalle,TamboNuevo}.tsx` y `adminDatos.ts`; `web/src/sesion/sesionAdmin.ts`; tests (ver estrategia).
- Modificar: `api/prisma/schema.prisma`; `api/src/app.ts`; `api/src/rutas/auth.ts`; `api/src/rutas/usuarios.ts`; `api/src/auth/registro.ts`; `api/package.json`; `api/tests/ayudas.ts` (`limpiarBase` suma las tres tablas nuevas y ayudas `crearAdministradorDirecto` / `iniciarSesionAdmin`); `.env.example` (documenta `ADMIN_PASSWORD` como variable de uso único, sin valor); `web/src/sesion/auth.tsx`, `Login.tsx`; `web/src/compartido/{api.ts,Rutas.tsx}`; `web/src/App.tsx`; `docs/constitution.md`, `docs/plan.md`, `MEMORY.md` (en la última tarea).

## Decisiones
- **Administrador en tabla aparte** — así `establecimientoId` nunca es nulo en una ruta del tambo y ninguna consulta existente puede devolver, por error, una sesión sin tambo. Alternativa descartada: `Usuario` con `establecimientoId` nulo y rol `ADMIN`, porque obliga a revisar y proteger cada consulta existente y un olvido filtraría datos de todos los tambos.
- **Sesión y cookie propias con `path: '/api/admin'`** — el navegador no manda la cookie del administrador a las rutas del tambo; el aislamiento no depende solo del código. Alternativa descartada: la misma cookie `sesion` con otra tabla de búsqueda, porque mezcla dos orígenes de confianza en un mismo lugar.
- **Duración fija de 8 horas, sin renovar** — acota el daño de una cookie robada. Alternativa descartada: 30 días como el resto, porque el administrador toca todos los tambos.
- **Login unificado en el mismo endpoint** — comparte contador por IP y no revela de qué grupo es un email; una sola verificación argon2 mantiene el tiempo parecido. Alternativa descartada: `/api/admin/login` aparte, porque da otro contador (se puede probar contra cada uno) y delata que existe un administrador.
- **Email único entre tablas con disparador y bloqueo asesor** — el único mecanismo que serializa altas simultáneas en tablas distintas. Alternativa descartada: una tabla `cuentas_email` mantenida a mano, porque exige tocar todas las altas y se desincroniza.
- **Un solo administrador con índice `((true))`** — la decisión del usuario queda garantizada en la base. Alternativa descartada: solo validarlo en el script, porque dos ejecuciones simultáneas podrían crear dos.
- **Nombre de tambo único con índice de expresión** — sin distinguir mayúsculas y colapsando espacios, en la base (principio 6). Alternativa descartada: validar solo en el código, porque no cubre la carrera ni otros caminos de alta.
- **Duplicados existentes: renombrar al más nuevo con número** — la migración nunca falla ni borra. Alternativa descartada: abortar con un error, porque dejaría la actualización trabada.
- **Auditoría sin clave foránea al tambo, con nombre copiado** — igual que los demás historiales: no se pierde si el tambo cambia. Alternativa descartada: clave foránea `Restrict`, porque estorbaría las limpiezas de datos de prueba.
- **Alta única con la lógica fuera del script** — se prueba sin lanzar procesos y se puede verificar que la salida no contiene la contraseña. Alternativa descartada: todo dentro del script, porque no se puede testear con facilidad.
- **El administrador no pasa por el almacén local** — estado propio en `AuthProvider` y `api()` sin copia para `/admin`. Alternativa descartada: reutilizar `entrar()`, porque evalúa propietario y podría borrar los datos de una tablet de un tambo.

## Estrategia de tests
Tests primero, base `cowregister_test`.
| RF | Test (archivo › caso) |
|---|---|
| RF-1, 7, 8, 27, 34 | `api/tests/base-admin.test.ts` › índices, disparadores y CHECK directo en la base: email repetido entre tablas (en los dos sentidos, y por `UPDATE`) rechazado con 23505; dos altas simultáneas con el mismo email en tablas distintas dejan una sola; nombre de tambo repetido con otras mayúsculas y espacios rechazado; segundo administrador rechazado; auditoría rechaza `UPDATE` y `DELETE`; el bloque de dedupe de la migración se ejecuta sobre duplicados sembrados (renombra al más nuevo, conserva datos) |
| RF-7 | `api/tests/email-unico.test.ts` › un caso por punto de alta: registro, `POST /api/usuarios`, crear tambo del administrador (409 también con el email de un usuario de un tambo) y alta única |
| RF-2, 3 | `api/tests/admin-login.test.ts` › mismas respuestas con email inexistente, administrador con contraseña mala y usuario con contraseña mala; contador de intentos compartido |
| RF-4, 5 | `admin-login.test.ts` › el administrador entra, cookie `sesion_admin` con `path=/api/admin`, `httpOnly`; dos ingresos dan tokens distintos; la sesión vence a las 8 horas sin renovarse (reloj inyectado) |
| RF-15 | `admin-login.test.ts` › ingreso correcto y fallido auditados sin contraseña |
| RF-9, 10, 11 | `api/tests/admin-alta-unica.test.ts` › crea; segunda vez no cambia nada; email existente en cualquiera de las dos tablas; la salida de `escribir` no contiene la contraseña ni el hash |
| RF-6, 29, 30 | `api/tests/admin-aislamiento.test.ts` › recorre `rutasAdmin.stack` (allowlist exacta de rutas): sin sesión 401, dueño/encargado/veterinario 403, administrador pasa; la cookie del administrador en rutas del tambo (`/api/auth/yo`, `/api/copia-local`, `/api/animales`, `/api/usuarios`, `/api/lotes`) da 401; la `sesion` de tambo en `/api/admin/*` da 403 |
| RF-12 | `admin-aislamiento.test.ts` › allowlist de rutas de `rutasAuth` y de `rutasAdmin` (falla si aparece una nueva que cree o modifique administradores); `POST /api/usuarios` con rol `ADMIN` da 400; el código de `api/src/admin/` no importa `animal`, `evento`, `lote` ni `produccion` salvo `contarAnimalesActivos` |
| Tambo sin nulo | `admin-aislamiento.test.ts` › en la base no hay usuarios con `establecimientoId` nulo (la columna es `NOT NULL`) y `requiereSesion` nunca produce `establecimientoId` vacío |
| RF-16, 17, 18, 19, 20, 31 | `api/tests/admin-tambos-lectura.test.ts` › tambo con 2 dueños (listado con el más antiguo y `duenosAdicionales: 1`, detalle con los dos); cantidades (usuarios activos en el listado, todos en el detalle; animales activos sin contar las bajas), orden por nombre, claves exactamente iguales a la lista blanca, nada de `passwordHash`/`tokenHash`/animales/eventos, id mal formado e inexistente 404 |
| RF-22, 23, 25 | `api/tests/admin-tambos-crear.test.ts` › deja tambo, dueño, 4 lotes con destinos y auditoría; no cambia la cookie del administrador ni crea `sesiones`; la respuesta no trae contraseña ni hash; si falla el alta del dueño no queda tambo, lotes ni auditoría |
| RF-24, 26, 27, 28 | `admin-tambos-crear.test.ts` › 409 por email repetido; 400 por campo inválido; 409 "Ya existe un tambo con ese nombre" (también `" libertad  "`) y en `POST /api/auth/registro`; dos creaciones simultáneas con el mismo nombre dejan un solo tambo; el límite responde "Demasiados intentos" |
| RF-13, 14 | `web/tests/sesion-admin.test.ts` › `obtenerAlmacen` mockeado que lanza: el ingreso y el cierre del administrador no lo llaman; `sesionAdmin.ts` no importa `sinconexion`; el ingreso de un administrador con datos de un tambo en el almacén de memoria no borra ni pide confirmación |
| RF-21 | `web/tests/api-admin.test.ts` › sin conexión, un pedido a `/admin/...` da "Esto necesita conexión" sin leer la copia ni la vista local |
| RF-32, 33 | Verificación en el navegador (tarea 5): 768 y 375 px, claro y oscuro, 48 px |

## Riesgos
- **El disparador y el bloqueo asesor** son SQL a mano que Prisma no ve: un test directo en la base y el `migrate diff` esperado los cuidan.
- **`P2002` desde el adaptador `pg`:** el manejador central ya lo traduce hoy; el helper de choques consulta de nuevo para no depender del detalle del error.
- **Los tests de concurrencia** son lentos en esta computadora (MEMORY.md): los nuevos son pocos y usan solo dos pedidos simultáneos.
- **013:** al cerrar el registro público, `POST /api/auth/registro` queda fuera de producción pero la restricción de nombre y email sigue en la base.
