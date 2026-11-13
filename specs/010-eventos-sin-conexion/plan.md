# Plan — 010 Eventos sin conexión (parte 1): API idempotente y motor local

Spec: [spec.md](spec.md) (aprobada)

## Resumen
En la API, los cinco eventos (servicio, tacto, parto, secado, baja) aceptan un `id` propio y se pueden reenviar sin duplicar: la clave primaria de `eventos` es la llave de idempotencia, la comprobación se hace con la vaca bloqueada y **antes** del 404 por estado, y un choque de la base se traduce siempre a 200 o 409 (nunca 500). La anulación es idempotente por evento + usuario + motivo. `eventos` suma dos columnas (hora informativa de la tablet y los avisos que se dieron al aceptar), `siguienteRegistro` mira también los cambios manuales y la copia suma el semen activo.

En la web (`web/src/sinconexion/`, lógica pura con Vitest, sin pantallas nuevas) se generaliza la cola a todos los tipos, se migra IndexedDB a la versión 3 conservando los litros de la 009, se arma una **vista local** de cada vaca (copia + pendientes), se portan las reglas del servidor con una **tabla de casos compartida** que corren los dos Vitest, y se reescribe el sincronizador con orden y espera por vaca. La pantalla "Pendientes" de la 009 solo se adapta para mostrar los tipos nuevos; los formularios son de la 011.

## Base de datos

### Migración `20261112190000_eventos_sin_conexion`
`Evento` suma dos columnas (las comparten los cinco tipos porque todos viven en `eventos`):

| Columna | Tipo | Para qué |
|---|---|---|
| `cargadoEnDispositivo` | `DateTime?` (`TIMESTAMP(3)`) | Hora que tenía la tablet al cargar (RF-3). Solo informativa: nunca ordena, valida ni calcula. Nula si no vino o si venía de un reloj desfasado. |
| `avisosAlAceptar` | `Json` (`JSONB NOT NULL DEFAULT '[]'`) | Avisos que el servidor dio al aceptar el evento por primera vez, para devolverlos idénticos en el reenvío (RF-5). Se escribe en el mismo `INSERT` y no se modifica nunca. |

SQL (se crea la carpeta a mano, como en la 009, y se aplica con `prisma migrate deploy`; `migrate dev` falla sin terminal interactiva):
- `ALTER TABLE "eventos" ADD COLUMN "cargadoEnDispositivo" TIMESTAMP(3), ADD COLUMN "avisosAlAceptar" JSONB NOT NULL DEFAULT '[]';` (en PostgreSQL 18 un `DEFAULT` constante no reescribe la tabla).
- **A mano** (constitución 6, con comentario en el SQL):
  - `ALTER TABLE "eventos" ADD CONSTRAINT "eventos_hora_dispositivo_rango" CHECK ("cargadoEnDispositivo" IS NULL OR "cargadoEnDispositivo" >= TIMESTAMP '2000-01-01');` (RF-3: la base impide una hora anterior al 2000; lo de "más de 5 minutos adelantada" depende del reloj y lo controla la API, que guarda `null`.)
  - `ALTER TABLE "eventos" ADD CONSTRAINT "eventos_avisos_es_lista" CHECK (jsonb_typeof("avisosAlAceptar") = 'array');`
- **Triggers:** `eventos` solo tiene el constraint trigger `eventos_bajas_coherencia` (mira la baja, no estas columnas); no hay trigger de "solo agregar" sobre `eventos`, `partos` ni `secados`. El implementador lo confirma leyendo `bajas_base` antes de aplicar. Un test deja asentado que las dos columnas no cambian al anular.
- **Índices:** ninguno nuevo. La búsqueda por `id` usa la clave primaria; el máximo de `creadoEn` por animal usa el índice único `(animalId, creadoEn)` de `eventos` y el índice `(animalId, creadoEn)` de `cambios_animal`.
- **`schema.prisma`:** los dos campos en `Evento` con comentario que remite a esta spec; `avisosAlAceptar Json @default("[]")`.
- **`migrate diff` esperado** (antes y después de aplicar): solo las **tres claves foráneas de lote previo** de siempre (bajas, partos y secados); no aplicarlas. Las dos columnas y los dos CHECK no deben aparecer como diferencia (los CHECK no los ve Prisma; las columnas deben coincidir con el schema).

## API

El tambo y el usuario salen de la sesión en todas las rutas; cualquier `establecimientoId` del cuerpo se ignora. Los controles de sesión y rol de `app.ts` (antes de los parsers de JSON) no cambian.

| Método y ruta | Rol | Qué cambia | RF |
|---|---|---|---|
| `POST /api/animales/:id/servicios` | los tres | Acepta `id` y `cargadoEnDispositivo`; idempotente; 201 al crear, **200** `{ evento, avisos: [], yaExistia: true }` al reenviar igual | RF-3 a RF-6, RF-9 a RF-11 |
| `POST /api/animales/:id/tactos` | los tres | Ídem | ídem |
| `POST /api/animales/:id/partos` | dueño, encargado | Ídem; guarda los avisos al aceptar y los devuelve en el reenvío; no duplica crías, estado ni lote | ídem |
| `POST /api/animales/:id/secados` | dueño, encargado | Ídem | ídem |
| `POST /api/animales/:id/baja` | dueño, encargado | Ídem; el reenvío de una baja ya hecha da 200, no 404 | ídem |
| `POST /api/servicios/:id/anular`, `/api/tactos/:id/anular` | los tres | Mismo evento + usuario + motivo ya anulado: 200 con la forma de siempre más `yaEstabaAnulado: true`; sin `id` propio | RF-7, RF-10, RF-11 |
| `POST /api/partos/:id/anular`, `/api/secados/:id/anular` | dueño, encargado | Ídem (`{ evento, avisos: [], yaEstabaAnulado: true }`) | RF-7, RF-10, RF-11 |
| `GET /api/copia-local` | los tres | Suma `semen: [{ id, nombre, raza }]` (solo activos del tambo de la sesión) en la misma transacción `RepeatableRead`; sin tope propio | RF-8, RF-11 |
| Lecturas de eventos (`/eventos`, `/historial`, copia, ficha de baja) | los tres | Cada evento suma `cargadoEnDispositivo` (ISO o `null`) | RF-3 |

### Contrato de las cargas (cuerpo)
- `id` (opcional): UUID; se normaliza a minúsculas como en los litros. Mal formado: **400** "El identificador del registro tiene que ser un UUID válido".
- `cargadoEnDispositivo` (opcional): mismo esquema que ya usa la carga de litros (se extrae a `api/src/horaTablet.ts` y la 009 lo importa de ahí, sin cambiar su comportamiento): formato inválido 400 con "La hora de carga de la tablet no es una fecha y hora válida"; ausente o `null`, se guarda sin el dato; más de 5 minutos posterior a `ahora()` o anterior al 2000, se guarda el evento **sin el dato**.
- El resto del cuerpo, sus validaciones y sus mensajes no cambian.

### Orden de controles de cada carga (RF-5, RF-6)
Sesión (401) → rol (403) → cuerpo (400) → id del animal en la ruta (404) → transacción: bloquear al animal → **re-lectura por `id`** → reglas de la 003 a la 006 → inserción con ese `id`.

La re-lectura por `id` se hace **después de bloquear y también cuando el animal ya no está activo** (antes de contestar 404):
- El evento existe, es del mismo tambo, del mismo animal, del mismo usuario y con los mismos datos: **200** "ya estaba guardado" (`{ evento, avisos, yaExistia: true }`, el evento armado como en la lista y los avisos guardados en `avisosAlAceptar`; para la baja, `evento` es el mismo objeto plano que devuelve el 201). No se evalúa ninguna regla ni se toca nada.
- El `id` existe con otros datos, otro animal, otro usuario, otro tipo o es de otro tambo: **409** genérico "Ese identificador de registro ya se usó con otros datos" (el mismo texto de los litros), sin decir cuál de los casos es. Si además el animal de la ruta no es accesible (ajeno, inexistente o de baja) y el evento no es "el mismo", gana el **404** de siempre: nunca se confirma que existe algo de otro tambo.
- No existe: sigue el flujo normal.

Si la base protesta por la clave primaria al insertar (dos pedidos con el mismo `id` sobre animales distintos, o cualquier carrera que se haya escapado), el `catch` **fuera de la transacción** vuelve a leer por `id` con una lectura nueva y responde 200 o 409 según corresponda; un `P2002` que no es del `id` conserva su traducción actual (número de cría ocupado, etc.). Nunca 500 (RF-6).

### Comparación de "mismos datos" (RF-5)
Funciones **puras** en `api/src/reproduccion/idempotencia.ts`, una por tipo, con test propio:
- Todas: animal, usuario que lo cargó y tipo. La hora informativa no cuenta.
- Servicio: fecha, tipo de servicio y semen o toro (`null`, ausente y vacío son lo mismo).
- Tacto: fecha, resultado, fecha probable indicada (`null` = ausente) y anomalías **como conjunto**: se parten por coma o punto y coma, se recortan, se descartan los vacíos y se comparan sin importar el orden (el campo es texto libre; esta es la única lectura de "conjunto" posible).
- Parto: fecha y crías **en el orden enviado** (sexo, nacida muerta, número de la viva y observaciones; `null` = vacío).
- Secado: fecha.
- Baja: fecha, motivo y observaciones (`null` = vacío).

### Anulación idempotente (RF-7)
En `anularEvento`: la búsqueda inicial deja de filtrar por animal activo. Si el evento (del tambo y del tipo de la ruta) no existe: 404. Si está anulado: **mismo usuario y mismo motivo** (el motivo ya llega recortado y normalizado) → 200 `yaEstabaAnulado`; otro usuario u otro motivo → 409 "Este <tipo> ya fue anulado" (también cuando el animal ya está de baja; hoy ese caso daba 404, cambio mínimo pedido por el RF-7). Si no está anulado y el animal no está activo: el 404 de siempre. La misma comprobación se repite **después de bloquear** y releer (un reenvío que esperó la lock de la primera anulación debe contestar `yaEstabaAnulado`, no 409).

### `siguienteRegistro` (RF-2)
Devuelve el mayor entre la hora real y 1 ms después del máximo `creadoEn` de **cualquier evento del animal (anulados incluidos) y de cualquier cambio manual del animal** (`cambios_animal`). Dos agregados con índice, ya dentro de la transacción con el animal bloqueado. La edición del animal (spec 005) también la usa, así que queda asegurado en los dos sentidos.

### Copia con semen (RF-8)
`armarCopiaLocal` lee `semenToro` activos del tambo (id, nombre y raza), ordenados por nombre sin distinguir mayúsculas, **dentro de la misma transacción**; no cuentan para el tope de 5.000 y el 422 sigue sin leer nada. Se suma la etapa `'semen'` al gancho de prueba. Sin `activo` ni `establecimientoId` en la respuesta.

## Interfaz
No hay pantallas nuevas. Lo único visible es que la pantalla "Pendientes de sincronizar" (`web/src/sinconexion/Pendientes.tsx`) muestra, para cualquier tipo, el número de la vaca, un texto de tipo ("Servicio", "Tacto", "Parto", "Secado", "Baja", "Anulación de …", "Litros") y el estado, con los botones de la 009 (Reintentar, Reintentar ahora, Descartar). Los resúmenes ("Parto con 2 crías"), las marcas en la ficha y los formularios son de la 011. A 768 px; controles de 48 px como ya están.

## Motor local (web)

### Modelo de datos del almacén (versión 3)
```
Pendiente = { id (= id del evento), usuarioId, establecimientoId, animalId, numero (de la vaca),
              tipo: 'LITROS'|'SERVICIO'|'TACTO'|'PARTO'|'SECADO'|'BAJA'|'ANULACION',
              datos: <lo que se manda, por tipo>, cargadoEnDispositivo, orden,
              estado: 'esperando'|'enviando'|'rechazado', motivo, codigoRechazo, intentos, proximoIntento }
Enviado   = { id, usuarioId, establecimientoId, animalId, numero, tipo, datos,
              aceptadoEn (ms, hora del SERVIDOR: registradoEn / anulación.en de la respuesta),
              registro: RegistroProduccion | null (solo litros, como en la 009) }
AvisoGuardado = { id (= id del pendiente), usuarioId, establecimientoId, animalId, numero, tipo, avisos[] }
```
- `datos` de una anulación: `{ eventoId, tipoEvento, motivo }`; de un parto: `{ fecha, crias[] }` (todas las crías en **un solo** pendiente); de litros: `{ fecha, turno, litros }`.
- **"En espera del anterior" no se guarda: se calcula** (`dependencias.ts`). Los estados guardados son `esperando`, `enviando` y `rechazado`; "enviado" es el almacén `enviados`. Así reintentar o descartar el rechazado libera solo a los que esperaban y no puede quedar un estado viejo.
- Un almacén nuevo `avisos` (clave `id`): los avisos del servidor **sobreviven al enviado** (que se quita cuando la copia lo refleja) y solo se borran al cerrarlos el usuario (RF-28). `aceptarPendiente(id, enviado, avisos)` escribe los tres almacenes en **una** transacción.
- `MetaCopia` suma `semen?` (opcional: una copia guardada antes de la 010 no lo tiene; mientras falte, la regla local de "semen activo" no se aplica y decide el servidor).

### Migración de IndexedDB 2 → 3 (RF-13)
- `VERSION = 3` en `almacenIndexedDb.ts`. En `onupgradeneeded`: crea `avisos` y, si `oldVersion < 3`, recorre con un cursor (dentro de la propia transacción de `versionchange`, así es atómica) los almacenes `pendientes` y `enviados` y reescribe cada registro con funciones **puras** de `formatoAlmacen.ts`:
  - `migrarPendiente009`: agrega `tipo: 'LITROS'` y mueve `fecha`, `turno` y `litros` a `datos`; conserva `id`, dueño, `orden`, `estado`, `motivo`, `intentos`, `proximoIntento` y `cargadoEnDispositivo`.
  - `migrarEnviado009`: agrega `tipo: 'LITROS'`, `datos` y `aceptadoEn` (de `registro.registradoEn`); conserva `registro`.
  - Si el registro ya tiene `tipo`, no lo toca (idempotente). Si la transacción falla, el navegador deshace todo y queda la versión 2 intacta.
- **Con qué se prueba:** `fake-indexeddb` como **devDependency de `web`** (ver Decisiones). El test arma una base versión 2 con el formato literal de la 009 (stores `animales`, `meta`, `pendientes`, `enviados`; litros esperando, enviando y rechazados; un enviado; la meta de la copia), la cierra y la abre con `AlmacenIndexedDb`: comprueba que están todos, ninguno duplicado, con el contenido y el orden de antes, que `enviando` sigue siendo restablecible y que el sincronizador los envía con el cuerpo de litros de la 009. Más una comprobación **a mano** en el navegador (dejar litros pendientes con la versión anterior, actualizar y ver que siguen y se envían).
- El almacén en memoria **no** prueba esto (no pasa por el formato real).

### Estructura de módulos nuevos y cambiados en `web/src/sinconexion/`
Todos en minúsculas y sin pares que choquen por mayúsculas con un componente (Windows).

| Módulo | Qué hace | Tarea |
|---|---|---|
| `almacen.ts`, `almacenMemoria.ts`, `almacenIndexedDb.ts` | Tipos nuevos, almacén `avisos`, versión 3 | T2 |
| `formatoAlmacen.ts` (nuevo) | Migración pura 009 → 010 | T2 |
| `dependencias.ts` (nuevo) | Puro: anteriores de una vaca, "puede enviarse", estado visible (incluye "en espera del anterior"), posteriores de un pendiente | T2 |
| `cola.ts` | Cola general: guardar con orden y límite de 500, restablecer `enviando`, conteos de no aceptados; lo específico de litros se adapta | T2 |
| `propietario.ts` | `evaluarIngreso` suma los avisos como dato con dueño | T2 |
| `vistaLocal.ts` (nuevo) | Vista de una vaca: copia + pendientes válidos en orden de carga → situación, estado, crías de partos pendientes, marca "baja", último evento no anulado | T3 |
| `situacionLocal.ts` (nuevo) | Port de `calcularSituacion`, `ultimoNoAnulado`, `resolverFechaProbable`, separación de partos y fecha probable | T3 |
| `reglasLocales.ts` (nuevo) | Port de las validaciones de carga y anulación (fechas, aptitud, preñez, semen, número de cría, "solo el último") con los mismos mensajes | T3 |
| `permisos.ts` (nuevo) | Matriz por rol (RF-10 y RF-22) | T3 |
| `reflejo.ts` (nuevo; reemplaza `limpiarEnviadosIncluidos`) | Qué enviados ya refleja la copia y cuáles se quitan (RF-19) | T3 |
| `registrar.ts` (nuevo) | Punto único de registro de carga o anulación (RF-15) | T4 |
| `anularLocal.ts` (nuevo) | Anular el último evento o descartar si es pendiente (RF-16, RF-17) | T4 |
| `clasificar.ts`, `envio.ts`, `sincronizar.ts` | Respuesta por tipo, envío por tipo, orden por vaca (ver abajo) | T4 |
| `cargarLitros.ts` | Pasa a delegar en `registrar.ts` (conserva su firma para `Produccion.tsx`) | T4 |
| `ColaProvider.tsx`, `Pendientes.tsx`, `Produccion.tsx`, `Layout.tsx` | Conexión con React; mínimos | T2 (compilar) y T5 |

### Vista local y reglas locales (RF-18 a RF-24)
- `construirVista(animalCopia, pendientes, enviados, semen)`: parte de la copia del animal y aplica **en orden de carga** los pendientes `esperando`/`enviando` (que no estén "en espera") y los enviados que la copia todavía no refleja. No cuentan los rechazados ni los "en espera del anterior". Resultado: situación reproductiva (con el mismo cálculo del servidor), estado ("seca" con un secado pendiente; "en ordeñe" con un parto pendiente; "baja" con una baja pendiente o enviada sin reflejar), las crías de cada parto pendiente (número, sexo, nacida muerta) **dentro de ese parto** (no entran al listado ni al buscador), el último evento no anulado (lo que se puede anular) y los números de crías ocupados.
- **Anulación pendiente en la vista:** marca el evento como anulado (así el "último no anulado" retrocede y un servicio puede volver a cargarse); no revierte lote ni estado de partos/secados: el lote no se proyecta (fuera de alcance).
- Número de cría (RF-21): se controla contra los animales activos de la copia, las crías de partos pendientes o enviados sin reflejar y las demás crías del mismo parto. El número de un animal con baja pendiente o enviada queda libre **solo** para pendientes con `orden` posterior al de esa baja.
- Todas las reglas devuelven `{ ok: true }` o `{ ok: false, mensaje, campo? }`. Lo que solo decide el servidor no se porta.
- Litros (RF-24): el formulario se ofrece a una hembra "en ordeñe" **según la vista**; el envío espera a los eventos anteriores de la vaca por `dependencias.ts`.

### Tabla de casos compartida (RF-23)
- **Archivo:** `compartido/casos-reglas-eventos.json` en la raíz del repositorio (carpeta nueva `compartido/`, fuera de `api/` y `web/`). Es **datos**, no código: cada Vitest lo lee con `fs.readFileSync` y `import.meta.dirname` (ya se usa en `web/vite.config.ts`), así no entra en ningún `tsconfig` ni la web importa nada de la API.
- **Forma de cada caso:** `id`, `descripcion`, `tipo` (de la carga o anulación), `rol`, `hoy`, `base` (animales con número, sexo, estado, nacimiento, eventos y semen, con `ref` en vez de UUID), `previas` (lista **ordenada** de acciones que la tablet cargó antes, cada una con `estado: "esperando" | "enviado"`), `pedido` (`animal` y `datos`), `esperado` (`resultado: "ok" | "rechazo"`, `mensaje` exacto, `campo` y `codigo` para la API) y, solo si corresponde, `soloServidor: true` con `motivoSoloServidor` y `alServidor` (lo que pasó en el servidor y **no** está en la copia: un número ocupado después de la copia, un semen desactivado después, etc.).
- **Runner de la API** (`api/tests/casos-compartidos.test.ts`): arma la base con los helpers de `ayudas.ts`, fija el reloj en `hoy`, ejecuta las `previas` y el `pedido` contra las **rutas reales** (con el rol del caso) y compara código y mensaje. Corre todos los casos, también los `soloServidor`.
- **Runner de la web** (`web/tests/casos-compartidos.test.ts`): arma la copia desde `base`, convierte `previas` en pendientes `esperando` o enviados sin reflejar, y compara el resultado de `reglasLocales` con `esperado.mensaje` y `campo`. **Salta** los `soloServidor`, pero un test verifica que cada uno tiene `motivoSoloServidor` y cuenta cuántos se saltan (visible en el informe).
- **Cobertura mínima:** las reglas heredadas de cada tipo (fechas, aptitud, preñez vigente, semen desactivado, fecha probable, separación de 200 días, número de cría, "solo se anula el último", permisos por rol), partos enviados que la copia todavía no trae (con y sin el mismo número de cría), la baja pendiente de otro animal cargada antes y después, un secado pendiente que bloquea litros, y los casos `soloServidor` de RF-20.
- **Orden de trabajo:** primero se escribe la tabla y pasa en la API (así queda probado que describe al servidor real); después se hace pasar la web.

### Sincronización por vaca (RF-25 a RF-29)
- **Quién puede enviarse** (`dependencias.ts`): un pendiente `esperando` con la espera cumplida y **sin anteriores de su vaca que sean eventos** (cualquier estado: si existe en `pendientes`, no fue aceptado). Los litros anteriores no frenan a nadie; los litros esperan solo a los eventos anteriores. Un fallo transitorio de un anterior también frena a los siguientes de esa vaca (sigue en `pendientes`).
- **Estado visible:** `rechazado`, `enviando` o `esperando` como están guardados; `enEspera` si hay **un evento anterior rechazado** de la misma vaca (un litro rechazado no frena a nadie).
- **Ronda:** se repite "elegir el primero que puede enviarse por orden de carga, enviarlo, guardar el resultado" hasta que no quede ninguno, intentando **cada pendiente una sola vez por ronda**. Si el primero de una cadena se acepta, el siguiente de esa vaca puede salir en la misma ronda; si falla, las demás vacas siguen. Un corte de red (sin llegar al servidor) corta la ronda y un 401 la corta conservando todo (como en la 009). Sigue el candado `navigator.locks` y el envío de a uno.
- **Respuesta cortada:** el pendiente vuelve a `esperando` con el **mismo `id` y el mismo `datos`** (inmutables) y su espera creciente; hasta que se resuelva no sale nada de esa vaca.
- **Clasificación** (`clasificar.ts`): la tabla cerrada de la 009 sin cambios. Para reconocer un "aceptado" 2xx se valida la forma **por tipo**: el 201 de siempre de cada ruta, o el 200 con `yaExistia: true`/`yaEstabaAnulado: true`, y que el `id` del evento coincida con el del pendiente; cualquier otra cosa 2xx (HTML de un portal, por ejemplo) es "esperar". Al aceptar se obtienen `aceptadoEn` y los avisos del cuerpo.
- **Al aceptar:** una sola operación borra el pendiente, guarda el enviado y guarda los avisos (RF-28). Al terminar la ronda con aceptados se actualiza la copia (la 009 RF-35 ya lo dispara desde `ColaProvider`).
- **Reintentar** un rechazado: vuelve a `esperando` (mismo `id`) y libera por cálculo a los que esperaban. **Descartar:** quita el pendiente; devuelve la lista de **posteriores de la misma vaca** (RF-17) sin tocarlos; si el pendiente está "en espera del anterior" el motor pide confirmación (`requiereConfirmacion`) y solo lo quita si le llega confirmada (RF-27); si se está enviando espera el resultado y, si el servidor lo aceptó, responde `ya-guardado` (como en la 009). Un rechazado no se reintenta solo (RF-29).

### Punto único de registro (RF-15 a RF-17, RF-20, RF-22)
`registrar({ tipo, animal, datos })`:
1. Controla el **permiso por rol** (RF-22); no guarda lo que el rol no puede cargar.
2. Decide: "no aceptados delante" = pendientes de **eventos** de esa vaca (para un evento o anulación) o de eventos de esa vaca (para litros: los litros anteriores no cuentan).
3. **Con señal y sin pendientes delante:** envía enseguida con su `id`, sin control local previo; 10 s de tope. Aceptado → guarda el enviado (y los avisos) y devuelve el resultado; rechazado (400, 403, 404, 409) → lo devuelve y no guarda nada; no confirma en 10 s, falla la red, 5xx o 401 → sigue al paso 4 con **el mismo `id`**.
4. **Sin señal, con pendientes delante o sin confirmación:** controla con `reglasLocales` sobre la **vista local**; si es inválido lo devuelve y no guarda; si es válido lo guarda como pendiente **detrás** de los existentes (aunque haya señal) con límite de 500: el mensaje "No se pudo guardar en la tablet: <motivo>. Conectate para sincronizar los pendientes", sin confirmar nunca como guardado.
`anularLocal` (RF-16): sobre el último evento no anulado de la vista: si es un **pendiente no aceptado**, lo descarta (si ya se estaba enviando y se aceptó, cae al caso siguiente); si es una **anulación pendiente**, la descarta; si no, entra por `registrar` como pendiente `ANULACION` con `eventoId` (que es el mismo `id` del evento).

## Archivos

### Crear
- **Base y API:** `api/prisma/migrations/20261112190000_eventos_sin_conexion/migration.sql`; `api/src/horaTablet.ts`; `api/src/reproduccion/idempotencia.ts`.
- **API, tests:** `api/tests/eventos-id-propio.test.ts`, `eventos-idempotencia-concurrencia.test.ts`, `eventos-idempotencia-puro.test.ts`, `anulaciones-idempotencia.test.ts`, `eventos-hora-dispositivo.test.ts`, `eventos-orden.test.ts`, `eventos-choques.test.ts`, `eventos-permisos-aislamiento.test.ts`, `casos-compartidos.test.ts`.
- **Compartido:** `compartido/casos-reglas-eventos.json`.
- **Web, módulos:** `formatoAlmacen.ts`, `dependencias.ts`, `vistaLocal.ts`, `situacionLocal.ts`, `reglasLocales.ts`, `permisos.ts`, `reflejo.ts`, `registrar.ts`, `anularLocal.ts` (en `web/src/sinconexion/`).
- **Web, tests** (`web/tests/`): `almacen-migracion.test.ts`, `almacen-contrato.test.ts`, `dependencias.test.ts`, `vista-local.test.ts`, `reglas-locales.test.ts`, `permisos.test.ts`, `reflejo.test.ts`, `casos-compartidos.test.ts`, `registrar.test.ts`, `anular-local.test.ts`, `sincronizar-orden.test.ts`.

### Modificar
- **API:** `api/prisma/schema.prisma`; `api/src/produccion/validacion.ts` (importa `horaTablet.ts`); `api/src/reproduccion/bloqueo.ts` (`siguienteRegistro`); `api/src/reproduccion/eventos.ts` (select y `armarEvento` con la hora informativa); `api/src/reproduccion/anular.ts`; `api/src/rutas/reproduccion.ts`, `api/src/rutas/partos.ts` (avisos calculados antes de insertar), `api/src/rutas/bajas.ts`, `api/src/bajas/baja.ts`, `api/src/bajas/validacion.ts` (`bajaSchema` con `id` y hora); `api/src/rutas/anulaciones.ts`, `anulaciones-partos.ts`; `api/src/copia/copiaLocal.ts`; tests existentes que fijen la forma exacta de un evento o las claves de la copia (`copia-local.test.ts`, `historial*.test.ts`, `anulaciones*.test.ts`, `servicios.test.ts`, `tactos.test.ts`, `partos.test.ts`, `secados.test.ts`, `bajas.test.ts`).
- **Web:** `web/package.json` (devDependency `fake-indexeddb`); `web/src/compartido/api.ts` (tipos: `CopiaLocal.semen`, `EventoReproductivo.cargadoEnDispositivo`); `almacen.ts`, `almacenMemoria.ts`, `almacenIndexedDb.ts`, `cola.ts`, `propietario.ts`, `clasificar.ts`, `envio.ts`, `sincronizar.ts`, `cargarLitros.ts`, `copia.ts` (guardar el semen), `ColaProvider.tsx`, `Pendientes.tsx`, `Produccion.tsx`, `Layout.tsx`, `estilos.css` si hace falta; los tests de la 009 (`cola`, `carga-litros`, `clasificar`, `sincronizar`, `propietario`, `copia`) se adaptan al formato nuevo.
- **Cierre:** `MEMORY.md`, `docs/plan.md` (ítem 6.2).

## Decisiones
- **Avisos del primer envío guardados en una columna (`avisosAlAceptar`) y devueltos tal cual** — elegida porque RF-5 pide los avisos "que el servidor dio al aceptar": se escriben en el mismo `INSERT` y el reenvío los lee, aunque después cambien las reglas de lote, la cría se mueva o la madre cambie de estado. Alternativa descartada: reconstruirlos al reenviar desde el estado actual (los avisos 1, 3, 4 y 5 dependen del lote de ese instante y de la genética de ese momento, que no quedan guardados; daría avisos distintos o ninguno). Es un dato que no está en la lista de cambios de la spec, pero lo exige RF-5; se avisa en el resumen.
- **Idempotencia: la clave primaria de `eventos` + bloqueo del animal + re-lectura por `id` + traducción del choque de la base** — elegida porque ya tenemos las tres piezas (la PK es global, el `FOR UPDATE` serializa los pedidos de una misma vaca y la re-lectura después de bloquear ve lo que el primero confirmó); y el choque de PK entre animales distintos lo atrapa el `catch`. Sirve igual para los cinco tipos porque todos son una fila de `eventos` (los litros siguen con su PK propia y el comportamiento de la 008). Alternativas descartadas: `INSERT ... ON CONFLICT DO NOTHING` (el evento son varias tablas y el alta de crías y el estado; habría que revisar filas afectadas y comparar igual, con SQL a mano que Prisma no genera) y un bloqueo por `id` con `pg_advisory_xact_lock` (no hace falta: el bloqueo del animal ya serializa la misma vaca y la PK cubre vacas distintas).
- **La re-lectura se hace después de bloquear, incluso si el animal ya no está activo** — elegida para cubrir los dos casos del RF-5/RF-6: la baja ya hecha por ese mismo evento (no 404) y el reenvío que esperó la lock de la primera baja (que al despertar ve el animal de baja). Alternativa descartada: comprobar solo antes de bloquear (se escapa la carrera: el segundo pedido pasa la comprobación, espera, y al seguir recibe 404).
- **El 200 "ya estaba guardado" tiene la misma forma en los cinco tipos: `{ evento, avisos, yaExistia: true }`** — elegida porque el RF-5 pide "la misma forma de respuesta en los cinco tipos" y los 201 hoy son tres formas distintas (evento a secas, `{ evento, avisos }` y el objeto plano de la baja). Los 201 no cambian (no rompen la web ni los tests de la 003 a la 006) y la web distingue por el código. Alternativa descartada: agregar `yaExistia` a la forma de cada 201 (cinco formas distintas que clasificar).
- **La anulación repetida devuelve la forma de siempre más `yaEstabaAnulado: true`** — elegida porque la anulación no tiene `id` propio ni requisito de forma, y así el extractor de la web es el mismo del primer envío. Alternativa descartada: unificarla con las cargas (obligaría a cambiar la forma de la respuesta de servicios y tactos).
- **Los avisos de una anulación de parto o secado (los de lote 6, 7 y 8) NO se vuelven a dar en el reenvío** (`avisos: []`) — elegida porque la spec no lo pide, guardarlos exigiría otra columna junto a las tres de la anulación (que el CHECK exige juntas) y el aviso es informativo (el lote de la vaca se ve en su ficha). Alternativa descartada: guardarlos también. Pendiente de confirmar con el usuario (ver Riesgos).
- **Hora informativa y avisos en `eventos` y no en cada tabla de detalle** — elegida porque los cinco tipos comparten esa fila (y `armarEvento` la lee de ahí para el historial y la copia) y es una migración de dos columnas. Alternativa descartada: una columna por detalle (cinco migraciones y cinco lecturas).
- **`siguienteRegistro` mira también `cambios_animal`** — elegida porque el aviso 8 compara el `creadoEn` del evento con el de la fila LOTE del historial; asegurar "posterior a todo" en el mismo punto donde ya se asegura contra los eventos cierra el riesgo del reloj de la 005 sin lógica nueva. Alternativa descartada: arreglarlo solo en el aviso 8 (compararía otra cosa y dejaría el orden sin garantía).
- **"En espera del anterior" se calcula, no se guarda** — elegida porque depende de qué hay delante de ese pendiente: al reintentar o descartar el rechazado se libera solo, sin tocar registros y sin estados viejos. Alternativa descartada: un cuarto estado guardado (hay que actualizarlo en cada reintento, descarte o aceptación, y una falla a mitad lo deja inconsistente).
- **Enviados con `aceptadoEn` del servidor y margen de 10 minutos para el "reflejo"** — elegido porque comparar el reloj de la tablet con el de la copia es justo lo que la spec prohíbe, y la copia toma su foto un instante antes de poner su `generadaEn`: sin margen, un evento confirmado en esa ventana se daría por reflejado sin estarlo. Se quita un enviado si la copia lo trae, si el animal ya no está (baja) o si la copia es 10 minutos posterior a su aceptación y no lo trae (otro dispositivo revirtió). Alternativa descartada: quitarlo apenas la copia es posterior (ventana de milisegundos con el evento desaparecido de la vista).
- **Tabla de casos como JSON en `compartido/` leída con `fs`** — elegida porque es la única forma de que dos paquetes independientes lean la misma verdad sin que la web importe de la API ni crear un paquete nuevo. Alternativas descartadas: duplicar la tabla en `api/tests` y `web/tests` (se desincroniza, que es justo el riesgo que cubre el RF-23), importarla con `resolveJsonModule` desde fuera del paquete (rompe el `rootDir` de los `tsconfig`) y crear un workspace compartido (más herramientas y una dependencia interna para un solo archivo, principio 9).
- **`fake-indexeddb` como devDependency de `web`** — elegida porque la spec exige probar la migración con el formato real y Node no trae IndexedDB; es solo de tests (no viaja a producción), es la librería estándar para esto y permite probar de paso el contrato del almacén real. Alternativas descartadas: probar solo la función pura de transformación (no ejecuta el `onupgradeneeded` real, que es justo donde se pueden perder litros) y escribir un IndexedDB falso a mano (mucho código propio que puede imitar mal al navegador). Justificación para la constitución, principio 9; se avisa al usuario.
- **Reglas locales portadas (copiadas) a la web, protegidas por la tabla compartida** — elegida porque la web no puede importar de la API y la paridad la verifica la tabla en los dos lados. Alternativa descartada: pedirle las reglas al servidor sin conexión (imposible, y es justo el caso de uso).
- **Anomalías "como conjunto" = texto partido por coma o punto y coma, recortado y sin orden** — elegida porque el campo es texto libre y es la única lectura posible de la spec; el reenvío legítimo manda el mismo texto, así que el criterio solo evita falsos 409. Alternativa descartada: comparar el texto exacto (el test pedido por la spec, "otro orden", fallaría).
- **El pendiente es inmutable (no se corrige, solo se reintenta o se descarta)** — así "el mismo contenido" del reenvío es el mismo `datos` guardado. Alternativa descartada: permitir editarlo (fuera de alcance de la spec y rompería la idempotencia).

## Estrategia de tests
La suite completa se corre una vez al cerrar (T5); cada tarea corre solo sus archivos (preferencia del usuario).

| RF | Test (archivo › caso) |
|---|---|
| RF-1 | `eventos-orden.test.ts` › dos dispositivos, misma vaca y fecha: el que llega primero queda primero y las reglas del segundo se evalúan sobre el estado real (servicio después de tacto "preñada" del mismo día: 409 por preñez vigente); dos tactos el mismo día: valen ambos y manda el último en llegar; la `cargadoEnDispositivo` anterior no cambia el orden |
| RF-2 | `eventos-orden.test.ts` › se siembra un `creadoEn` futuro en un evento y en un cambio manual (no se simula con el reloj inyectable) y el evento nuevo queda posterior a los dos; el aviso 8 no falla |
| RF-3 | `eventos-hora-dispositivo.test.ts` › válida (se guarda aparte de `creadoEn`), formato inválido 400 con el mensaje, ausente o `null`, adelantada más de 5 minutos y anterior al 2000 (se guarda el evento sin el dato), CHECK de la base por SQL directo, aparece en `/eventos`, `/historial` y la copia; no cambia al anular |
| RF-4 | `eventos-id-propio.test.ts` › con `id` propio (en cada uno de los cinco tipos se guarda con ese `id`), sin `id` se genera, `id` mal formado 400 |
| RF-5 | `eventos-id-propio.test.ts` › por tipo: reenvío igual da 200 con `yaExistia`, misma forma y sin duplicar eventos, crías, estado ni lote; avisos del primer envío repetidos; evento anulado después sigue en 200; baja reenviada con el animal de baja no da 404; 409 con otros datos, otro animal, otro usuario, otro tipo y otro tambo (mismo texto genérico); `eventos-idempotencia-puro.test.ts` › comparadores (semen `null`/vacío/ausente, anomalías en otro orden, crías en distinto orden = distinto, hora informativa distinta no cuenta) |
| RF-6 | `eventos-idempotencia-concurrencia.test.ts` › dos pedidos simultáneos con el mismo `id` por tipo (uno 201 y otro 200 con los mismos datos; 409 con otros datos); mismo `id` sobre dos animales distintos; baja simultánea; jamás 500 y una sola fila |
| RF-7 | `anulaciones-idempotencia.test.ts` › anulación repetida por el mismo usuario y motivo (con espacios) da `yaEstabaAnulado` sin cambiar nada, con el animal ya de baja también; otro usuario u otro motivo 409; sin anular y animal de baja 404; repetida mientras la primera espera la lock |
| RF-8 | `copia-local.test.ts` (actualizado) › trae el semen activo del tambo (id, nombre, raza) y no el desactivado, claves de la copia actualizadas, no cuenta para el tope 422; `copia-local-foto.test.ts` › un semen desactivado por el gancho entre lecturas no cambia la foto |
| RF-9 | `eventos-choques.test.ts` y `casos-compartidos.test.ts` › preñez vigente, fecha anterior al último evento, vaca que ya no está en el estado que exige el evento, última anulación ya hecha, semen desactivado, número de cría ocupado (409 con `crias.N.numero` y sin crear animales a medias), vaca dada de baja por otro dispositivo (404) |
| RF-10 | `eventos-permisos-aislamiento.test.ts` › veterinario 403 en parto, secado, baja y anular parto o secado (también reenviando un `id` existente y con JSON roto); servicio, tacto y sus anulaciones permitidos a los tres roles |
| RF-11 | `eventos-permisos-aislamiento.test.ts` › por cada ruta (cinco cargas, cuatro anulaciones y la copia con el semen): animal o evento de otro tambo = mismo 404 que inexistente o mal formado; semen y lote de otro tambo = como inexistente; `establecimientoId` del cuerpo y de la consulta ignorado; sin `passwordHash` ni `tokenHash`; la copia de un tambo no trae el semen del otro |
| RF-12, RF-14 | `almacen-contrato.test.ts` (memoria y `fake-indexeddb`) y `cola.test.ts` › pendiente de cada tipo con todos sus datos, el dueño, el `id` y el orden de carga; 501.º rechazado con el mensaje exacto, falta de espacio no confirma, límite inyectable |
| RF-13 | `almacen-migracion.test.ts` › base versión 2 con el formato de la 009 y litros esperando, enviando y rechazados: sin perder ni duplicar, mismo orden, se envían con el cuerpo de la 009; segunda apertura no los vuelve a migrar. A mano en el navegador |
| RF-15 | `registrar.test.ts` › con señal y sin pendientes: envío directo con su `id`; rechazo 400, 403, 404 y 409 se devuelve y no se guarda; 10 s o falla de red: pendiente con el mismo `id`; con pendientes delante (esperando, enviando, en espera o rechazado): se guarda detrás aunque haya señal; litros: esperan eventos pero los litros pendientes no desvían |
| RF-16, RF-17 | `anular-local.test.ts` › anular el último de cada tipo crea la anulación pendiente; anular un pendiente o una anulación pendiente lo descarta sin crear nada; descartar devuelve los posteriores sin tocarlos |
| RF-18, RF-19 | `vista-local.test.ts` y `reflejo.test.ts` › vista con secado, parto (crías dentro del parto), baja pendiente y enviada, rechazados y "en espera" que no cuentan; un enviado por tipo se quita cuando la copia lo trae (servicio, tacto, parto, secado con su `id`; anulación con el evento anulado; baja con el animal ausente; litros como la 009), y por antigüedad (baja revertida) |
| RF-20, RF-21, RF-22, RF-23 | `casos-compartidos.test.ts` (API y web) y `reglas-locales.test.ts`, `permisos.test.ts` › tabla compartida (mismo resultado y mensaje; los `soloServidor` se saltan y se cuentan), número de cría con partos pendientes o enviados y con baja pendiente cargada antes y después, permisos por rol |
| RF-24 | `vista-local.test.ts` y `sincronizar-orden.test.ts` › litros ofrecidos solo a hembra en ordeñe según la vista (parto pendiente sí, secado pendiente no); el litro sale después de los eventos anteriores de su vaca y, si el parto se rechaza, queda en espera |
| RF-25, RF-26, RF-27, RF-29 | `sincronizar-orden.test.ts` y `dependencias.test.ts` › orden de carga entre tipos; de a uno; un fallo transitorio frena a los siguientes de esa vaca y las demás siguen; respuesta cortada se reintenta con el mismo `id` y `datos`; rechazo deja en espera a los posteriores (y un litro rechazado no frena); reintentar o descartar libera en orden; descartar uno "en espera" pide confirmación; un rechazado no se reintenta solo; 401 conserva todo |
| RF-28 | `sincronizar-orden.test.ts` › los avisos del 200 o 201 se guardan junto al envío, sobreviven a la limpieza del enviado y solo se borran al cerrarlos |
| RF-30 | `cola.test.ts` y `propietario.test.ts` › conteo de no aceptados de todos los tipos con los rechazados destacados, los enviados no cuentan; ingreso de otro usuario con pendientes de cualquier tipo o avisos pide confirmación y borra todo |
| RF-31 | Navegador (un solo ancho, red cortada): pendientes de los tipos nuevos sembrados desde la consola en IndexedDB se ven en "Pendientes de sincronizar" sin errores; más el typecheck |

## Riesgos
- **Reenvío de anulaciones de parto o secado sin avisos de lote** (decisión de arriba): si la respuesta de la anulación se corta, el aviso 6, 7 u 8 no se vuelve a mostrar. Para confirmar con el usuario; la ficha igual muestra el lote real.
- **Número de la cría editado antes del reenvío:** la comparación de un parto reenviado mira el número actual de la cría viva; si otro dispositivo le cambió el número a esa cría entre el primer envío y el reenvío, el reenvío daría 409. Es un caso extremo (la tablet no edita animales sin conexión) y se acepta.
- **El orden entre dispositivos es el de llegada** (riesgo aceptado de la spec): el plan lo respeta y lo prueba, no lo "arregla".
- **Reglas portadas a la web:** pueden divergir del servidor con el tiempo; la tabla compartida las cubre solo en los casos que contiene. Cualquier regla nueva de eventos debe sumar su caso a la tabla.
- **`fake-indexeddb` imita al navegador, no es el navegador:** por eso además hay una comprobación manual de la actualización con litros pendientes.
- **Probar la pantalla sin formularios:** los pendientes de los tipos nuevos solo se pueden crear sembrándolos en IndexedDB (un fragmento de consola que no se commitea); la verificación real de punta a punta llega con la 011.
- **Datos locales sin cifrar y sesión local sin vencimiento:** heredados de la 009.
