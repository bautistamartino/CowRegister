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
  - **Siguiente:** Etapa 3 de [docs/plan.md](docs/plan.md) (reglas y bajas por venta o muerte).
- Hay una API de gestión de usuarios (`/api/usuarios`) **sin pantalla** todavía.

## Decisiones

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

- **Menú del encabezado en celular:** `.menu-acciones` del Layout desborda a 375 px (el ancho de la página supera el de la pantalla). Viene de antes de la spec 004; arreglarlo en una pasada chica de estilos.

- **Alta con madre sin bloqueo (spec 002):** `POST /api/animales` con madre no bloquea a la madre. Una carrera con "madre pasa a macho" (spec 005) podría dejar una madre macho con crías. Bloquear a la madre en el alta.
- **Reloj (spec 005):** si el reloj del servidor retrocede, un evento podría quedar con `creadoEn` menor al de un movimiento manual previo y el aviso 8 fallaría. Retomar en la Etapa 6.

## Pendiente de definir con el responsable

- Si los litros se cargan a mano o se importan del equipo de ordeñe.
- Destino final de los terneros.
- Otros informes.
