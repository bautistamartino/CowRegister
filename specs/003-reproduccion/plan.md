# Plan — 003 Reproducción: catálogo de semen, servicios y tactos

Spec: [spec.md](spec.md)

## Resumen
Una migración (`reproduccion_base`) crea el catálogo `semen_toros` y un modelo de eventos en dos capas: una tabla común `eventos` (animal, tipo, fecha, orden de registro, quién, anulación) y una tabla de detalle por tipo (`servicios`, `tactos`). Todo con claves foráneas compuestas con `establecimientoId` y CHECK hechos a mano. La spec 004 solo suma valores al tipo de evento y tablas de detalle (`partos`, `secados`, `crias`); no rehace nada.
Toda operación que registra o anula un evento bloquea primero la fila del animal (`SELECT … FOR UPDATE` en la transacción), así el orden total y las reglas de "último evento" son confiables aun con usuarios simultáneos. La situación reproductiva y la fecha probable de parto se **calculan** con funciones puras (sin base) a partir de la lista de eventos no anulados; no se guardan derivadas.
La API suma el catálogo (`/api/semen`), el registro de servicios y tactos y el listado de eventos del animal, y la anulación por tipo. La web suma la pantalla "Semen y toros" y reemplaza la sección "Historial" de la ficha por la situación reproductiva, los formularios y la lista de eventos.

## Base de datos

### Modelos nuevos (`schema.prisma`)
Todos con `id` `uuid(7)`, `creadoEn` y `establecimientoId`.

- **`SemenToro`** (`semen_toros`): `nombre`, `raza?`, `activo` (default true), `actualizadoEn`. `@@unique([establecimientoId, id])` (destino de la clave foránea del servicio).
- **Enums:** `TipoEvento { SERVICIO TACTO }` (la 004 agrega `PARTO` y `SECADO`), `TipoServicio { INSEMINACION MONTA_NATURAL }`, `ResultadoTacto { PRENADA VACIA }`.
- **`Evento`** (`eventos`): `animalId`, `tipo`, `fecha` (`@db.Date`), `registradoPorId`, y la anulación: `anuladoEn?`, `anuladoPorId?`, `motivoAnulacion?`. `creadoEn` es además el **momento de registro** que desempata el orden (ver Decisiones); no tiene `actualizadoEn` porque el evento nunca se edita (solo se completa la anulación).
  - `@@unique([establecimientoId, id, tipo])`: destino de la clave de los detalles.
  - `@@unique([animalId, creadoEn])`: nunca hay dos eventos de un animal con el mismo momento de registro.
  - `@@index([animalId, fecha, creadoEn])`: lectura en orden total.
  - Relaciones: `animal` por `[establecimientoId, animalId]` → `Animal [establecimientoId, id]`; `registradoPor` y `anuladoPor` por `[establecimientoId, …Id]` → `Usuario [establecimientoId, id]`. Todas `onDelete: Restrict`.
- **`Servicio`** (`servicios`): `eventoId` (`@id`), `establecimientoId`, `tipo` (siempre `SERVICIO`), `tipoServicio`, `semenId?`. Relación con `Evento` por `[establecimientoId, eventoId, tipo]` → `[establecimientoId, id, tipo]`, y con `SemenToro` por `[establecimientoId, semenId]` → `[establecimientoId, id]` (`Restrict`; con `semenId` nulo no se controla, igual que el lote del animal).
- **`Tacto`** (`tactos`): `eventoId` (`@id`), `establecimientoId`, `tipo` (siempre `TACTO`), `resultado`, `fechaProbableIndicada?` (`@db.Date`, la que escribió el usuario), `anomalias?`. Misma clave compuesta hacia `Evento`.
- **`Usuario`**: se agrega `@@unique([establecimientoId, id])` (destino de las claves de `registradoPor` y `anuladoPor`) y las relaciones inversas. Los usuarios no se borran (solo `activo`; `usuarios.ts` borra sesiones, no usuarios), así que `Restrict` no estorba.
- **`Animal`**: relación inversa `eventos`. `Establecimiento`: relaciones inversas.

Si Prisma 7.10.1 exige `@@unique([establecimientoId, eventoId, tipo])` en `Servicio` y `Tacto` para aceptar la relación uno a uno, se agrega (índice redundante e inocuo). Si rechaza alguna clave compuesta, se deja la relación con los campos que acepte y la clave foránea se escribe a mano (plan B ya usado en la 002); se documenta en el SQL y en MEMORY.md. Es el primer riesgo a verificar en T1.

### Migración `reproduccion_base`
Se crea la carpeta `api/prisma/migrations/<fecha>_reproduccion_base/` **a mano** con el SQL que da `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (en `api/`) más el bloque manual, y se aplica con `npx prisma migrate deploy` (`migrate dev` falla sin terminal interactiva; ver MEMORY.md). Antes de empezar, `migrate diff` tiene que dar vacío; después de aplicar, también, sin proponer ningún `DROP` de lo hecho a mano (`animales_numero_activo_unico`, `animales_baja_con_fecha`, `animales_numero_normalizado`, `animales_madre_distinta`, `lotes_nombre_unico_sin_mayusculas`, `reglas_lote_sin_baja` y los nuevos). Si propone alguno, no se aplica.

SQL agregado a mano al final, con un comentario sobre cada objeto:
- `semen_toros`: índice único `semen_toros_nombre_unico_sin_mayusculas` sobre (`establecimientoId`, `lower("nombre")`); CHECK `semen_toros_nombre_valido` (`"nombre" = btrim("nombre") AND char_length("nombre") BETWEEN 1 AND 50`); CHECK `semen_toros_raza_valida` (`"raza" IS NULL OR (char_length("raza") BETWEEN 1 AND 50 AND "raza" = btrim("raza"))`, así "sin raza" siempre es `NULL`).
- `eventos`: CHECK `eventos_fecha_minima` (`"fecha" >= DATE '2000-01-01'`); CHECK `eventos_anulacion_completa` (las tres columnas de anulación son nulas o ninguna lo es); CHECK `eventos_motivo_valido` (si hay motivo, `char_length(btrim("motivoAnulacion")) BETWEEN 1 AND 200`).
- `servicios`: CHECK `servicios_tipo` (`"tipo" = 'SERVICIO'`). Junto con la clave compuesta con `tipo`, un servicio solo puede colgar de un evento de tipo servicio.
- `tactos`: CHECK `tactos_tipo` (`"tipo" = 'TACTO'`); CHECK `tactos_fecha_probable_solo_prenada` (`"fechaProbableIndicada" IS NULL OR "resultado" = 'PRENADA'`); CHECK `tactos_anomalias_largo` (`"anomalias" IS NULL OR char_length("anomalias") BETWEEN 1 AND 200`).
- No hay datos previos que migrar (tablas nuevas), así que no hace falta un bloque `DO $$` de verificación.

### Qué garantiza cada cosa
| Garantía de la spec | Mecanismo |
|---|---|
| Evento de un animal del mismo tambo | Clave compuesta `eventos (establecimientoId, animalId)` → `animales` |
| Servicio con semen del mismo tambo | Clave compuesta `servicios (establecimientoId, semenId)` → `semen_toros` |
| Detalle del mismo tambo y del tipo correcto | Clave compuesta `(establecimientoId, eventoId, tipo)` → `eventos` + CHECK de `tipo` constante |
| Nombre del catálogo único por tambo sin mayúsculas | Índice único sobre `lower(nombre)` (incluye desactivadas) |
| Nunca dos eventos con el mismo orden | `UNIQUE (animalId, creadoEn)` |
| Anulación completa y con motivo válido | CHECK de las tres columnas y del largo |
| Quién registró o anuló es del mismo tambo | Claves compuestas a `usuarios` |
| Eventos que no se borran | No hay rutas de edición ni de borrado; las claves hacia `animales` y `usuarios` son `Restrict` |

## API
Todas las rutas usan `requiereSesion` (401). Las del catálogo que modifican usan `requiereRol('DUENO','ENCARGADO')` (403) como middleware **antes** de leer `body` o `params`. Orden de controles: sesión (401) → rol (403) → formato del cuerpo con zod (400) → id de la ruta y búsqueda en la base (404) → referencias del cuerpo y reglas de fecha (400) → conflictos con el estado (409). Todo se filtra por el `establecimientoId` de la sesión; el cuerpo se parsea con `z.object`, que descarta lo no declarado (por ejemplo un `establecimientoId`).

| Método y ruta | Rol | Qué hace | RF |
|---|---|---|---|
| GET `/api/semen` | Todos | Lista activas y desactivadas del tambo, orden alfabético sin mayúsculas (en JavaScript, como los lotes). `[{ id, nombre, raza (o null), activo }]` | RF-1, RF-27, RF-28 |
| POST `/api/semen` | Dueño, encargado | `{ nombre, raza? }`. Normaliza y valida; crea activa. 201. P2002 → 409 "Ya existe un semen o toro con ese nombre" | RF-2 a RF-4, RF-27, RF-28 |
| PATCH `/api/semen/:id` | Dueño, encargado | `{ nombre?, raza?, activo? }` (al menos uno; `raza` vacía o `null` la borra). `updateMany` filtrado por tambo: 0 filas → 404. También si está desactivada. P2002 → 409. Devuelve la entrada. Desactivar y reactivar son este mismo PATCH con `activo` | RF-3 a RF-6, RF-27, RF-28 |
| GET `/api/animales/:id/eventos` | Todos | Animal activo del tambo (404 si no). Responde `{ situacion, eventos }`; en un macho, `situacion: null` y `eventos: []`. Eventos del más reciente al más antiguo, anulados incluidos | RF-23 a RF-27 |
| POST `/api/animales/:id/servicios` | Todos | `{ fecha, tipo, semenId? }`. Transacción con bloqueo del animal (ver abajo). 201 con el evento | RF-7 a RF-11, RF-18, RF-22, RF-27 |
| POST `/api/animales/:id/tactos` | Todos | `{ fecha, resultado, fechaProbableParto?, anomalias? }`. 201 con el evento | RF-12 a RF-18, RF-22, RF-27 |
| POST `/api/servicios/:id/anular` | Todos | `{ motivo }`. Anula el servicio si es el último evento no anulado. 200 con el evento anulado | RF-19 a RF-22, RF-27 |
| POST `/api/tactos/:id/anular` | Todos | Igual, para tactos. Un id de otro tipo da 404 | RF-19 a RF-22, RF-27 |

"Todos" en las rutas de eventos: los tres roles pueden registrar y anular (tabla de permisos de la spec), pero igual exigen sesión.

### Orden exacto de controles en el registro
1. Sesión (401). 2. Cuerpo con zod (400): `fecha` con formato `AAAA-MM-DD` y que exista en el calendario; `tipo`/`resultado` del enum; `semenId` con formato UUID (un `semenId` que no es UUID es 400 con mensaje, no 404); `anomalias` hasta 200 (vacías → `null`); fecha probable con formato válido y, por venir en el mismo cuerpo, posterior a la fecha del tacto y a no más de 283 días (RF-14) y no permitida si el resultado es `VACIA`. 3. `:id` del animal que no es UUID → 404.
4. **Dentro de la transacción:** bloqueo de la fila del animal (activo y del tambo; si no hay fila → 404 "Animal no encontrado"). 5. `semenId` que no existe o es de otro tambo → 400 (mismo mensaje en ambos casos). 6. Reglas de fecha contra el estado del animal (RF-18): futura, anterior al 01/01/2000, anterior al nacimiento, anterior al último evento no anulado; y, en el tacto "preñada", la exigencia de fecha probable cuando no hay base (RF-13) → 400. 7. Conflictos (409), en este orden: el animal no admite el evento (macho, recién nacida); servicio sobre preñada (RF-11); semen o toro desactivado. 8. Inserción de `eventos` y del detalle con ids generados en la API.

### Anulación
1. Sesión. 2. `{ motivo }` con zod: obligatorio, hasta 200 caracteres sin contar los extremos (400). 3. Dentro de la transacción: se busca el evento por `id`, `establecimientoId` y `tipo` de la ruta (404 también si el id está mal formado, es de otro tambo, de otro tipo o su animal no está activo). 4. Se bloquea la fila del animal y se **relee** el evento ya con el bloqueo. 5. 409 si ya está anulado ("ya fue anulado"); 409 si no es el último no anulado, con el mensaje "Primero tenés que anular el {tipo} del {dd/mm/aaaa}" nombrando al último. 6. Se completa la anulación con `updateMany` filtrado por `anuladoEn: null` (si afecta 0 filas, 409): `anuladoEn` (reloj real), `anuladoPorId` (sesión) y `motivoAnulacion`. No se toca el animal (RF-21).

### Qué devuelve la lista de eventos
Por evento: `id`, `tipo`, `fecha`, `registradoPor` (**solo el nombre del usuario**), `registradoEn`, `anulacion` (`null` o `{ motivo, por (nombre), en }`) y el detalle: servicio `{ tipoServicio, semen: { id, nombre } | null }` (con el nombre actual, aunque esté desactivada) o tacto `{ resultado, fechaProbableIndicada, fechaProbable, anomalias }`, donde `fechaProbable` es la fecha resuelta de un tacto "preñada" no anulado (el cálculo de RF-13) y `null` en los demás. Las lecturas usan `select` explícito con `usuario: { select: { nombre } }`, nunca `include` (RF-26: ninguna respuesta lleva hashes ni datos de acceso).
`situacion`: `{ estado ("SIN_SERVICIO" | "SERVIDA" | "PRENADA" | "VACIA"), ultimoServicio, ultimoTacto, fechaProbableParto: { fecha, dias, vencida } | null, fechaReferencia: { fecha, dias } | null }`. `dias` es positivo si faltan y negativo si ya pasaron, calculado contra el "hoy" de Argentina del reloj inyectable.

## Lógica pura (sin base ni Express)
- **`api/src/reproduccion/fechas.ts`**: `DIAS_GESTACION = 283`, `sumarDias(fecha, n)` y `diasEntre(desde, hasta)` (cálculo en UTC sobre textos `AAAA-MM-DD`, sin husos horarios) y `validarFechaEvento(fecha, { hoy, nacimiento, ultimoEvento })` que devuelve el mensaje de error o `null` (futura, anterior al 01/01/2000, al nacimiento o al último evento no anulado; igual fecha al último se acepta). Reutiliza `esFechaValida`, `FECHA_MINIMA` y `hoyArgentina` de `animales/reglas.ts`.
- **`api/src/reproduccion/situacion.ts`**:
  - `ordenarEventos(lista)`: orden total por `fecha` y después `creadoEn`.
  - `ultimoNoAnulado(lista)`, `cicloActual(lista)` (los no anulados posteriores al último tacto "vacía"; la 004 suma "o al último parto" en esta única función) y `servicioBase(lista)`.
  - `resolverFechaProbable(lista, fechaIndicada)`: indicada → última indicada de un tacto "preñada" del ciclo → servicio base + 283 → `null` (el llamador responde 400).
  - `calcularSituacion(lista, hoy)`: estado reproductivo, últimos eventos, fecha probable vigente (solo si "preñada") y fecha de referencia (solo si "servida"), con `dias` y `vencida`. También devuelve la fecha resuelta de cada tacto "preñada" (repitiendo el cálculo en orden) para la lista.
- **`api/src/reproduccion/aptitud.ts`**: `puedeRecibirEventoReproductivo(sexo, estado)` con el motivo en español (macho, recién nacida).
- **`api/src/reloj.ts`**: `ahora()`, `fijarReloj(fecha | null)`. Es el "reloj inyectable" (ver Decisiones).

## Interfaz
- **Menú:** `NavLink` "Semen y toros" (`/semen`) en `Layout.tsx`.
- **Semen y toros** (`paginas/SemenToros.tsx`, `/semen`): sigue el estilo de `Lotes.tsx`. Lista (nombre, raza o "sin raza", etiqueta "Activa" / "Desactivada" con texto además del color), formulario de alta (nombre, raza) y, por entrada, "Editar" (en la misma tarjeta), "Desactivar" / "Reactivar". Los errores 400 y 409 van debajo del campo nombre. El veterinario ve el catálogo sin botones ni formulario (RF-29). Controles de 48 px; en 375 px las tarjetas apilan sus botones.
- **Ficha** (`paginas/AnimalFicha.tsx`): para hembras carga además `/animales/:id/eventos` y muestra, en lugar de la sección "Historial" actual, el componente `componentes/Reproduccion.tsx` con tres partes:
  1. **Situación reproductiva**: estado, último servicio (con semen o toro), último tacto, fecha probable (o "Referencia (servicio + 283 días)" si está servida), días que faltan o pasaron y el aviso "vencida" cuando corresponde; "sin dato" donde falte.
  2. **Acciones** (solo las que corresponden): "Registrar servicio" si es vaquillona, en ordeñe o seca y no está preñada (si está preñada, un texto explica que primero hay que cargar un tacto "vacía"); "Registrar tacto" si es vaquillona, en ordeñe o seca; "Anular último evento" en la fila del último evento no anulado. Formularios en línea debajo de los botones: fecha (`<input type="date">` con `max` de hoy en Argentina y `min` 2000-01-01, precargada con hoy), tipo y semen o toro en un `select` con "No especificado" y solo entradas activas (servicio); resultado, fecha probable (solo si es "preñada", con la ayuda "Si no la indicás, se calcula con el servicio") y anomalías (tacto); motivo en un `textarea` (anular, con confirmación). Errores de la API debajo del campo o en una alerta, y al guardar se recarga la ficha.
  3. **Lista de eventos** del más reciente al más antiguo: tipo, fecha, datos principales, quién registró y, si fue anulado, marca "Anulado" con motivo, quién y cuándo (tachado más texto, no solo color). Sin eventos: "Todavía no hay eventos registrados". Los machos conservan ese texto y no ven la situación ni las acciones.
- Todos los controles de al menos 48 px, sin desbordes horizontales en 768 px y 375 px, en modo claro y oscuro con las variables de `estilos.css`.

## Archivos
- Crear:
  - `api/prisma/migrations/<fecha>_reproduccion_base/migration.sql`
  - `api/src/reloj.ts`
  - `api/src/reproduccion/fechas.ts`, `situacion.ts`, `aptitud.ts`
  - `api/src/reproduccion/bloqueo.ts`: `bloquearAnimal(tx, animalId, establecimientoId)` (el `SELECT … FOR UPDATE` crudo, que devuelve sexo, estado y nacimiento o `null`) y `siguienteRegistro(tx, animalId)` (momento de registro estrictamente creciente). La 004 lo reutiliza tal cual.
  - `api/src/reproduccion/eventos.ts`: lectura de los eventos de un animal con sus detalles y nombres (`select` explícito), armado de la respuesta y texto del evento ("tacto del 05/11/2026").
  - `api/src/reproduccion/anular.ts`: la anulación compartida por servicios y tactos (recibe el tipo).
  - `api/src/rutas/semen.ts`, `api/src/rutas/reproduccion.ts` (rutas bajo `/api/animales/:id/…`), `api/src/rutas/anulaciones.ts` (`/api/servicios/:id/anular` y `/api/tactos/:id/anular`)
  - Tests: `api/tests/base-reproduccion.test.ts`, `situacion.test.ts`, `fechas-eventos.test.ts`, `semen.test.ts`, `servicios.test.ts`, `tactos.test.ts`, `anulaciones.test.ts`, `reproduccion-concurrencia.test.ts`, `eventos-lista.test.ts`
  - `web/src/paginas/SemenToros.tsx`, `web/src/componentes/Reproduccion.tsx`, `web/src/reproduccion.ts` (nombres en español de estados, tipos y resultados; fecha de hoy en Argentina para el cliente)
- Modificar:
  - `api/prisma/schema.prisma`
  - `api/src/validacion.ts`: `nombreSemenSchema`, `razaSemenSchema`, `motivoAnulacionSchema` (usa `normalizarNombre` y el largo en code points)
  - `api/src/app.ts`: montar `/api/semen`, `/api/servicios`, `/api/tactos` y las rutas de reproducción en `/api/animales`; guardas de sesión y rol **antes** de los parsers de JSON para las rutas nuevas (ver Decisiones)
  - `api/tests/ayudas.ts`: `limpiarBase()` con las tablas nuevas; helpers `crearSemenDirecto`, `crearServicioDirecto` y `crearTactoDirecto` (insertan evento y detalle con `creadoEn` creciente)
  - `web/src/api.ts` (tipos), `web/src/componentes/Layout.tsx`, `web/src/App.tsx` (ruta `semen`), `web/src/paginas/AnimalFicha.tsx`, `web/src/estilos.css`
  - `MEMORY.md` y `docs/plan.md` (cierre)

## Decisiones
- **Tabla común `eventos` más una tabla de detalle por tipo (servicios, tactos; en la 004 partos y secados).** Elegida porque el orden total, el "último evento no anulado", la anulación (quién, cuándo, motivo) y el bloqueo por animal son iguales para todos los tipos y quedan en un solo lugar, la lista de la ficha sale de una sola consulta, y la 004 solo agrega valores al enum `TipoEvento` (con `ALTER TYPE … ADD VALUE` en una migración propia, porque un valor nuevo no se puede usar dentro de la misma transacción) y tablas de detalle. Alternativa descartada 1: una tabla por tipo sin tabla común: el orden total y el "último evento" necesitarían uniones entre tablas y cada tipo repetiría las columnas de anulación. Alternativa descartada 2: una sola tabla ancha con columnas nulas: la 004 sumaría muchas columnas más (estado y lote previos, genética, crías) y los CHECK por tipo se vuelven ilegibles.
- **Orden total = `fecha` y después `creadoEn`, con `creadoEn` estrictamente creciente por animal.** Dentro de la transacción ya bloqueada, `creadoEn` = el mayor entre el reloj real y (el máximo `creadoEn` de **todos** los eventos del animal, anulados incluidos, + 1 ms). Junto con `UNIQUE (animalId, creadoEn)` el empate es imposible, aun con el reloj del servidor atrasado. Alternativa descartada: una columna `orden` autoincremental o una secuencia de la base: la constitución §5 pide no depender de números que genera el servidor para el modo sin conexión, y un `creadoEn` ya es un dato que el cliente podrá generar en la Etapa 6 (con el mismo criterio de desempate).
- **Bloqueo por animal con `SELECT … FOR UPDATE` sobre su fila, como primer paso de cada transacción que registra o anula un evento.** Cualquier otra operación sobre el mismo animal espera a que termine la primera, y las instrucciones siguientes (en `READ COMMITTED` cada una ve lo ya confirmado) leen el estado real; así RF-11 y RF-18 se verifican sobre datos firmes, no sobre una lectura vieja. La misma consulta resuelve el 404 (animal activo del tambo). Solo se bloquea una fila por operación, así que no hay interbloqueos. Alternativa descartada 1: aislamiento `Serializable` con reintentos: más código y los conflictos se resolverían por error de la base, no por orden. Alternativa descartada 2: un índice o CHECK que impida "servicio sobre preñada": la regla depende de la lista de eventos y no se expresa como restricción de la base; por eso el bloqueo es el mecanismo y los tests de concurrencia lo prueban.
- **Las derivadas no se guardan: situación y fecha probable se calculan con funciones puras sobre los eventos no anulados.** Así anular un evento "recalcula" solo (RF-19, RF-21), no hay estado que quede desactualizado y las reglas se prueban con tests rápidos sin base. El tacto guarda solo la fecha que indicó el usuario (`fechaProbableIndicada`). Alternativa descartada: guardar la fecha resuelta en cada tacto o una columna "estado reproductivo" en el animal: duplica información y obliga a mantenerla al anular. Si los informes de la Etapa 4 necesitan filtrar por fecha probable en SQL, se agregará entonces.
- **El "hoy" sale de un reloj inyectable (`reloj.ts`) que solo se cambia desde los tests, y todas las comparaciones usan `hoyArgentina(ahora())`.** Alternativas descartadas: una cabecera o variable de entorno que fije la fecha (abre un hueco en producción para saltarse "no futura") y pasar el reloj por `createApp` (los tests comparten el `app` creado en `ayudas.ts`). Las marcas de registro y de anulación usan siempre el reloj real, no el inyectable: el reloj fijo solo gobierna "hoy".
- **Claves compuestas con `establecimientoId` en todo, incluidos `registradoPor`, `anuladoPor` y el `tipo` del detalle.** Es el mismo mecanismo de las specs 001 y 002 y cubre las garantías de la constitución §6 sin código extra. Alternativa descartada: claves simples a `usuarios` y a `eventos`: no impedirían que un evento apunte a un usuario o detalle de otro tambo si algún día falla una ruta.
- **El catálogo se desactiva con un `PATCH` con `activo` (sin ruta aparte) y la raza vacía se guarda como `NULL`.** Menos rutas, mismo permiso y mismos errores que editar. Alternativa descartada: `POST …/desactivar` y `…/reactivar`: más rutas y más tests para el mismo efecto.
- **Rutas de anulación separadas por tipo (`/api/servicios/:id/anular`, `/api/tactos/:id/anular`) con una función común.** Lo pide la spec (RF-19): el tipo sale de la ruta, así un id de otro tipo es 404 sin lógica especial. Alternativa descartada: una ruta única `/api/eventos/:id/anular`: obligaría a decidir el permiso por tipo después de buscar el evento, y la 004 necesita permisos distintos (el veterinario no anula partos ni secados).
- **Las guardas de sesión (y de rol en el catálogo) se montan en `app.ts` antes de los parsers de JSON**, como en las rutas de carga de la 002: un pedido sin sesión (o un veterinario en el catálogo) recibe 401 (403) aunque el JSON venga roto. Alternativa descartada: dejarlas solo en los routers: un cuerpo mal formado ganaría con 400 y rompería el orden de controles (RF-28).
- **Las validaciones del cuerpo que no dependen de la base (formato y existencia de la fecha, relación entre la fecha probable y la fecha del tacto) van en zod, antes del 404.** Las que dependen del animal (futura, nacimiento, último evento, base del servicio) van después de buscarlo. Respeta el orden de la spec ("cuerpo mal formado gana sobre animal inexistente").
- **Los detalles se insertan con ids generados en la API (`crypto.randomUUID()`) y dos `create` en la misma transacción.** Alternativa descartada: `create` anidado de Prisma: con claves compuestas hacia el evento depende de cómo Prisma completa `establecimientoId` y `tipo`, y los ids generados por el cliente son lo que pide la constitución §5.
- **Sin dependencias nuevas.**

## Estrategia de tests
Tests primero, con Vitest y supertest sobre `cowregister_test`. Los datos de partida se arman con los helpers directos de `ayudas.ts` (sin pasar por la API); los roles con `crearUsuario`; el "hoy" con `fijarReloj` (restaurado en `afterEach`). Los tests puros (`situacion`, `fechas-eventos`) no usan la base. La web no tiene tests automáticos: se verifica en el navegador.

| RF | Test (archivo › caso) |
|---|---|
| RF-1 | semen.test.ts › lista activas y desactivadas, orden sin mayúsculas, "sin raza" como `null`; los tres roles la ven |
| RF-2 | semen.test.ts › dueño y encargado crean con y sin raza; queda activa en su tambo |
| RF-3 | semen.test.ts › normaliza espacios y tabulaciones; vacío, 50 y 51 caracteres (con ñ), raza de 51; raza de solo espacios queda `null` · base-reproduccion.test.ts › CHECK de nombre y raza |
| RF-4 | semen.test.ts › "Toro 1" y "toro  1" chocan (409 con el mensaje) al crear y al editar, también contra una desactivada; dos tambos con el mismo nombre se permiten; `Promise.all` de dos altas del mismo nombre deja una sola · base-reproduccion.test.ts › el índice rechaza el duplicado insertado directo |
| RF-5 | semen.test.ts › edita nombre y raza, también desactivada; renombrar a sí misma o cambiar mayúsculas da 200 |
| RF-6 | semen.test.ts › desactivar y reactivar con PATCH · servicios.test.ts › el formulario no admite una desactivada (409) y la lista de eventos la sigue mostrando |
| RF-7 | servicios.test.ts › servicio con y sin semen sobre vaquillona, en ordeñe y seca: 201, estado "SERVIDA", animal sin cambios de estado ni lote · eventos-lista.test.ts › aparece en la lista con su semen |
| RF-8 | servicios.test.ts › sin fecha, sin tipo, tipo inválido y fecha inválida: 400 en español |
| RF-9 | servicios.test.ts › `semenId` inexistente, de otro tambo y mal formado: 400 con el mismo mensaje; desactivada: 409 |
| RF-10 | servicios.test.ts › macho y recién nacida: 409 con el motivo |
| RF-11 | servicios.test.ts › sobre preñada 409 con el mensaje; sobre servida o con tacto "vacía" se acepta; después de un tacto "vacía" se acepta |
| RF-12 | tactos.test.ts › preñada y vacía sobre vaquillona, en ordeñe y seca (201); macho y recién nacida 409; sin resultado o sin fecha 400; sin servicio previo se acepta |
| RF-13 | situacion.test.ts › indicada, conservada del ciclo, servicio base + 283, ninguna (`null`); servicio anterior a un "vacía" no cuenta · tactos.test.ts › sin base y sin fecha 400; con servicio y sin fecha se guarda y la fecha vigente es servicio + 283 |
| RF-14 | tactos.test.ts › fecha probable igual o anterior al tacto, a 284 días, a 283 días (se acepta) y con tacto "vacía": 400 |
| RF-15 | tactos.test.ts › "vacía" sobre preñada deja "VACIA" sin fecha vigente; sobre una vaca sin servicio ni preñez se acepta; estado y lote del animal sin cambios |
| RF-16 | situacion.test.ts › vale el último tacto "preñada"; los anteriores siguen en la lista; la derivada de hace 300 días se informa con `vencida` y días negativos · tactos.test.ts › idem por API |
| RF-17 | tactos.test.ts › anomalías de 200 (se guardan) y 201 (400); vacías quedan `null` y la lista las muestra como "sin anomalías" |
| RF-18 | fechas-eventos.test.ts › `2026-11-11T10:00`, `11/11/2026`, `2026-02-30`, futura, hoy (se acepta), 31/12/1999, anterior al nacimiento, anterior al último evento no anulado, igual fecha que el último; "mañana" con el reloj fijo a las 22:00 de Argentina (que ya es otro día en UTC) · servicios.test.ts y tactos.test.ts › el mismo mensaje por API; evento olvidado entre dos ya cargados |
| RF-19 | anulaciones.test.ts › anula servicio y tacto: queda guardado, con quién, cuándo y motivo, y la situación se recalcula; otro tambo, inexistente, mal formado, de otro tipo (servicio con la ruta de tactos) y animal de baja dan el mismo 404 · base-reproduccion.test.ts › CHECK de anulación incompleta |
| RF-20 | anulaciones.test.ts › no es el último: 409 con "Primero tenés que anular…"; ya anulado: 409; motivo vacío o de 201: 400; anular el último y después el anterior se permite |
| RF-21 | anulaciones.test.ts › al anular un tacto "vacía" vuelve el estado anterior; estado y lote del animal sin cambios |
| RF-22 | reproduccion-concurrencia.test.ts › `Promise.all` repetido: servicio y tacto "preñada" sobre la misma vaca (nunca un servicio sobre preñez vigente); dos anulaciones del mismo evento (una 200 y una 409); anulación del último y del anterior a la vez; anulación y registro a la vez; después de cada ronda se revisa que ningún evento tenga fecha anterior a la de otro posterior · base-reproduccion.test.ts › `UNIQUE (animalId, creadoEn)` |
| RF-23 | situacion.test.ts › los cuatro estados, últimos eventos, fecha de referencia solo en "servida" · eventos-lista.test.ts › hembra con situación; macho con `situacion: null` · manual en el navegador |
| RF-24 | situacion.test.ts › días que faltan y que pasaron con "hoy" de Argentina (reloj fijo) · manual en el navegador |
| RF-25 | eventos-lista.test.ts › orden del más reciente al más antiguo (a igual fecha, por registro), anulados con marca y motivo · manual: "Todavía no hay eventos registrados" sin eventos |
| RF-26 | eventos-lista.test.ts › "registró" y "anuló" son solo el nombre; el JSON de todas las respuestas nuevas no contiene `passwordHash`, `tokenHash` ni `email` |
| RF-27 | aislamiento entre dos tambos para cada acción: semen.test.ts (listar, crear con `establecimientoId` ajeno ignorado, editar, desactivar), servicios.test.ts y tactos.test.ts (registrar sobre un animal ajeno, con `semenId` ajeno y con `establecimientoId` en el cuerpo), eventos-lista.test.ts (ver), anulaciones.test.ts (anular un evento ajeno); animal, evento o semen de otro tambo, inexistente o mal formado: el mismo 404 · base-reproduccion.test.ts › claves compuestas rechazan evento con animal ajeno, servicio con semen ajeno, detalle con evento de otro tipo y usuario de otro tambo |
| RF-28 | semen.test.ts › veterinario 200 al listar y 403 al crear, editar y desactivar (también con datos inválidos y con una entrada ajena o inexistente), con JSON roto también; sin sesión 401 en todas las rutas nuevas, con JSON roto también · servicios.test.ts, tactos.test.ts y anulaciones.test.ts › el veterinario puede registrar y anular |
| RF-29 | Verificación manual en el navegador (veterinario: catálogo y situación en lectura, sin botones de alta, edición ni desactivación) |
| RF-30 | Verificación manual en el navegador: acciones según estado y rol, "No especificado" en el select, 48 px, 768 px y 375 px, claro y oscuro, errores en español |
| RF-31 | Verificación manual en el navegador: pantalla "Semen y toros" completa, 48 px, 768 px y 375 px, claro y oscuro |

## Riesgos
- **Que Prisma 7.10.1 no acepte alguna clave compuesta** (la del `tipo` en el detalle, o la de un campo opcional como `semenId`). Plan B: claves escritas a mano en el SQL, documentadas. T1 lo verifica primero.
- **Que `migrate diff` quiera borrar objetos hechos a mano** (los de las specs 001 y 002 y los nuevos). Se mitiga con el chequeo antes y después, igual que en las migraciones anteriores.
- **`creadoEn` como orden de registro no sirve tal cual para el modo sin conexión (Etapa 6):** dos dispositivos pueden generar el mismo momento. Hoy queda cubierto por el bloqueo y el `UNIQUE`; en la Etapa 6 habrá que sumar un desempate por dispositivo. Queda anotado en MEMORY.md.
- **`FOR UPDATE` también frena por unos milisegundos las altas de crías que apunten a esa vaca** (la clave foránea de la madre pide un bloqueo compatible solo con `FOR NO KEY UPDATE`). Es aceptable por la duración; si molestara, se pasa a `FOR NO KEY UPDATE`, que alcanza para serializar los eventos.
- **Concurrencia difícil de probar:** los tests repiten cada carrera varias veces y aceptan solo los resultados que enumera RF-22; un fallo intermitente se trata como un error real, no se reintenta el test.
- **Eventos que solo se agregan, garantizado solo en la API** (no hay disparador que impida un `UPDATE` o `DELETE` directo en la base). Es coherente con las demás specs; si hiciera falta una defensa extra, se agregaría un disparador en la 004.
- **La 004 cambia `cicloActual`, `ultimoNoAnulado` y la lista** (partos y secados): están concentrados en `situacion.ts` y `eventos.ts` para que el cambio sea en un solo lugar y con los tests de esta spec como red.
