# Plan — 006 Bajas por venta o muerte

Spec: [spec.md](spec.md)

## Resumen
La baja es un evento más (`Evento` tipo `BAJA` + tabla de detalle `Baja`, igual que partos y secados) que además deja al animal en estado `BAJA` con fecha y motivo. Revertir anula ese evento y reactiva al animal con el estado y lote previos. Se suman cuatro rutas (dar de baja, revertir, listado y ficha de baja de solo lectura) y se retocan las lecturas y reglas de las specs 002 a 005 en los puntos que declara la spec. La concurrencia sigue el patrón existente: `FOR UPDATE` sobre el animal en cada operación y, para lo que la base puede garantizar sola (una baja vigente por animal, coherencia animal–baja), restricciones en la base. **Sin dependencias nuevas.**

## Base de datos
Dos migraciones, creadas a mano en carpetas y aplicadas con `prisma migrate deploy` (`migrate dev` falla en modo no interactivo, MEMORY.md). Van **separadas** porque PostgreSQL no deja usar un valor de enum recién agregado dentro de la misma transacción (precedente: `partos_tipos_evento`).

- **Migración `20261112100000_bajas_enums`:** solo `ALTER TYPE "TipoEvento" ADD VALUE 'BAJA'` y `ALTER TYPE "MotivoBaja" ADD VALUE 'VENTA'` y `'MUERTE'`.
- **Migración `20261112100100_bajas_base`:**
  - **Modelo nuevo `Baja`** (tabla `bajas`, detalle del evento `BAJA`): `eventoId` (PK, UUID), `establecimientoId`, `tipo` (default `BAJA`; CHECK `bajas_tipo`), `animalId`, `motivo` (`MotivoBaja`; CHECK solo `VENTA` o `MUERTE`: el `PARTO_ANULADO` sigue sin evento), `observaciones` (nulo = "sin observaciones"; CHECK de largo 1 a 200 como en crías), `estadoAnterior` (`EstadoAnimal`; CHECK distinto de `BAJA`), `tuvoLoteAnterior` y `loteAnteriorId` (mismo esquema que `Parto` y `Secado`; clave foránea a mano `bajas_loteAnterior_fkey` con `ON DELETE SET NULL ("loteAnteriorId")`), `vigente` (boolean, `true` al crear; pasa a `false` al revertir).
  - **Clave foránea compuesta** `(establecimientoId, eventoId, tipo, animalId)` → `Evento` (destino ya existente `@@unique([establecimientoId, id, tipo, animalId])`): la baja es de un evento de tipo `BAJA`, del mismo animal y del mismo tambo (RF-18.3).
  - **Índice único parcial** `bajas_una_vigente_por_animal` sobre `("animalId") WHERE "vigente"`: a lo sumo una baja vigente por animal, también con operaciones simultáneas (RF-18.2).
  - **Índice** `(establecimientoId) WHERE "vigente"` para el listado.
  - **CHECK en `animales`** (a mano): `animales_baja_con_fecha_y_motivo` (`estado <> 'BAJA' OR ("fechaBaja" IS NOT NULL AND "motivoBaja" IS NOT NULL)`, creado `NOT VALID` para no romper bajas viejas) y `animales_activo_sin_baja` (`estado = 'BAJA' OR "fechaBaja" IS NULL`); ya existen `animales_baja_sin_lote` y `animales_motivo_baja_coherente` (RF-18.1 y RF-18.5).
  - **Disparador diferido (`CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`)** sobre `animales`, `bajas` y `eventos` que, al confirmar la transacción, comprueba: (a) `bajas.vigente` equivale a `eventos.anuladoEn IS NULL` de su evento; (b) un animal en `BAJA` con motivo `VENTA` o `MUERTE` tiene **exactamente una** baja vigente, con la misma fecha (la del evento) y el mismo motivo; (c) un animal activo no tiene baja vigente. Es diferido para que la transacción pueda escribir en cualquier orden. Es la garantía "manda la baja registrada" (RF-18.2).
  - **Anulación completa:** ya existe `eventos_anulacion_completa` y vale también para el evento `BAJA` (se agrega su test, RF-18.4). Al revertir no se borra nada (RF-18.6); el disparador de solo-agregar no aplica a `eventos` y se confía en que el código nunca borra (igual que 003 y 004), con un test que lo verifica.
- **`schema.prisma`:** enum `TipoEvento` suma `BAJA`; `MotivoBaja` suma `VENTA` y `MUERTE`; modelo `Baja` y la relación `baja Baja?` en `Evento`; comentarios que remiten a la migración (como `Parto`).
- **Antes de migrar:** correr en `api/` `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` y comprobar que da solo las dos claves foráneas de lote previo conocidas (004) más lo equivalente de `bajas_loteAnterior_fkey` (no modelada) y ningún `DROP` de lo hecho a mano; después de migrar tiene que dar lo mismo. No aplicar esas propuestas.
- **`tests/ayudas.ts`:** `bajas` en el `TRUNCATE` de `limpiarBase`; helpers `crearBajaDirecta` (siembra animal de baja con su evento y detalle) y `crearAnimalDeBajaPartoAnulado`; `verificarInvariantes` suma los invariantes (a) a (e) de RF-16 de la spec.

## API
Sesión y rol se controlan **antes** de los parsers de JSON (`app.ts`), como en partos y edición. Los nombres del cuerpo y de las respuestas son los de la spec (`motivo`, `fecha`, `observaciones`, `motivoReversion`; valores `"venta"` y `"muerte"` en minúsculas, mapeados a `VENTA` y `MUERTE`).

| Método y ruta | Rol | Qué hace | RF |
|---|---|---|---|
| `POST /api/animales/:id/baja` | Dueño, encargado | Valida `{ motivo, fecha, observaciones? }`; en transacción bloquea al animal (`bloquearAnimal`, 404 si no es activo), valida la fecha, guarda `Evento` `BAJA` + `Baja` (con estado y lote previos, `siguienteRegistro`) y pasa el animal a `BAJA` con fecha, motivo y sin lote; 201 con la baja | RF-1 a RF-6, RF-16, RF-17 |
| `POST /api/animales/:id/revertir-baja` | Dueño, encargado | Valida `{ motivoReversion }`; en transacción bloquea la fila del animal **de baja por venta o muerte** (404 si no); 409 si otro activo usa el número; lee el lote previo con `FOR SHARE`; devuelve estado y lote previos, vacía fecha y motivo, anula el evento (`anuladoEn`, `anuladoPorId`, `motivoAnulacion`) y pone `vigente = false`; 200 con la ficha activa y `avisos` | RF-7 a RF-10, RF-16, RF-17 |
| `GET /api/bajas?motivo=&numero=` | Los tres | Listado de bajas vigentes por venta o muerte: orden por fecha de baja y `creadoEn` del evento (más reciente primero), filtros por motivo (`venta` o `muerte`; otro valor 400) y por número (normalizado, coincidencia exacta, solo entre bajas), tope 2.000 con total y aviso | RF-12, RF-17 |
| `GET /api/bajas/:id` | Los tres | Ficha de baja del animal (`:id` = id del animal): datos, baja, madre y crías con su estado, lista de eventos (incluida la baja, sin "Anular") y cambios manuales (últimos 100 con total). 404 idéntico si no es una baja vigente por venta o muerte del tambo | RF-5, RF-13, RF-17 |

Orden de rechazos (spec): **baja** 401, 403, 400 del cuerpo (zod: motivo exacto, fecha existente, observaciones texto), 404, 400 de fecha (`bajas/validacion.ts`); **revertir** 401, 403, 400, 404, 409. La validación del cuerpo va antes de la búsqueda, incluso con id mal formado.

Detalle de la **baja** (`api/src/bajas/baja.ts`): fecha mínima = mayor entre el nacimiento y la fecha del último evento no anulado del animal **que no sea `BAJA`**; máxima = hoy de Argentina (`reloj.ts`). Se escriben, en este orden, el `Evento`, la `Baja` y el `update` del animal con `loteId: null` (el CHECK `animales_baja_sin_lote` lo exige). La baja **no toca** a la madre ni a las crías.

Detalle de **revertir** (`api/src/bajas/revertir.ts`): estado y lote previos salen de `Baja`; el lote se lee con `FOR SHARE` (si desapareció o `tuvoLoteAnterior` es falso, queda sin lote y se arma el aviso de RF-9 con el estado en español de `lotes/estados.ts`); el `update` del animal (P2002 del índice de número → 409) y la anulación se hacen en la misma transacción.

Cambios en rutas existentes (RF-15 de la spec):
- `GET /api/animales/:id` (`leerFicha`): `madre` suma `motivoBaja` (con `activa`, la web decide el acceso: ficha de baja solo si venta o muerte) y se agrega `criasDeBaja` (`{ id, numero, motivo }`, ordenadas con el orden natural).
- Eventos (`leerEventos`): `CriaDeParto.animal` suma `motivoBaja` (acceso a su ficha de baja solo si venta o muerte); `FilaEvento` y `armarEvento` incluyen el detalle `baja`; `armarRespuesta` **excluye `BAJA`** de `calcularSituacion` (no cuenta para situación, ciclo, genética ni "último evento a anular") pero la muestra en la lista; `textoEvento` y los tipos aceptan `BAJA`.
- Anular parto (`anular.ts`, `bloquearYControlarCrias`): una cría de baja por venta o muerte da 409 "La cría N.º X está dada de baja por <venta|muerte>: revertí primero su baja" (antes del mensaje de "ya no está activa", que queda para "parto anulado"); los conteos de "eventos propios no anulados" ignoran el tipo `BAJA`.
- Edición (`animales-edicion.ts`): la consulta de ciclos (CTE recursiva) deja de filtrar por `estado <> 'BAJA'` en su recorrido hacia arriba (recorre bajas); el conteo de "sexo con eventos no anulados" ignora `BAJA`. La búsqueda de la nueva madre sigue exigiendo hembra **activa** (mensaje genérico).
- Alta manual (`POST /api/animales`, `rutas/animales.ts`): con madre, el alta pasa a una **transacción** que toma `SELECT ... FOR UPDATE` de la madre y vuelve a comprobar que sea hembra activa antes de crear (cierra el riesgo pendiente de MEMORY.md y la carrera con la baja de la madre). Carga desde planilla (`animales/carga.ts`): al confirmar, bloquea con `FOR SHARE`, en orden de id, a las madres ya existentes que usa.
- Aviso de número de un animal de baja (RF-14): helper `bajas/numero-de-baja.ts` (`buscarBajasPorNumero(cliente, establecimientoId, numeros)`: baja vigente venta o muerte más reciente por número, orden fecha y luego `creadoEn`). Lo usan el alta manual (respuesta suma `avisoNumeroDeBaja: { motivo, fecha } | null`, junto a `avisoSinLote`), la edición del número (la respuesta suma `avisos`, lista de textos; la ficha sigue igual) y la planilla (cada fila pública suma `avisoNumeroDeBaja`; vista previa y confirmar lo devuelven). El parto no avisa.
- `GET /api/animales`, `/buscar`, `/:id`, `/:id/eventos`, `/:id/cambios`, registrar y anular eventos, editar y mover **no cambian**: siguen en 404 para animales de baja.

## Interfaz
- **Menú** (`Layout.tsx`): entrada "Bajas" para los tres roles; se arregla `.menu-acciones` en `estilos.css` para que no desborde a 375 px (envuelve en varias filas o se vuelve vertical).
- **Listado** (`paginas/Bajas.tsx`, ruta `/bajas`): filtro por motivo (todos, venta, muerte) y por número, tabla (número, sexo, fecha, motivo) con acceso a la ficha de baja, aviso de tope, vacíos "No hay animales dados de baja" y "No hay bajas con ese número".
- **Ficha de baja** (`paginas/BajaFicha.tsx`, ruta `/bajas/:id`): datos básicos, estado previo, madre y crías con las marcas de las reglas de vínculos, caja con el texto "Baja por <venta|muerte> el <dd/mm/aaaa>" (observaciones o "sin observaciones" y quién la registró), eventos (reutiliza la lista de `Reproduccion.tsx` sin "Anular" para la baja) e historial de cambios (`HistorialCambios.tsx` existente con su leyenda). Dueño y encargado ven "Revertir baja" (`FormRevertirBaja.tsx`: `motivoReversion`, confirmación).
- **Dar de baja** (`componentes/FormBaja.tsx` dentro de `AnimalFicha.tsx`): botón solo para dueño y encargado, motivo sin valor por defecto, fecha por defecto hoy, observaciones, paso de confirmación con el texto de RF-19; al guardar navega a la ficha de baja con el mensaje "Baja registrada: …"; tras revertir vuelve a la ficha del animal activo con "Baja revertida" y el aviso de RF-9 en la caja de avisos.
- **Vínculos:** `AnimalFicha.tsx` muestra la madre con "dada de baja" (con enlace a `/bajas/:id` solo si venta o muerte) y `criasDeBaja`; la lista de eventos muestra la cría de baja con su marca y enlace según el motivo.
- **Avisos de número** en `AnimalNuevo.tsx` (una vez al guardar), `FormEditarAnimal.tsx` y `AnimalesPlanilla.tsx` (por fila, como aviso y no como error).
- **Errores concurrentes (RF-21):** `api.ts` ya maneja el 401; los formularios tratan 404 con el texto de la spec y recargan, 409 con el mensaje en la ficha de baja y 400 conservando lo escrito.
- Tablet: campos y botones de 48 px, una columna, sin desbordes a 768 px y 375 px, modo claro y oscuro (variables de `estilos.css`).

## Archivos
- Crear:
  - `api/prisma/migrations/20261112100000_bajas_enums/migration.sql` y `20261112100100_bajas_base/migration.sql`
  - `api/src/bajas/baja.ts`, `revertir.ts`, `validacion.ts` (zod y fechas), `numero-de-baja.ts`
  - `api/src/rutas/bajas.ts` (los dos `Router`: `/api/animales/:id/baja` y `revertir-baja`, y `/api/bajas`)
  - `api/tests/base-bajas.test.ts`, `bajas-validacion.test.ts`, `bajas.test.ts`, `bajas-revertir.test.ts`, `bajas-listado.test.ts`, `bajas-integracion.test.ts`, `bajas-concurrencia.test.ts`
  - `web/src/paginas/Bajas.tsx`, `BajaFicha.tsx`; `web/src/componentes/FormBaja.tsx`, `FormRevertirBaja.tsx`
- Modificar:
  - `api/prisma/schema.prisma`
  - `api/src/app.ts` (sesión y rol antes de los parsers; montar rutas)
  - `api/src/rutas/animales.ts` (ficha, alta con bloqueo de madre y aviso de número), `api/src/animales/carga.ts` y `planilla.ts`
  - `api/src/rutas/animales-edicion.ts` (ciclos por bajas, sexo sin `BAJA`, aviso de número)
  - `api/src/reproduccion/eventos.ts`, `situacion.ts` (ignorar `BAJA`), `anular.ts` (mensaje y conteos), `bloqueo.ts` (`bloquearAnimalDeBaja`)
  - `api/tests/ayudas.ts` y los tests que arman respuestas de eventos o de ficha si cambia su forma
  - `web/src/api.ts`, `web/src/App.tsx`, `web/src/componentes/Layout.tsx`, `web/src/componentes/Reproduccion.tsx`, `web/src/componentes/FormEditarAnimal.tsx`, `web/src/paginas/AnimalFicha.tsx`, `AnimalNuevo.tsx`, `AnimalesPlanilla.tsx`, `web/src/estilos.css`
  - Cierre: `MEMORY.md` y `docs/plan.md` (las edita el implementador): la Etapa 3 pasa a decir "Bajas por venta o muerte con reversión, listado y ficha de bajas (spec [006-bajas](../specs/006-bajas/spec.md)). El movimiento automático entre lotes según el estado ya quedó hecho en las etapas 1 y 2 (specs 001, 004 y 005)." con el paso "- [x] 3.1 Bajas por venta o muerte: registrar, revertir, listado y ficha de bajas, aviso al reutilizar un número", y el título "Etapa 3 — Bajas"

## Decisiones
- **La baja es un evento (`Evento` `BAJA` + detalle `Baja`)** — elegida porque la spec la pide en el historial con quién y cuándo, con anulación (reversión) y estado y lote previos, igual que partos y secados, y porque reutiliza el orden total, el bloqueo y las claves compuestas. Alternativa descartada: columnas en `Animal` (comprador, fecha, motivo) sin evento, porque no admite varias bajas del mismo animal (baja, reversión, nueva baja) ni la anulación con motivo.
- **`BAJA` queda fuera de los cálculos de las specs 003 a 005** — elegida porque la spec lo exige y evita tocar situación, ciclo y genética; se filtra por tipo en un solo lugar (`armarRespuesta`) y en los conteos. Alternativa descartada: que cuente y filtrar caso por caso en cada regla, porque es fácil olvidarse una.
- **Columna `vigente` + índice único parcial + disparador diferido** — elegida porque "a lo sumo una baja vigente" necesita un índice parcial (no puede mirar la tabla de eventos) y la coherencia animal–baja cruza tres tablas. Alternativa descartada: solo disparador de conteo, porque con dos transacciones simultáneas ambas pueden pasar el conteo; el índice cierra esa carrera.
- **Manda la baja registrada; el animal guarda una copia (`fechaBaja`, `motivoBaja`)** — elegida porque los listados y los CHECK existentes ya leen el animal; el disparador impide que difieran. Alternativa descartada: derivar la fecha y el motivo siempre del evento (join en cada lectura), porque obliga a cambiar todo lo que hoy lee esas columnas.
- **Dos migraciones (enums y base)** — elegida porque un valor de enum recién agregado no se puede usar en la misma transacción. Alternativa descartada: una sola migración, porque falla al crear el CHECK o el índice.
- **Revertir por el id del animal con 404 para todo lo que no sea una baja vigente por venta o muerte** — elegida porque coincide con la spec y evita revelar nada de otros tambos o de bajas por "parto anulado". Alternativa descartada: `POST /api/bajas/:eventoId/anular`, porque obligaría a distinguir "ya anulada" (409) de "no encontrada" y contradice la spec.
- **Lecturas de bajas solo por `/api/bajas`** — elegida para no abrir las rutas de animales activos a los de baja (spec 002 RF-30, spec 005 RF-18). Alternativa descartada: relajar `GET /api/animales/:id`, porque cambiaría el 404 idéntico de la 002 y el buscador.
- **Bloqueos: `FOR UPDATE` del animal en baja y revertir; `FOR UPDATE` de la madre en el alta; `FOR SHARE` del lote previo al revertir** — elegidos porque repiten el orden "madre antes que cría" y "animal antes que lote" de las specs 004 y 005 (sin interbloqueos) y cierran la carrera baja de madre × alta de cría. Alternativas descartadas: `SERIALIZABLE` (reintentos y 40001 al usuario) y confiar en la clave foránea (no mira el estado de la madre).
- **Revertir no aplica el destino de lotes del estado** — elegido por la spec (respeta el lote previo). Alternativa descartada: recalcular el lote por la regla vigente, porque descartaría un lote puesto a mano antes de la baja.
- **Aviso de número en la respuesta, sin tabla ni estado** — elegido porque no persiste (spec). Alternativa descartada: guardar una marca en el animal, porque duplica datos del historial.
- **Sin dependencias nuevas** — alcanza con Prisma, zod y Express ya instalados; el filtro, el orden y el tope se hacen como en el listado de activos. Alternativa descartada: una librería de tablas o de paginación en la web, porque el tope de 2.000 con aviso ya lo define la spec.

## Estrategia de tests
Tests primero, Vitest + supertest sobre `cowregister_test`. **Concurrencia:** cada fila de la tabla de RF-16 se prueba en `bajas-concurrencia.test.ts` con `Promise.all` de las dos operaciones, **repetido varias veces** (como la 005) con fixtures nuevos en cada vuelta; cada resultado se compara con la lista de resultados aceptables de la spec y se llama a `verificarInvariantes` (incluidos los invariantes (a) a (e) de bajas). La carrera "lote que desaparece entre la lectura y el `FOR SHARE`" se prueba con un cliente simulado, igual que en la 004 y la 005.

| RF | Test (archivo › caso) |
|---|---|
| RF-1 | `bajas.test.ts` › baja en cada estado y sexo, queda `BAJA`, con fecha, motivo, sin lote, y con estado y lote previos guardados (con y sin lote); preñada se acepta |
| RF-2 | `bajas-validacion.test.ts` › motivo ausente, `"VENTA"`, `" venta"`, `""`, `null`, número, `"parto anulado"`; fecha ausente, `null`, número, `2026-02-30`, formato malo; observaciones número, 201, 200, solo espacios, `null`; sin guardar nada |
| RF-3 | `bajas-validacion.test.ts` › hoy sí, mañana, 31/12/1999, anterior al nacimiento, anterior al último evento no anulado, igual sí, evento anulado no cuenta, madre con crías más nuevas no se compara; mensajes con `dd/mm/aaaa` |
| RF-4 | `bajas.test.ts` › eventos, crías, madre y cambios intactos; número libre y reutilizable por otro animal |
| RF-5 | `bajas.test.ts` › la ficha de baja lista la baja con tipo, fecha, motivo, observaciones y solo el nombre de quien registró; revertida figura anulada; sin "Anular" |
| RF-6 | `bajas.test.ts` › animal ya de baja, inexistente, ajeno y mal formado: 404 idéntico (también con cuerpo válido) |
| RF-7 | `bajas-revertir.test.ts` › vuelve activo con estado y lote previos, fecha y motivo vacíos, baja anulada con quién, cuándo y `motivoReversion`; nueva baja posterior se acepta |
| RF-8 | `bajas-revertir.test.ts` › otro animal activo con el número: 409 con su mensaje y nada cambia |
| RF-9 | `bajas-revertir.test.ts` › lote previo eliminado, sin lote previo y lote previo existente (aunque ya no sea destino); textos de los avisos con el estado en español |
| RF-10 | `bajas-revertir.test.ts` › `motivoReversion` ausente, `null`, vacío, espacios, no texto, 201; 404 para activo, ya revertida, inexistente, ajeno, mal formado y "parto anulado"; orden 400 antes que 404 y 404 antes que 409 |
| RF-11 | `bajas-integracion.test.ts` › con el animal de baja: registrar y anular eventos, editar, mover y `/eventos`, `/cambios`, `/:id`, buscar y listado dan 404; tras revertir vuelve todo |
| RF-12 | `bajas-listado.test.ts` › orden por fecha y luego registro, filtro por motivo, por número (normalizado, varias bajas del mismo número), sin "parto anulado", tope 2.000 con aviso (fixture masivo directo en la base), motivo inválido 400 |
| RF-13 | `bajas-listado.test.ts` › ficha de baja con datos, estado previo, madre y crías, baja, eventos y cambios (con tope 100 y total); 404 para ajena, activa, mal formada y "parto anulado" |
| RF-14 | `bajas-integracion.test.ts` › aviso en alta manual, edición del número y fila de planilla (vista previa y confirmar); baja más reciente; sin aviso con baja revertida, "parto anulado" o parto; el aviso no persiste |
| RF-15 | `bajas-integracion.test.ts` › vínculos (madre de baja y crías de baja en ficha y en eventos, con y sin acceso según motivo); 409 de anular parto con cría de baja venta o muerte y mensaje exacto; "parto anulado" mantiene el anterior; ciclo que pasa por un animal de baja; el tipo `BAJA` sembrado no cuenta en situación, ciclo, aviso 8, sexo con eventos ni eventos propios de la cría; alta con madre de baja 400 |
| RF-16 | `bajas-concurrencia.test.ts` › una prueba por cada fila de la tabla (14 filas) y los invariantes (a) a (f) con `verificarInvariantes`; `base-bajas.test.ts` › invariante (e) con consultas sobre `creadoEn` |
| RF-17 | Cada ruta › dos tambos (baja, revertir, listado, ficha ajena: 404 idéntico; `establecimientoId` del cuerpo ignorado), veterinario 403 en baja y revertir (también con JSON roto, datos inválidos y animal ajeno), veterinario sí lee listado y ficha, sin sesión 401, ninguna respuesta con hashes ni emails |
| RF-18 | `base-bajas.test.ts` › (1) CHECK de fecha y motivo en `BAJA` y nulos en activo, y sin lote; (2) segundo evento `BAJA` vigente del mismo animal rechazado, disparador de coherencia (fecha o motivo distintos, animal activo con baja vigente, animal de baja sin baja); (3) baja con evento de otro tambo, de otro animal o de otro tipo rechazada; (4) anulación incompleta rechazada; (5) valores del enum y bajas existentes ("parto anulado") válidas; (6) revertir no borra filas |
| RF-19 a RF-21 | Navegador (no automatizado), solo en las tareas de web: dueño y veterinario, 768 px y 375 px, claro y oscuro, controles de 48 px, sin scroll horizontal incluido el menú; textos exactos de la spec; 404 y 409 provocados con dos pestañas |

## Riesgos
- **Disparador diferido:** es la parte más delicada de la migración; se prueba con sembrados directos y con las rutas. Si las bajas "parto anulado" existentes chocaran con alguna comprobación, el disparador las excluye por motivo.
- **CHECK `NOT VALID`:** si hay bajas viejas sin fecha o motivo, la base las deja pero no admite nuevas; se informa en MEMORY.md.
- **Forma de las respuestas:** sumar `avisos` y `avisoNumeroDeBaja` y los campos de la ficha es aditivo, pero hay que revisar los tests y la web que comparan respuestas completas.
- **Reloj:** igual que 003 y 005 (`siguienteRegistro` protege el orden dentro de un animal; el desempate entre bajas de distintos animales es solo de presentación).
- **Interbloqueos:** el orden (madre, animal, lote) coincide con las operaciones existentes; los tests de concurrencia repetidos lo vigilan.
- **`migrate diff`:** da las diferencias conocidas antes y después; si aparece algo más o un `DROP`, no aplicar.

## Tabla RF → parte del plan
| RF | Parte del plan |
|---|---|
| RF-1 a RF-6 | `POST /api/animales/:id/baja`, `bajas/baja.ts`, `bajas/validacion.ts`, `FormBaja.tsx` |
| RF-7 a RF-11 | `POST /api/animales/:id/revertir-baja`, `bajas/revertir.ts`, `bloqueo.ts`, `FormRevertirBaja.tsx` |
| RF-12, RF-13 | `GET /api/bajas` y `GET /api/bajas/:id`, `Bajas.tsx`, `BajaFicha.tsx` |
| RF-14 | `bajas/numero-de-baja.ts` y avisos en alta, edición y planilla (API y web) |
| RF-15 | `leerFicha`, `eventos.ts`, `anular.ts`, ciclos en `animales-edicion.ts`, alta y planilla con bloqueo de madre |
| RF-16 | Bloqueos de las rutas, índice único parcial, disparador diferido y `bajas-concurrencia.test.ts` |
| RF-17 | `app.ts` (sesión y rol antes de los parsers) y filtros por `establecimientoId` de la sesión |
| RF-18 | Migración `bajas_base` (CHECK, índices, clave compuesta, disparador) y `base-bajas.test.ts` |
| RF-19 a RF-21 | Interfaz (`Layout.tsx`, páginas, formularios, estilos) y verificación en el navegador |
