# Plan — 002 Animales y buscador

Spec: [spec.md](spec.md)

## Resumen
Una migración de estructura (`animales_restricciones`) lleva a la base las garantías que pide la spec: un animal nunca apunta a un lote ni a una madre de otro tambo, un lote con animales no se puede eliminar, y el número tiene que estar normalizado (mayúsculas, formato) para que el índice único entre activos que ya existe valga sobre el valor normalizado.
La API suma `/api/animales` (alta, listado, ficha, búsqueda y carga desde planilla). El parseo y la validación de la planilla son funciones puras escritas a mano, con tests propios; las rutas solo las usan. El DELETE de lotes se ajusta al nuevo `ON DELETE RESTRICT`.
En la web se suma el buscador a la barra del layout y las pantallas Animales (listado), Alta, Carga desde planilla y Ficha.

## Base de datos

### Migración: `animales_restricciones`
Cambios en `schema.prisma` (Prisma genera el SQL):
- `Animal`: agregar `@@unique([establecimientoId, id])` (destino de las claves foráneas compuestas, igual que en `Lote`).
- `Animal.lote`: `fields: [establecimientoId, loteId], references: [establecimientoId, id], onDelete: Restrict`. Reemplaza a `animales_loteId_fkey` (`SET NULL`). Con `loteId` nulo la clave no se controla (MATCH SIMPLE de PostgreSQL), así que un animal sin lote sigue siendo válido.
- `Animal.madre`: `fields: [establecimientoId, madreId], references: [establecimientoId, id], onDelete: Restrict`. Reemplaza a `animales_madreId_fkey`. No sirve `SET NULL` con una clave compuesta (pondría en null el `establecimientoId`, que es obligatorio) y los animales no se borran, así que `Restrict` alcanza.
- Quitar el `@@index([loteId])` solo si Prisma lo pide; si no, se deja.
- Si Prisma 7.10.1 rechazara una relación compuesta con un campo opcional (`loteId`) y otro obligatorio, se deja la relación del schema con los campos que acepte y las dos claves foráneas compuestas se escriben a mano en el SQL (con `DROP CONSTRAINT` de las anteriores). En ese caso se documenta en el comentario del SQL y en MEMORY.md. Es el primer riesgo a verificar en T1.

SQL agregado a mano al final del `migration.sql`, con comentarios como en las migraciones anteriores:
```sql
-- Si ya hubiera animales con un número que no cumple el formato, se frena la
-- migración y se informa (no se modifica nada). Hoy la tabla está vacía.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM animales WHERE numero !~ '^[A-Z0-9.-]{1,20}$') THEN
    RAISE EXCEPTION 'Hay animales con un número que no está normalizado: corregilos antes de migrar';
  END IF;
END $$;

-- El número se guarda normalizado: mayúsculas, solo A-Z, 0-9, guion y punto, de 1 a 20
-- caracteres. Así el índice único entre activos (animales_numero_activo_unico,
-- de la migración inicial) compara siempre el valor normalizado, aunque falle la API.
ALTER TABLE "animales" ADD CONSTRAINT "animales_numero_normalizado"
    CHECK ("numero" ~ '^[A-Z0-9.-]{1,20}$');

-- Un animal no puede ser su propia madre.
ALTER TABLE "animales" ADD CONSTRAINT "animales_madre_distinta"
    CHECK ("madreId" IS NULL OR "madreId" <> "id");
```
- **Verificación obligatoria (de MEMORY.md):** antes de crear la migración, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (en `api/`) tiene que dar vacío. Después de aplicarla, vuelve a dar vacío y no propone ningún `DROP` de `animales_numero_activo_unico`, `animales_baja_con_fecha`, `animales_numero_normalizado`, `animales_madre_distinta`, `lotes_nombre_unico_sin_mayusculas` ni `reglas_lote_sin_baja`. Si propone alguno, no se aplica.
- **Cómo se crea:** `prisma migrate dev` falla en un entorno no interactivo con advertencias. Se crea la carpeta `api/prisma/migrations/<fecha>_animales_restricciones/` a mano con el SQL que da `migrate diff --from-config-datasource --to-schema ... --script` más el bloque manual, y se aplica con `npx prisma migrate deploy`. Los tests aplican las migraciones solos (`setup-global.ts`).

### Qué garantiza cada cosa
| Garantía | Mecanismo |
|---|---|
| Número único entre activos | Índice parcial existente `animales_numero_activo_unico` + CHECK de formato (valor normalizado) |
| Lote del mismo tambo | FK compuesta (establecimientoId, loteId) |
| Madre del mismo tambo | FK compuesta (establecimientoId, madreId) |
| Lote con animales no se elimina | La misma FK de lote con `ON DELETE RESTRICT` |
| Lote inexistente al alta | La misma FK: el INSERT falla con P2003 |
| Animal no es su propia madre | CHECK `animales_madre_distinta` |
| Baja sin lote | **Sigue pendiente para la Etapa 3** (`CHECK (estado <> 'BAJA' OR "loteId" IS NULL)`); esta spec solo crea animales activos |

### Mecanismo único para el riesgo de MEMORY.md (lote borrado en paralelo con un alta)
Se descarta el bloqueo explícito (`SELECT … FOR UPDATE`) y se usa solo la clave foránea con `RESTRICT`: PostgreSQL ya serializa por sí mismo las dos operaciones (la inserción toma un bloqueo sobre la fila del lote y el borrado la espera, o al revés), así que el resultado es siempre uno de dos, determinista:
- El alta llega primero: el DELETE falla con P2003, y la API (que ya traduce P2003 y vuelve a consultar) responde 409 "El lote tiene N animales".
- El DELETE llega primero: el INSERT del alta falla con P2003 y la API responde 409 "El lote destino ya no existe, volvé a intentar", sin guardar nada.

### Cambio en el DELETE de lotes (`api/src/rutas/lotes.ts`)
Hoy los animales dados de baja que tuviera el lote quedaban con `loteId` null por el `SET NULL`. Con `RESTRICT` eso ya no pasa solo, y la spec 001 (RF-7) sigue pidiendo que un lote con solo animales dados de baja se pueda eliminar. Por eso, dentro de la misma transacción y **después** de verificar que no hay animales activos ni reglas, el DELETE ejecuta `animal.updateMany({ where: { loteId: id, establecimientoId, estado: 'BAJA' }, data: { loteId: null } })` y recién entonces `deleteMany`. El manejo existente del P2003 (volver a consultar y responder 409 con el motivo real) cubre ahora también al animal asignado en paralelo; los mensajes no cambian.

### Sin cambios
- `limpiarBase()` no cambia (no hay tablas nuevas).
- El modelo `Animal` mantiene `id` con `uuid(7)` por defecto; la carga desde planilla genera los ids en la API con `crypto.randomUUID()` (ver Decisiones).

## API
Todas las rutas usan `requiereSesion` (401). Las de carga (alta y planilla) usan además `requiereRol('DUENO','ENCARGADO')` (403) **antes** de leer `body` o `params`. Después viene la validación (400) y recién entonces la búsqueda del recurso (404). Todas filtran por el `establecimientoId` de la sesión. Los estados de un animal se muestran con `NOMBRE_ESTADO` (`api/src/lotes/estados.ts`).

| Método y ruta | Rol | Qué hace | RF |
|---|---|---|---|
| POST `/api/animales` | Dueño, encargado | Alta manual con `{ numero, sexo, estado, fechaNacimiento?, madre? }` (`madre` es un número). Valida con zod, busca la madre activa del tambo (`numero` normalizado, hembra, fecha anterior), lee la regla del estado y crea el animal con `loteId` (o `null`). 201 con `{ animal: { id, numero, … }, avisoSinLote: { estado } \| null }`. P2002 → 409 "Ya existe un animal activo con ese número". P2003 → 409 "El lote destino ya no existe, volvé a intentar" | RF-1 a RF-9, RF-37, RF-40 |
| GET `/api/animales` | Todos | Lista activos del tambo. Query `estado?` (4 estados; otro valor, incluido BAJA, da 400 en español) y `loteId?` (UUID de un lote del tambo o `sin-lote`; mal formado, inexistente o de otro tambo da 404 "Lote no encontrado"). Filtros combinados con AND. Orden natural (ver Decisiones). Respuesta `{ total, mostrados, truncado, animales: [{ id, numero, sexo, estado, lote: { nombre } \| null }] }` con máximo 2.000 | RF-23 a RF-27, RF-37 |
| GET `/api/animales/buscar?numero=` | Todos | Normaliza el número igual que al guardar y busca coincidencia exacta entre activos del tambo. 200 `{ id, numero }`; sin resultado (inexistente, otro tambo, baja, caracteres no permitidos) 404 "No hay un animal activo con ese número"; `numero` ausente o vacío al normalizar, 400. Se declara **antes** de `/:id` | RF-33 a RF-36, RF-37 |
| GET `/api/animales/:id` | Todos | Ficha: `{ id, numero, sexo, estado, fechaNacimiento (AAAA-MM-DD o null), lote: { nombre } \| null, madre: { id, numero, activa } \| null, crias: [{ id, numero }] (solo activas) }`. Id mal formado, inexistente, de otro tambo o dado de baja: 404 "Animal no encontrado" | RF-28 a RF-30, RF-38 |
| POST `/api/animales/planilla/vista-previa` | Dueño, encargado | `{ texto }`. Analiza y devuelve `{ filas: [{ fila, ok, numero, sexo, estado, fechaNacimiento, madre, motivo? }], resumen: { total, correctas, conError, sinLotePorEstado } }`. **No escribe nada** | RF-11 a RF-17, RF-20, RF-22 |
| POST `/api/animales/planilla/confirmar` | Dueño, encargado | `{ texto }` (crudo). Reanaliza todo contra la base y guarda las filas correctas con un solo `createMany` dentro de una transacción. 200 `{ guardados, quedaronAfuera: [{ fila, motivo }], sinLotePorEstado }`. P2002 → vuelve a analizar y reintenta (máximo 3 intentos), luego 409 en español; P2003 → 409 "El lote destino ya no existe, volvé a intentar" | RF-18 a RF-21 |

Errores de la planilla que cortan todo con 400 y mensaje en español: texto vacío, más de 500 filas con datos, más de 100.000 caracteres, ninguna fila con tabulaciones (mensaje específico de RF-17) y comillas sin cerrar (con la fila donde empezaron).
`app.ts`: se monta `express.json({ limit: '1mb' })` en `/api/animales/planilla` **antes** del parser global de 100 kb (Express no vuelve a parsear un cuerpo ya leído). Así 100.000 caracteres con tabulaciones y saltos escapados entran, y el límite de la spec lo aplica el código con su mensaje. Además `manejarErrores` responde con un mensaje en español al error `entity.too.large` (413), como red de seguridad.

## Interfaz
- **Buscador** (`componentes/Buscador.tsx`) dentro del `Layout`, en la barra: `<form role="search">` con un `input` (`aria-label="Buscar animal por número"`, 48 px) y el botón "Buscar". Enter lo envía, que es lo que hace el bastón al terminar de leer. Normaliza (extremos + mayúsculas) antes de enviar; si queda vacío, no llama a la API y devuelve el foco al campo. Si encuentra, navega a `/animales/:id`. Si da 404, muestra debajo "No hay un animal activo con el número X" (`role="status"`) y, para dueño y encargado y si el número es válido, el enlace "Dar de alta" a `/animales/nuevo?numero=X`. El aviso se borra al buscar de nuevo o al cambiar de pantalla. Foco automático solo cuando la ruta es `/` o `/animales` (efecto sobre la ruta); nunca en formularios. En 375 px la barra ya pasa a varias filas: el buscador ocupa una fila completa propia (`flex: 1 1 100%`), siempre visible.
- **Menú:** se suma el `NavLink` "Animales" (`/animales`, sin `end`, así queda marcado también en la ficha y en las pantallas de carga).
- **Animales** (`paginas/Animales.tsx`, `/animales`): filtros (select de estado con "Todos", select de lote con "Todos" y "Sin lote"), cantidad ("N animales"), aviso de tope ("Mostrando 2000 de N animales: usá los filtros para acotar") y tabla (número como enlace a la ficha, sexo, estado, lote) dentro de un contenedor con scroll horizontal propio. Dueño y encargado ven los botones "Nuevo animal" y "Cargar desde planilla". Sin resultados: mensaje y los mismos accesos solo para quien puede cargar.
- **Alta** (`paginas/AnimalNuevo.tsx`, `/animales/nuevo`): formulario con número (precargado desde `?numero=`), sexo, estado, fecha de nacimiento (`<input type="date">` con `max` de hoy y `min` 2000-01-01) y número de la madre. Muestra errores por campo y el aviso de "sin lote" que devuelve la API; al guardar navega a la ficha. Solo se accede con rol que carga; el veterinario ve un mensaje de sin permiso (la API igual responde 403).
- **Planilla** (`paginas/AnimalesPlanilla.tsx`, `/animales/planilla`): instrucciones breves (columnas en orden, que se copia desde Excel o Google Sheets), un `textarea`, "Ver vista previa", resumen (correctas, con error, sin lote por estado), tabla de filas (fila, datos, resultado o motivo; las filas con error resaltadas con texto además del color) y "Confirmar y guardar N animales", deshabilitado si no hay filas correctas. Al editar el texto se invalida la vista previa (hay que verla de nuevo), sin perder lo pegado. Tras confirmar muestra cuántos se guardaron, cuántas quedaron afuera con su motivo y "Cargar otra planilla".
- **Ficha** (`paginas/AnimalFicha.tsx`, `/animales/:id`): datos básicos ("sin dato" donde falten), nombre del lote sin enlace o "sin lote", madre con enlace (solo el número si no está activa), crías activas con enlaces y la sección "Historial" con "Todavía no hay eventos registrados". Si la API responde 404, mensaje "Animal no encontrado" y enlace al listado.
- **Inicio:** se actualiza el texto (sin "llegan en los próximos pasos") y se suma un enlace a Animales.
- **CSS** (`estilos.css`): estilos de `.buscador`, `.tabla-contenedor` (overflow-x), tablas, filas con error, ficha y filtros, con las variables existentes (modo claro y oscuro) y controles de 48 px.

## Archivos
- Crear:
  - `api/prisma/migrations/<fecha>_animales_restricciones/migration.sql`
  - `api/src/animales/reglas.ts`: `ESTADOS_INICIALES`, `puedeTenerEstado(sexo, estado)`, `hoyArgentina(ahora?)`, `validarFechaNacimiento(fecha, hoy)` y la comparación madre-cría
  - `api/src/animales/planilla.ts`: `leerPlanilla(texto)` (parseo a mano), `analizarPlanilla(filas, contexto)` (validación de cada fila, duplicados y madres) y los textos de error
  - `api/src/animales/orden.ts`: comparador de orden natural de números
  - `api/src/rutas/animales.ts`
  - `api/tests/base-animales.test.ts`, `api/tests/validacion-animales.test.ts`, `api/tests/planilla.test.ts`, `api/tests/animales.test.ts`, `api/tests/animales-planilla.test.ts`
  - `web/src/componentes/Buscador.tsx`
  - `web/src/paginas/Animales.tsx`, `AnimalNuevo.tsx`, `AnimalesPlanilla.tsx`, `AnimalFicha.tsx`
  - `web/src/animales.ts`: `normalizarNumero` del lado del cliente, nombres de estado y sexo
- Modificar:
  - `api/prisma/schema.prisma`
  - `api/src/validacion.ts`: `normalizarNumero`, `numeroSchema` (y sus mensajes)
  - `api/src/errores.ts`: respuesta en español para `entity.too.large`
  - `api/src/rutas/lotes.ts`: el DELETE (baja desasignada antes de borrar)
  - `api/src/app.ts`: montar `/api/animales` y el parser de 1 MB de la planilla
  - `api/tests/ayudas.ts`: helper `crearAnimalDirecto(...)` (la función local de `lotes.test.ts` se reutiliza o se mueve acá)
  - `api/tests/lotes.test.ts`: casos de concurrencia lote-animal y eliminación con animales dados de baja
  - `web/src/api.ts`: tipos `Animal`, `AnimalFicha`, `ResultadoPlanilla`, etc.
  - `web/src/componentes/Layout.tsx`: buscador y enlace "Animales"
  - `web/src/App.tsx`: rutas `animales`, `animales/nuevo`, `animales/planilla`, `animales/:id`
  - `web/src/paginas/Inicio.tsx`
  - `web/src/estilos.css`
  - `MEMORY.md` y `docs/plan.md` (cierre)

## Decisiones
- **Un solo mecanismo para el riesgo de lote en paralelo: la clave foránea compuesta con `ON DELETE RESTRICT`.** Alternativa descartada: `SELECT … FOR UPDATE` sobre el lote en el DELETE y en el alta. Hay que acordarse de usarlo en cada ruta nueva que asigne animales (los movimientos de la Etapa 3, por ejemplo) y se puede olvidar; la clave foránea vale para cualquier camino, incluidos los futuros.
- **`ON DELETE RESTRICT` para el lote y para la madre.** Alternativa descartada: `SET NULL`. Con la clave compuesta pondría en null el `establecimientoId` (obligatorio), y para el lote ocultaría el problema: un animal asignado en paralelo quedaría sin lote en silencio.
- **El DELETE de lotes desasigna a los animales dados de baja antes de borrar.** Alternativa descartada: pedir que los de baja se muevan a mano. La spec 001 pide que un lote con solo bajas se pueda eliminar, y el CHECK "baja sin lote" recién llega en la Etapa 3.
- **El formato del número se garantiza con un CHECK, y la unicidad sigue en el índice parcial que ya existía.** Alternativa descartada: crear un segundo índice sobre `upper(numero)`. El CHECK deja un solo valor posible por número, así que el índice existente alcanza y no se duplican reglas (misma idea que en la spec 001 con el nombre de lote).
- **Normalizar el número validando los caracteres sobre el texto original (ya sin los extremos) y recién después pasando a mayúsculas.** Alternativa descartada: pasar a mayúsculas primero. `toUpperCase()` convierte "ß" en "SS", y letras raras (como "ı") en "I", que entrarían como válidas por error. Los extremos se quitan con `\s` de JavaScript (espacios, tabulaciones, saltos de línea y espacios Unicode como el de no separación).
- **Fecha "hoy" con `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })`, comparando textos AAAA-MM-DD.** Alternativa descartada: comparar `Date` con la hora del servidor. El servidor puede estar en UTC y, entre las 21 y las 24 de Argentina, "hoy" sería mañana. La función recibe el instante como parámetro para poder testear el cambio de día. La fecha se guarda en la columna `Date` creando el `Date` en UTC a medianoche.
- **Parseo a mano de la planilla** (máquina de estados de caracteres: separador tabulación, celdas entre comillas con `""`, saltos internos y CRLF/LF), sin librería. Alternativa descartada: una librería de CSV/TSV. El formato es chico y fijo, la spec pide reglas propias (numeración de filas, comillas sin cerrar) y la constitución pide no sumar dependencias sin justificarlas.
- **Resolución de madres en pasos:** (1) validar los campos propios de cada fila; (2) marcar duplicados contra filas anteriores y contra activos del tambo; (3) resolver la madre de cada fila (animal activo del tambo, fila de la planilla, o error); (4) marcar como error todas las filas de un ciclo (búsqueda en profundidad sobre las dependencias); (5) propagar el error a las crías hasta que no haya cambios, con el motivo "la madre (fila N) tiene error". Alternativa descartada: validar en orden de aparición. No acepta madres que aparecen después ni detecta ciclos.
- **El análisis consulta la base una sola vez por pedido:** trae los activos cuyos números (y los números de madre) aparecen en la planilla con `numero in [...]`, filtrado por tambo, y las reglas de lote. Alternativa descartada: una consulta por fila (hasta 500 consultas por pedido).
- **Ids de los animales de la planilla generados en la API con `crypto.randomUUID()` y un solo `createMany`.** Así una cría puede referenciar a su madre aunque esté más abajo en la planilla: PostgreSQL controla las claves foráneas al final de la sentencia. Alternativa descartada: insertar en orden topológico o en dos pasadas (más código y más consultas). No se usa uuid v7 porque Node no lo trae; cualquier UUID es válido y el orden de los ids no importa.
- **Confirmar manda el texto crudo y el servidor revalida todo.** Alternativa descartada: guardar la vista previa en el servidor o mandar las filas ya validadas. Obliga a tener borradores (la spec los descarta) y no se podría confiar en datos del cliente.
- **Reintentos al confirmar:** si el INSERT falla por un número ocupado en paralelo (P2002) se reanaliza y se reintenta hasta 3 veces; después, 409. Alternativa descartada: `INSERT … ON CONFLICT DO NOTHING`. Perdería en silencio filas que la spec manda informar con su motivo.
- **Orden natural con `Intl.Collator('es', { numeric: true })` y desempate alfabético por texto.** Los números son ASCII en mayúsculas, así que no hay riesgos de tildes. Se ordena en JavaScript, como en los lotes. Alternativa descartada: `ORDER BY numero`. Pondría "10" antes de "9".
- **Listado sin paginación y con tope de 2.000** (el total se calcula antes del recorte). Alternativa descartada: paginar. La spec lo descarta y un rodeo de cientos de animales se ve y se filtra bien en una sola lista.
- **La búsqueda es un recurso aparte, `GET /api/animales/buscar?numero=`.** Alternativa descartada: reutilizar el filtro del listado. El buscador tiene que dar un único resultado o 404, con la normalización propia de RF-34, y no mostrar una lista.
- **El aviso de "no hay animal" y el acceso al alta viven en el buscador del layout** (junto a la barra), no en una pantalla aparte. Alternativa descartada: una ruta `/animales/no-encontrado`. Suma una pantalla y navegación solo para mostrar un mensaje, y el bastón queda con el campo a mano para leer otra vaca.
- **`normalizarNumero` duplicado en `web/src/animales.ts`** (unas pocas líneas). Alternativa descartada: un paquete compartido entre `api/` y `web/`. Es infraestructura nueva para dos funciones; la API siempre vuelve a normalizar y valida, así que el cliente es solo una comodidad.
- **Sin dependencias nuevas.**

## Estrategia de tests
Tests primero, con Vitest y supertest sobre `cowregister_test`. Los animales que hacen falta en los tests de lotes y de aislamiento se crean directo con Prisma (helper en `ayudas.ts`). Los roles con `crearUsuario`. Los tests puros (`validacion-animales`, `planilla`) no usan la base.

| RF | Test (archivo › caso) |
|---|---|
| RF-1 | animales.test.ts › dueño y encargado dan de alta un animal; queda en el lote destino de su estado y la respuesta lo incluye |
| RF-2 | validacion-animales.test.ts › normaliza extremos (espacios, tabulaciones, saltos de línea, NBSP) y mayúsculas; vacío, 20 y 21 caracteres, espacio interno, ñ, tildes, "_" y "ß" se rechazan con mensaje · animales.test.ts › " ab-1 " se guarda "AB-1" |
| RF-3 | animales.test.ts › número repetido entre activos da 409 con el mensaje; "ab-1" y "AB-1" son el mismo; con un animal dado de baja con ese número se permite |
| RF-4 | base-animales.test.ts › insertar directo un número repetido entre activos falla y uno no normalizado ("ab-1") falla por el CHECK · animales.test.ts › dos altas simultáneas del mismo número (`Promise.all`): una da 201 y la otra 409 |
| RF-5 | validacion-animales.test.ts › sexo y estado inválidos, BAJA y macho con estado distinto de recién nacido se rechazan; hembra con cualquier estado inicial se acepta · animales.test.ts › 400 con mensaje |
| RF-6 | validacion-animales.test.ts › hoy se acepta, mañana no; el cambio de día se evalúa con la hora de Argentina (instante de las 22:00 Argentina que ya es otro día en UTC); 31/12/1999 no, 01/01/2000 sí; 31/02 no; madre anterior (igual o posterior se rechaza); madre sin fecha no se compara |
| RF-7 | animales.test.ts › madre inexistente, de otro tambo, de baja, macho y el propio número dan el mismo mensaje; madre válida se vincula · base-animales.test.ts › FK compuesta de madre: apuntar a una madre de otro tambo falla; el CHECK impide ser su propia madre |
| RF-8 | animales.test.ts › sin regla para el estado: 201 con `loteId` null y `avisoSinLote` con el estado |
| RF-9 | animales.test.ts › lote destino eliminado justo antes del insert (se fuerza borrando la regla y el lote entre la lectura y el insert con un hook de prueba o llamando directo al borrado concurrente) da 409 "El lote destino ya no existe, volvé a intentar" y no queda ningún animal · base-animales.test.ts › insertar un animal con un lote inexistente falla |
| RF-10 | lotes.test.ts › `Promise.all` de alta y DELETE sobre el mismo lote repetido varias veces: o el lote queda eliminado y el alta dio 409, o el lote sigue y el animal existe; nunca un animal con lote inexistente · base-animales.test.ts › borrar en la base un lote con animales falla · lotes.test.ts › sigue pudiéndose eliminar un lote con solo animales dados de baja |
| RF-11, RF-20 | animales-planilla.test.ts › la vista previa devuelve filas correctas y con error con su número de fila y motivo (la numeración cuenta encabezado y filas vacías) y la tabla `animales` no cambia (`count` antes y después) |
| RF-12 | planilla.test.ts › duplicado en la misma planilla (también en minúsculas), número ya activo en el tambo, número que existe solo en otro tambo (se acepta), columnas de más o de menos y campo obligatorio vacío |
| RF-13 | planilla.test.ts › madre del tambo, madre en fila posterior, madre en la misma fila, ciclo de dos y de tres filas, madre en fila con error (con motivo que nombra la fila), madre del tambo que además es fila (la fila es duplicado y la cría se vincula con la existente), madre macho, madre solo en otro tambo (error), fechas madre-cría entre filas |
| RF-14 | planilla.test.ts › celdas entre comillas con tabulación y salto de línea, comillas escapadas, comillas sin cerrar (error general con la fila), CRLF y LF, filas vacías ignoradas |
| RF-15 | planilla.test.ts › encabezado exacto con las variantes aceptadas (sin tildes ni mayúsculas) se ignora; encabezado parcial o repetido más abajo se trata como datos; no cuenta para el límite |
| RF-16 | planilla.test.ts › sexo (hembra, macho, H, M), estados con y sin tildes ("en ordene"), fechas `5/3/2021`, `05/03/2021`, `2021-03-05` válidas; `5/3/21` y "marzo 2021" son error de fila con mensaje |
| RF-17 | animales-planilla.test.ts › texto vacío, 501 filas (400), 500 filas (200), más de 100.000 caracteres (400 con mensaje, no 413 sin mensaje), sin ninguna tabulación (mensaje específico), un cuerpo de 400 kb JSON entra |
| RF-18 | animales-planilla.test.ts › confirmar con filas correctas e incorrectas guarda solo las correctas, juntas, con su lote destino; se envía el texto crudo y se revalida: si entre la vista previa y la confirmación se crea el número de una fila, esa fila queda afuera con su motivo y el resto se guarda |
| RF-19 | animales-planilla.test.ts › la respuesta informa guardados, `quedaronAfuera` con motivo y `sinLotePorEstado`; la vista previa trae el mismo total por estado |
| RF-21 | animales-planilla.test.ts › un conflicto de número simultáneo (se crea el número en medio del guardado) se reintenta y termina bien; con conflicto persistente simulado (3 intentos) responde 409 y no guarda nada |
| RF-22 | Verificación manual en el navegador (corregir el texto y volver a la vista previa; confirmar no disponible sin filas correctas) |
| RF-23 | animales.test.ts › solo activos del tambo, con lote o "sin lote"; orden natural ("9","10","A2","A10") · planilla/orden: validacion-animales.test.ts › comparador natural |
| RF-24 | animales.test.ts › filtro por estado, por lote, por "sin lote" y combinados con AND; `total` correcto |
| RF-25 | animales.test.ts › `loteId` de otro tambo, inexistente y mal formado dan el mismo 404; `estado=XYZ` y `estado=BAJA` dan 400 |
| RF-26 | animales.test.ts › con 2.001 animales (creados con `createMany`) devuelve 2.000, `truncado: true` y el total real |
| RF-27 | Verificación manual en el navegador (mensaje y accesos con listado vacío y con filtro sin resultados) |
| RF-28 | animales.test.ts › ficha con lote (solo nombre), madre con `activa`, crías activas, y "sin dato" en lo que falta |
| RF-29 | Verificación manual en el navegador (texto del historial) |
| RF-30 | animales.test.ts › ficha de un animal de baja del propio tambo da 404 |
| RF-31, RF-32 | Verificación manual en el navegador: el buscador aparece en todas las pantallas con sesión y no en login ni registro; en 375 px en su propia fila; el foco automático solo en Inicio y listado, no en formularios |
| RF-33 | animales.test.ts › `GET /buscar` devuelve el id del animal activo · manual: tipear el número y Enter abre la ficha (el bastón se simula con el teclado) |
| RF-34 | animales.test.ts › `buscar?numero=%20ab-1%0A` encuentra "AB-1"; "12" no encuentra "123"; caracteres no permitidos dan 404 |
| RF-35 | animales.test.ts › inexistente, de otro tambo, dado de baja y con caracteres no permitidos dan la misma respuesta 404 · manual: mensaje con enlace de alta que precarga el número (solo dueño y encargado) |
| RF-36 | animales.test.ts › `numero` ausente o solo espacios da 400 · manual: Enter vacío no hace nada y deja el foco |
| RF-37, RF-38 | animales.test.ts y animales-planilla.test.ts › **aislamiento entre dos tambos para cada acción**: listar, filtrar por lote ajeno, ver ficha, buscar, alta (queda en el tambo de la sesión aunque se mande un `establecimientoId`), vista previa y confirmar (un número que existe solo en otro tambo se acepta; una madre que existe solo en otro tambo da error de inexistente). La ficha de un animal de otro tambo y la de un id mal formado dan 404 |
| RF-39 | Verificación manual en el navegador (veterinario sin botones de alta ni de planilla) |
| RF-40 | animales.test.ts y animales-planilla.test.ts › veterinario recibe 403 en alta, vista previa y confirmar, también con datos inválidos; sin sesión, 401 |
| RF-41 | Verificación manual en el navegador a 768 px y 375 px, en modo claro y oscuro: controles de 48 px, sin desbordes (las tablas se desplazan dentro de su contenedor) |

## Riesgos
- **Que Prisma 7.10.1 no acepte la relación compuesta con un campo opcional (`loteId`).** Plan B documentado arriba: claves foráneas escritas a mano en el SQL de la migración. T1 lo verifica primero.
- **Que Prisma quiera borrar objetos hechos a mano en una migración futura** (índice parcial de número, CHECK de baja, CHECK de número, CHECK de madre, índice de nombre de lote, CHECK de reglas). Se mitiga con la verificación de `migrate diff` (vacío antes y después) y quedando anotado en MEMORY.md.
- **Tests existentes que creen animales directo con un número no normalizado.** Hoy `lotes.test.ts` usa "1", "2" y "3", que cumplen el CHECK; cualquier otro hay que ajustarlo.
- **Rendimiento de la vista previa con 500 filas.** Mitigado con una sola consulta con `in` para los números y las madres; no hay consultas por fila.
- **Que el parser de la planilla pierda un caso raro de Excel.** Se cubre con los tests de comillas, CRLF, filas vacías y NBSP; si aparece otro caso real al cargar el rodeo, se agrega un test y se corrige.
- **El CHECK de BAJA sin lote sigue pendiente** (Etapa 3). Hasta entonces la base no lo garantiza, y por eso el DELETE de lotes desasigna a los animales dados de baja.
