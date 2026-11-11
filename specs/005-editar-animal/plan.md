# Plan — 005 Editar animal y mover de lote a mano

Spec: [spec.md](spec.md)

## Resumen
Se agrega una tabla de historial de cambios manuales (`CambioAnimal`, solo se agrega), tres rutas nuevas (editar, mover de lote y leer el historial) y las pantallas en la ficha. Las reglas de edición viven en una función pura que devuelve el primer rechazo según el orden de la spec (fácil de probar sin base). La concurrencia se resuelve con bloqueos de fila (`FOR UPDATE`, como en la 003 y la 004) más un bloqueo por tambo solo para los cambios de madre (ciclos). Sin dependencias nuevas.

## Base de datos
- **Modelo nuevo `CambioAnimal`** (tabla `cambios_animal`), una fila por dato modificado:
  - `id` (UUID), `establecimientoId`, `animalId`, `campo` (enum `CampoCambio`: `NUMERO`, `SEXO`, `FECHA_NACIMIENTO`, `MADRE`, `LOTE`, en ese orden: es el orden fijo de RF-15), `valorAnterior` y `valorNuevo` (texto copiado, nulos = "sin dato" o "sin lote"), `usuarioId` (UUID **sin** clave foránea), `usuarioNombre` (copia), `creadoEn`.
  - Clave foránea compuesta `(establecimientoId, animalId)` → `Animal` con `ON DELETE RESTRICT` (el historial es del tambo de su animal). Sin claves a `Lote`, a la madre ni a `Usuario` (decisión 7 de la spec).
  - Índice `(animalId, creadoEn)` para leer el historial.
  - Todos los registros de un mismo guardado comparten el mismo `creadoEn`.
- **Migración `editar_animal`** (carpeta creada a mano, `20261111200000_editar_animal`, aplicada con `prisma migrate deploy`; `migrate dev` falla en modo no interactivo, ver MEMORY.md). SQL a mano con comentario:
  - Trigger `BEFORE UPDATE OR DELETE` en `cambios_animal` que lanza excepción: el historial no se modifica ni se borra (constitución §3 y §6).
  - CHECK `cambios_valores_distintos`: `valorAnterior IS DISTINCT FROM valorNuevo` (no se registra un cambio que no cambió nada).
  - CHECK `cambios_usuario_nombre`: `usuarioNombre` no vacío.
- **Antes de migrar:** correr en `api/` `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` y comprobar que da solo las dos claves foráneas de lote previo ya conocidas (MEMORY.md, spec 004) y ningún `DROP` de lo hecho a mano. Después de migrar tiene que dar **exactamente lo mismo** (nada de la tabla nueva). No aplicar la propuesta de esas dos claves.
- **Ya existe en la base** (RF "garantías"): número único entre activos y CHECK de formato; un animal no es su propia madre; madre y lote del mismo tambo; baja sin lote; una cría de parto no cambia de madre (la clave `crias_parto` exige la madre del parto).
- **Solo en el código** (con el motivo de la spec): ciclos de madres, madre hembra y de fecha anterior, sexo con eventos o crías, combinación sexo-estado, campos no editables.
- `tests/ayudas.ts`: `cambios_animal` en el `TRUNCATE` de `limpiarBase`; `verificarInvariantes` suma (b) ciclos de madres y (c) madre que no es hembra.

## API
Todas controlan sesión y rol **antes** de los parsers de JSON (se suman en `app.ts`, igual que partos), así el veterinario recibe 403 y un pedido sin sesión 401 aunque el JSON venga roto.

| Método y ruta | Rol | Qué hace | RF |
|---|---|---|---|
| `PATCH /api/animales/:id` | Dueño, encargado | Edita número, sexo, fecha de nacimiento y madre (tabla omitido / valor / `null`); guarda y escribe el historial en una transacción; devuelve la ficha | RF-1 a RF-8, RF-14, RF-16, RF-17, RF-18 |
| `PATCH /api/animales/:id/lote` | Dueño, encargado | Cuerpo `{ loteId: uuid \| null }`; mueve de lote o deja sin lote, sin tocar el estado; escribe el historial | RF-9 a RF-12, RF-14, RF-17, RF-18 |
| `GET /api/animales/:id/cambios` | Los tres | Últimos 100 cambios (más nuevo primero, orden fijo de campo) y el total | RF-15, RF-18 |
| `POST /api/partos/:id/anular` y `POST /api/secados/:id/anular` (existentes) | Dueño, encargado | Suman el aviso 8 cuando corresponde | RF-13 |

Detalle de la edición (`reproduccion/bloqueo.ts` se reutiliza; la edición va en un archivo nuevo):
1. Formato (400): lista de claves del cuerpo; `establecimientoId` se ignora; `estado`, `loteId`, `lote`, `id` y cualquier otra dan su mensaje; `numero`/`sexo` en `null` y valores mal formados dan 400.
2. Búsqueda sin bloqueo (404): animal activo del tambo; si viene madre, se busca por número.
3. Transacción: si el pedido trae madre, `pg_advisory_xact_lock` del tambo (serializa las ediciones de madre); después `SELECT ... FOR UPDATE` de la **nueva madre y luego el animal**; se relee todo con los bloqueos tomados.
4. Reglas (función pura `animales/edicion.ts`): "sin cambios" 400 → reglas de datos 400 (sexo-estado, fecha, madre; ciclo por CTE recursiva que sube por `madreId` desde la nueva madre) → conflictos 409 (cría de parto, sexo con eventos no anulados o crías de cualquier estado, número repetido). Dentro de cada grupo: número, sexo, fecha, madre.
5. Escritura: `update` del animal (P2002 del índice de número → 409) y una fila de historial por dato cambiado, con `creadoEn = siguienteRegistro(...)`.

Detalle de mover: se busca el lote sin bloqueo (404 si no existe, es ajeno o está mal formado); en la transacción se bloquea el animal y se toma el lote con `FOR SHARE`; si ya no está, 409 "El lote destino ya no existe, volvé a intentar". Mismo lote o ya sin lote: 400.

Detalle del aviso 8 (`reproduccion/anular.ts` + `avisos.ts`): al volver atrás, si existe una fila `LOTE` del animal con `creadoEn` posterior al del evento anulado y el lote actual del animal es distinto del que va a recibir, se agrega el aviso (código nuevo `LOTE_MANUAL_DESCARTADO`) al final de la lista, después de los 6 y 7.

## Interfaz
En la ficha (`AnimalFicha.tsx`), para dueño y encargado, botones "Editar" y "Mover de lote" que abren un panel dentro de la ficha (mismo patrón que los formularios de parto y secado). Veterinario: no los ve.
- **Editar** (`FormEditarAnimal.tsx`): número, sexo, fecha de nacimiento y madre (por número) con los datos actuales; no ofrece el estado; en una cría de parto muestra sexo, fecha y madre como texto con el motivo ("vienen del parto"). Solo se envían los campos que cambiaron; vaciar la fecha o la madre manda `null`. Errores en español junto al campo.
- **Mover de lote** (`FormMoverLote.tsx`): lista de lotes del tambo (`GET /api/lotes`) más "Sin lote".
- **Historial** (`HistorialCambios.tsx`): lista para los tres roles con la leyenda de RF-15 y el total si hay más de 100.
- Al guardar con éxito se recarga la ficha y se muestra un mensaje de confirmación en la caja de resultado; el aviso 8 aparece en la caja de avisos existente de `Reproduccion.tsx` (ya muestra la lista de avisos de la respuesta, sin cambios de lógica).
- Tablet: campos y botones de 48 px, paneles de una columna, sin desbordes a 768 px y 375 px, modo claro y oscuro (variables de `estilos.css`).
- La ficha de la API suma el `id` del lote (`lote: { id, nombre }`) para preseleccionarlo.

## Archivos
- Crear:
  - `api/prisma/migrations/20261111200000_editar_animal/migration.sql`
  - `api/src/animales/edicion.ts` (reglas puras y orden de rechazos)
  - `api/src/rutas/animales-edicion.ts` (los tres endpoints; se monta en `app.ts` antes de `rutasAnimales`)
  - `api/tests/base-cambios.test.ts`, `edicion-puro.test.ts`, `animales-editar.test.ts`, `animales-mover.test.ts`, `edicion-concurrencia.test.ts`
  - `web/src/componentes/FormEditarAnimal.tsx`, `FormMoverLote.tsx`, `HistorialCambios.tsx`
- Modificar:
  - `api/prisma/schema.prisma` (modelo y enum nuevos)
  - `api/src/app.ts` (sesión y rol antes de los parsers; montar rutas)
  - `api/src/reproduccion/anular.ts` y `avisos.ts` (aviso 8)
  - `api/src/rutas/animales.ts` (ficha con `lote.id`)
  - `api/tests/ayudas.ts` (limpiarBase, invariantes nuevas, helper `crearCambioDirecto`), `api/tests/anulaciones-partos.test.ts` y `animales.test.ts`
  - `web/src/api.ts`, `web/src/paginas/AnimalFicha.tsx`, `web/src/estilos.css`
  - Cierre: `MEMORY.md`, `docs/plan.md`

## Decisiones
- **Tabla propia `CambioAnimal` con una fila por dato** — elegida porque el historial es de datos, no de reproducción, y necesita copiar texto sin bloquear nada. Alternativa descartada: guardarlo como `Evento`, porque los eventos tienen orden total, anulación y reglas de ciclo que no aplican, y ensuciaría la situación reproductiva.
- **Texto copiado, sin claves a lote, madre ni usuario** — elegida (decisión 7) para que un lote del historial se pueda eliminar y el historial se lea siempre. Alternativa descartada: claves foráneas con `SET NULL`, porque se perdería qué lote era y complicaría el borrado de lotes.
- **Historial inmodificable con un trigger en la base** — elegido porque la constitución §3 y §6 piden garantizarlo también en la base. Alternativa descartada: solo en el código, porque cualquier consulta directa podría reescribirlo.
- **Bloqueos: advisory lock por tambo solo en cambios de madre, y `FOR UPDATE` de la nueva madre y luego del animal** — elegido porque detecta ciclos de cualquier largo con pocas filas bloqueadas y respeta el orden "madre antes que cría" que ya usa la anulación del parto (sin interbloqueos con ella). Alternativas descartadas: bloquear toda la cadena de ascendientes (más consultas y riesgo de interbloqueo) y transacciones `SERIALIZABLE` (reintentos y errores 40001 para el usuario).
- **Ciclos solo en el código (CTE recursiva)** — elegido porque una restricción de base no expresa ciclos indirectos; se protege con el bloqueo. Alternativa descartada: trigger de ciclos en la base, por complejidad desproporcionada para esta spec.
- **Dos rutas separadas (editar y mover)** — elegido porque la edición rechaza `loteId` con 400 (RF-2), el movimiento tiene su propio orden de errores (404/409 del lote) y su propio aviso. Alternativa descartada: un solo `PATCH` con `loteId`, porque mezcla reglas y contradice RF-2.
- **Reglas en una función pura que devuelve el primer rechazo** — elegida para probar el orden de RF-16 y los cruces sin base. Alternativa descartada: `refine` de zod, porque mezcla 400 y 409 y necesita datos de la base.
- **El aviso 8 sale de la fila `LOTE` del historial posterior al evento** — elegida para no agregar columnas a `Animal`. Para que "posterior" sea confiable, el `creadoEn` del guardado usa `siguienteRegistro` (nunca menor al del último evento). Alternativa descartada: una marca "lote manual" en el animal, porque duplica información del historial.
- **Historial en un endpoint aparte (`/cambios`)** — elegido para que la ficha no crezca. Alternativa descartada: incluirlo en `GET /:id`, porque se carga siempre aunque no se mire.
- **Tope de 100 cambios con total, sin paginación** — elegido por simplicidad (RF-15). Alternativa descartada: paginar, innecesario para este volumen.

## Estrategia de tests
Tests primero, Vitest + supertest sobre `cowregister_test`.

| RF | Test (archivo › caso) |
|---|---|
| RF-1, RF-2 | `animales-editar.test.ts` › omitido/valor/`null` de cada campo; `estado`, `loteId`, `id`, campo desconocido, `numero: null`, `sexo: null`, `{}`, sin cambios reales → 400; `establecimientoId` ignorado |
| RF-3 | `animales-editar.test.ts` › número normalizado, vacío, 21 caracteres, caracteres inválidos, repetido 409, de una baja o de otro tambo permitido; el número viejo ya no se encuentra en `/buscar`; `edicion-concurrencia.test.ts` › mismo número en dos ediciones y en edición × alta/parto |
| RF-4 | `edicion-puro.test.ts` y `animales-editar.test.ts` › sexo con servicio no anulado 409, solo anulados permitido, cría de baja cuenta, macho no recién nacido 400 |
| RF-5 | `edicion-puro.test.ts` › hoy, mañana, 31/12/1999, madre igual o posterior, vaciar, posterior a evento o cría permitido |
| RF-6 | `edicion-puro.test.ts` y `animales-editar.test.ts` › mensaje genérico (inexistente, otro tambo, baja), propios (macho, uno mismo, ciclo directo e indirecto, fecha), quitar madre |
| RF-7 | `animales-editar.test.ts` › cría de parto: número sí; sexo, fecha o madre (aun `null`) 409 |
| RF-8 | `animales-editar.test.ts` › error en el medio (número repetido con otros campos válidos) no guarda ni campos ni historial |
| RF-9, RF-10 | `animales-mover.test.ts` › a un lote, a "sin lote", estado intacto, mismo lote 400, ya sin lote 400, cuerpo sin lote 400 |
| RF-11 | `animales-mover.test.ts` › 404 idéntico (ajeno, inexistente, mal formado). **Carrera:** (a) test con cliente simulado que hace desaparecer el lote entre la lectura y el `FOR SHARE` → 409 y nada guardado (mismo estilo que `resolverLotesDestino` con `tx` simulado de la 004); (b) `edicion-concurrencia.test.ts` › `Promise.all` de mover y `DELETE /api/lotes/:id` repetido varias veces: solo "mover 200 y eliminar 409" o "eliminar 200 y mover 409", sin animal con lote inexistente |
| RF-12 | `animales-mover.test.ts` › lote manual se mantiene; un secado posterior lo guarda como lote previo y mueve al destino |
| RF-13 | `anulaciones-partos.test.ts` › aviso 8 con movimiento manual posterior, sin aviso si fue anterior o igual al previo, junto con aviso 6 y 7 (orden: 6/7 y luego 8) |
| RF-14 | `animales-editar.test.ts` y `animales-mover.test.ts` › una fila por dato cambiado con antes, después, nombre e id, misma operación; sin filas en ediciones rechazadas; `base-cambios.test.ts` › trigger impide UPDATE y DELETE, CHECK de valores distintos, el historial pertenece al tambo de su animal, no hay claves a lote ni usuario (se puede eliminar un lote del historial) |
| RF-15 | `edicion-puro.test.ts` y `animales-editar.test.ts` › más nuevo primero, orden fijo de campo dentro de un guardado, tope 100 con total, textos copiados tras eliminar lote o dar de baja la madre |
| RF-16 | `edicion-puro.test.ts` › cada cruce de los casos límite (sexo con eventos × fecha inválida, cría de parto × número repetido, número repetido × sexo con eventos, madre inexistente × número repetido); `animales-editar.test.ts` › 401 → 403 → 400 → 404 |
| RF-17 | `edicion-concurrencia.test.ts` › cada fila de la tabla (A↔B, ciclo de tres, madre que pasa a macho, madre que cambia de fecha, número, sexo × evento, mover × eliminar lote, editar o mover × anular parto, mover × parto o secado) con `verificarInvariantes` y las invariantes nuevas (ciclos, madre hembra) |
| RF-18 | Cada ruta › animal de otro tambo, inexistente, de baja y mal formado dan 404 idéntico; lote de otro tambo; `establecimientoId` ignorado; el historial de otro tambo no se ve |
| RF-19 | Cada ruta › veterinario 403 también con datos inválidos, JSON roto y animal ajeno; sin sesión 401; el veterinario sí lee `/cambios`; ninguna respuesta con hashes ni email |
| RF-20, RF-21 | Navegador (no automatizado), solo en la tarea de web: dueño y veterinario, 768 px y 375 px, claro y oscuro, controles de 48 px, sin scroll horizontal |

Garantías en la base (`base-cambios.test.ts` y los tests de base existentes): se agrega al menos un caso directo contra la base por cada garantía "también en la base" de la spec que no tenga test (propia madre y tambo de madre y lote ya los tienen; se confirma que siguen pasando).

## Riesgos
- **Reloj:** si el reloj del servidor retrocede, un evento podría quedar con `creadoEn` menor al de un movimiento manual anterior; el aviso 8 usa `creadoEn` y `siguienteRegistro` solo protege el caso del movimiento después del evento. Es un riesgo que se retoma en la Etapa 6 (sin conexión).
- **Fecha sin revisar a las crías:** aceptado por el usuario (decisión 6): editar la fecha de una madre no revisa a sus crías.
- **Interbloqueos:** el orden de bloqueo (tambo, nueva madre, animal; en mover: animal y después lote con `FOR SHARE`) coincide con el de las operaciones existentes; los tests de concurrencia lo comprueban repitiendo cada fila varias veces.
- **`migrate diff`:** da las dos diferencias conocidas de la 004 antes y después; si aparece algo más o un `DROP`, no aplicar.
- **Trigger y pruebas:** `TRUNCATE` no dispara el trigger de fila, así que `limpiarBase` sigue funcionando; ningún test borra filas del historial con `DELETE`.

## Tabla RF → parte del plan
| RF | Parte del plan |
|---|---|
| RF-1 a RF-8 | `PATCH /api/animales/:id`, `animales/edicion.ts`, `FormEditarAnimal.tsx` |
| RF-9 a RF-12 | `PATCH /api/animales/:id/lote`, `FormMoverLote.tsx` |
| RF-13 | `reproduccion/anular.ts` y `avisos.ts` |
| RF-14 | Modelo `CambioAnimal`, migración (trigger y CHECK) y escritura en las dos rutas |
| RF-15 | `GET /api/animales/:id/cambios`, `HistorialCambios.tsx` |
| RF-16 | `animales/edicion.ts` (orden de rechazos) |
| RF-17 | Bloqueos de las rutas y `edicion-concurrencia.test.ts` |
| RF-18, RF-19 | `app.ts` (sesión y rol antes de los parsers) y filtros por `establecimientoId` de la sesión |
| RF-20, RF-21 | Interfaz (`AnimalFicha.tsx`, formularios, estilos) y verificación en el navegador |
