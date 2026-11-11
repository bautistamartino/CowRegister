# Plan — 001 Lotes y destino de cada estado

Spec: [spec.md](spec.md)

## Resumen
Las garantías que la spec pide "a nivel de almacenamiento" se resuelven en PostgreSQL con dos migraciones de Prisma, agregando SQL a mano donde Prisma no alcanza. La primera cambia la estructura; la segunda completa una sola vez los destinos de los tambos ya registrados.
La API suma `/api/lotes` y `/api/reglas-lote`. En todas las rutas de modificación el rol se controla antes de buscar el lote, y las violaciones de restricciones de la base se traducen a los mensajes de la spec.
En la web se agrega un layout con menú común a las pantallas privadas y la pantalla Lotes. `api.ts` pasa a reaccionar a un 401 a mitad de uso.

## Base de datos

### Migración 1: `lotes_restricciones` (estructura)
Cambios en `schema.prisma` (Prisma genera el SQL):
- `Lote`: agregar `@@unique([establecimientoId, id])`, que es el destino de la clave foránea compuesta. Quitar `@@unique([establecimientoId, nombre])`, porque la reemplaza el índice sin mayúsculas de abajo y tener dos reglas de unicidad distintas confunde.
- `ReglaLote`: la relación `lote` pasa a `fields: [establecimientoId, loteId], references: [establecimientoId, id], onDelete: Restrict`. Esto genera `FOREIGN KEY ("establecimientoId","loteId") REFERENCES lotes("establecimientoId","id") ON DELETE RESTRICT` y reemplaza a `reglas_lote_loteId_fkey`. Así ninguna regla puede apuntar a un lote de otro tambo (RF-17) y no se puede borrar un lote que es destino (RF-9 y RF-31). Como Prisma lo expresa, no hay riesgo de que una migración futura lo borre.

SQL agregado a mano al final del `migration.sql`, con un comentario como en la migración inicial:
```sql
-- Si ya hubiera lotes con el mismo nombre salvo mayúsculas en un tambo,
-- se frena la migración y se informa (no se borra ni renombra nada).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM lotes GROUP BY "establecimientoId", lower(nombre) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Hay lotes con nombres repetidos (sin distinguir mayúsculas) en un mismo tambo: corregilos antes de migrar';
  END IF;
END $$;

-- Nombre de lote único por tambo SIN distinguir mayúsculas (Prisma no expresa índices sobre lower()).
CREATE UNIQUE INDEX "lotes_nombre_unico_sin_mayusculas" ON "lotes" ("establecimientoId", lower("nombre"));

-- El estado BAJA nunca tiene lote destino.
ALTER TABLE "reglas_lote" ADD CONSTRAINT "reglas_lote_sin_baja" CHECK ("estado" <> 'BAJA');
```
- **Verificación obligatoria:** después de crearla, `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script` (con la base sombra que use el proyecto) no tiene que proponer `DROP` del índice ni del CHECK. Si los propusiera, se deja documentado en el comentario del SQL y en MEMORY.md cómo evitarlo, igual que con el índice parcial de la migración inicial.

### Migración 2: `lotes_iniciales_existentes` (datos, RF-19)
Es una sola sentencia `DO $$ … $$`, encerrada entre los comentarios `-- INICIO lotes iniciales` y `-- FIN lotes iniciales` para que el test la pueda extraer y ejecutar. Para cada establecimiento y cada par (estado, nombre inicial) — RECIEN_NACIDO "Terneros", VAQUILLONA "Vaquillonas", EN_ORDENE "En ordeñe", SECA "Secas":
1. Si el estado ya tiene regla, no hace nada.
2. Si no tiene, busca un lote del tambo con `lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g')) = lower(<nombre inicial>)`. Si no lo encuentra, lo crea con `uuidv7()` (nativa en PostgreSQL 18) y `actualizadoEn = now()`.
3. Crea la regla.

Prisma ejecuta cada migración una sola vez (tabla `_prisma_migrations`), y eso cumple el "una sola vez" de RF-19.

### Sin cambios
- `animales.loteId` sigue con `ON DELETE SET NULL`. La spec no pide garantizar en la base que no se borre un lote con animales activos: lo controla la API dentro de una transacción.
- `limpiarBase()` no cambia, porque no hay tablas nuevas.

## API
Todas las rutas usan `requiereSesion`. Las de modificación también usan `requiereRol('DUENO','ENCARGADO')` como middleware, **antes** de leer `params` o `body` (RF-22). Todas filtran por el `establecimientoId` de la sesión.

| Método y ruta | Rol | Qué hace | RF |
|---|---|---|---|
| GET `/api/lotes` | Todos | Lotes del tambo, ordenados por nombre sin mayúsculas (`localeCompare('es', { sensitivity: 'base' })`). De cada uno: `id`, `nombre`, `descripcion`, `cantidadAnimales` (cuenta los que tienen `estado <> 'BAJA'`) y `destinoDe: EstadoAnimal[]` | RF-1, RF-20 |
| GET `/api/lotes/:id` | Todos | Un lote con los mismos campos. Id mal formado, inexistente o de otro tambo: 404 "Lote no encontrado" | RF-20 |
| POST `/api/lotes` | Dueño, encargado | Crea el lote con `{ nombre, descripcion? }` normalizados. Un P2002 del índice se traduce a 409 "Ya existe un lote con ese nombre" | RF-2, RF-4 a RF-6, RF-27 |
| PATCH `/api/lotes/:id` | Dueño, encargado | Cambia `nombre` y/o `descripcion` (`null` o vacía la borra) con `updateMany({ where: { id, establecimientoId } })`. Si actualiza 0 filas, 404. P2002, 409 | RF-3 a RF-6, RF-27, RF-32 |
| DELETE `/api/lotes/:id` | Dueño, encargado | En una transacción: busca el lote (si no está, 404), cuenta los animales activos y lee sus reglas. Si hay alguno, 409 con el mensaje armado (ver Decisiones). Si no, `deleteMany`: 0 filas, 404. Si llega un P2003 por una regla creada en paralelo, se vuelve a consultar y responde 409. Respuesta 204 | RF-7 a RF-9, RF-31, RF-32 |
| GET `/api/reglas-lote` | Todos | Siempre 4 elementos `{ estado, lote: { id, nombre } \| null }`, en el orden recién nacido, vaquillona, en ordeñe, seca | RF-11, RF-14 |
| PUT `/api/reglas-lote/:estado` | Dueño, encargado | `{ loteId }`. Un estado fuera de los 4 (incluido BAJA) da 400 "Estado inválido". Un `loteId` mal formado, inexistente o de otro tambo da 404 "Lote no encontrado". Hace `upsert` por (establecimientoId, estado), así que elegir el mismo lote no cambia nada. Un P2003 (lote borrado en paralelo) también da 404 | RF-12, RF-15 a RF-17, RF-20, RF-31 |
| DELETE `/api/reglas-lote/:estado` | Dueño, encargado | Quita el destino con `deleteMany`. Es idempotente: 204 aunque no hubiera regla | RF-13 |
| POST `/api/auth/registro` (modificada) | Público | Dentro del `$transaction` existente: crea el establecimiento, los 4 lotes, las 4 reglas y por último el dueño | RF-18 |

Respuestas de error: rol no permitido, 403 "No tenés permiso para hacer esto" (ya existe en `requiereRol`). No encontrado, 404 "Lote no encontrado". Validación, 400 con `detalles` por campo (manejo central de zod).

## Interfaz
- **Layout con menú** (`componentes/Layout.tsx`): es la ruta padre de las pantallas privadas y renderiza `<Outlet />`.
  - Barra superior con el nombre del tambo y del usuario (recortados con `text-overflow: ellipsis`, `min-width: 0`), `<nav aria-label="Principal">` con `NavLink` a Inicio y Lotes, y el botón "Cerrar sesión".
  - `NavLink` pone `aria-current="page"` en la sección actual; con eso se resalta por CSS y lo anuncia el lector de pantalla (RF-24).
  - A 375 px la barra pasa a dos filas: arriba los nombres y abajo la navegación y el botón, todos con 48 px de alto.
- **Inicio**: se le quita la barra propia (la pone el layout) y se ajusta el texto de bienvenida.
- **Lotes** (`paginas/Lotes.tsx`), de arriba hacia abajo:
  1. Avisos: uno por cada estado sin destino ("Recién nacido no tiene lote destino"), en un contenedor con `role="status"`.
  2. "Destino de cada estado": 4 filas con un `<select>` (opción "Sin destino" más los lotes). Al elegir un lote se hace PUT; al elegir "Sin destino", DELETE. Después se recargan lotes y reglas.
  3. Formulario "Nuevo lote" (nombre y descripción) con los errores por campo debajo de cada uno.
  4. Lista de lotes en tarjetas, no en tabla, para que entre en 375 px: nombre, descripción, "N animales", "Destino de: …" y los botones Editar y Eliminar. Editar abre la tarjeta en modo formulario. Eliminar pide `window.confirm` y, si la API responde 409, muestra su mensaje en la tarjeta.
  - Si el rol es veterinario no se muestran el formulario, los botones ni los `select`: los destinos aparecen como texto (RF-21).
- **CSS** (`estilos.css`): `.boton-secundario` pasa de 40 a 48 px (hoy no cumple RF-26). Se suman estilos para `select` y `textarea` dentro de `.campo` (48 px como mínimo) y para el menú, las tarjetas y los avisos, usando solo las variables existentes para que funcionen en modo claro y oscuro.

## Archivos
- Crear:
  - `api/prisma/migrations/<fecha>_lotes_restricciones/migration.sql`
  - `api/prisma/migrations/<fecha>_lotes_iniciales_existentes/migration.sql`
  - `api/src/lotes/iniciales.ts`: los 4 pares estado/nombre y `crearLotesIniciales(tx, establecimientoId)`
  - `api/src/lotes/estados.ts`: estados con destino y sus nombres en español
  - `api/src/auth/registro.ts`: `crearTamboConDueno(datos)`, la transacción del registro sacada de la ruta para poder testear el todo o nada sin la verificación previa del email
  - `api/src/rutas/lotes.ts`
  - `api/src/rutas/reglas-lote.ts`
  - `api/tests/validacion.test.ts`, `api/tests/base-lotes.test.ts`, `api/tests/lotes-iniciales.test.ts`, `api/tests/lotes.test.ts`, `api/tests/reglas-lote.test.ts`
  - `web/src/componentes/Layout.tsx`
  - `web/src/paginas/Lotes.tsx`
- Modificar:
  - `api/prisma/schema.prisma`
  - `api/src/validacion.ts`: `normalizarNombre`, `nombreLoteSchema`, `descripcionLoteSchema`
  - `api/src/errores.ts`: helper `esErrorPrisma(err, codigo)`
  - `api/src/rutas/auth.ts`: lotes iniciales en el registro
  - `api/src/app.ts`: montar las rutas nuevas
  - `api/tests/ayudas.ts`: helper `crearUsuario(agenteDueño, rol, email)` que devuelve el agente logueado
  - `web/src/api.ts`: manejador de 401 y tipos `Lote`, `ReglaLote`, `EstadoConDestino`
  - `web/src/auth.tsx`: registra el manejador de sesión vencida
  - `web/src/App.tsx`: ruta de layout con `/` y `/lotes`
  - `web/src/paginas/Inicio.tsx`
  - `web/src/estilos.css`
  - `MEMORY.md` y `docs/plan.md` (cierre)

## Decisiones
- **Nombre único sin mayúsculas con un índice único sobre `lower(nombre)`, agregado a mano.** Alternativa descartada: columna `citext`. Necesita una extensión de PostgreSQL y cambia cómo se compara el nombre en todas las consultas, cuando solo hace falta en la unicidad.
- **Detectar los repetidos con el índice y traducir el P2002 a 409.** Alternativa descartada: consultar antes si el nombre existe. Duplica la lógica y no evita la carrera entre dos usuarios; el índice es la única fuente de verdad.
- **Clave foránea compuesta (establecimientoId, loteId) declarada en Prisma.** Alternativa descartada: un trigger que compare tambos. Es más código, está escondido y Prisma no lo conoce. La clave compuesta, en cambio, además sostiene RF-9 y RF-31 con `ON DELETE RESTRICT`.
- **CHECK `estado <> 'BAJA'` en `reglas_lote`.** Alternativa descartada: un enum aparte sin BAJA para las reglas. Obliga a convertir entre dos enums y a cambiar el tipo de la columna, solo para excluir un valor.
- **RF-19 como migración de datos en SQL.** Alternativa descartada: un script que corra al iniciar la API o un seed. Se podría ejecutar más de una vez y volvería a crear lotes que el tambo ya eliminó; la migración corre una sola vez y queda versionada.
- **Lotes iniciales del registro en `crearLotesIniciales(tx, …)` dentro de la transacción existente, antes de crear al dueño.** Alternativa descartada: crearlos después de la transacción. Si fallaran, quedaría un tambo sin lotes (rompe RF-18).
- **Normalización:** recortar los extremos con `\s` (cubre espacios y tabulaciones), reducir `\s+` internos a un espacio y aplicar `normalize('NFC')`. La longitud se cuenta en code points (`[...texto].length`), así "ñ" o "é" valen 1 aunque vengan descompuestas. Alternativa descartada: `Intl.Segmenter` por grafemas. Es más complejo y no cambia nada para nombres de lotes.
- **Id mal formado responde 404, no 400** (lo pide RF-20). Se valida con `z.uuid().safeParse` y, si falla, 404. Es distinto de `/api/usuarios`, que hoy responde 400.
- **Mensaje de bloqueo al eliminar** armado en la API: "El lote tiene 3 animales" (o "1 animal"), "El lote es destino de En ordeñe y Seca", o los dos unidos: "El lote tiene 3 animales y es destino de En ordeñe". Alternativa descartada: devolver códigos y armar el texto en la web. La spec pide el mensaje concreto y la API ya devuelve textos en español.
- **Destinos en un recurso aparte (`/api/reglas-lote/:estado`, con PUT y DELETE).** Alternativa descartada: editarlos dentro de PATCH de un lote. Cada estado tiene un solo destino y el recurso natural es el estado, no el lote.
- **Menú como layout de React Router (`Outlet`) con `NavLink`.** Alternativa descartada: menú hamburguesa. Con 3 opciones alcanza una barra que se acomoda en dos filas, y la hamburguesa suma estado y esconde opciones. `NavLink` ya da `aria-current`.
- **Confirmación de eliminar con `window.confirm`.** Alternativa descartada: un diálogo propio con `<dialog>`. Es más código para una sola confirmación; se puede cambiar más adelante.
- **Sesión vencida (RF-29):** `api.ts` expone `alVencerSesion(fn)`. Si cualquier pedido, salvo `/auth/yo` y `/auth/login`, responde 401, llama a esa función. `AuthProvider` la registra para poner `usuario = null`, y `RutaPrivada` redirige al login. Alternativa descartada: revisar el 401 en cada pantalla. Se repite y es fácil olvidarlo.
- **Sin dependencias nuevas.**

## Estrategia de tests
Tests primero, con Vitest y supertest sobre `cowregister_test`. Para los roles, el helper `crearUsuario` crea un encargado y un veterinario con `POST /api/usuarios`.

| RF | Test (archivo › caso) |
|---|---|
| RF-1 | lotes.test.ts › lista solo los lotes del tambo, ordenados sin distinguir mayúsculas, con cantidad de animales activos (no cuenta BAJA) y `destinoDe` |
| RF-2, RF-27 | lotes.test.ts › dueño y encargado crean un lote con y sin descripción; la descripción de solo espacios queda `null`; la de 201 caracteres da 400 |
| RF-3 | lotes.test.ts › renombrar y cambiar o borrar la descripción no cambia sus reglas |
| RF-4, RF-5 | validacion.test.ts › normaliza espacios y tabulaciones de los extremos e internos; vacío; 50 caracteres con ñ/é se acepta y 51 no; forma descompuesta cuenta igual · lotes.test.ts › " En  ordeñe " se guarda como "En ordeñe" |
| RF-6 | lotes.test.ts › crear "secas" con "Secas" existente da 409; renombrar a un nombre de otro lote da 409; renombrar a sí mismo o cambiar solo las mayúsculas da 200; dos tambos con el mismo nombre se permiten · base-lotes.test.ts › insertar directo en la base "Secas"/"secas" falla |
| RF-7 | lotes.test.ts › elimina un lote sin animales ni reglas (204) y también uno que solo tiene animales dados de baja |
| RF-8 | lotes.test.ts › con 3 animales activos da 409 "El lote tiene 3 animales" (los animales se crean directo con Prisma, porque todavía no hay API de animales) |
| RF-9 | lotes.test.ts › destino de En ordeñe da 409 con el estado nombrado; con animales y destino a la vez, el mensaje nombra los dos · base-lotes.test.ts › borrar en la base un lote que es destino falla |
| RF-10 | Verificación manual en el navegador |
| RF-11, RF-14 | reglas-lote.test.ts › devuelve siempre 4 estados, con `lote: null` cuando no hay destino · manual: los avisos se ven |
| RF-12 | reglas-lote.test.ts › PUT reemplaza el destino anterior; repetir el mismo lote da 200 y no cambia nada |
| RF-13 | reglas-lote.test.ts › DELETE deja el estado sin destino; repetirlo da 204 |
| RF-15 | reglas-lote.test.ts › el mismo lote queda como destino de dos estados |
| RF-16 | reglas-lote.test.ts › PUT `/BAJA` da 400 · base-lotes.test.ts › insertar en la base una regla BAJA falla |
| RF-17 | reglas-lote.test.ts › `loteId` de otro tambo, inexistente o mal formado da 404 · base-lotes.test.ts › insertar en la base una regla que apunta a un lote de otro tambo falla |
| RF-18 | lotes-iniciales.test.ts › un registro nuevo tiene los 4 lotes y las 4 reglas; si el dueño falla (email repetido forzado llamando a la función de registro sin la verificación previa), no queda ni el establecimiento ni sus lotes |
| RF-19 | lotes-iniciales.test.ts › se arman con Prisma tambos sin reglas, con un lote "  terneros" propio y con SECA apuntando a "Secas viejas"; se ejecuta el bloque extraído de la migración 2 y se comprueba que reutiliza, crea y no toca lo que corresponde |
| RF-20 | lotes.test.ts y reglas-lote.test.ts › **aislamiento entre dos tambos para cada acción**: listar, ver, crear (queda en el tambo de la sesión aunque se mande un `establecimientoId`), editar, eliminar, configurar y quitar destino. El tambo B nunca ve ni toca lo de A, y las acciones sobre un id de A responden 404 |
| RF-21, RF-22 | lotes.test.ts y reglas-lote.test.ts › el veterinario puede listar (200), pero POST, PATCH, DELETE, PUT y DELETE de regla dan 403, también con un id de otro tambo o mal formado |
| RF-23 a RF-26, RF-28 a RF-30 | Verificación manual en el navegador a 768 px y 375 px, en modo claro y oscuro: menú, `aria-current`, controles de 48 px, sin desbordes, "…" en nombres largos, cerrar sesión, y sesión vencida (borrando la sesión en la base) que lleva al login |
| RF-31 | base-lotes.test.ts › borrar un lote referenciado falla e insertar una regla hacia un lote inexistente falla; o sea, nunca queda un destino colgado · reglas-lote.test.ts › PUT hacia un lote recién eliminado da 404 |
| RF-32 | lotes.test.ts › PATCH y DELETE sobre un lote ya eliminado dan 404 |

## Riesgos
- **Que Prisma quiera borrar el índice sobre `lower()` o el CHECK en una migración futura.** Se mitiga con la verificación de `migrate diff` de T1 y quedando anotado en MEMORY.md.
- **Que `lower()` no se comporte bien con letras acentuadas.** Depende de la collation de la base; con UTF-8 funciona. Si la base de producción usara otra, hay que revisarlo en la Etapa 7.
- **Que haya animales dados de baja con `loteId` cargado.** Esta spec asume que la baja los saca del lote, pero no lo garantiza la base. Conviene agregar `CHECK (estado <> 'BAJA' OR "loteId" IS NULL)` en la Etapa 3, junto con las bajas.
- **Que el test de RF-19 se separe de la migración real.** Lo evita que el test lea el bloque directamente del `migration.sql` entre los marcadores.
