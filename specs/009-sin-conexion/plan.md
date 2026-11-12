# Plan — 009 Modo sin conexión: consulta y carga de litros

Spec: [spec.md](spec.md) (aprobada)

## Resumen
La API suma **una sola ruta de descarga** (`GET /api/copia-local`) que arma, en una transacción con foto consistente, todo el tambo activo (fichas, situación reproductiva, historial, producción y lotes), con un tope de 5.000 animales; y la carga de litros acepta un dato informativo `cargadoEnDispositivo` (columna nueva, sin tocar `creadoEn`). La web se vuelve instalable (manifiesto y service worker artesanal), guarda la copia y la cola de pendientes en el navegador (IndexedDB directo, detrás de una interfaz que se prueba en memoria), resuelve las lecturas de las pantallas desde la copia cuando no hay conexión (dentro de `api()`, sin reescribir las pantallas) y envía los pendientes solos con la carga idempotente por `id` que ya existe desde la spec 008.

La lógica pura (clasificación de respuestas, cola, buscador local, decisión de usuario distinto, conexión) vive en `web/src/sinconexion/` sin React y se prueba con Vitest. Lo visual y la instalación se verifican en el navegador (768 y 375 px).

## Cambio de API declarado (contrato)

### `GET /api/copia-local` (nuevo; dueño, encargado y veterinario)
- Sesión obligatoria (401 sin sesión). El tambo sale de la sesión; cualquier `establecimientoId` de la query se ignora.
- Una transacción con aislamiento `RepeatableRead` (foto única del tambo en un instante, RF-6) y un timeout de 60 s. Primero cuenta los animales activos del tambo; si superan `topeCopia()` (5.000, inyectable en `api/src/topes.ts`), responde sin leer nada más.
- **200**:
  ```
  {
    generadaEn: string ISO,           // instante de la foto (reloj del servidor)
    totalAnimales: number,
    lotes: Lote[],                     // igual que GET /api/lotes
    animales: AnimalCopia[]            // activos, sin orden garantizado
  }
  AnimalCopia = {
    ficha: AnimalFicha,                // igual que GET /api/animales/:id
    eventos: RespuestaEventos,         // igual que GET /api/animales/:id/eventos
    historial: RespuestaHistorial,     // igual que GET /api/animales/:id/historial (tope 500)
    produccion: FichaProduccion        // igual que GET /api/animales/:id/produccion, SIN `sugerencia` (tope 200)
  }
  ```
- **422** si hay más animales activos que el tope: `{ error: "El tambo tiene más animales de los que entran en la tablet (N)…", totalAnimales, tope }`. Nunca recorta (RF-8).
- Sin animales de baja, sin catálogo de semen, sin informes, sin ids de usuarios ni hashes (RF-14, RF-51). La respuesta sale comprimida (gzip con `node:zlib`) cuando el cliente lo acepta.
- Cada animal debe ser **idéntico** al que dan las rutas individuales (se prueba comparando).

### `POST /api/animales/:id/produccion` (existente, una sola novedad)
- Campo opcional `cargadoEnDispositivo`: texto con fecha y hora ISO con zona (por ejemplo `2026-11-12T08:15:00-03:00`).
  - Si viene con un formato inválido → **400** "La hora de carga de la tablet no es una fecha y hora válida" (RF-27).
  - Si falta o es `null` → se guarda sin ese dato (RF-27).
  - Si es más de **5 minutos posterior a `ahora()`** del servidor, o anterior al 01/01/2000 → el litro se guarda **igual y sin ese dato** (queda `null`), sin error (RF-28).
- No cambia ningún otro código, mensaje ni orden de controles de la spec 008. La repetición idempotente compara vaca, fecha, turno y litros: el dato informativo **no** entra (RF-26).
- La respuesta del registro no incluye el dato (es solo informativo y de consulta en la base).

## Base de datos
- `Produccion` suma `cargadoEnDispositivo DateTime?` (sin valor por defecto). Migración `sin_conexion_hora_dispositivo`:
  - `ALTER TABLE "producciones" ADD COLUMN "cargadoEnDispositivo" TIMESTAMP(3);`
  - **A mano:** `CHECK ("cargadoEnDispositivo" IS NULL OR "cargadoEnDispositivo" >= '2000-01-01')` (`producciones_hora_dispositivo_rango`), con comentario (constitución 6).
  - Revisar el disparador `producciones_solo_agregar` de `produccion_base`: si compara columnas para impedir cambios, sumar esta; el dato se escribe solo al insertar.
- **Cómo se respeta `creadoEn`:** no se toca. Sigue siendo `@default(now())` del servidor; el orden (`fecha`, `turno`, `creadoEn`), la unicidad y los informes no leen la columna nueva. Un test carga con una hora de tablet de hace un año y comprueba que `creadoEn` es la del servidor y que el orden de la ficha no cambia.
- `migrate diff` esperado: **solo las tres claves foráneas de lote previo** de siempre (no aplicarlas); la columna y el CHECK no deben aparecer como diferencia.

## Armado de la copia (API)
Lecturas **masivas por tambo** dentro de la transacción, no una por animal (2.000 animales × ~10 consultas sería lento):
- Fichas: se extrae de `leerFicha` (`api/src/rutas/animales.ts`) una función pura que arma la ficha desde la fila, y una lectura que trae todos los activos con el mismo `select`.
- Eventos y situación: `leerEventos` pasa a ser un caso de `leerEventosDeAnimales(tx, ids, establecimientoId)` (mismo código; agrupa por animal) y se reutilizan `armarRespuesta` y `armarHistorial`.
- Cambios manuales: los `tope` más nuevos y el total por animal (consulta con ventana `row_number()` y un `count` agrupado).
- Producción: por animal, los `tope` más recientes (ventana `row_number()`), el total, el promedio de 30 días (suma y días distintos, con `redondearDecimas`) y el último no anulado (`DISTINCT ON`). Mismo orden y mismos nombres que `leerFicha` de `api/src/produccion/leer.ts`.
- Lotes: la lectura de `GET /api/lotes` se extrae a una función reutilizable.
- Gancho de prueba: una función `fijarGanchoCopia` (solo tests, como `fijarTopes`) que se ejecuta entre dos lecturas, para probar que un cambio hecho en ese momento **no** aparece (foto única, RF-6).

## Interfaz y lógica del lado de la web

### Instalación (RF-1 a RF-3)
- `web/public/manifest.webmanifest` (nombre "CowRegister", `display: standalone`, `start_url: /`, colores, íconos PNG de 192 y 512 px, uno `maskable`) y `<link rel="manifest">` y `theme-color` en `web/index.html`. Los íconos se generan una sola vez con un script de Node sin dependencias y se commitean.
- `web/public/sw.js` (service worker escrito a mano, sin librería):
  - Al instalar, descarga `/`, lee de ese HTML las rutas `/assets/…` y las guarda junto con el manifiesto y los íconos (caché `cowregister-app-v1`).
  - Navegaciones: primero la red; si falla, el `index.html` guardado (la app es una sola página).
  - `/assets/*`: primero el caché (los nombres llevan hash).
  - **Nunca toca `/api/*` ni pedidos que no sean GET**: los datos del tambo no pasan por este caché, así cerrar sesión los borra todos (RF-43).
- `web/src/sinconexion/registrarSw.ts` lo registra solo en producción (`import.meta.env.PROD`), desde `main.tsx`.
- `vite.config.ts`: `preview.proxy` a `/api` (para probar la compilación con la API en local) y la configuración de Vitest.

### Almacenamiento local (RF-4 a RF-9)
`web/src/sinconexion/almacen.ts` define la interfaz `Almacen` (copia, sesión/propietario, pendientes, enviados recientes) con dos implementaciones: `almacenMemoria.ts` (tests) e `almacenIndexedDb.ts` (navegador). IndexedDB directo, sin librería.
- Reemplazar la copia es **una sola transacción** (vaciar los animales, escribir uno por registro, escribir `generadaEn` y lotes): o queda la nueva completa o, si falla o no hay espacio (`QuotaExceededError`), la transacción se deshace y queda la anterior (RF-7, RF-9). Nunca una copia a medias.
- `copia.ts` (puro, con el `Almacen` y un `descargar` inyectados): `actualizarCopia` distingue primera descarga (bloquea) de actualización (usa la vieja mientras tanto), error de red, 422 por tope (`RF-8`, con el mensaje y sin tocar lo guardado) y falta de espacio.

### Lecturas sin conexión (RF-9 a RF-17)
- `api()` (`web/src/compartido/api.ts`) suma un desvío: si el estado de conexión es "sin conexión" **o** un GET falla por red, y la ruta es una de la **lista cerrada** (listado de animales y sus filtros, `/animales/buscar`, `/animales/:id`, `/animales/:id/eventos`, `/historial`, `/produccion`, `/lotes` para los filtros), responde desde la copia con `resolverLocal` (`copiaLocal.ts`, puro). Cualquier otra ruta o método sin conexión lanza `ApiError(0, "Esto necesita conexión")` sin intentar la red. Así las pantallas actuales casi no cambian.
- Buscador y listado locales reproducen las reglas de la spec 002: `normalizarNumero` y `compararNumeros` (orden natural) se copian a `numeros.ts` de la web (la web no importa de la API), con una tabla de casos que cubre las reglas (mayúsculas, tildes, guion, punto, 1 a 20 caracteres, A2 antes que A10).
- Ficha local: los datos, `eventos`, `historial` y `produccion` salen de la copia y se aclara "datos locales, al día de…" (RF-15). Animal ausente: "No encontrado en los datos de la tablet (al día de …)" (RF-16).
- `NecesitaConexion.tsx` y un envoltorio `RutaConConexion` en `Rutas.tsx` para las pantallas fuera de la lista (bajas, informes, semen, lotes, usuarios, alta, planilla); el menú y los botones de la ficha (editar, mover, baja, anular, reproducción, partos, secados) se deshabilitan con el texto "Esto necesita conexión" (RF-13). `AvisoConexion.tsx` (cartel fijo "Sin conexión: datos al día de …", RF-41).

### Estado de conexión
`conexion.ts` (puro, con reloj y sondeo inyectables): combina los eventos `online`/`offline`, los fallos de red de `api()` y una sonda a `GET /api/salud` cada 15 s mientras está "sin conexión". `navigator.onLine` solo no alcanza (WiFi sin internet).

### Pendientes y sincronización (RF-18 a RF-40)
- `cola.ts` (puro): crear pendiente (validaciones de la spec 008 reutilizando `produccionDatos.ts` y `reproduccionDatos.ts`; duplicado contra la copia y los pendientes no descartados; límite de 500 y falta de espacio), orden de envío, estados (`esperando`, `enviando`, `rechazado`, y `enviado` reciente), esperas crecientes (5 s, 15 s, 45 s, 2 min, 5 min tope), reinicio de `enviando` a `esperando` al abrir.
- `clasificar.ts` (puro): **tabla cerrada de respuestas** de la spec. `clasificarRespuesta({ estado, cuerpo, red })` devuelve `aceptado` (2xx con la forma esperada: `id`, vaca, fecha, turno y litros coinciden con el pendiente), `rechazado` (400, 403, 404, 409, con el motivo de la API), `sesion` (401) o `esperar` (408, 429, 5xx, otros códigos, red, tiempo agotado, 200 con HTML o cuerpo que no es la forma de la API).
- `sincronizar.ts`: toma los pendientes `esperando` de a uno, en orden, con un `enviar` inyectable; guarda el resultado; al aceptar, lo pasa a "enviado reciente" (se muestra en la ficha como "Enviado: se confirma al actualizar" hasta que una copia nueva lo incluya, RF-34) y al terminar dispara `actualizarCopia`. Una pestaña a la vez con `navigator.locks` si existe; si no, igual es seguro por el `id` idempotente.
- Carga con señal (RF-24): `cargarLitros` intenta enviar con un tope de **10 s** (`AbortController`); si falla la red, hay tiempo agotado o una respuesta de la clase `esperar`, lo guarda como pendiente con su `id`; si es un rechazo, lo muestra y no lo guarda. Sin señal va directo a pendiente. El `id` sale de `crypto.randomUUID()` con un reemplazo por `crypto.getRandomValues` (en contextos no seguros no existe `randomUUID`).
- `Produccion.tsx`: el formulario usa `cargarLitros`; la fecha y el turno sin conexión salen de la hora del dispositivo convertida a Argentina (UTC-3 fija) con una función pura inyectable; el "último registro" mezcla copia y pendientes (por fecha y turno, la tarde después de la mañana; sin rechazados); la lista muestra los pendientes marcados.
- `Pendientes.tsx` (ruta `/pendientes`): lista, "Reintentar", "Reintentar ahora", "Descartar" con confirmación (`Confirmar.tsx`), esperar el resultado si se está enviando (RF-39) y el vacío "No hay nada pendiente de sincronizar". El menú muestra la cantidad (`Layout.tsx`).
- `SinConexionProvider.tsx`: contexto con conexión, copia (`generadaEn`), pendientes y acciones; se monta dentro del `AuthProvider`.

### Sesión (RF-43 a RF-48)
- `auth.tsx`: al abrir, si `/auth/yo` falla por red y hay perfil guardado en el almacén, la app entra con ese perfil (modo sin conexión); si responde 401, pide credenciales **sin borrar nada**. Con conexión revalida y actualiza el perfil.
- `propietario.ts` (puro): `decidirIngreso(perfil, propietarioLocal, pendientes)` devuelve `continuar` (mismo usuario y tambo, o no hay datos), `reemplazarSinPreguntar` (otro usuario sin pendientes) o `confirmarBorrado(n)` (otro usuario con pendientes). Se usa en el login y al abrir.
- Cerrar sesión (`Layout.tsx`): con pendientes (esperando o rechazados) pide confirmación con la cantidad; si acepta, intenta cerrar la sesión del servidor (si no hay red lo avisa y sigue) y **borra todo lo local** (copia, pendientes, perfil). El caché de la app (código) no guarda datos del tambo.
- Cancelar el borrado en el ingreso de otro usuario cierra la sesión del servidor recién abierta y vuelve al ingreso, sin mostrar nada.

## Archivos
- **Crear (API):**
  - `api/src/copia/copiaLocal.ts` (armado de la copia), `api/src/copia/lecturasMasivas.ts` (ventanas y agrupados), `api/src/rutas/copia-local.ts`
  - `api/prisma/migrations/<fecha>_sin_conexion_hora_dispositivo/migration.sql`
  - Tests: `api/tests/copia-local.test.ts`, `copia-local-paridad.test.ts`, `copia-local-foto.test.ts`, `produccion-hora-dispositivo.test.ts`
- **Modificar (API):** `api/prisma/schema.prisma`; `api/src/produccion/validacion.ts` (dato informativo) y `cargar.ts` (guardarlo); `api/src/animales/…` o `api/src/rutas/animales.ts` (extraer el armado de la ficha); `api/src/reproduccion/eventos.ts` (`leerEventosDeAnimales`); `api/src/rutas/lotes.ts` (extraer la lectura); `api/src/topes.ts` (`topeCopia`); `api/src/app.ts` (montar la ruta con la sesión antes); `api/tests/ayudas.ts` si hace falta.
- **Crear (web):**
  - `web/public/manifest.webmanifest`, `web/public/sw.js`, `web/public/icono-192.png`, `icono-512.png`, `icono-maskable-512.png`
  - `web/src/sinconexion/`: `almacen.ts`, `almacenMemoria.ts`, `almacenIndexedDb.ts`, `copia.ts`, `copiaLocal.ts`, `numeros.ts`, `conexion.ts`, `cola.ts`, `clasificar.ts`, `sincronizar.ts`, `propietario.ts`, `limites.ts` (500, 10 s, 5.000 no hace falta), `registrarSw.ts`, `SinConexionProvider.tsx`, `AvisoConexion.tsx`, `NecesitaConexion.tsx`, `Pendientes.tsx`, `Confirmar.tsx`
  - Tests en `web/tests/`: `numeros.test.ts`, `buscador-local.test.ts`, `copia.test.ts`, `clasificar.test.ts`, `cola.test.ts`, `sincronizar.test.ts`, `conexion.test.ts`, `propietario.test.ts`
- **Modificar (web):** `web/package.json` (Vitest y script `test`), `web/vite.config.ts`, `web/tsconfig.json` (incluir los tests), `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/compartido/api.ts` (desvío local, tipos de la copia y respuesta cruda para clasificar), `Layout.tsx`, `Rutas.tsx`, `web/src/sesion/auth.tsx` y `Login.tsx`, `web/src/animales/AnimalFicha.tsx`, `Animales.tsx` y `Buscador.tsx` (mensajes sin conexión), `web/src/reproduccion/Reproduccion.tsx`, `web/src/historial/Historial.tsx` y los formularios de edición, bajas y lotes (deshabilitar acciones), `web/src/produccion/Produccion.tsx` y `produccionDatos.ts`, `web/src/estilos.css`; `package.json` de la raíz (`npm test` corre API y web).
- Nombres con mayúsculas y minúsculas distintas en la misma carpeta chocan en Windows (`MEMORY.md`): los módulos de datos terminan en `*Datos.ts` o llevan nombre distinto de su componente (por ejemplo `copiaLocal.ts` y no `CopiaLocal.ts` junto a un componente).

## Decisiones
- **IndexedDB directo detrás de una interfaz `Almacen`** — elegida porque guarda miles de objetos, permite una transacción atómica (copia completa o nada, también ante falta de espacio) y no necesita librerías; la versión en memoria deja probar toda la lógica con Vitest. Alternativas descartadas: `localStorage` (límite de unos 5 MB, síncrono y sin transacciones: una copia de 2.000 animales no entra y puede quedar a medias); `idb` o Dexie (comodidad que no justifica una dependencia nueva, principio 9).
- **Service worker artesanal** (unas 60 líneas) — elegido porque la app es una sola página con archivos con hash y alcanza con guardar el código al instalar y servir `index.html` sin red; no toca `/api`. Alternativa descartada: `vite-plugin-pwa` con Workbox (dependencia pesada con mucha magia, difícil de entender y de probar para un estudiante y no aporta nada que esta app necesite).
- **Copia en una sola ruta y una sola transacción `RepeatableRead`** — elegida porque pide la spec "una foto única en un instante" (RF-6) y evita que listado, fichas y lotes salgan de momentos distintos. Alternativa descartada: pedir lotes, listado y cada ficha por separado o paginar (varios instantes, y un animal podría aparecer a medias).
- **Lecturas masivas por tambo con consultas de ventana, reutilizando las funciones puras de armado** — elegido por rendimiento (pocas consultas) sin duplicar reglas; un test compara cada animal con las rutas individuales. Alternativa descartada: llamar a las lecturas individuales dentro de un bucle (miles de consultas por descarga y más lento con cada animal).
- **Compresión con `node:zlib`** — elegida porque no suma dependencias; el JSON repetitivo baja mucho. Alternativa descartada: el paquete `compression` (dependencia nueva) y no comprimir (decenas de MB sin razón).
- **Tope con respuesta 422 y mensaje, sin descarga parcial** — elegido por la decisión del usuario (completa o nada). Alternativas descartadas: recortar a los primeros N (el buscador local daría "no existe" para vacas reales) o 409/413 (otro significado en la API y en la clasificación de la cola).
- **Resolver las lecturas locales dentro de `api()`** — elegido porque las pantallas siguen haciendo los mismos pedidos y no hay que reescribirlas ni mantener dos caminos de datos. Alternativa descartada: que cada pantalla lea de la copia (más cambios, más errores y duplicación).
- **Estado de conexión con eventos, fallos de red y sonda a `/api/salud`** — elegido porque `navigator.onLine` dice "hay WiFi" aunque no haya internet. Alternativa descartada: usar solo `navigator.onLine`.
- **Hora informativa en una columna aparte, nunca en `creadoEn`** — elegida por la decisión del usuario: el orden total y la unicidad de las specs 003 y 005 siguen dependiendo del reloj del servidor. Alternativa descartada: que `creadoEn` lo mande la tablet (relojes distintos romperían el orden y el aviso 8). Si el reloj del dispositivo está desfasado, el dato se descarta y el litro se guarda igual (no se pierde por un dato informativo).
- **Rechazo definitivo solo para 400, 403, 404 y 409; todo lo demás se reintenta** — elegido porque un portal de WiFi o un 5xx no son decisiones del negocio. Alternativa descartada: marcar como rechazado todo lo que no sea 2xx (perdería cargas por una falla de red).
- **Reintentos solos con esperas crecientes (5 s a 5 min) y "Reintentar ahora"** — elegido para no saturar el servidor ni gastar batería. Alternativa descartada: Background Sync del service worker (no está en todos los navegadores y la spec deja afuera la sincronización con la app cerrada).
- **Vitest también en `web`** — elegido porque ya se usa en la API (misma versión, sin dependencias nuevas de producción) y la lógica pura de la cola, la clasificación y el buscador es lo más riesgoso; el entorno es Node (sin jsdom). Alternativa descartada: probar la lógica de la web solo a mano en el navegador (no se repite ni protege contra regresiones).

## Estrategia de tests
La suite completa se corre una vez al cerrar (T5); cada tarea corre solo sus archivos (preferencia del usuario).

| RF | Test (archivo › caso) |
|---|---|
| RF-4, RF-6, RF-8 | `copia-local.test.ts` › descarga completa del tambo (fichas, eventos, historial, producción, lotes); 422 con `fijarTopes({ copia })`; `copia-local-foto.test.ts` › un cambio hecho por el gancho entre lecturas no aparece |
| RF-4, RF-11 (paridad) | `copia-local-paridad.test.ts` › cada animal de la copia es idéntico a las rutas individuales (con animales con partos, bajas de crías, historial y producción anulada) y una prueba de volumen de 2.000 animales |
| RF-26, RF-27, RF-28 | `produccion-hora-dispositivo.test.ts` › se guarda aparte; formato inválido 400; ausente o `null`; más de 5 minutos adelantada o anterior al 2000 se guarda sin el dato; `creadoEn` y el orden de la ficha no cambian; el idempotente ignora el dato; CHECK en la base |
| RF-33, RF-53 | `produccion-hora-dispositivo.test.ts` › animal de otro tambo e inexistente dan el mismo 404; veterinario 403 con el mensaje exacto con el dato nuevo |
| RF-49 a RF-52, RF-54 | `copia-local.test.ts` › 401 sin sesión, tres roles 200, `establecimientoId` de la query ignorado, aislamiento entre dos tambos (nada del otro tambo, sin bajas), sin `passwordHash` ni `tokenHash` |
| RF-5, RF-7, RF-9 | `web/tests/copia.test.ts` › actualización exitosa; falla a mitad conserva la anterior y su fecha; sin espacio conserva la anterior; primera descarga fallida no deja nada; 422 conserva la anterior |
| RF-10, RF-14 | `web/tests/numeros.test.ts` y `buscador-local.test.ts` › mismos casos que la spec 002 (normalización, orden natural, número inválido igual que inexistente) |
| RF-12, RF-13, RF-16 | `web/tests/buscador-local.test.ts` › `resolverLocal` con lista cerrada y `Esto necesita conexión` para el resto; animal ausente |
| RF-19, RF-20, RF-21, RF-22, RF-23 | `web/tests/cola.test.ts` › validaciones iguales a la spec 008, duplicado contra copia y pendientes, límite de 500, falta de espacio no confirma, fecha y turno por hora de Argentina a las 13:59 y 14:00, último registro por fecha y turno |
| RF-24, RF-29 a RF-32 | `web/tests/clasificar.test.ts` (tabla completa de códigos, 200 con HTML, 401, red) y `sincronizar.test.ts` (orden, de a uno, esperas crecientes, sigue con los demás, 401 detiene y conserva) |
| RF-34, RF-35, RF-37 a RF-39 | `web/tests/sincronizar.test.ts` y `cola.test.ts` › aceptado pasa a "enviado reciente" hasta que la copia nueva lo incluye; reintentar; descartar con envío en curso |
| RF-41 | `web/tests/conexion.test.ts` › eventos, fallos de red y sonda |
| RF-43 a RF-48 | `web/tests/propietario.test.ts` › decisión de ingreso (mismo usuario, otro usuario con y sin pendientes), cierre con pendientes borra todo, perfil guardado y 401 sin borrar |
| RF-1 a RF-3, RF-12, RF-13, RF-15, RF-25, RF-36, RF-40, RF-42, RF-55, RF-56 | Navegador (red cortada, 768 y 375 px, claro y oscuro) y lo visual de cada tarea |

## Riesgos
- **HTTPS:** el navegador solo instala la app y registra el service worker en `localhost` o con HTTPS. La spec no define el despliegue; en la tablet real hará falta HTTPS. Para verificar acá se usa `localhost` con `vite build` y `vite preview`.
- **Tamaño de la copia:** 2.000 animales con historial y producción pueden pesar decenas de MB sin comprimir. Se comprime y se mide en el test de volumen; si pesa demasiado se revisa en la spec 010 (por ejemplo, mostrar menos producción por ficha).
- **Almacenamiento del navegador:** algunos navegadores borran datos de sitios poco usados; la app instalada suele estar protegida. Si se borrara, vuelve el caso "primera descarga" (RF-11) y los pendientes que no se enviaron se perderían: por eso se muestra siempre su cantidad y se envían apenas hay señal.
- **Reloj de la tablet:** una fecha futura propuesta se rechaza al sincronizar y queda visible (spec, casos límite).
- **Raw SQL de la copia:** las consultas con ventana no pasan por los tipos de Prisma; la prueba de paridad con las rutas individuales es la red de seguridad.
- Las specs 003 y 005 siguen con su riesgo del reloj y el orden de eventos: esta spec solo carga litros y no lo resuelve (spec 010).
