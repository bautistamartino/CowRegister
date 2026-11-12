# Plan — 008 Producción: litros por vaca e informe de leche

Spec: [spec.md](spec.md)

## Resumen
Una tabla nueva `producciones` (un registro = litros de una vaca en un ordeño) que **solo se agrega**: se anula con motivo y nunca se borra ni se edita. La API tiene cuatro rutas nuevas en torno a la vaca (cargar, anular, leer la ficha activa, leer la ficha de baja) y una de informe. El informe **se calcula en la base con agregaciones SQL** (no en TypeScript fila por fila) porque el volumen es mucho mayor que el de la spec 007. La web suma la sección "Producción" en las dos fichas y el informe "Litros de leche" en `/informes`. Sin dependencias nuevas.

## Base de datos

### Modelo nuevo `Produccion` (tabla `producciones`) y enum `TurnoOrdeno`
- `enum TurnoOrdeno { MANANA TARDE }` (el orden del enum hace que `ORDER BY turno DESC` ponga la tarde antes que la mañana).
- Columnas: `id` (UUID, `@default(uuid(7))`; si el cliente manda un `id` se usa ese), `establecimientoId`, `animalId`, `fecha` (`@db.Date`), `turno`, **`litrosDecimas` (entero, litros × 10)**, `loteId` (UUID **sin clave foránea**, nulo = "Sin lote"), `loteNombre` (texto copiado, nulo = "Sin lote"), `registradoPorId`, `creadoEn`, `actualizadoEn` (`@updatedAt`), y las tres columnas de anulación (`anuladoEn`, `anuladoPorId`, `motivoAnulacion`).
- Claves foráneas compuestas, como `Evento`: `(establecimientoId, animalId)` → `Animal`, `(establecimientoId, registradoPorId)` y `(establecimientoId, anuladoPorId)` → `Usuario`, todas `ON DELETE RESTRICT`. Así un registro nunca apunta a una vaca o usuario de otro tambo. Se agregan las relaciones inversas en `Animal`, `Usuario` y `Establecimiento`.
- Índices de Prisma: `@@index([establecimientoId, fecha])` (informe: **el índice que pedían las notas de la spec**; normal y no parcial para que `migrate diff` siga limpio) y `@@index([animalId, fecha, turno])` (ficha de la vaca).

### SQL a mano en la migración `produccion_base` (con comentarios)
- **Índice único parcial** `producciones_un_vigente_por_ordeno` sobre `(animalId, fecha, turno) WHERE "anuladoEn" IS NULL`: una sola carga vigente por ordeño; con dos cargas simultáneas la segunda falla en la base (RF-6, RF-28). Es un índice y no un conteo en el código por la misma razón que `bajas_una_vigente_por_animal`.
- **CHECK**: `producciones_litros_rango` (`litrosDecimas BETWEEN 0 AND 999`), `producciones_fecha_minima` (`fecha >= '2000-01-01'`), `producciones_anulacion_completa` (las tres columnas nulas o las tres con valor), `producciones_motivo_largo` (motivo nulo o de 1 a 200 caracteres y igual a su `btrim`), `producciones_lote_coherente` (`loteId` y `loteNombre` ambos nulos o ambos con valor; nombre no vacío).
- **Disparador `producciones_solo_agregar`** (constitución §3): `BEFORE DELETE` siempre falla; `BEFORE UPDATE` solo deja pasar el paso "no anulado → anulado" (la fila vieja debe tener `anuladoEn` nulo) y exige que todas las demás columnas queden iguales salvo las tres de anulación y `actualizadoEn`. `TRUNCATE` no lo dispara, así que `limpiarBase` sigue andando (igual que `cambios_animal`).
- Se arma con `npm run db:migrate -w api -- --name produccion_base`. Si `migrate dev` no corre en el entorno no interactivo, se crea la carpeta a mano y se aplica con `prisma migrate deploy` (decisión de la spec 001). Del SQL que genere `migrate diff` se **quitan las tres claves foráneas de lote previo** (`DROP`/`ADD` de bajas, partos y secados) que ya vienen arrastradas.
- **`migrate diff` esperado después:** las mismas TRES claves foráneas de lote previo de siempre (`SET NULL (columna)`) y, además, la propuesta de `DROP INDEX producciones_un_vigente_por_ordeno` (Prisma no modela índices parciales). **Ninguna de las dos se aplica.**

### Sin migración de datos
No hay registros viejos: la tabla nace vacía. Los tambos existentes no necesitan nada.

## API
Todas filtran por el `establecimientoId` de la sesión; el del cuerpo o la query se descarta. Sesión y rol de las rutas de escritura se controlan en `app.ts` **antes** de los parsers de JSON (401 y 403 aunque el JSON venga roto, patrón de las specs 004 a 006).

| Método y ruta | Rol | Qué hace | RF |
|---|---|---|---|
| `POST /api/animales/:id/produccion` — `{ fecha, turno: "manana"\|"tarde", litros, id? }` | dueño, encargado | Carga un registro. 201 con el registro (también en la repetición idempotente). | RF-1 a RF-8, RF-27, RF-28, RF-34, RF-35, RF-37 |
| `POST /api/animales/:id/produccion/:registroId/anular` — `{ motivo }` | dueño, encargado | Anula un registro de una vaca activa. 200 con el registro. | RF-9 a RF-11, RF-25, RF-27, RF-36 |
| `GET /api/animales/:id/produccion` | los tres | Ficha de la vaca **activa**: registros (hasta 200), total, promedio de 30 días, último registro, sugerencia de fecha y turno. | RF-12 a RF-16, RF-30 |
| `GET /api/bajas/:id/produccion` | los tres | Lo mismo para un animal de baja por venta o muerte (sin sugerencia). 404 si es activo. | RF-33 |
| `GET /api/informes/leche?desde&hasta` | los tres | Informe del período. | RF-17 a RF-25, RF-37 |

### Cómo se resuelven los puntos de la spec
- **Orden de controles al cargar:** 401, 403 → cuerpo (zod: `litros`, `fecha` no futura con `ahora()`/`hoyArgentina`, `turno`, `id` UUID) 400 → id de animal mal formado, inexistente, ajeno o de baja 404 → **dentro de la transacción**, con la vaca bloqueada: (1) repetición idempotente por `id`, (2) 409 por estado (macho, vaquillona, seca, recién nacida; mensaje con el motivo), (3) 409 por duplicado vaca–fecha–turno. Es la misma forma que `bajas.ts`.
- **Bloqueo (RF-35):** `bloquearAnimal` (`SELECT ... FOR UPDATE`, ya existente en `reproduccion/bloqueo.ts`) devuelve sexo, estado y `loteId` con la fila bloqueada, que es lo que se guarda en el registro; el nombre del lote se lee dentro de la misma transacción. El choque de unicidad en la base (`P2002`) se captura **fuera** de la transacción y se traduce a 409 (nunca 500).
- **`id` del cliente (RF-34):** dentro de la transacción se busca el `id` en toda la tabla. Si existe con la misma vaca, fecha, turno y litros del mismo tambo, se devuelve ese registro (201). Si existe con otros datos o de otro tambo, 409 con un mensaje genérico. Un choque simultáneo de la clave primaria cae en el `P2002` de arriba y también da 409.
- **Litros (RF-2, RF-3, RF-37):** el cuerpo acepta un número JSON o un texto con forma `d`, `dd`, `d.d` o `dd.d`; se convierte a **décimas enteras** con aritmética de enteros sobre el texto (nunca `parseFloat` ni multiplicar un decimal por 10). Un número JSON se pasa por su representación en texto (`String(n)`) y se rechaza si tiene notación científica, más de un decimal o está fuera de 0 a 99,9. En las respuestas, `litros` es un número de un decimal (`litrosDecimas / 10`).
- **Anular (RF-9, RF-10, RF-36):** en una transacción: `bloquearAnimal` (404 si es de baja, ajeno o inexistente; **no** pide que esté en ordeñe, así se puede anular el de una vaca seca) → se busca el registro por `id`, `animalId` y `establecimientoId` (404 si no) → si ya está anulado, 409 → se completan las tres columnas de anulación. Como las dos anulaciones simultáneas esperan el bloqueo de la vaca, la segunda ve el registro anulado y da 409. El motivo usa el `motivoAnulacionSchema` existente (200 caracteres sin contar los extremos, "solo espacios" = 400), por lo que el 400 sale antes que el 404.
- **Ficha (RF-12 a RF-16, RF-30):** una lectura con los registros ordenados por `fecha DESC, turno DESC, creadoEn DESC` y tope `topeProduccionFicha()` (200). Los nombres de quien cargó y anuló se leen con `select` explícito (nunca el id de usuario ni el email). `ultimoRegistro` es una consulta aparte: el más reciente no anulado (no depende del tope). El promedio de 30 días usa la ventana `[hoy-29, hoy]` en hora de Argentina, sobre registros no anulados, con aritmética de enteros. **La sugerencia `{ fecha, turno }` la calcula la API** (hoy argentino y mañana antes de las 14:00, tarde desde las 14:00, con `ahora()`): así la hora por defecto se prueba con `fijarReloj` y no depende de la zona del navegador (RF-30).
- **Informe (RF-17 a RF-25):** ver la decisión siguiente. Con el período válido (`periodoSchema` y `validarPeriodo` de la 007, sin cambios) se ejecutan **cinco agregaciones en una sola transacción de lectura consistente** (`RepeatableRead`) sobre registros no anulados del tambo con `fecha` en el período: resumen, por lote, por vaca (con join a `animales` para número, estado y motivo de baja), por día y turno. La suma es de enteros (décimas) y se pasa a texto en SQL para no perder bits.
  - Por vaca: se traen **todas** las vacas con registros (una fila por vaca, del orden de los miles), se ordenan en TypeScript por **promedio exacto** (comparación cruzada de enteros `suma_a × días_b` contra `suma_b × días_a`, sin redondear) y, en empate, por `compararNumeros` (orden natural, `animales/orden.ts`), y se corta en `topeInforme()` (2.000) con `totalDetalle`, `truncado` y `tope`.
  - Por lote: se agrupa por `loteId` (nulo = "Sin lote"); el nombre mostrado es el del registro **más reciente** del grupo, así un lote renombrado no se parte en dos filas. Vacas distintas y vaca-días se cuentan por (vaca, día, lote).
  - Por día: sin tope (máximo 1.827 filas con 5 años); litros del día, de la mañana y de la tarde y vacas ordeñadas.
  - Promedios: `redondearDecimas(suma, base) = floor((2·suma + base) / (2·base))` en enteros (medio punto hacia arriba exacto), dividido por 10 para mostrar; `null` si la base es 0. El 0,1 + 0,2 = 0,3 sale de sumar enteros (1 + 2 = 3).
- **Montaje (`app.ts`):** `app.get('/api/animales/:id/produccion', requiereSesion)`, `app.post([...'/:id/produccion', '/:id/produccion/:registroId/anular'], requiereSesion, requiereRol('DUENO','ENCARGADO'))` antes de los parsers; `rutasProduccion` (activos) montado en `/api/animales` antes de `rutasAnimales`, `rutasProduccionBaja` en `/api/bajas` antes de `rutasBajas`, y `rutasInformes` suma `GET /leche`. `/api/informes` y `/api/bajas` ya tienen `requiereSesion`.

## Interfaz

### Ficha de la vaca activa (`AnimalFicha.tsx`) y ficha de baja (`BajaFicha.tsx`)
- Componente `Produccion` (sección propia, después de "Historial"; el historial no cambia, RF-16). Recibe `animalId`, `contexto` (`"animales"` o `"bajas"`), `rol` y una `version` para recargar.
- **Hembra en ordeñe, dueño o encargado:** formulario con fecha (por defecto la sugerida por la API), turno (dos botones "Mañana" / "Tarde" de 48 px, el sugerido seleccionado y cambiable), litros (campo con `inputMode="decimal"`; la coma se convierte a punto antes de enviar) y "Guardar". Arriba, número de la vaca, su lote y su último registro (RF-7). Al guardar bien: mensaje de confirmación y **vuelta al buscador por número** (navegar a la pantalla de Animales con el buscador enfocado, igual que el flujo del bastón).
- **Lista de registros** (tabla o tarjetas que se adaptan a 375 px): fecha, turno, litros, quién, anulados tachados con "Anulado por … el … — motivo". "Anular" abre un pequeño formulario con el motivo (solo dueño y encargado, solo en registros no anulados, **también si la vaca está seca**). Promedio de 30 días arriba de la lista ("—" si no hay). Vacío: "Todavía no hay producción registrada". Más de 200: el aviso de tope.
- **Vaca que no está en ordeñe** (seca, etc.): sin formulario, con la explicación (RF-15). **Veterinario y ficha de baja:** solo lectura (sin formulario ni "Anular").
- Los mensajes 409 de la API (estado o duplicado) se muestran tal cual en el formulario.

### Informes (`/informes`)
- `Informes.tsx` suma el botón "Litros de leche" al selector. Cuando está elegido, el **período por defecto es el mes en curso hasta hoy** (el período vive en la pantalla; al cambiar de informe se conserva el que haya, y el valor inicial depende del informe en que se entra: se resuelve con `periodoPorDefectoLeche()` en `web/src/informes.ts`).
- `InformeLeche.tsx`: resumen (total, ordeños, vacas distintas, promedio por vaca-día y por ordeño), tabla por lote (con la nota de que vacas y vaca-días por lote pueden sumar más que el total), por vaca (número con enlace a su ficha activa o de baja, aviso "Se muestran las 2.000 primeras de N") y por día (con mañana y tarde). Vacío: "No hay producción registrada en este período". Reutiliza `PeriodoInforme`, `useInforme` y las piezas de `PiezasInforme.tsx`.
- Todo a 768 y 375 px sin scroll horizontal de la página (las tablas desplazan por dentro), campos de 48 px, modo claro y oscuro.

## Archivos
- Crear (API): `api/prisma/migrations/<fecha>_produccion_base/migration.sql`; `api/src/produccion/validacion.ts` (esquema de carga, litros a décimas, turno), `api/src/produccion/cargar.ts`, `api/src/produccion/anular.ts`, `api/src/produccion/leer.ts` (ficha y promedio de 30 días), `api/src/produccion/sugerencia.ts` (fecha y turno por hora argentina), `api/src/produccion/formato.ts` (décimas ↔ litros, `redondearDecimas`), `api/src/rutas/produccion.ts` (activos y baja), `api/src/informes/leche.ts` (las agregaciones SQL y el armado de la respuesta).
- Modificar (API): `api/prisma/schema.prisma` (modelo y enum, relaciones inversas), `api/src/app.ts` (sesión y rol antes de los parsers y montaje), `api/src/rutas/informes.ts` (`GET /leche`), `api/src/topes.ts` (`topeProduccionFicha()` = 200, con `fijarTopes({ produccionFicha })`), `api/tests/ayudas.ts` (`producciones` en el `TRUNCATE` de `limpiarBase`).
- Crear (tests): `api/tests/base-produccion.test.ts`, `produccion-puro.test.ts`, `produccion.test.ts`, `produccion-anular.test.ts`, `produccion-ficha.test.ts`, `produccion-concurrencia.test.ts`, `informes-leche.test.ts`.
- Crear (web): `web/src/componentes/Produccion.tsx`, `web/src/componentes/InformeLeche.tsx`, `web/src/produccion.ts` (formato de litros y turno).
- Modificar (web): `web/src/api.ts` (tipos), `web/src/paginas/AnimalFicha.tsx` y `BajaFicha.tsx` (sección), `web/src/paginas/Informes.tsx`, `web/src/informes.ts` (período por defecto de leche), `web/src/estilos.css`.
- Modificar (docs, en el cierre): `MEMORY.md`, `docs/plan.md`.

## Decisiones
- **Litros como entero en décimas (`litrosDecimas`)** — elegida porque la suma y la comparación son exactas con enteros de JavaScript y de PostgreSQL, y el CHECK de rango (0 a 999) es trivial. Alternativa descartada: `Decimal(3,1)`: Prisma devuelve objetos `Decimal` que habría que sumar y comparar con una librería, y el redondeo "medio hacia arriba" sobre valor exacto se complica sin ganar nada.
- **El informe se calcula con agregaciones SQL en la base** — elegida porque el volumen es de otro orden que los informes de la 007: un tambo de 150 vacas con dos ordeños son unas 110.000 filas por año y hasta ~550.000 en el período máximo de 5 años; traerlas todas a Node para sumarlas sería lento y costoso. Con `GROUP BY` la base devuelve a lo sumo una fila por vaca (miles), por día (≤ 1.827) y por lote (pocos). El **límite claro** es de salida, no de lectura: el desglose por vaca corta en `topeInforme()` (2.000) y los demás desgloses están acotados por su propia naturaleza. Es una **excepción explícita al criterio de "informes en TypeScript" de la 007**, que se justifica por el volumen; el armado (orden por promedio exacto, redondeo, enlaces) sigue en TypeScript con funciones puras. Alternativa descartada: leer filas con Prisma y agregar en TypeScript: rápido de escribir, pero explota en memoria con tambos grandes.
- **Índice `(establecimientoId, fecha)` normal y no parcial** — elegida para que `migrate diff` siga limpio y porque el filtro por `anuladoEn` es barato sobre el rango ya acotado. Alternativa descartada: índice parcial `WHERE anuladoEn IS NULL`: ahorra poco y sumaría otro objeto a mano que `migrate diff` propondría borrar.
- **Lote del registro como copia (`loteId` sin clave + `loteNombre`)** — elegida porque la spec exige que el nombre se conserve aunque se elimine el lote, como `CambioAnimal` (spec 005): una clave con `ON DELETE SET NULL` perdería el dato y una con `RESTRICT` impediría eliminar lotes. Alternativa descartada: clave foránea al lote: contradice la spec.
- **Anular con la vaca bloqueada (`bloquearAnimal`)** — elegida porque ya existe, serializa dos anulaciones simultáneas (RF-36) y también las cargas, y no exige estado en ordeñe. Alternativa descartada: `UPDATE ... WHERE anuladoEn IS NULL` y mirar cuántas filas cambió: también sería correcto, pero repetiría un patrón distinto al de todas las demás operaciones del proyecto.
- **La API calcula la sugerencia de fecha y turno** — elegida porque la web no tiene tests automáticos y la regla de las 14:00 hora argentina debe poder probarse con `fijarReloj`. Alternativa descartada: calcularla en el navegador: dependería de la zona del dispositivo y solo se podría probar a mano.
- **Rutas anidadas bajo el animal para cargar y anular** (`/api/animales/:id/produccion/...`) — elegida porque obliga a que el registro sea de esa vaca y de ese tambo (404 idéntico si no), y porque sigue el patrón de partos y secados. Alternativa descartada: `/api/produccion/:id/anular` suelta: bastaría el id del registro, pero el de otra vaca no daría 404 como pide la spec.
- **`turno` en la API como `"manana"` / `"tarde"`** — elegida para evitar la eñe en el contrato; la pantalla muestra "Mañana". Alternativa descartada: `"mañana"` en el JSON: funciona, pero invita a errores de normalización de texto.
- **La respuesta idempotente es un 201 igual al de la primera carga** — elegida porque la spec pide que responda "igual que si hubiera salido bien". Alternativa descartada: 200 para distinguir la repetición: obliga al cliente (la sincronización de la Etapa 6) a tratar dos códigos como éxito.
- **Validación del período duplicada en la web** — se reutiliza `web/src/informes.ts` tal cual; solo cambia el período por defecto. Si cambian las reglas de período, hay que cambiarlas en la API y en la web (misma nota que en la 007).

## Estrategia de tests
Tests primero (Vitest + supertest sobre `cowregister_test`; `fijarReloj` y `fijarTopes` para el "hoy", la hora del turno y los topes). La web no tiene tests automáticos: se verifica en el navegador (768 y 375 px, claro y oscuro), solo en las tareas visuales.

| RF | Test (archivo › caso) |
|---|---|
| RF-1, RF-8 | `produccion.test.ts` › carga válida de dueño y encargado guarda quién y el lote al cargar (con lote y sin lote); el lote queda igual tras mover a la vaca y tras eliminar el lote |
| RF-2, RF-3, RF-37 | `produccion-puro.test.ts` › litros válidos ("5.0", 99.9, 0, número JSON) y rechazados ("5.00", "5,0", "5.", ".5", "1e1", "+5", -1, 100, 99.95, vacío, tipos raros); décimas exactas; `redondearDecimas` (12,25 → 12,3; 0,1+0,2 = 0,3; sin base `null`) |
| RF-4 | `produccion.test.ts` › 400 por fecha inexistente, futura (con `fijarReloj` a las 22:00 ART), anterior a 2000, turno inválido, `id` que no es UUID; hoy se acepta; fecha anterior al nacimiento se acepta |
| RF-5 | `produccion.test.ts` › 404 idéntico para inexistente, ajeno, mal formado y de baja; 409 con motivo propio para macho, vaquillona, seca y recién nacida; sin guardar nada |
| RF-6, RF-28 | `produccion.test.ts` › duplicado 409; tras anular se puede recargar; `base-produccion.test.ts` › índice único parcial, CHECK de rango, fecha, turno (enum), anulación completa, motivo y lote, y los disparadores (no se puede borrar ni editar; solo anular) probados con `session_replication_role = replica` donde haga falta |
| RF-7, RF-13, RF-14, RF-30 | `produccion-ficha.test.ts` › `ultimoRegistro` (más reciente por fecha y turno, no anulado, `null` sin registros, independiente del tope), promedio de 30 días con la ventana exacta y "—" sin datos, tope de 200 con `fijarTopes`, `sugerencia` a las 13:59 y 14:00 ART y con el reloj en el día UTC siguiente |
| RF-9, RF-10, RF-11, RF-36 | `produccion-anular.test.ts` › anula y guarda quién, cuándo y motivo; motivo vacío, solo espacios o de 201 caracteres 400; de 200 se acepta; ya anulado 409; registro de otra vaca, de otro tambo, inexistente o mal formado 404 idéntico; vaca de baja 404; **vaca seca: se permite**; recarga posterior |
| RF-12, RF-15, RF-16 | `produccion-ficha.test.ts` › orden por fecha y turno (tarde antes que mañana), anulados visibles con quién, cuándo y motivo, vaca seca devuelve sus registros, el historial de la 007 no incluye producción |
| RF-33 | `produccion-ficha.test.ts` › la ficha de baja da lo mismo en solo lectura; un activo da 404 en la ruta de bajas y un animal de baja da 404 en la de activos; baja revertida vuelve a mostrar sus registros con el lote original |
| RF-17 a RF-21, RF-25 | `informes-leche.test.ts` › resumen, desglose por lote (lote al cargar, "Sin lote", vaca con dos lotes el mismo día), por vaca y por día (con turnos y vacas ordeñadas); anulados fuera; bajas dentro; período sin registros; anular cambia el siguiente cálculo |
| RF-19 | `informes-leche.test.ts` › orden por promedio exacto (dos promedios que se redondean igual pero difieren) y empate por número en orden natural (A2 antes que A10) |
| RF-23, RF-24 | `informes-leche.test.ts` › períodos inválidos 400 (mismos casos que `informes-periodo.test.ts`: falta, repetido, futuro, más de 5 años, etc.), `establecimientoId` en la query ignorado; tope de 2.000 con `fijarTopes` aviso y totales completos |
| RF-26 | los cinco archivos de rutas › aislamiento entre dos tambos por **cada** ruta (carga, anulación con sus tres casos cruzados, ficha activa, ficha de baja, informe), `establecimientoId` en cuerpo y query ignorado |
| RF-27 | `produccion.test.ts`, `produccion-anular.test.ts`, `produccion-ficha.test.ts`, `informes-leche.test.ts` › veterinario 403 con el mensaje exacto al cargar y al anular, y 200 al leer; sin sesión 401 (también con JSON roto); orden 401, 403, 400, 404, 409 por estado, 409 por duplicado; las respuestas no incluyen hashes ni ids de usuario |
| RF-29 | `base-produccion.test.ts` › id UUID, `creadoEn` y `actualizadoEn`; se acepta el id del cliente |
| RF-34 | `produccion.test.ts` › mismo `id` y mismos datos: 201 y un solo registro; mismo `id` con otros datos: 409; mismo `id` de otro tambo: 409 genérico |
| RF-35 | `produccion-concurrencia.test.ts` › `Promise.all` de dos cargas del mismo ordeño: una 201 y una 409 (nunca 500); carga y cambio de estado simultáneos no guardan una carga de una vaca seca |
| RF-36 | `produccion-concurrencia.test.ts` › `Promise.all` de dos anulaciones del mismo registro: una 200 y una 409 |
| RF-22, RF-31, RF-32 | Navegador (T4): selector, período por defecto del mes en curso, descarte de respuesta vieja, "Calculando…", errores, 48 px, 768 y 375 px, claro y oscuro |
| RF-7 (pantalla), RF-12, RF-15, RF-30, RF-32 | Navegador (T3): formulario, vuelta al buscador, lista y anulación, vaca seca, veterinario y ficha de baja en solo lectura |

## Riesgos
- **Rendimiento del informe:** depende del índice `(establecimientoId, fecha)` y de que las agregaciones corran en una sola transacción de lectura. Se verifica en T2 con un tambo de prueba de volumen razonable (miles de registros) midiendo que responda en un tiempo cómodo; si no, el plan de respaldo es agregar un índice cubriente con `animalId`.
- **SQL en el informe:** rompe el criterio "informes en TypeScript" de la 007 (decisión explícita y justificada arriba). Las consultas llevan `establecimientoId` de la sesión como parámetro (nunca interpolado) y tienen test de aislamiento.
- **`migrate diff`:** queda la propuesta de borrar el índice parcial y las tres claves de lote previo; no aplicarlas (se anota en `MEMORY.md`).
- **Modo sin conexión (Etapa 6):** el `id` del cliente y la idempotencia dejan la puerta abierta, pero dos cargas del mismo ordeño hechas sin conexión en dispositivos distintos seguirán chocando con 409; se resuelve en la sincronización. Igual que el riesgo del reloj de las specs 003 y 005.
- **Lote copiado:** si se renombra un lote, los registros viejos conservan el nombre anterior; el informe muestra el del registro más reciente del grupo. Es lo que pide la spec ("conserva el lote con su nombre").
- **Anular una carga de una vaca activa en estado distinto de ordeñe y la baja revertida:** probados en `produccion-anular.test.ts` y `produccion-ficha.test.ts`.

## Tabla RF → parte del plan
| RF | Parte del plan |
|---|---|
| RF-1 a RF-8 | Modelo `Produccion`, `produccion/cargar.ts` y `validacion.ts`, ruta POST de carga; T1 |
| RF-9 a RF-11, RF-36 | `produccion/anular.ts`, ruta POST de anulación; T1 |
| RF-12 a RF-16, RF-33 | `produccion/leer.ts`, rutas GET de ficha activa y de baja, `Produccion.tsx`; T1 y T3 |
| RF-17 a RF-25 | `informes/leche.ts`, `GET /api/informes/leche`, `InformeLeche.tsx`; T2 y T4 |
| RF-26, RF-27 | Cada ruta y `app.ts` (sesión y rol antes de los parsers); T1 y T2 |
| RF-28, RF-29 | SQL a mano de la migración y columnas del modelo; T1 |
| RF-30 | `produccion/sugerencia.ts` y `Produccion.tsx`; T1 y T3 |
| RF-31, RF-32 | `Informes.tsx`, `InformeLeche.tsx`, `Produccion.tsx`, `estilos.css`; T3 y T4 |
| RF-34, RF-35 | `produccion/cargar.ts` (idempotencia y bloqueo); T1 |
| RF-37 | `produccion/formato.ts` y las agregaciones en enteros; T1 y T2 |
