# Plan — 007 Historial por animal e informes

Spec: [spec.md](spec.md)

## Resumen
Todo es **lectura**: no hay tablas ni columnas nuevas. El historial único se arma en la API a partir de lo que ya existe (`leerEventos` + `CambioAnimal`) y se expone con una ruta nueva por contexto (animales activos y bajas); la web reemplaza las dos listas actuales por un componente `Historial`. Los informes son dos rutas de solo lectura en `/api/informes` que calculan en TypeScript con funciones puras (el mismo estilo que `situacion.ts`: "se calcula al leer"). Sin dependencias nuevas.

> **AVISO — este plan incluye UNA migración (un índice).** Los informes leen eventos de **todo el tambo** filtrando por tambo, tipo y fecha, y hoy el único índice de fecha de `eventos` empieza por `animalId` (no sirve para esa consulta). Se agrega `@@index([establecimientoId, tipo, fecha])` en `Evento` con una migración de Prisma (`informes_indice_eventos`, un solo `CREATE INDEX`, sin SQL a mano ni cambios de datos). Va en la **T2**. No cambia ninguna regla ni dato; si el responsable prefiere no tocar la base, se puede quitar sin afectar nada más (las consultas andan igual, más lentas con el tiempo). No se fija ningún criterio de rendimiento.

## Base de datos
- **Sin modelos nuevos.** Solo el índice de arriba: `@@index([establecimientoId, tipo, fecha])` en `Evento` (`schema.prisma`) y su migración creada con `npm run db:migrate -w api -- --name informes_indice_eventos`.
- `migrate diff` (en `api/`, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`) debe dar **solo** las tres claves foráneas de lote previo conocidas (MEMORY.md) antes y después; no aplicar esa propuesta ni borrar nada hecho a mano.
- Los cambios manuales y los eventos ya guardan `creadoEn` (orden total) y el nombre de quien registró (`registradoPor`, `usuarioNombre`): alcanza para el historial.

## API
Todas son GET, solo lectura, para los tres roles. Sesión antes de los parsers (`app.ts`), igual que las demás.

| Método y ruta | Rol | Qué hace | RF |
|---|---|---|---|
| `GET /api/animales/:id/historial` | los tres | Historial único de un animal **activo** (hembra o macho): eventos (con anulaciones y bajas revertidas) + cambios manuales, orden fecha y registro descendente, tope de 500 con `total`/`truncado`, y `ultimoEventoNoAnuladoId`. 404 idéntico si es de baja, ajeno, inexistente o mal formado. | RF-1 a RF-5, RF-17 a RF-19 |
| `GET /api/bajas/:id/historial` | los tres | Lo mismo para un animal de baja por venta o muerte del tambo (misma condición que `GET /api/bajas/:id`). 404 idéntico para activo, ajeno, inexistente, mal formado o "parto anulado". | RF-1, RF-2, RF-3, RF-5, RF-18, RF-19 |
| `GET /api/informes/inseminacion?desde&hasta` | los tres | Resumen, desglose por semen o toro y detalle de servicios del período. 400 si el período es inválido. | RF-7 a RF-10, RF-14 a RF-19 |
| `GET /api/informes/natalidad?desde&hasta` | los tres | Resumen y detalle de partos del período. 400 si el período es inválido. | RF-11 a RF-19 |

**Formas de respuesta (contrato para la web):**
- Historial: `{ total, truncado, tope, ultimoEventoNoAnuladoId: string | null, entradas: Entrada[] }`. Cada entrada es `{ clase: 'EVENTO', fecha, registradoEn, evento }` (con el `evento` ya armado por `armarEvento`, el mismo de `/eventos`, incluido `anulacion` y `baja`) o `{ clase: 'CAMBIO', fecha, registradoEn, cambio: { id, campo, valorAnterior, valorNuevo, usuarioNombre } }`. `fecha` es `AAAA-MM-DD`: la del evento (aunque esté anulado) o el **día argentino** de `creadoEn` del cambio. `ultimoEventoNoAnuladoId` es el último evento no anulado que no es baja (el único anulable), calculado **antes** de cortar por el tope.
- Inseminación: `{ periodo: { desde, hasta }, resumen, porSemen: Fila[], detalle: Servicio[], totalDetalle, truncado, tope }`. `resumen` y cada fila de `porSemen` = `{ total, prenadas, vacias, sinTacto, base, porcentajePrenez: number | null }` (`base` = prenadas + vacías; `null` = "—"); las filas de `porSemen` llevan además `semen: { id, nombre } | null` (`null` = "No especificado", con el nombre **actual**). Cada servicio del detalle: `{ servicioId, fecha, tipoServicio, semen, resultado: 'PRENADA_TACTO' | 'PRENADA_PARTO' | 'VACIA' | 'SIN_TACTO', animal: { id, numero, activo, motivoBaja } }`.
- Natalidad: `{ periodo, resumen: { partos, criasVivas: { total, hembras, machos }, criasMuertas: { total, hembras, machos }, mellizos, porcentajeNacidasMuertas: number | null }, detalle: Parto[], totalDetalle, truncado, tope }`. Cada parto: `{ partoId, fecha, vaca: { id, numero, activo, motivoBaja }, crias: [{ orden, sexo, nacidaMuerta, animal: { id, numero, activo, motivoBaja } | null }] }`. `motivoBaja` con el mismo formato que `CriaDeParto` (`'venta' | 'muerte' | 'parto_anulado' | null`); en la práctica los informes solo ven `venta` o `muerte`.

**Reglas de cálculo (todas en funciones puras, sin base):**
- `api/src/informes/periodo.ts`: `periodoSchema` (zod: `desde` y `hasta` obligatorios y **string**, así un parámetro repetido —que Express entrega como arreglo— o ausente da 400; lo demás de la query, como `establecimientoId`, se descarta) y `validarPeriodo(desde, hasta, hoy)` con los mensajes en español en este orden: formato y existencia (reusa `esFechaValida`), `desde` ≤ `hasta`, `hasta` no futura, `desde` ≥ 2000-01-01 y rango máximo = `desde` + 5 años − 1 día (29/02 + años → 28/02; reusa `sumarDias`).
- `api/src/informes/porcentaje.ts`: `porcentajeEntero(n, d)` = `null` si `d = 0`, si no `Math.floor((200 * n + d) / (2 * d))` (medio punto hacia arriba con enteros, sin errores de coma flotante: 1/8 → 13, 2/3 → 67).
- `api/src/informes/resultado-servicio.ts`: `resultadoDeServicio(servicio, eventosDeLaVaca)` con los eventos **no anulados** de la vaca ordenados con `ordenarEventos` (orden total fecha + `creadoEn`): tramo = entre el servicio y el siguiente servicio o parto no anulado (excluidos); primer tacto del tramo manda (`PRENADA_TACTO` o `VACIA`); sin tacto, si algún parto no anulado tiene `servicioId` = ese servicio → `PRENADA_PARTO`; si no, `SIN_TACTO`. Los tactos fuera de un tramo de servicio no se miran.
- `api/src/informes/inseminacion.ts` y `natalidad.ts`: la lectura y el armado de las respuestas (ver T2).
- `api/src/historial/historial.ts`: `armarHistorial(filas, cambios, totalCambios, hoy, tope)` pura: reusa `armarRespuesta` para los eventos (así `fechaProbable` de los tactos y la genética salen igual que hoy), pasa cada cambio a su día argentino con `hoyArgentina(creadoEn)`, ordena por `fecha` desc, `registradoEn` desc y, para los cambios de un mismo guardado (mismo `creadoEn`), por `campo` y `id` para que el orden sea estable, y corta en el tope.
- `api/src/topes.ts` (nuevo, como `reloj.ts`): `topeHistorial()` = 500 y `topeInforme()` = 2.000, más `fijarTopes({ historial?, informe? } | null)` **solo para tests**. No se lee de una variable de entorno ni de la petición (no abre un hueco en producción).

**Lecturas (`select` explícito, solo nombres, nunca hashes):**
- Historial: `leerEventos` (todos los eventos del animal, pocos) + `cambioAnimal.count` + `cambioAnimal.findMany` de los `tope` más nuevos por `creadoEn` (un cambio fuera de esos `tope` nunca entraría en las `tope` entradas más recientes). `total` = eventos + total de cambios.
- Inseminación: (1) servicios no anulados del tambo con fecha en el período (`animalId`, semen, tipo); (2) **una sola** lectura de los eventos no anulados de tipo servicio, tacto y parto del tambo con `fecha >= desde` y **sin tope superior** (tactos y partos posteriores al período cuentan: el resultado se mide a hoy), agrupados por vaca en memoria; (3) nombres actuales de los semen y datos (`numero`, `estado`, `motivoBaja`) solo de las vacas de las filas del detalle. Totales y desglose se calculan con **todos** los servicios; solo el detalle se corta en `topeInforme()`.
- Natalidad: partos no anulados del tambo con fecha en el período, con sus crías y los animales (vaca y crías vivas); totales con todo, detalle cortado en `topeInforme()`.
- Ambos filtran siempre por `establecimientoId` de la sesión (el cliente no manda nada de tambo).

**app.ts:** `app.get('/api/animales/:id/historial', requiereSesion)` y `app.use('/api/informes', requiereSesion)` junto a los demás controles previos; `app.use('/api/informes', rutasInformes)` y `rutasHistorial` montado **antes** de `rutasAnimales` (para `/api/animales/:id/historial`) y la ruta de bajas en `/api/bajas`. Las rutas viejas (`/eventos`, `/cambios`, `GET /api/bajas/:id`) **no cambian**.

## Interfaz
- **Historial único** (`componentes/Historial.tsx`), una sola sección "Historial" en `AnimalFicha` (hembra y macho) y en `BajaFicha`. Reemplaza la lista de eventos que hoy está dentro de `Reproduccion` y la sección "Cambios manuales" (`HistorialCambios`). Cada entrada de evento se dibuja con la fila de evento que ya existe (marcas "Anulado" y "Revertida", detalle de parto, secado y baja), y cada cambio manual con una fila marcada "Cambio manual" (dato, valor anterior → nuevo, quién y día/hora). "Anular" solo aparece en la fila cuyo id es `ultimoEventoNoAnuladoId` y con las reglas por rol de hoy (veterinario solo servicio o tacto; nunca en la ficha de baja, en una baja ni en un cambio). Aviso "Se muestran las 500 entradas más recientes de N" si `truncado`. Vacío: "Todavía no hay historial registrado".
- **Coordinación en la ficha:** `Reproduccion` sigue mostrando la situación y los formularios y **embebe** `Historial` donde estaba su lista, pasándole `alAnular`/`alRefrescar` (sus funciones actuales) y una versión que sube al registrar o anular; para el macho lo embebe `AnimalFicha`. `AnimalFicha` pasa `versionCambios` (sube al editar o mover) como parte de esa versión. `BajaFicha` lo usa sin anulación.
- **Informes** (`paginas/Informes.tsx`, ruta `/informes`, entrada "Informes" en `Layout.tsx` para los tres roles): selector entre "Resultado de inseminación" y "Natalidad" (botones de 48 px), `componentes/PeriodoInforme.tsx` (Desde, Hasta; por defecto `hasta` = hoy argentino y `desde` = mismo día del año anterior + 1 día, 29/02 → 28/02), `InformeInseminacion.tsx` e `InformeNatalidad.tsx`. Consulta solo con ambas fechas completas y válidas (validación local con las **mismas reglas y mensajes** que la API, en `web/src/informes.ts`); si no, muestra el mensaje y no consulta. Cada consulta usa el patrón `vigente` (bandera en el `cleanup` del `useEffect`) para descartar respuestas viejas; "Calculando…" mientras espera y el error sin perder el período.
- Inseminación: caja de resumen con "Preñadas", "Vacías", **"Sin tacto" bien visible** (número grande aparte) y el porcentaje con "X de Y" y la leyenda "No incluye servicios sin tacto" (o "—"); tabla de desglose por semen (con "No especificado"); detalle con "preñada por tacto", "preñada por parto (sin tacto)", "vacía", "sin tacto" y número de la vaca como enlace a `/animales/:id` (activa) o `/bajas/:id` (baja por venta o muerte).
- Natalidad: caja de resumen y detalle de partos con sus crías, mismos enlaces (a la cría viva también).
- **Tablet y celular:** tablas dentro de un envoltorio con scroll horizontal **interno** (la página no se desborda) y encabezados cortos; botones y campos de 48 px; colores con las variables de `estilos.css` en claro y oscuro. A 375 px el menú (ya con `flex-wrap`) debe seguir sin desborde con la entrada nueva.

## Archivos
- Crear (API): `api/src/topes.ts`, `api/src/historial/historial.ts`, `api/src/rutas/historial.ts`, `api/src/informes/periodo.ts`, `api/src/informes/porcentaje.ts`, `api/src/informes/resultado-servicio.ts`, `api/src/informes/inseminacion.ts`, `api/src/informes/natalidad.ts`, `api/src/rutas/informes.ts`, `api/prisma/migrations/<fecha>_informes_indice_eventos/migration.sql`.
- Crear (tests): `api/tests/historial-puro.test.ts`, `api/tests/historial.test.ts`, `api/tests/informes-periodo.test.ts`, `api/tests/informes-resultado.test.ts`, `api/tests/informes-inseminacion.test.ts`, `api/tests/informes-natalidad.test.ts`, `api/tests/base-informes.test.ts`.
- Crear (web): `web/src/componentes/Historial.tsx`, `web/src/paginas/Informes.tsx`, `web/src/componentes/PeriodoInforme.tsx`, `web/src/componentes/InformeInseminacion.tsx`, `web/src/componentes/InformeNatalidad.tsx`, `web/src/informes.ts`.
- Modificar: `api/prisma/schema.prisma` (índice), `api/src/app.ts` (sesión y montajes), `api/tests/ayudas.ts` solo si falta un helper de siembra (se reusan `crearServicioDirecto`, `crearTactoDirecto`, `crearPartoDirecto`, `crearCambioDirecto`, `crearBajaRegistradaDirecta`); `web/src/api.ts` (tipos), `web/src/App.tsx` (ruta `/informes`), `web/src/componentes/Layout.tsx` (entrada), `web/src/componentes/Reproduccion.tsx` (sale la lista, entra `Historial`), `web/src/paginas/AnimalFicha.tsx` (macho, sin `HistorialCambios`), `web/src/paginas/BajaFicha.tsx` (usa `Historial`), `web/src/estilos.css`; `MEMORY.md` y `docs/plan.md` (cierre).
- Borrar (web, quedan sin uso): `web/src/componentes/HistorialCambios.tsx`, y `ListaEventosLectura` en `Reproduccion.tsx`.

## Decisiones
- **Ruta nueva de historial por contexto** (`/api/animales/:id/historial` y `/api/bajas/:id/historial`) — elegida porque no toca nada de lo que ya funciona y respeta la regla de la 006 de que las bajas se leen solo por `/api/bajas`. Alternativa descartada: ampliar `/eventos`: hoy devuelve vacío para el macho a propósito, mezcla la situación con la lista y rompería los tests de las specs 003, 004 y 006.
- **El historial se arma en la API** — elegida para que el orden, el tope y el "último evento anulable" sean consistentes y se prueben sin navegador. Alternativa descartada: que la web pida `/eventos` y `/cambios` y los mezcle: dos topes distintos (100 de `/cambios`), el último evento no anulado podría quedar mal y la lógica no tendría tests.
- **Topes fijados por un módulo `topes.ts` con setter de tests** (como `reloj.ts`) — elegida porque permite probar el corte sin crear miles de filas y no se puede cambiar desde la API. Alternativa descartada: variable de entorno o parámetro: abre un hueco de configuración en producción sin necesidad.
- **Cambios manuales: los `tope` más nuevos + `count`** — elegida porque nunca lee de más y el resultado es exacto. Alternativa descartada: leer todos los cambios y cortar en memoria: crece sin límite con la vida del animal.
- **Informes calculados en TypeScript con funciones puras** sobre una lectura por tambo — elegida porque reusa `ordenarEventos` (orden total), sigue el principio "se calcula al leer" y se prueba sin base. Alternativa descartada: una consulta SQL con funciones de ventana por vaca: más difícil de leer y de probar para quien está aprendiendo, y duplicaría la regla de orden total.
- **Una lectura de eventos del tambo desde `desde` (sin tope superior)** — elegida porque el resultado se mide a hoy y así entran tactos y partos posteriores al período. Alternativa descartada: una consulta por vaca (N+1) o cortar en `hasta` (daría resultados distintos a los de la spec).
- **Índice `(establecimientoId, tipo, fecha)`** (migración Prisma) — elegido porque la consulta tambo-wide no puede usar el índice por animal. Alternativa descartada: no agregarlo: funciona, pero se degrada a medida que `eventos` crece (solo se agrega, nunca se borra).
- **Porcentaje con aritmética entera** (`floor((200n + d) / 2d)`) — elegida porque da exactamente "medio punto hacia arriba". Alternativa descartada: `Math.round(n / d * 100)`: puede fallar por coma flotante en el medio punto.
- **Período por defecto en la web; la API exige `desde` y `hasta`** — elegida porque así la API es determinista y fácil de testear, y el "hoy" argentino se calcula en la pantalla con la misma función de fechas que ya usa. Alternativa descartada: que la API complete el período si falta: contradice el 400 por parámetro faltante de la spec.
- **Validación del período duplicada en la web** (`web/src/informes.ts`) — elegida porque la spec pide no consultar con fechas inválidas y mostrar el mensaje. Se mantiene corta y con los mismos mensajes; la API sigue siendo la que decide. Alternativa descartada: un paquete compartido entre `api/` y `web/`: agregaría una estructura nueva para dos funciones chicas (constitución §9).
- **`Historial` embebido en `Reproduccion`** (en vez de una sección aparte en `AnimalFicha`) — elegida porque la anulación ya vive ahí (cartel de resultado, avisos 6 y 7, recarga de la situación) y no hay que mover esa lógica. Alternativa descartada: sacar la anulación a `AnimalFicha`: toca más código probado sin ganar nada.
- **Las respuestas viejas (`/eventos`, `/cambios`, ficha de baja con eventos y cambios) no se tocan** — elegida para no romper tests ni contratos; la web deja de usar sus listas. Alternativa descartada: limpiarlas ahora: cambio sin pedido en la spec; queda como posible limpieza futura.
- **Sin gráficos ni librerías de tablas** — elegido por simplicidad (constitución §9): tablas HTML con el CSS actual.

## Estrategia de tests
Tests primero (Vitest + supertest sobre `cowregister_test`; el reloj se fija con `fijarReloj`, los topes con `fijarTopes`). La web no tiene tests automáticos: se verifica en el navegador (768 y 375 px, claro y oscuro).

| RF | Test (archivo › caso) |
|---|---|
| RF-1 | `historial-puro` › orden fecha y registro descendente, desempate estable de los cambios de un guardado, eventos + cambios mezclados; `historial` › hembra con servicio, tacto, parto, secado y cambio; macho; ficha de baja |
| RF-2 | `historial` › cada tipo de evento trae su resumen (semen, resultado y fecha probable, crías, motivo de baja, dato anterior y nuevo) y quién lo registró; anulado con quién, cuándo y motivo; baja revertida |
| RF-3 | `historial-puro` › `ultimoEventoNoAnuladoId` salteando anulados y la baja; con tope inyectado el último evento no anulado queda fuera de las entradas y sigue identificado; `historial` › `total` y `truncado` |
| RF-4 | `historial` › animal sin entradas: `entradas` vacío, `total` 0 (la pantalla muestra el texto) |
| RF-5 | `historial` › macho con cambios y bajas (también revertida) y sin eventos reproductivos; baja venta y muerte por `/api/bajas/:id/historial`; 404 idéntico para activo en la ruta de bajas, baja en la de activos, "parto anulado", ajeno, inexistente y mal formado |
| RF-6, RF-21 | Navegador (T3): una sola sección, sin listas duplicadas, "Anular" solo en el último evento no anulado y con los permisos por rol, nunca en la ficha de baja |
| RF-7 | `informes-resultado` (puro) › preñada por tacto, vacía, sin tacto; `informes-inseminacion` › resumen con total, preñadas, vacías, sin tacto, base y porcentaje |
| RF-7 (reglas del resultado) | `informes-resultado` › tramo hasta el siguiente servicio o parto; primer tacto manda aunque haya otro contrario después (preñada→vacía y vacía→preñada); mismo día con orden total (tacto registrado antes no cuenta, después sí); tacto anulado salteado; servicio anulado fuera; tacto sin servicio fuera; parto vinculado sin tacto = `PRENADA_PARTO`; con tacto manda el tacto; parto anulado no vincula; tacto posterior al fin del período cuenta |
| RF-8 | `informes-inseminacion` › desglose por semen con "No especificado" (inseminación sin semen y monta sin toro juntas), semen renombrado y desactivado con nombre actual, orden por cantidad y nombre |
| RF-9 | `informes-inseminacion` › detalle ordenado con vaca activa, vaca de baja por venta y por muerte (datos de enlace), tipo de servicio y resultado |
| RF-10 | `informes-inseminacion` › período sin servicios: totales en cero y porcentaje `null` |
| RF-11 | `informes-natalidad` › partos, crías vivas y muertas por sexo, mellizos y porcentaje |
| RF-11 (casos de mellizos) | `informes-natalidad` › dos vivas, una viva y una muerta, dos muertas, crías de distinto sexo; parto anulado no cuenta; cría vendida o muerta cuenta como viva |
| RF-12 | `informes-natalidad` › detalle con vaca y crías (sexo, viva o muerta, número y datos de enlace de la cría activa y de la de baja por venta o muerte) |
| RF-13 | `informes-natalidad` › período sin partos: totales en cero y porcentaje `null` |
| RF-14 | Navegador (T4): período por defecto, consulta solo con fechas válidas, respuesta vieja descartada, "Calculando…" |
| RF-15 | `informes-periodo` (puro) › falta, formato, fecha inexistente (`2026-02-30`), `desde` > `hasta`, `hasta` futura (mañana) con `fijarReloj`, `desde` 1999, 5 años justos sí y un día más no (incluido 29/02); `informes-inseminacion` y `informes-natalidad` › 400 por parámetros ausentes, repetidos o no texto, `establecimientoId` en la query ignorado |
| RF-16 | `informes-inseminacion` e `informes-natalidad` › con `fijarTopes({ informe: 2 })` el detalle trae 2 filas, `truncado` y `totalDetalle`, y los totales y el desglose cuentan todo; `informes-inseminacion` › tacto posterior al período cuenta |
| RF-17 | `informes-inseminacion` › anular un tacto (por la API) cambia el resultado del servicio; anular un servicio lo saca; `informes-natalidad` › anular un parto lo saca; `historial` › revertir una baja la deja marcada revertida |
| RF-18 | Por cada ruta nueva (`/api/animales/:id/historial`, `/api/bajas/:id/historial`, `/api/informes/inseminacion`, `/api/informes/natalidad`): aislamiento entre dos tambos (404 idéntico en el historial; en los informes el otro tambo no ve datos ajenos y los suyos no cambian) y `establecimientoId` enviado ignorado |
| RF-19 | Mismas pruebas › dueño, encargado y veterinario reciben 200; sin sesión 401 también con query inválida (401 antes que 400); ninguna respuesta incluye `passwordHash`, `tokenHash` ni emails |
| RF-20, RF-22 | Navegador (T4) |
| Índice | `base-informes` › el índice `(establecimientoId, tipo, fecha)` existe en `eventos`; `migrate diff` solo con las diferencias conocidas |
| Día argentino (spec) | `historial-puro` e `historial` › un cambio manual guardado a las 22:00 ART figura en el día argentino (con `fijarReloj` o fecha de siembra) y una anulación se ubica en la fecha del evento |

## Riesgos
- **Migración del índice:** una sola, de bajo riesgo, avisada arriba. `migrate diff` se controla antes y después (T2).
- **Validación del período duplicada** en la web y la API: si se tocan las reglas hay que cambiarlas en los dos lados. Por eso los mensajes son los mismos y la API es la que manda.
- **Informes que leen todo el tambo desde `desde`:** con 5 años de rango la lectura puede ser grande; es la forma simple y correcta de medir "a hoy". Si en el futuro pesa, se puede acotar la lectura o agregar paginación (no es parte de esta spec).
- **El "último evento anulable" ahora viene de la API:** si la web y la API discreparan en qué cuenta (la baja no cuenta), aparecería un "Anular" mal ubicado. Cubierto con test de la API y verificación en el navegador.
- **Reloj (MEMORY.md):** los cambios manuales usan `creadoEn` del servidor para su día argentino; el riesgo del modo sin conexión (Etapa 6) sigue anotado, sin cambios acá.

## Tabla RF → parte del plan
| RF | Parte del plan |
|---|---|
| RF-1 a RF-5 | `api/src/historial/historial.ts`, `api/src/rutas/historial.ts`, `topes.ts`; T1 |
| RF-6, RF-21 | `Historial.tsx`, `Reproduccion.tsx`, `AnimalFicha.tsx`, `BajaFicha.tsx`; T3 |
| RF-7 a RF-10 | `informes/resultado-servicio.ts`, `informes/inseminacion.ts`, `porcentaje.ts`, `rutas/informes.ts`; T2 (pantalla: `InformeInseminacion.tsx`, T4) |
| RF-11 a RF-13 | `informes/natalidad.ts`, `rutas/informes.ts`; T2 (pantalla: `InformeNatalidad.tsx`, T4) |
| RF-14 | `Informes.tsx`, `PeriodoInforme.tsx`, `web/src/informes.ts`; T4 |
| RF-15, RF-16 | `informes/periodo.ts`, `topes.ts`, `informes/*.ts`; T2 |
| RF-17 | cálculo al leer (T1 y T2); verificación final en T5 |
| RF-18, RF-19 | `app.ts` y los tests de aislamiento y permisos de cada ruta; T1 y T2 |
| RF-20, RF-22 | `Layout.tsx`, `Informes.tsx`, `estilos.css`, `Historial.tsx`; T3 y T4 |
