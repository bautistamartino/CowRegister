# Memoria del proyecto

Estado actual y decisiones importantes. La actualiza el implementador al terminar cada spec, y cualquiera que tome una decisión de diseño. Lo más reciente va arriba en cada sección.

## Estado

- **Etapa 1 — Base del sistema** (ver [docs/plan.md](docs/plan.md))
  - Hecho: 1.0 preparación, 1.1 esqueleto, 1.2 base de datos, 1.3 login y seguridad, 1.4 lotes y destino de cada estado (spec [001-lotes](specs/001-lotes/spec.md)), 1.5 animales y 1.6 buscador (spec [002-animales-buscador](specs/002-animales-buscador/spec.md)): alta manual, carga desde planilla con vista previa, listado, ficha y buscador por número.
  - 1.7 cierre (2026-11-11): 275 tests y typecheck en verde; las ramas apiladas se juntaron en `main`. El repositorio está en GitHub (`origin`, rama `main`); el usuario hace los `git push` (los agentes no).
- **Etapa 2 — Reproducción** (en curso)
  - Hecho: 2.1 semen, servicios y tactos (spec [003-reproduccion](specs/003-reproduccion/spec.md)): catálogo "Semen y toros", servicios, tactos con fecha probable de parto, situación reproductiva en la ficha y anulación del último evento (con motivo, sin borrar).
  - Hecho: 2.2 partos, crías y secados (spec [004-partos-secados](specs/004-partos-secados/spec.md)): registro y anulación de partos y secados (dueño y encargado), alta de las crías vivas, genética de la cría, lote previo, avisos de la lista cerrada y reinicio del ciclo reproductivo. Anular un parto da de baja a las crías vivas (`PARTO_ANULADO`).
  - Hecho: 2.3 editar animal y mover de lote a mano (spec [005-editar-animal](specs/005-editar-animal/spec.md)): edición de número, sexo, fecha de nacimiento y madre (dueño y encargado), mover de lote o dejar sin lote, historial de cambios manuales en la ficha (los tres roles) y aviso 8 al anular un parto o secado tras un movimiento manual.
- **Etapa 3 — Bajas** (ver [docs/plan.md](docs/plan.md))
  - Hecho: 3.1 bajas por venta o muerte (spec [006-bajas](specs/006-bajas/spec.md), T1 a T5): dar de baja y revertir (dueño y encargado), listado `/bajas` y ficha de baja (los tres roles), vínculos madre–cría hacia animales de baja, aviso al reutilizar el número de un animal de baja (alta, edición y planilla).
- **Etapa 4 — Historial e informes** (ver [docs/plan.md](docs/plan.md))
  - Hecho: 4.1 historial único por animal e informes de resultado de inseminación y natalidad (spec [007-historial-informes](specs/007-historial-informes/spec.md), T1 a T5): historial en las fichas de hembra, macho y baja, informes por período con desglose por semen y entrada "Informes" en el menú (los tres roles, solo lectura). Cierre (2026-11-12): 1151 tests y typecheck en verde.
- **Etapa 5 — Producción** (ver [docs/plan.md](docs/plan.md))
  - Hecho: 5.1 producción: litros por vaca e informe de leche (spec [008-produccion](specs/008-produccion/spec.md), T1 a T5): carga y anulación de litros por ordeño (dueño y encargado), sección "Producción" en las fichas de vaca y de baja (los tres roles) e informe "Litros de leche" por período (por lote, por vaca y por día) dentro de "Informes".
- **Etapa 6 — Modo sin conexión** (ver [docs/plan.md](docs/plan.md), en curso)
  - Hecho: 6.1 app instalable, consulta sin conexión y carga de litros sin conexión (spec [009-sin-conexion](specs/009-sin-conexion/spec.md), T1 a T5): copia completa del tambo en la tablet (`GET /api/copia-local`), listado, buscador y fichas locales, litros pendientes con envío automático, pantalla "Pendientes de sincronizar", sesión y cierre de sesión con borrado de todo lo local.
  - **Siguiente:** 6.2 en la **spec 010** (los demás eventos sin conexión: servicios, tactos, partos, secados, bajas, anulaciones; orden por fecha y hora con relojes distintos, ver Riesgos pendientes). Una nueva sesión debería partir de `docs/plan.md`.
  - **Limpieza hecha (2026-11-12):** se borraron de la base de desarrollo los tambos de prueba T3, T4 y T5 con todos sus datos (transacción con `SET LOCAL session_replication_role = 'replica'`, solo para esos tres tambos). Queda solo el tambo real "Libertad".
- Hay una API de gestión de usuarios (`/api/usuarios`) **sin pantalla** todavía.

## Decisiones

- **2026-11-12 — Modo sin conexión (spec 009):**
  - **Copia del tambo en UNA transacción `RepeatableRead` con foto única** (`GET /api/copia-local`, `api/src/copia/`): fichas, eventos, historial, producción y lotes salen del mismo instante. Usa lecturas masivas por tambo (consultas con ventana `row_number()`) en vez de una consulta por animal; un test compara cada animal con las rutas individuales (paridad) y otro mide 2.000 animales. Tope de 5.000 animales activos con 422 (completa o nada, nunca recortada), gzip con `node:zlib`.
  - **IndexedDB y service worker artesanales** (sin librerías ni dependencias nuevas): `Almacen` es una interfaz con dos implementaciones (IndexedDB real y memoria para los tests); reemplazar la copia es una sola transacción (o queda la nueva completa o la anterior). El service worker (`web/public/sw.js`) guarda solo el código de la app y **nunca toca `/api`**: los datos del tambo no pasan por ese caché, así que cerrar sesión los borra todos.
  - **Hora informativa aparte de `creadoEn`:** la carga de litros acepta `cargadoEnDispositivo` (columna nueva, solo consulta). `creadoEn` sigue siendo la hora del servidor, así el orden y la unicidad de las specs 003 y 005 no cambian; si el reloj de la tablet está adelantado más de 5 minutos o es anterior al 2000, el dato se descarta y el litro se guarda igual.
  - **Clasificación de respuestas** (`web/src/sinconexion/clasificar.ts`, tabla cerrada): solo 400, 403, 404 y 409 son "rechazado" (no se reintenta solo); 401 es sesión (detiene y conserva); 408, 429, 5xx, cortes, tiempos agotados, otros códigos y un 200 que no es de la API (portal de WiFi con HTML) siguen "esperando" con esperas crecientes (5 s a 5 min). El `id` UUID del cliente evita duplicados al reenviar.
  - **Estado de conexión** con eventos `online`/`offline`, fallos de red de `api()` y una sonda a `/api/salud` cada 15 s (`navigator.onLine` solo no alcanza). Las lecturas de la lista cerrada se resuelven dentro de `api()` desde la copia; el resto sin conexión da "Esto necesita conexión".
  - **Sesión y datos de otro usuario (RF-43 a RF-48):** nunca queda visible ni enviable un dato de otro usuario o tambo. `web/src/sinconexion/propietario.ts` decide al ingresar: mismo usuario y tambo conserva copia y pendientes y retoma el envío; otro usuario sin pendientes reemplaza sin preguntar; con pendientes se muestra "Hay datos de otro usuario en esta tablet" con la cantidad y solo con confirmación se borra todo (si cancela, se cierra la sesión recién abierta y vuelve al ingreso, sin borrar). Un 401 en vivo no borra nada. Cerrar sesión borra copia, pendientes, enviados y perfil, con confirmación y cantidad si hay pendientes; sin conexión igual cierra y borra, y avisa. **Agregado:** si el servidor no se pudo cerrar, queda una marca en `localStorage` y se cierra apenas hay señal, antes de preguntar quién está ingresado (si no, la cookie viva reingresaría sola).
  - **Riesgos aceptados por el usuario:** tras revocar la sesión o dar de baja a un usuario la tablet sigue mostrando datos locales hasta volver la señal; los datos locales están sin cifrar; el control de duplicado local usa datos que pueden estar viejos (el servidor decide al sincronizar).
  - **HTTPS para instalar:** el navegador solo instala la app y registra el service worker en `localhost` o con HTTPS. En la tablet real hace falta HTTPS (Etapa 7).
  - **`migrate diff` esperado:** sigue dando solo las TRES claves foráneas de lote previo (bajas, partos y secados); no aplicar esa propuesta. La columna `cargadoEnDispositivo` y su CHECK `producciones_hora_dispositivo_rango` (a mano) no deben aparecer como diferencia.
  - **Web:** `npm test` de la raíz corre API y web (Vitest también en `web`, entorno Node, solo lógica pura). Los módulos de datos de `sinconexion/` no chocan por mayúsculas con los componentes (`copiaLocal.ts`, no `CopiaLocal`).
- **2026-11-12 — Producción (spec 008):**
  - **Litros en décimas enteras** (`litrosDecimas`, 0 a 999): nunca hay punto flotante; 0,1 + 0,2 da exactamente 0,3 y se redondea solo al mostrar (medio punto hacia arriba, sobre el valor exacto). La API acepta un número JSON o un texto `d`, `dd`, `d.d`, `dd.d`; la coma la convierte la web.
  - **Informe con agregaciones SQL** (`api/src/informes/leche.ts`, cinco consultas en una transacción de lectura consistente), distinto de la 007 (TypeScript): la producción es de mucho volumen (dos registros por vaca por día durante 5 años) y traer todas las filas a Node sería caro; la base suma y agrupa con el índice por tambo y fecha. El **límite de salida** es el tope de 2.000 filas en el desglose por vaca (corta por mayor promedio exacto, con empate por número natural); por día y por lote no tienen tope y los totales cuentan todo. Topes inyectables en `api/src/topes.ts` (ficha 200).
  - **Lote copiado sin clave:** cada registro guarda el id y el nombre del lote de la vaca al cargar, sin clave foránea; el informe por lote usa ese lote aunque la vaca cambie de lote o el lote se elimine.
  - **Anulación con bloqueo de la vaca** (`FOR UPDATE`): dos anulaciones o una carga y una anulación sobre la misma vaca se serializan; la segunda anulación da 409 (nunca 500). Se puede anular aunque la vaca ya no esté en ordeñe; no si está de baja (404).
  - **`id` del cliente idempotente:** la carga acepta un UUID opcional; el mismo `id` con los mismos datos devuelve el registro ya guardado sin crear otro (se resuelve antes de revisar estado y duplicado); con otros datos o de otro tambo da 409 genérico. `P2002` de la base se traduce a 409.
  - **Sugerencia de fecha y turno calculada en la API** con `ahora()` (hora de Argentina; mañana antes de las 14:00, tarde desde las 14:00), no con el reloj del navegador. El turno es cambiable en la pantalla.
  - **`migrate diff` esperado:** sigue dando solo las TRES claves foráneas de lote previo (bajas, partos y secados); no aplicar esa propuesta. El índice único parcial `producciones_un_vigente_por_ordeno`, los CHECK y el disparador `producciones_solo_agregar` están a mano en la migración `produccion_base`.
  - **La validación del período del informe sigue duplicada en la web** (`web/src/informes/informesDatos.ts`, con `periodoPorDefectoLeche`: mes en curso hasta hoy en hora de Argentina); si cambian las reglas hay que cambiar la API y la web.
  - **`Informes.tsx`:** al cambiar de informe se reinicia el período (el de leche propone el mes en curso y los otros dos empiezan vacíos).
  - **Web:** la sección "Producción" (`web/src/produccion/Produccion.tsx`) está en la ficha de la vaca (con formulario si está en ordeñe y "Anular" para dueño y encargado) y en la ficha de baja (solo lectura); al guardar se vuelve al listado/buscador con la confirmación. La producción no entra en el historial de la 007.
- **2026-11-12 — Historial e informes (spec 007):**
  - **Historial único armado en la API** (`GET /api/animales/:id/historial` y `GET /api/bajas/:id/historial`): reúne eventos y cambios manuales, con tope de 500 entradas y `ultimoEventoNoAnuladoId` calculado antes del corte (así "Anular" sigue apareciendo aunque ese evento quede fuera). Los cambios manuales se ubican en su día argentino; los anulados, en la fecha del evento. Las rutas viejas (`/eventos`, `/cambios`, `/api/bajas/:id`) no cambiaron.
  - **Topes en `api/src/topes.ts`** (historial 500, informes 2.000), inyectables con `fijarTopes` solo en los tests.
  - **Informes calculados en TypeScript** (`api/src/informes/`), nada se guarda: el resultado de cada servicio se mide "a hoy" con su tramo (hasta el siguiente servicio o parto no anulado, en el orden total); vale el primer tacto del tramo; un parto vinculado sin tacto cuenta como preñada. Porcentaje entero con el medio punto hacia arriba y `null` ("—") sin base. Las bajas por venta o muerte cuentan; los anulados no.
  - **Índice nuevo `(establecimientoId, tipo, fecha)` en `eventos`** (migración `informes_indice_eventos`). `migrate diff` esperado: sigue dando solo las TRES claves foráneas de lote previo; no aplicar esa propuesta.
  - **La validación del período está duplicada en la web** (`web/src/informes/informesDatos.ts`, mismos mensajes que la API): si cambian las reglas, hay que cambiar las dos.
  - **Web:** una sola sección "Historial" (`web/src/historial/Historial.tsx`) reemplaza la lista de eventos y los "Cambios manuales"; los informes viven en `/informes`, para los tres roles.
- **2026-11-12 — Bajas por venta o muerte (spec 006):**
  - **La baja es un evento** (`TipoEvento.BAJA`, tabla `bajas` con clave compuesta al evento y al animal) con columna `vigente`: un índice único parcial permite una sola baja vigente por animal. Revertir marca la baja como anulada (quién, cuándo y motivo) y no borra nada. Un disparador diferido (`bajas_solo_agregar` y coherencia animal–baja–evento) garantiza que fecha y motivo del animal coincidan con su baja vigente; un test usa `session_replication_role = replica` para saltearlo y probar los CHECK directo.
  - **`BAJA` queda fuera de los cálculos** de situación reproductiva, ciclo, aviso 8, sexo y eventos propios. "Parto anulado" sigue siendo un motivo interno (no se pide por la API, no aparece en listados ni tiene ficha).
  - **Revertir se hace por id del animal** y responde 404 para todo lo demás (activo, ajeno, inexistente, mal formado, "parto anulado", ya revertido). Orden de rechazos: 401, 403, 400, 404, 409 (número ocupado).
  - **Lecturas de bajas solo por `/api/bajas`** (listado y ficha de baja); las rutas de animales activos siguen dando 404 para un animal de baja.
  - **El alta manual bloquea a la madre** (`FOR UPDATE` en una transacción): cierra el riesgo de la 002.
  - **CHECK `animales_baja_con_fecha_y_motivo` creado `NOT VALID`** (no revisa las filas viejas, solo las nuevas) y `animales_activo_sin_baja`.
  - **`migrate diff` esperado ahora:** da solo TRES claves foráneas de lote previo (`SET NULL (columna)`: bajas, partos y secados). No aplicar esa propuesta.
  - **Avisos de número (RF-14):** la API devuelve datos (`avisoNumeroDeBaja`, `avisosDeNumero` por fila, `avisos` al editar) y la web arma el texto "El número X perteneció a un animal dado de baja por <venta|muerte> el dd/mm/aaaa". Es un aviso (`role="status"`, estilo `.aviso`), nunca un error, y no persiste.
  - **Web:** madre y crías de baja con la marca "dada de baja" y enlace a `/bajas/:id` solo si fue venta o muerte; los avisos del alta y de la reversión llegan por el estado de navegación (un refresco de la página con ese estado los repite: límite conocido).
- **2026-11-11 — Editar animal y mover de lote (spec 005):**
  - **`CambioAnimal` (historial) con texto copiado y sin claves** a lote, madre ni usuario: un lote del historial se puede eliminar y el historial se lee siempre. Una fila por dato, con el mismo `creadoEn` por guardado (`siguienteRegistro`). Un trigger en la base impide `UPDATE` y `DELETE` (solo se agrega); `TRUNCATE` no lo dispara, así que `limpiarBase` sigue andando.
  - **Madre y ciclos:** las ediciones de madre se serializan con un bloqueo por tambo (`pg_advisory_xact_lock`); después `FOR UPDATE` de la nueva madre y luego del animal (mismo orden que la anulación del parto). Ciclos por consulta recursiva, solo en el código.
  - **Aviso 8** (`LOTE_MANUAL_DESCARTADO`): sale de una fila `LOTE` del historial posterior al evento anulado. Con lote previo "sin lote" dice "La vaca quedó sin lote y se descartó…".
  - **Mover a un lote ya eliminado antes de mover:** responde 404 ("Lote no encontrado"), no 409, porque el lote se busca antes de la transacción; el 409 queda solo para el lote que desaparece entre la lectura y el guardado. Es una desviación menor de la tabla RF-17/RF-11 del plan y se acepta tal cual (no se cambió el código).
  - **Editar la fecha de nacimiento no revisa a las crías** (decisión 6 del usuario). El estado no se edita.
  - **`migrate diff` esperado:** sigue dando solo las dos claves foráneas de lote previo de la 004; no aplicar esa propuesta.
  - **Web:** botones "Editar" y "Mover de lote" solo para dueño y encargado; historial "Cambios manuales" con la leyenda para los tres roles; la confirmación se muestra en una caja de la ficha y el aviso 8 en la caja de resultado de Reproducción. En una cría de parto el formulario deja cambiar solo el número.
- **2026-11-11 — Partos, crías y secados (spec 004):**
  - **Lote previo con clave compuesta y `ON DELETE SET NULL ("loteAnteriorId")`:** si se elimina el lote donde estaba la vaca, `loteAnteriorId` queda nulo sin tocar `establecimientoId`; `tuvoLoteAnterior` distingue "no tenía lote" (aviso 6) de "su lote se eliminó" (aviso 7). Al anular se lee el lote con `FOR SHARE` para que nadie lo borre en el medio.
  - **CHECK `animales_baja_sin_lote`:** un animal de baja nunca tiene lote. La migración desasigna las bajas existentes y `DELETE /api/lotes/:id` ya no desasigna bajas. Con esto queda resuelto el riesgo pendiente de "baja sin lote".
  - **`CriaParto`:** una fila por cría (viva con `animalId`, o nacida muerta sin animal). Las crías vivas son animales reales; al anular el parto quedan de baja con `motivoBaja = PARTO_ANULADO`, sin lote, y su número se libera (el índice único es solo entre activos).
  - **La genética de la cría se guarda separada del servicio base:** se resuelve al registrar el parto (servicio entre 240 y 300 días antes, si es único) y no cambia si después se anula ese servicio.
  - **Respuestas con avisos:** registrar y anular partos y secados devuelven `{ evento, avisos }` (lista cerrada, 7 códigos); servicio y tacto siguen devolviendo el evento a secas.
  - **Un parto reinicia el ciclo:** `cicloActual` corta en el último parto no anulado; lo anterior se rotula "del ciclo anterior" (`cicloAnterior`). El secado no cuenta para el estado reproductivo.
  - **`migrate diff` esperado:** da solo las dos claves foráneas de lote previo (`SET NULL (columna)` no lo expresa Prisma). No aplicar esa propuesta: dejaría `ON DELETE SET NULL` completo y rompería `establecimientoId`.
  - **Web:** "Anular" aparece en el último evento no anulado de cualquier tipo; al veterinario solo si es servicio o tacto (la API da 403 con el mensaje "lo tiene que hacer un dueño o encargado"). Los avisos 6 y 7 se muestran en la caja de resultado de la ficha.
  - **Para la spec de "editar animal":** debe respetar la madre de las crías de un parto (no cambiarla ni dejar un animal sin madre si nació de un parto registrado).
- **2026-11-11 — Reproducción (spec 003):**
  - **Eventos en dos capas:** `Evento` (común: animal, tipo, fecha, quién y cuándo, anulación) más un detalle por tipo (`Servicio`, `Tacto`), unidos por clave compuesta (establecimientoId, eventoId, tipo) para que el detalle no cuelgue de un evento de otro tipo o de otro tambo. La 004 suma `Parto` y `Secado` de la misma forma.
  - **Orden total por fecha y `creadoEn`:** a igual fecha manda el momento de registro, y `creadoEn` es único por animal (índice único; `siguienteRegistro` lo asegura creciente). Riesgo para el modo sin conexión (Etapa 6): relojes de distintos dispositivos pueden desordenar eventos del mismo día; habrá que revisarlo ahí.
  - **Bloqueo `SELECT ... FOR UPDATE` sobre el animal** en cada registro y anulación: dos pedidos simultáneos sobre la misma vaca se serializan y las reglas (preñez vigente, solo anular el último) se evalúan sobre datos estables.
  - **La situación reproductiva y la fecha probable se calculan al leer** (funciones puras en `api/src/reproduccion/`), nunca se guardan: al anular un evento se rehace sola. Un evento solo se anula, no se edita ni se borra.
  - **Reloj inyectable** (`api/src/reloj.ts`): los tests fijan la hora de Argentina para probar "fecha futura" y la fecha probable vencida.
  - **CHECK e índices hechos a mano** en la migración `reproduccion_base` (índice único sobre `lower(nombre)` del semen, CHECK de nombre, raza, fecha mínima 2000, anulación completa, tipo constante y fecha probable solo en "preñada"). `migrate diff` debe dar vacío y no proponer `DROP` de esto.
  - **Web:** con una preñez vigente no se ofrece "Registrar servicio" (se explica que primero va un tacto "vacía"); solo se ofrece "Anular" en el último evento no anulado. Los tres roles pueden registrar y anular servicios y tactos; el catálogo lo modifican dueño y encargado.
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
  - La web maneja el 401 en un solo lugar (`web/src/compartido/api.ts`): cualquier 401 fuera de `/auth/yo` y `/auth/login` lleva al login.
  - El menú es una ruta de layout de React Router (`web/src/compartido/Layout.tsx`) que envuelve las páginas con sesión.
- **2026-11-10 — Sistema de agentes:** coordinador como skill `/sdd`, subagentes planificador, implementador y revisor (`.claude/agents/`). Cambios chicos con `/feature`.
- **2026-11-10 — Tests:** Vitest + supertest sobre la base `cowregister_test`. `LIMITE_INTENTOS_LOGIN` permite subir el límite de intentos en los tests.
- **2026-11-10 — Sesiones en la base** (no JWT): se pueden revocar. Cookie httpOnly + SameSite=Lax, 30 días.
- **2026-11-10 — Prisma fijado en 7.10.1:** la etiqueta `latest` de npm apuntaba a una 8.0.0-rc.
- **2026-11-10 — Stack:** React + Vite + TS, Express + TS, PostgreSQL 18 + Prisma.

## Ramas

`main` tiene toda la Etapa 1 (las ramas apiladas `setup/...` → `spec/002-animales-buscador` quedaron contenidas en ella). Desde ahora cada spec sale de `main` en su propia rama y vuelve a `main` al terminar.

## Riesgos pendientes

- **Service worker e instalación (spec 009):** el navegador integrado de las pruebas no puede registrar el service worker real; la instalación y el service worker solo se probaron **a medias** (manifiesto, desvíos y lectura sin red con un servidor de prueba). Hay que probarlos a mano en Chrome: `npm run build -w web && npm run preview -w web` (puerto 4173), DevTools → Application (Manifest, Service Workers, "Offline"). En la tablet real hará falta **HTTPS** (Etapa 7).
- **Reloj y orden de eventos (spec 010):** la 009 solo carga litros sin conexión (que no ordenan nada). Cuando se carguen servicios, tactos, partos o secados sin conexión habrá que resolver el orden por fecha y `creadoEn` con relojes de distintos dispositivos.
- **Sesión local sin conexión:** el perfil guardado no tiene vencimiento propio; sin conexión la tablet entra con él (hasta volver la señal, donde se revalida). Es el riesgo aceptado de la spec 009.
- **Reloj (spec 005):** si el reloj del servidor retrocede, un evento podría quedar con `creadoEn` menor al de un movimiento manual previo y el aviso 8 fallaría. Retomar en la Etapa 6.

## Pendiente de definir con el responsable

- Si los litros se cargan a mano o se importan del equipo de ordeñe.
- Destino final de los terneros.
- Otros informes.

## Refactor: web/src por dominio (2026-11-12, rama `refactor/ordenar-web`)
- `web/src/` queda en carpetas por dominio: `compartido` (api, Campo, Layout, Rutas, Inicio), `sesion`, `animales`, `reproduccion`, `bajas`, `historial`, `produccion`, `informes`, `lotes`; `App.tsx`, `main.tsx` y `estilos.css` en la raíz.
- Los módulos de datos pasaron a `*Datos.ts` (`animalesDatos`, `informesDatos`, `reproduccionDatos`, `produccionDatos`) porque en Windows `reproduccion.ts` y `Reproduccion.tsx` en la misma carpeta chocan por mayúsculas. Las specs viejas citan las rutas anteriores (son históricas).
