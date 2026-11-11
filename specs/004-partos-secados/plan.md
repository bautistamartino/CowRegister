# Plan — 004 Partos, crías y secados

Spec: [spec.md](spec.md)

## Resumen
Se suman dos valores al tipo de evento (`PARTO`, `SECADO`) y tres tablas de detalle: `partos`, `secados` y `crias_parto` (las crías de cada parto, vivas o nacidas muertas, y el vínculo con el animal dado de alta). Cada parto y secado guarda el estado y el lote previos de la vaca. El lote previo se guarda con una clave foránea compuesta escrita a mano que, al eliminarse el lote, anula **solo** la columna del lote (`ON DELETE SET NULL (columna)`, PostgreSQL 15 o superior). Además se agrega a `animales` el motivo de baja y la regla "un animal de baja no tiene lote".
La API suma el registro de parto y de secado (con el mismo bloqueo `FOR UPDATE` por animal de la 003), la anulación de ambos y los datos de partos y crías en la lista de eventos y en la ficha de la cría. Las funciones puras de `situacion.ts` cambian en un solo lugar (el parto reinicia el ciclo, el secado no cuenta para el estado reproductivo) y se suma `genetica.ts` (separada del servicio base). La web extiende la ficha con los formularios, los avisos y la anulación.

## Base de datos

### Migraciones (a mano, dos archivos)
1. `api/prisma/migrations/<fecha>_partos_tipos_evento/migration.sql`: solo `ALTER TYPE "TipoEvento" ADD VALUE 'PARTO'` y `'SECADO'`. Va sola porque un valor nuevo del enum no se puede usar en la misma transacción en que se agrega (así lo anticipó la 003).
2. `api/prisma/migrations/<fecha>_partos_secados/migration.sql`: el SQL de `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (en `api/`) más el bloque manual de abajo. Se aplica con `npx prisma migrate deploy` (`migrate dev` falla sin terminal interactiva; ver MEMORY.md).

### Modelos (`schema.prisma`)
- **Enums:** `TipoEvento` suma `PARTO` y `SECADO`; `MotivoBaja { PARTO_ANULADO }` (lista cerrada; la Etapa 3 agrega venta y muerte con `ADD VALUE`).
- **`Animal`:** `motivoBaja MotivoBaja?`; `@@unique([establecimientoId, id, madreId])` (destino de la clave que ata la cría a su madre); relación inversa `criaDeParto CriaParto?`.
- **`Evento`:** `@@unique([establecimientoId, id, tipo, animalId])` (destino de las claves del parto, que exigen tipo y animal) y relaciones inversas `parto`, `secado`.
- **`Parto`** (`partos`): `eventoId` (`@id`), `establecimientoId`, `tipo` (siempre `PARTO`), `madreId` (siempre igual al animal del evento), `estadoAnterior` (`EstadoAnimal`), `tuvoLoteAnterior` (`Boolean`), `loteAnteriorId?`, `servicioId?` y `servicioTipo?` (genética: el servicio vinculado, o ambos nulos). Relaciones: con `Evento` por `[establecimientoId, eventoId, tipo, madreId]` → `[establecimientoId, id, tipo, animalId]` (cubre mismo tambo, tipo correcto y misma vaca); con el servicio por `[establecimientoId, servicioId, servicioTipo, madreId]` → `Evento [establecimientoId, id, tipo, animalId]` (el servicio es un evento de tipo `SERVICIO` de la misma vaca y el mismo tambo). Todas `Restrict`. `crias CriaParto[]`.
- **`Secado`** (`secados`): `eventoId` (`@id`), `establecimientoId`, `tipo` (siempre `SECADO`), `estadoAnterior`, `tuvoLoteAnterior`, `loteAnteriorId?`. Misma clave a `Evento` que `Servicio` y `Tacto` (`[establecimientoId, eventoId, tipo]`).
- **`CriaParto`** (`crias_parto`): `id` (`uuid(7)`), `establecimientoId`, `eventoId` (el parto), `madreId`, `orden` (1 o 2), `sexo`, `nacidaMuerta`, `observaciones?`, `animalId?` (la cría dada de alta; nulo si nació muerta), `creadoEn`. Claves: `[establecimientoId, eventoId, madreId]` → `Parto [establecimientoId, eventoId, madreId]` (la cría es del tambo y de la madre del parto) y `[establecimientoId, animalId, madreId]` → `Animal [establecimientoId, id, madreId]` (el animal existe, es del mismo tambo y su madre es la del parto). `@@unique([eventoId, orden])`, `@@unique([animalId])` (una cría viva pertenece a **un solo** parto). Por eso `Parto` lleva `@@unique([establecimientoId, eventoId, madreId])`.
- **Lote previo:** `loteAnteriorId` en `Parto` y `Secado` es una columna simple **sin `@relation` en Prisma** (Prisma no sabe `SET NULL (columna)` y rechaza `SetNull` si la clave compuesta tiene una columna obligatoria). La clave foránea se escribe a mano (ver abajo). El cliente de Prisma no la "ve": el nombre del lote previo se lee con una consulta aparte.

Si Prisma 7.10.1 rechaza alguna clave compuesta de arriba (en particular las que apuntan a `Evento` con `tipo` y `animalId`, o a `Animal` con `madreId`), se deja la relación con los campos que acepte y la clave se escribe a mano en el SQL (plan B ya usado en las specs 002 y 003), documentado en el SQL y en MEMORY.md. Es el primer riesgo a verificar en T1.

### SQL a mano (al final de `partos_secados`, con un comentario en cada objeto)
- **Motivo de baja y baja sin lote (RF-34), en este orden:**
  1. `UPDATE "animales" SET "loteId" = NULL WHERE "estado" = 'BAJA' AND "loteId" IS NOT NULL;` (se desasignan los animales de baja que ya existieran; hoy no hay).
  2. `ALTER TABLE "animales" ADD CONSTRAINT "animales_baja_sin_lote" CHECK ("estado" <> 'BAJA' OR "loteId" IS NULL);`
  3. `ALTER TABLE "animales" ADD CONSTRAINT "animales_motivo_baja_coherente" CHECK ("motivoBaja" IS NULL OR "estado" = 'BAJA');` (el motivo solo existe en una baja; no se exige en las bajas viejas).
- **Lote previo (RF-36 y RF-37):** en `partos` y `secados`, `ALTER TABLE … ADD CONSTRAINT "…_loteAnterior_fkey" FOREIGN KEY ("establecimientoId", "loteAnteriorId") REFERENCES "lotes" ("establecimientoId", "id") ON DELETE SET NULL ("loteAnteriorId")`. Con `loteAnteriorId` nulo no se controla (MATCH SIMPLE) y, al eliminar el lote, solo esa columna pasa a nulo: nunca se toca `establecimientoId`, que es obligatoria. PostgreSQL 18 soporta la lista de columnas. `tuvoLoteAnterior` distingue "sin lote previo" (`false`) de "lote previo eliminado" (`true` con `loteAnteriorId` nulo).
- `partos`: CHECK `partos_tipo` (`"tipo" = 'PARTO'`); CHECK `partos_estado_anterior` (`"estadoAnterior" IN ('VAQUILLONA','EN_ORDENE','SECA')`); CHECK `partos_lote_anterior_coherente` (`"loteAnteriorId" IS NULL OR "tuvoLoteAnterior"`); CHECK `partos_servicio_coherente` (`("servicioId" IS NULL) = ("servicioTipo" IS NULL) AND ("servicioTipo" IS NULL OR "servicioTipo" = 'SERVICIO')`).
- `secados`: CHECK `secados_tipo` (`"tipo" = 'SECADO'`); CHECK `secados_estado_anterior` (`"estadoAnterior" = 'EN_ORDENE'`); CHECK `secados_lote_anterior_coherente`.
- `crias_parto`: CHECK `crias_orden` (`"orden" IN (1, 2)`); CHECK `crias_viva_o_muerta` (`("nacidaMuerta" AND "animalId" IS NULL) OR (NOT "nacidaMuerta" AND "animalId" IS NOT NULL)`); CHECK `crias_observaciones_largo` (`"observaciones" IS NULL OR char_length("observaciones") BETWEEN 1 AND 200`, así "sin observaciones" siempre es `NULL`).
- Sin bloque `DO $$` de verificación: el `UPDATE` previo ya contempla los registros existentes y las demás tablas son nuevas.
- **Control con `migrate diff`:** antes de empezar da vacío; después de aplicar tiene que dar vacío **salvo dos sentencias esperadas** (`DROP`/`ALTER` de las claves `partos_loteAnterior_fkey` y `secados_loteAnterior_fkey`, que Prisma no modela). Cualquier otra sentencia, o un `DROP` de lo hecho a mano de las specs 001 a 003 (`animales_numero_activo_unico`, `animales_baja_con_fecha`, `animales_numero_normalizado`, `animales_madre_distinta`, `lotes_nombre_unico_sin_mayusculas`, `reglas_lote_sin_baja`, los de `semen_toros`, `eventos`, `servicios` y `tactos`), frena la aplicación. Si el diff propusiera además "arreglar" el `ON DELETE`, no se aplica.

### Qué garantiza cada cosa
| Garantía de la spec | Mecanismo |
|---|---|
| Animal de baja sin lote (RF-34) | CHECK `animales_baja_sin_lote`, con el `UPDATE` previo para los existentes |
| Número único entre activos, también con partos simultáneos (RF-35) | Índice parcial ya existente (`animales_numero_activo_unico`); la baja de la cría lo libera; P2002 → 409 |
| Evento de la vaca de su tambo, detalle del tipo correcto | Claves compuestas de la 003 y las de `Parto` y `Secado` |
| Parto de la misma vaca que su evento (`madreId`) | Clave `(establecimientoId, eventoId, tipo, madreId)` → `eventos (…, animalId)` |
| Servicio de genética de la misma vaca, del mismo tambo y de tipo servicio (RF-36.2) | Clave `(establecimientoId, servicioId, servicioTipo, madreId)` → `eventos` + CHECK de `servicioTipo` |
| Cría con madre del tambo (RF-36.3) | Clave de la 002 `animales (madreId)` |
| Cría viva en el parto de su madre y de su tambo (RF-36.4) | Las dos claves de `crias_parto` y `UNIQUE (animalId)` |
| Lote previo del mismo tambo (RF-36.5) y lote eliminable (RF-37) | FK compuesta `ON DELETE SET NULL (loteAnteriorId)` |
| Viva sin número en el parto y muerta sin animal | CHECK `crias_viva_o_muerta` |

## API
Todas las rutas usan `requiereSesion` (401). Las que registran o anulan partos y secados usan `requiereRol('DUENO','ENCARGADO')` (403) **antes** de los parsers de JSON (en `app.ts`, igual que el catálogo de la 003). Orden de controles: sesión (401) → rol (403) → formato del cuerpo con zod (400) → id y búsqueda (404) → referencias y fechas (400) → conflictos (409).

| Método y ruta | Rol | Qué hace | RF |
|---|---|---|---|
| POST `/api/animales/:id/partos` | Dueño, encargado | `{ fecha, crias: [{ sexo, nacidaMuerta?, numero?, observaciones? }] }`. 201 con `{ evento, avisos }` | RF-1 a RF-17, RF-21, RF-31, RF-41, RF-42 |
| POST `/api/animales/:id/secados` | Dueño, encargado | `{ fecha }`. 201 con `{ evento, avisos }` | RF-18 a RF-21, RF-31, RF-41, RF-42 |
| POST `/api/partos/:id/anular` | Dueño, encargado | `{ motivo }`. 200 con `{ evento, avisos }` | RF-23 a RF-30, RF-32, RF-41, RF-42 |
| POST `/api/secados/:id/anular` | Dueño, encargado | `{ motivo }`. 200 con `{ evento, avisos }` | RF-22, RF-25 a RF-30, RF-32, RF-41, RF-42 |
| GET `/api/animales/:id/eventos` (ya existe) | Todos | Suma partos y secados a `eventos` y las marcas "ciclo anterior" a la situación | RF-38, RF-40 |
| GET `/api/animales/:id` (ya existe) | Todos | Suma `parto` (de qué parto nació) a la ficha de la cría | RF-39 |
| `DELETE /api/lotes/:id` (ya existe) | Dueño, encargado | Deja de desasignar bajas (ver Decisiones); sigue igual en lo demás | RF-37 |

Las rutas de anulación de servicios y tactos (003) pasan a recibir el rol de la sesión para el mensaje del veterinario (RF-26), pero siguen siendo para los tres roles. Su respuesta no cambia (devuelve el evento a secas); las de parto y secado devuelven `{ evento, avisos }` porque pueden traer avisos.

### Cuerpo del parto
- `fecha`: `fechaEventoSchema` de la 003.
- `crias`: lista de 1 o 2 (si no es lista, o tiene 0 o más de 2: 400). Cada cría es un `z.object` (descarta campos no previstos): `sexo` obligatorio (`HEMBRA` o `MACHO`, 400 si no); `nacidaMuerta` opcional, `z.boolean()` con valor por defecto `false` (un texto u otro tipo es 400, no se convierte); `numero` con `numeroSchema` de la spec 002 (normaliza a mayúsculas); `observaciones` recortada, hasta 200 caracteres (vacía → `null`).
- `superRefine` sobre cada cría: si `nacidaMuerta` y trae `numero` → 400; si no `nacidaMuerta` y no trae `numero` → 400. Entre las dos crías vivas, el mismo número ya normalizado → 400 (RF-7).

### Orden exacto de controles en el parto
1. Sesión, rol, cuerpo con zod (todo lo anterior). 2. `:id` mal formado → 404.
3. **Dentro de la transacción:** `bloquearAnimal` (404 si no hay animal activo del tambo). 4. Fecha: `validarFechaEvento` de la 003 (400) y, además, estrictamente posterior al nacimiento de la madre (400).
5. Conflictos 409, **en este orden** y se informa el primero: (1) madre no apta (`puedeParir`: macho o recién nacida); (2) menos de 200 días de otro parto no anulado (mensaje con la fecha del existente y la sugerencia del tacto "vacía"); (3) número de cría existente entre activos (se revisan todos con una consulta y se informa el de la primera cría, por `orden`); (4) lote destino que ya no existe (ver "Lote destino").
6. Se calcula la genética y se insertan, en la misma transacción: el `Evento` (con `siguienteRegistro`) y el `Parto` con el estado y lote previos de la madre; las crías vivas como `Animal` (`id` generado en la API, `RECIEN_NACIDO`, `fechaNacimiento` = fecha del parto, `madreId`, lote destino de "recién nacido") y todas las crías en `crias_parto`; y el `update` de la madre (`EN_ORDENE` y lote destino de "en ordeñe", aunque ya lo estuviera).
7. Un P2002 al crear una cría (otro usuario ocupó el número entre la consulta y la inserción) → 409 con el mismo mensaje del paso 5.(3). Cualquier error aborta todo (todo o nada).

### Lote destino (parto, secado y anulación)
Función `resolverLotesDestino(tx, establecimientoId, estados)` en `reproduccion/destinos.ts`: lee las reglas de los estados pedidos y, para cada una con lote, toma `SELECT … FROM lotes WHERE id = … FOR SHARE`. Si la fila no está (la regla se quitó y el lote se eliminó entre la lectura y este paso) → 409 "El lote destino ya no existe, volvé a intentar" (RF-14). Con `FOR SHARE` tomado, quien intente eliminar ese lote espera a que termine el registro y después falla por la clave de `animales` (la ruta de lotes ya responde 409 en ese caso). Si el estado no tiene regla → `null` y el aviso que corresponde. Los estados se piden en orden fijo para evitar interbloqueos. Un P2003 inesperado al escribir se traduce al mismo 409 (defensa).

### Orden exacto de controles en el secado
Igual que el parto, sin crías: fecha de la 003 (400); 409: no es hembra en ordeñe (`puedeSecarse`, con el estado actual en el mensaje); lote destino de "seca". Sin ningún otro control (secado libre).

### Anulación (extiende `reproduccion/anular.ts`)
1. Sesión, rol (middleware), `{ motivo }` con zod (400), id mal formado → 404.
2. En la transacción: búsqueda sin bloqueo por `id`, tambo, **tipo de la ruta** y animal activo (404); `bloquearAnimal`; se **relee** todo con el bloqueo.
3. Rechazos 409 en el orden de la spec: (1) ya anulado; (2) no es el último no anulado (mensaje "Primero tenés que anular el {tipo} del {dd/mm/aaaa}"; si quien intenta es **veterinario** y el que hay que anular es un parto o un secado: "Primero hay que anular el {parto|secado} del {dd/mm/aaaa}; lo tiene que hacer un dueño o encargado"); (3) el estado actual de la vaca no es el que dejó el evento (`EN_ORDENE` tras un parto, `SECA` tras un secado); (4) solo en el parto: alguna cría viva con eventos propios no anulados, no activa o madre de animales activos (una consulta sobre todas las crías, con los animales bloqueados `FOR UPDATE` en orden de `id`).
4. **Secado:** se pide el lote previo con `FOR SHARE`; si `tuvoLoteAnterior` y la fila ya no existe → aviso 7; si no tenía lote → aviso 6. Se actualiza la vaca (`estadoAnterior`, lote previo o `null`) y se completa la anulación del evento con `updateMany … anuladoEn: null`.
5. **Parto:** igual para la madre; cada cría viva pasa a `BAJA` con `fechaBaja = hoyArgentina(ahora())`, `motivoBaja = PARTO_ANULADO` y `loteId = null` (el número queda libre por el índice parcial); las crías nacidas muertas no se tocan; se completa la anulación.
6. Se devuelve el evento armado y los avisos. La situación se recalcula sola al leer (derivadas no guardadas).

### Qué devuelve la lista de eventos (agregados)
- Parto: `parto: { estadoAnterior, loteAnterior: "SIN_LOTE" | "ELIMINADO" | { id, nombre }, genetica: { fechaServicio, semen: { id, nombre } | null } | null, crias: [{ orden, sexo, nacidaMuerta, observaciones, animal: { id, numero, activo } | null }] }`. `activo = false` es la cría dada de baja (se muestra con "dada de baja" y sin acceso a la ficha). Secado: `secado: { estadoAnterior, loteAnterior }`.
- Situación: `ultimoServicio` y `ultimoTacto` suman `cicloAnterior: boolean` (anteriores, en el orden total, al último parto no anulado).
- Ficha de la cría (`GET /api/animales/:id`): `parto: { eventoId, fecha, genetica } | null`. La madre ve sus partos en la lista de eventos.
- Lecturas con `select` explícito y solo el nombre del usuario, como en la 003.

### Avisos (lista cerrada)
Módulo `reproduccion/avisos.ts` con los 7 textos de la spec y sus códigos (`SIN_LOTE_MADRE_EN_ORDENE`, `SIN_LOTE_MADRE_SECA`, `SIN_LOTE_CRIA`, `SIN_GENETICA_SIN_SERVICIO`, `SIN_GENETICA_FUERA_DE_RANGO`, `SIN_LOTE_PREVIO`, `LOTE_PREVIO_ELIMINADO`). Cada aviso es `{ codigo, mensaje }` y se arman en el orden fijo de la spec. No se guardan: solo viajan en la respuesta de la operación (la web los muestra una vez).

## Lógica pura (sin base ni Express)
- **`situacion.ts` (cambia solo esto):**
  - `EventoCalculo.tipo` pasa a `'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO'`.
  - `ultimoNoAnulado`: sin cambios (ya vale para los cuatro tipos; lo usan las fechas y la anulación).
  - `cicloActual`: el ciclo empieza después del último tacto "vacía" **o** del último parto, el que sea posterior; el secado no lo corta.
  - `calcularSituacion`: el estado reproductivo se deriva del último evento no anulado **entre servicio, tacto y parto** (se filtra el secado): parto → `SIN_SERVICIO`; no hay fecha vigente ni de referencia. `ultimoServicio` y `ultimoTacto` siguen siendo de cualquier ciclo y suman `cicloAnterior` (su posición es anterior al último parto no anulado). `resolverFechaProbable` y `servicioBase` no cambian: ya usan `cicloActual`.
- **`genetica.ts` (nuevo):** `servicioParaGenetica(lista)`: el último servicio no anulado posterior al último parto no anulado (o de todo el historial si no hubo parto), **ignorando los tactos "vacía"**; es una función distinta de `servicioBase` a propósito. `evaluarGenetica(servicio, fechaParto)` → `{ vinculado: true, servicioId }` si `diasEntre(servicio.fecha, fechaParto)` está entre 240 y 300 (extremos incluidos); si no hay servicio, `{ vinculado: false, motivo: 'SIN_SERVICIO' }`; si está fuera, `{ vinculado: false, motivo: 'FUERA_DE_RANGO', fechaServicio }`.
- **`aptitud.ts`:** `puedeParir(sexo, estado)` (macho, recién nacida) y `puedeSecarse(sexo, estado)` (macho, o estado distinto de "en ordeñe" con el estado en el mensaje), con el motivo en español.
- **`partos.ts` (nuevo):** `validarSeparacionPartos(lista, fecha)` (200 días) y `armarAvisos(...)`.
- Se reutilizan `validarFechaEvento`, `sumarDias`, `diasEntre`, `bloquearAnimal`, `siguienteRegistro` y el reloj inyectable de la 003.

## Interfaz
- **Ficha** (`AnimalFicha.tsx` y `componentes/Reproduccion.tsx`): según la tabla de RF-44 (estado × rol), agrega "Registrar parto" (vaquillona, en ordeñe y seca) y "Registrar secado" (solo en ordeñe) para dueño y encargado; el veterinario no los ve. "Anular" aparece en el último evento no anulado; para el veterinario solo si es servicio o tacto.
- **Formulario de parto** (`componentes/FormParto.tsx`): fecha (`type="date"`, `max` hoy de Argentina, precargada con hoy) y 1 o 2 crías ("Agregar segunda cría" / "Quitar"). Por cría: sexo (select), "Nació muerta" (casilla que oculta el número), número (con `autoCapitalize` y el mismo criterio de la alta de animales) y observaciones. Errores 400 y 409 debajo del campo o en una alerta. Al guardar, se recarga la ficha y se muestran los avisos de la respuesta en una caja que se cierra (no persisten) y un enlace a la ficha de cada cría viva (RF-45).
- **Formulario de secado** (`componentes/FormSecado.tsx`): solo la fecha.
- **Anulación:** el `textarea` de motivo con confirmación que ya existe para servicios y tactos; el aviso 6 o 7 de la respuesta se muestra al volver a la ficha.
- **Lista de eventos:** el parto muestra sus crías (número con enlace si está activa; número con "dada de baja" y sin enlace si no; "nacida muerta" con sexo y observaciones), su genética (fecha de servicio y semen o toro, o "sin dato") y el lote previo ("sin lote previo" o "lote previo eliminado"); el secado muestra el lote previo igual. Anulados con marca, motivo, quién y cuándo (tachado más texto). Los servicios y tactos anteriores al último parto figuran con la etiqueta "del ciclo anterior" en la situación reproductiva.
- **Ficha de la cría:** muestra "Nació en el parto del dd/mm/aaaa" con su genética.
- Todos los controles de al menos 48 px, sin desbordes en 768 px y 375 px, en modo claro y oscuro (variables de `estilos.css`). Se divide así: T4 hace el registro y la lectura; T5, la anulación.

## Archivos
- Crear:
  - `api/prisma/migrations/<fecha>_partos_tipos_evento/migration.sql` y `<fecha>_partos_secados/migration.sql`
  - `api/src/reproduccion/genetica.ts`, `partos.ts`, `destinos.ts`, `avisos.ts`
  - `api/src/rutas/partos.ts` (POST partos y secados bajo `/api/animales/:id/…`) y `api/src/rutas/anulaciones-partos.ts` (POST `/api/partos/:id/anular` y `/api/secados/:id/anular`)
  - Tests: `api/tests/base-partos.test.ts`, `situacion-partos.test.ts`, `genetica.test.ts`, `partos.test.ts`, `secados.test.ts`, `anulaciones-partos.test.ts`, `partos-concurrencia.test.ts`, `lotes-historial.test.ts`
  - `web/src/componentes/FormParto.tsx`, `FormSecado.tsx`
- Modificar:
  - `api/prisma/schema.prisma`
  - `api/src/reproduccion/situacion.ts` (ciclo, estado, `cicloAnterior`), `eventos.ts` (partos, secados, crías, lote previo), `anular.ts` (tipos, orden de 409, vuelta atrás, baja de crías, mensaje del veterinario), `aptitud.ts`, `bloqueo.ts` (sin cambios de lógica; se reutiliza)
  - `api/src/rutas/reproduccion.ts` (GET eventos), `api/src/rutas/animales.ts` (ficha de la cría), `api/src/rutas/anulaciones.ts` (pasa el rol), `api/src/rutas/lotes.ts` (quita la desasignación de bajas)
  - `api/src/validacion.ts`: `criasPartoSchema` (reutiliza `numeroSchema`)
  - `api/src/app.ts`: sesión y rol de las 4 rutas nuevas antes de los parsers de JSON; montar las rutas
  - `api/tests/ayudas.ts`: `limpiarBase()` con las tablas nuevas (en el orden de las claves); `crearAnimalDirecto` con `motivoBaja` por defecto en las bajas y sin lote; helpers `crearPartoDirecto`, `crearSecadoDirecto`, `crearBajaDirecta` y `verificarInvariantes(animalId)` (RF-33)
  - Tests existentes que siembran una baja con lote: `lotes.test.ts` (líneas con `crearAnimal(..., 'BAJA')` con lote), `base-animales.test.ts` y `base-lotes.test.ts`, que se actualizan al nuevo CHECK
  - `web/src/api.ts` (tipos), `web/src/reproduccion.ts` (textos de parto, secado, avisos y estados), `web/src/componentes/Reproduccion.tsx`, `web/src/paginas/AnimalFicha.tsx`, `web/src/estilos.css`
  - `MEMORY.md` y `docs/plan.md` (cierre)

## Decisiones
- **El lote previo se guarda con una clave foránea compuesta escrita a mano con `ON DELETE SET NULL ("loteAnteriorId")` y la columna `tuvoLoteAnterior`.** Elegida porque borra solo la columna del lote (nunca `establecimientoId`, que es obligatoria), no hace falta código en la ruta de lotes y la base garantiza que el lote previo es del mismo tambo; `tuvoLoteAnterior` permite distinguir "sin lote previo" de "eliminado" después de que la base lo anuló. Alternativa descartada 1: clave simple al lote (con `SET NULL` completo anularía también `establecimientoId` y falla; sin compuesta no garantiza el tambo). Alternativa descartada 2: guardar solo el nombre del lote (sin referencia): no permitiría devolver a la vaca al lote previo. Costo aceptado: Prisma no modela esa clave y `migrate diff` la lista como diferencia esperada.
- **Un animal de baja nunca tiene lote: CHECK en `animales` con un `UPDATE` previo en la misma migración, y la ruta de lotes deja de desasignar bajas.** Elegida porque lo pide la spec (RF-34) y el riesgo de MEMORY.md; con el CHECK, la desasignación de la 001/002 nunca encuentra filas. Alternativa descartada: dejar la desasignación "por las dudas": código muerto que oculta si alguna ruta futura rompe la regla. Alternativa descartada: `ON DELETE SET NULL` en `animales → lotes`: con la clave compuesta anularía `establecimientoId`.
- **`CriaParto` como tabla propia con dos claves compuestas (hacia el parto y hacia el animal, ambas con `madreId`).** Elegida porque guarda a la vez las crías vivas y las nacidas muertas (que no son animales), conserva el vínculo aunque la cría pase a baja, y deja que la base garantice que la madre de la cría es la del parto (RF-36.4). Alternativa descartada 1: columna `partoId` en `animales`: no sirve para las muertas, ensucia el animal y no garantiza la madre. Alternativa descartada 2: lista de crías como JSON en el parto: sin claves foráneas ni garantías.
- **La genética se calcula con `servicioParaGenetica`, separada del servicio base.** Elegida porque la decisión A de la spec la define distinta (ignora los tactos "vacía"); reusar `servicioBase` daría una genética incorrecta para "servicio, tacto vacía, parto". Se guarda la referencia al servicio en el parto (`servicioId`) y no una copia de los datos, así la ficha muestra el nombre actual del semen. Alternativa descartada: guardar fecha y nombre del semen copiados en el parto: se desactualiza (la spec pide el nombre actual).
- **El estado reproductivo ignora el secado y el parto reinicia el ciclo, ambos dentro de `situacion.ts`.** Elegida porque ya concentra esas reglas (MEMORY.md) y los tests de la 003 son la red de seguridad. Alternativa descartada: guardar el estado reproductivo en el animal: duplica información y complica la anulación (decisión de la 003).
- **Bloqueo `SELECT … FOR UPDATE` sobre el animal en cada registro y anulación, como en la 003, más `FOR SHARE` sobre el lote destino o previo.** El bloqueo del animal serializa partos, secados, servicios, tactos y anulaciones de una misma vaca (tabla de RF-31 y RF-32). `FOR SHARE` sobre el lote evita que otro usuario lo elimine entre la lectura de la regla y la escritura, de modo que la vuelta atrás nunca falla por "lote eliminado en el medio" y el 409 de RF-14 es el único resultado alternativo. Alternativa descartada: reintentar ante P2003: más código y resultados menos predecibles. Para anular un parto se bloquean además las crías vivas en orden de `id` (evita interbloqueos entre dos anulaciones y una operación sobre una cría).
- **El 409 de lote inexistente (RF-14) se prueba con una transacción simulada y con la carrera real.** La clave de `reglas_lote` impide sembrar una regla a un lote que no existe, así que el test unitario de `resolverLotesDestino` usa un `tx` falso (regla presente, lote ausente) y el test de concurrencia acepta los tres resultados de la spec. Alternativa descartada: sacar la clave en el test: rompe la base de pruebas compartida.
- **Dos migraciones: una solo con `ADD VALUE` y otra con todo lo demás.** Un valor de enum agregado no se puede usar en la misma transacción. Alternativa descartada: una sola migración con las tablas: los CHECK con `'PARTO'` fallarían al aplicar.
- **Rutas separadas por tipo (`/api/partos/:id/anular`, `/api/secados/:id/anular`) y rol controlado en `app.ts` antes de los parsers.** Lo anticipó la 003: el veterinario recibe 403 aun con JSON roto o id inexistente (RF-42) y un id de otro tipo es 404. Alternativa descartada: una ruta única de anulación: obligaría a decidir el permiso después de buscar el evento.
- **Las respuestas de parto, secado y sus anulaciones son `{ evento, avisos }`.** Los avisos son una lista cerrada con código y texto (los textos viven en un solo módulo) y no se guardan. Alternativa descartada: persistir los avisos en la base o calcularlos al leer: la spec pide que no persistan (solo persiste el lote previo del historial).
- **Los números de las crías se verifican con una consulta previa (para informar determinísticamente la primera) y con el índice único (para la carrera).** Alternativa descartada: depender solo del P2002: no permite el orden fijo de rechazos de RF-12.
- **Sin dependencias nuevas.**

## Estrategia de tests
Tests primero, con Vitest y supertest sobre `cowregister_test`. Datos de partida con helpers directos (`prepararVaca`, `crearPartoDirecto`, `crearSecadoDirecto`, `crearBajaDirecta`); roles con `crearUsuario`; "hoy" con `fijarReloj` (restaurado en `afterEach`). Los tests puros (`situacion-partos`, `genetica`) no usan la base. Concurrencia: `Promise.all` repetido varias veces; solo se aceptan los resultados de las tablas de RF-31 y RF-32 y, después de cada ronda, se corre `verificarInvariantes` (RF-33, una consulta por invariante); un fallo intermitente se trata como error real. Las defensas (cría no activa, estado actual distinto) se siembran con `prisma` directo. La web no tiene tests automáticos: se verifica en el navegador.

| RF | Test (archivo › caso) |
|---|---|
| RF-1 | partos.test.ts › vaquillona, en ordeñe (cambia de lote) y seca: estado "en ordeñe" y lote destino; parto con estado y lote previos guardados |
| RF-2 | partos.test.ts › una y dos crías vivas: recién nacido, fecha de nacimiento, madre, lote destino y vínculo con el parto |
| RF-3 | partos.test.ts › viva y muerta: la muerta queda en el parto sin animal ni número; todas muertas: madre cambia igual, ningún animal nuevo |
| RF-4 | partos.test.ts › número repetido, madre inválida o error a mitad: no queda madre cambiada ni cría ni evento |
| RF-5 | partos.test.ts › 0 y 3 crías, sin sexo, sexo inválido, "nació muerta" con tipo inválido (400), por defecto falso, observaciones de 200 y 201, recortadas y vacías → "sin observaciones" |
| RF-6 | partos.test.ts › muerta con número 400; viva sin número y con número inválido 400 |
| RF-7 | partos.test.ts › mismo número en mayúsculas y minúsculas: 400 y nada guardado |
| RF-8 | partos.test.ts › número existente entre activos: 409 completo; uno de baja no choca |
| RF-9 | partos.test.ts › macho y recién nacida 409; baja y ajena 404 |
| RF-10 | partos.test.ts › fecha igual y anterior al nacimiento de la madre: 400; posterior se acepta |
| RF-11 | partos.test.ts › a 199 días 409 con fecha y sugerencia, a 200 se acepta; con el parto anulado no cuenta |
| RF-12 | partos.test.ts › cada par de motivos juntos (madre no apta + número existente, 200 días + número existente): se informa el primero |
| RF-13 | partos.test.ts › sin regla de "en ordeñe" y de "recién nacido": se guarda sin lote y con avisos 1 y 3 en el orden fijo |
| RF-14 | partos.test.ts › `resolverLotesDestino` con `tx` simulado (409) · partos-concurrencia.test.ts › quitar la regla y eliminar el lote en paralelo |
| RF-15 | genetica.test.ts y partos.test.ts › servicio a 239, 240, 300 y 301 días; semen o toro mostrado con el nombre actual y "sin dato" si no tenía |
| RF-16 | genetica.test.ts › servicio + tacto "vacía" ignora el tacto; servicio anterior al último parto no cuenta; parto anulado devuelve el servicio · partos.test.ts › sin servicio: aviso 4; fuera de rango: aviso 5 |
| RF-17 | situacion-partos.test.ts › parto reinicia: "SIN_SERVICIO", sin fechas; tacto "preñada" posterior sin servicio exige fecha (400); tacto "vacía" posterior; secado no cambia el estado reproductivo |
| RF-18 | secados.test.ts › en ordeñe, preñada y no preñada: "seca", lote destino, estado y lote previos, estado reproductivo sin cambios |
| RF-19 | secados.test.ts › seca, vaquillona, recién nacida y macho 409 con el estado; baja y ajena 404 |
| RF-20 | secados.test.ts › sin regla de "seca": sin lote y aviso 2 · `resolverLotesDestino` simulado |
| RF-21 | secados.test.ts y partos.test.ts › fecha futura con el reloj fijo, anterior al último evento (de los 4 tipos), igual fecha se acepta |
| RF-22 | anulaciones-partos.test.ts › anular secado: vuelve a "en ordeñe" y a su lote previo, con quién, cuándo y motivo |
| RF-23 | anulaciones-partos.test.ts › anular parto: madre al estado y lote previos, crías vivas de baja, muertas intactas, situación recalculada |
| RF-24 | anulaciones-partos.test.ts › cría de baja con fecha de hoy de Argentina, motivo `PARTO_ANULADO`, sin lote, número libre (un animal nuevo puede usarlo), no aparece en listados ni búsquedas, su ficha 404 |
| RF-25 | anulaciones-partos.test.ts › ya anulado 409 |
| RF-26 | anulaciones-partos.test.ts › no es el último: mensaje del servicio, tacto, parto y secado posteriores; veterinario con parto o secado posterior: mensaje "dueño o encargado" · anulaciones.test.ts › la de servicios y tactos mantiene su mensaje |
| RF-27 | anulaciones-partos.test.ts › estado actual distinto, sembrado con `prisma` directo: 409 sin cambios |
| RF-28 | anulaciones-partos.test.ts › cría con evento propio, con crías propias o no activa (sembrada): 409 y no se da de baja ninguna |
| RF-29 | anulaciones-partos.test.ts › motivo vacío y de 201: 400; de otro tambo, inexistente, mal formado, de otro tipo (id de servicio en la ruta de partos) y animal de baja: el mismo 404; veterinario 403 antes de buscar |
| RF-30 | anulaciones-partos.test.ts › lote previo eliminado (aviso 7, se elimina el lote antes de anular), sin lote previo (aviso 6), con lote previo (sin aviso) |
| RF-31 | partos-concurrencia.test.ts › una prueba por fila de la tabla de registro (partos entre sí, mismo número en otra vaca, alta de animal con el mismo número, parto con secado, con servicio o tacto, secados, secado con servicio o tacto, cambio de lote destino) |
| RF-32 | partos-concurrencia.test.ts › una prueba por fila de la tabla de anulación (mismo evento dos veces, parto con secado, secado con parto, con servicio o tacto, con el evento anterior) |
| RF-33 | ayudas.ts › `verificarInvariantes` (a a f) llamada al final de cada ronda de concurrencia, y también sobre datos armados a mano que los violen (el verificador falla) |
| RF-34 | base-partos.test.ts › el CHECK rechaza una baja con lote insertada o actualizada directo; la migración desasigna una baja existente (se prueba con el bloque `UPDATE` sobre datos sembrados antes del CHECK) |
| RF-35 | partos.test.ts › el parto en paralelo con el alta de un animal con el mismo número da 201 y 409 · base-partos.test.ts › el índice rechaza el duplicado entre activos y permite el de una baja |
| RF-36 | base-partos.test.ts › un caso por garantía: evento con animal ajeno; parto con servicio de otro animal y de otro tambo; cría con madre ajena; cría viva en un parto de otra madre o de otro tambo; lote previo de otro tambo; viva sin animal y muerta con animal (CHECK) |
| RF-37 | lotes-historial.test.ts › se elimina un lote que solo figura como lote previo (el historial queda "eliminado" y `establecimientoId` intacto); con animales activos o destino sigue 409 · lotes.test.ts › actualizado |
| RF-38 | eventos-lista.test.ts › parto con crías vivas, muertas y de baja, genética o "sin dato", lote previo, orden total, anulados, solo el nombre del usuario, sin hashes ni email |
| RF-39 | animales.test.ts › la ficha de una cría incluye su parto y genética; la de la madre lista los partos |
| RF-40 | eventos-lista.test.ts › `cicloAnterior` en el último servicio y tacto previos al parto; tras anular el parto desaparece · manual en el navegador |
| RF-41 | aislamiento entre dos tambos para registrar y anular parto y secado, ver la lista, y `establecimientoId` en el cuerpo ignorado (partos.test.ts, secados.test.ts, anulaciones-partos.test.ts, eventos-lista.test.ts) |
| RF-42 | veterinario 403 en parto, secado y sus anulaciones (también con datos inválidos, JSON roto y evento inexistente o ajeno); sin sesión 401 con JSON roto; dueño y encargado pueden |
| RF-43 | Verificación manual en el navegador (veterinario sin botones de parto, secado ni anulación de esos eventos) |
| RF-44 | Verificación manual en el navegador: cada fila de la tabla estado × rol |
| RF-45 | Verificación manual en el navegador: parto de una y dos crías, "nacida muerta", avisos, enlace a la ficha de cada cría |
| RF-46 | Verificación manual en el navegador: 48 px, 768 px y 375 px, claro y oscuro, errores en español |

## Riesgos
- **Que Prisma 7.10.1 no acepte alguna clave compuesta** (las que llevan `tipo` y `animalId` hacia `Evento`, o `madreId` hacia `Animal`). Plan B: la clave escrita a mano en el SQL y documentada. T1 lo verifica primero.
- **`migrate diff` no queda vacío por las dos claves de lote previo, que Prisma no modela.** Se acepta esa diferencia exacta y documentada; cualquier otra sentencia o un `DROP` de lo hecho a mano frena. Riesgo de que alguien aplique ese `ALTER` por error: queda anotado en el comentario del SQL y en MEMORY.md.
- **Que `ON DELETE SET NULL (columna)` no se comporte como se espera con la clave compuesta:** T1 lo prueba con el caso real (eliminar un lote previo y comprobar que `establecimientoId` sigue igual y `tuvoLoteAnterior` en `true`).
- **Los tests existentes que siembran una baja con lote dejan de funcionar** (a propósito, por el CHECK). Se actualizan en T1.
- **Interbloqueos:** el orden fijo de bloqueos (animal; lotes por estado; crías por `id`) y que cada operación toma el animal primero los evita. Los tests de concurrencia buscan interbloqueos como resultado inaceptable.
- **`FOR UPDATE` frena el alta de crías de esa vaca por la clave de la madre** (riesgo ya anotado en la 003); aceptable por la duración.
- **Editar el animal o la madre de una cría en la spec de "editar animal"** chocará con la clave `(animalId, madreId)` de `crias_parto`: es intencional (no se debe cambiar la madre de una cría que figura en un parto); esa spec deberá decidir cómo se corrige. Queda anotado en MEMORY.md.
- **El modo sin conexión (Etapa 6):** el orden por `creadoEn` y el bloqueo siguen siendo supuestos del servidor, como en la 003.
- **Tamaño de T2 y T3:** son las más pesadas. Si T2 se estira, el secado (que es mucho más simple) puede pasar a T3 sin cambiar el resto del reparto.
