# 001 — Lotes y destino de cada estado

Estado: aprobada
Fecha: 2026-11-10

## Contexto
En el tambo los animales se agrupan en lotes (terneros, vaquillonas, vacas en ordeñe, secas, etc.) y cada tambo los organiza a su manera. Hoy esa organización está en papel o en la cabeza del encargado. Esta funcionalidad permite que cada tambo arme sus propios lotes con nombres libres y defina a qué lote va un animal según su estado. Esa configuración es la base para que, en etapas siguientes, los animales se muevan solos de lote al cambiar de estado.

También suma un menú de navegación, porque la app empieza a tener más de una pantalla y el usuario necesita moverse entre ellas desde la tablet o la PC.

La usan el dueño y el encargado (para administrar) y el veterinario (para consultar).

## Alcance
- Incluye:
  - Ver, crear, editar (nombre y descripción opcional) y eliminar lotes del propio tambo.
  - Configurar el lote destino de cada estado del animal: recién nacido, vaquillona, en ordeñe y seca.
  - Lotes y destinos iniciales para los tambos nuevos y para los que ya están registrados.
  - Menú de navegación con Inicio, Lotes y Cerrar sesión, más el nombre del tambo y del usuario.
- No incluye:
  - El movimiento automático de animales al cambiar de estado (Etapa 3).
  - La baja de animales por venta o muerte (Etapa 3).
  - Mover animales a mano entre lotes, y el alta y el listado de animales (paso 1.5 y siguientes).
  - Las secciones Animales y Usuarios en el menú (se suman cuando existan sus pantallas).
  - El destino final de los terneros (pendiente de definir).

## Supuestos y reglas del dominio
- **Animales de un lote:** en toda esta spec, "animales del lote" son solo los animales **activos**. Los dados de baja (vendidos o muertos) no cuentan.
- **Baja y lote:** al darse de baja, el animal sale de su lote y conserva su historial. La baja se implementa en otra etapa; esta spec solo asume esa regla.
- **Nombre normalizado:** para guardar y comparar nombres de lote se quitan los espacios y tabulaciones de los extremos, y varios espacios seguidos dentro del nombre cuentan como uno ("  En  ordeñe " equivale a "En ordeñe"). Al comparar no se distinguen mayúsculas de minúsculas.
- **Garantías en el almacenamiento:** las reglas marcadas con "deberá garantizarse también a nivel de almacenamiento" tienen que cumplirse aunque fallen las validaciones previas o haya operaciones simultáneas (constitución §6). Cómo se logra se define en el plan.

## Requisitos funcionales

### Lotes
- **RF-1** — El sistema deberá mostrar solo los lotes del tambo del usuario, ordenados alfabéticamente por nombre sin distinguir mayúsculas. De cada uno mostrará su nombre, su descripción, cuántos animales activos tiene y de qué estados es destino.
- **RF-2** — Cuando un dueño o encargado crea un lote con un nombre válido, el sistema deberá guardarlo en su tambo, con una descripción opcional.
- **RF-3** — Cuando un dueño o encargado edita un lote de su tambo, el sistema deberá permitir cambiarle el nombre y la descripción, sin cambiar sus animales ni los estados de los que es destino.
- **RF-4** — El sistema deberá guardar el nombre del lote normalizado: sin espacios ni tabulaciones en los extremos y con los espacios internos repetidos reducidos a uno.
- **RF-5** — Si el nombre normalizado queda vacío o supera los 50 caracteres, entonces el sistema deberá rechazarlo con un mensaje en español que diga cuál de las dos cosas pasó. Los caracteres se cuentan como letras visibles (por ejemplo, "ñ" o "é" cuentan como uno), no por su tamaño en bytes.
- **RF-6** — Si el nombre normalizado coincide con el de otro lote del mismo tambo, sin distinguir mayúsculas, entonces el sistema deberá rechazarlo con el mensaje "Ya existe un lote con ese nombre". Esto vale al crear y al renombrar. Deberá garantizarse también a nivel de almacenamiento.
- **RF-7** — Cuando un dueño o encargado elimina un lote de su tambo que no tiene animales activos y no es destino de ningún estado, el sistema deberá eliminarlo.
- **RF-8** — Mientras un lote tenga animales activos, el sistema deberá impedir eliminarlo con un mensaje que diga la cantidad (por ejemplo, "El lote tiene 3 animales").
- **RF-9** — Mientras un lote sea destino de uno o más estados, el sistema deberá impedir eliminarlo con un mensaje que nombre esos estados (por ejemplo, "El lote es destino de En ordeñe"). Deberá garantizarse también a nivel de almacenamiento.
- **RF-10** — El sistema deberá pedir confirmación antes de eliminar un lote.
- **RF-27** — El sistema deberá permitir una descripción opcional del lote de hasta 200 caracteres, guardada sin espacios en los extremos. Una descripción vacía o con solo espacios se guarda como "sin descripción". Al editar, la descripción se puede borrar. Si supera los 200 caracteres, el sistema deberá rechazarla con un mensaje en español que lo diga.

### Destino de cada estado
- **RF-11** — El sistema deberá mostrar, para cada estado (recién nacido, vaquillona, en ordeñe y seca), el lote destino configurado o la indicación "sin destino".
- **RF-12** — Cuando un dueño o encargado elige un lote de su tambo como destino de un estado, el sistema deberá guardarlo y reemplazar el destino anterior de ese estado. Cada estado tiene como máximo un destino.
- **RF-13** — Cuando un dueño o encargado quita el destino de un estado, el sistema deberá dejar ese estado sin destino.
- **RF-14** — Mientras un estado no tenga destino, el sistema deberá mostrar en la pantalla de lotes, sin que el usuario tenga que hacer nada, un aviso que nombre ese estado (por ejemplo, "Recién nacido no tiene lote destino").
- **RF-15** — El sistema deberá permitir que un mismo lote sea destino de varios estados.
- **RF-16** — El sistema deberá ofrecer como destinos posibles solo los estados recién nacido, vaquillona, en ordeñe y seca. El estado baja nunca tiene destino. Deberá garantizarse también a nivel de almacenamiento.
- **RF-17** — Si se intenta configurar como destino un lote que no existe o que es de otro tambo, entonces el sistema deberá responder "no encontrado". Que un destino nunca apunte a un lote de otro tambo deberá garantizarse también a nivel de almacenamiento.
- **RF-31** — Si un lote se elimina al mismo tiempo que otro usuario lo elige como destino, entonces el sistema deberá resolverlo de manera que nunca quede un destino apuntando a un lote inexistente: o el lote no se elimina (porque ya es destino), o la elección del destino falla con "no encontrado".

### Lotes iniciales
- **RF-18** — Cuando se registra un tambo nuevo, el sistema deberá crearle los lotes "Terneros", "Vaquillonas", "En ordeñe" y "Secas", configurados como destino de recién nacido, vaquillona, en ordeñe y seca respectivamente. El registro (tambo, usuario dueño, lotes y destinos iniciales) es todo o nada: si falla cualquier parte, no queda nada guardado. Los lotes iniciales se pueden editar y eliminar como cualquier otro.
- **RF-19** — El sistema deberá completar **una sola vez** los destinos de los tambos que ya estaban registrados. Solo se completan los estados sin destino: para cada uno se reutiliza el lote del tambo cuyo nombre normalizado coincida con el nombre inicial correspondiente (sin distinguir mayúsculas) o, si no hay, se crea. Los estados que ya tienen destino no se tocan y no se crea su lote inicial.

### Aislamiento y permisos
- **RF-20** — Si un usuario pide ver, editar, eliminar o usar como destino un lote que no existe, que es de otro tambo o cuyo identificador está mal formado, entonces el sistema deberá responder siempre "no encontrado", sin revelar si el lote existe en otro tambo.
- **RF-21** — Donde el usuario sea veterinario, el sistema deberá mostrar los lotes y los destinos en modo lectura, sin opciones para crear, editar, eliminar ni configurar.
- **RF-22** — Si un veterinario intenta crear, editar o eliminar un lote o cambiar un destino por cualquier vía, entonces el sistema deberá responder siempre "sin permiso", también cuando el lote no existe o es de otro tambo. El permiso se controla antes que la existencia del lote, así la respuesta no revela nada.
- **RF-32** — Si un dueño o encargado edita o elimina un lote que otro usuario acaba de eliminar, entonces el sistema deberá responder "no encontrado".

### Menú de navegación
- **RF-23** — Mientras el usuario tenga la sesión iniciada, el sistema deberá mostrar un menú con Inicio (la pantalla de bienvenida actual), Lotes y Cerrar sesión, junto con el nombre del tambo y del usuario.
- **RF-24** — El sistema deberá marcar en el menú la sección actual de forma visual y también accesible (que un lector de pantalla la anuncie como la página actual).
- **RF-25** — Mientras el usuario no tenga la sesión iniciada (login y registro), el sistema no deberá mostrar el menú.
- **RF-26** — El sistema deberá mostrar el menú y la pantalla de lotes con controles de al menos 48 px de alto y sin desbordes horizontales en anchos de 768 px y 375 px, en modo claro y oscuro.
- **RF-28** — Cuando el usuario elige "Cerrar sesión", el sistema deberá cerrarla sin pedir confirmación y llevarlo al login.
- **RF-29** — Si la sesión vence mientras el usuario usa la app, entonces el sistema deberá llevarlo al login.
- **RF-30** — Si el nombre del tambo o del usuario no entra en el menú, entonces el sistema deberá recortarlo con "…" sin romper el diseño, también en 375 px.

## Permisos por rol
| Acción | Dueño | Encargado | Veterinario |
|---|---|---|---|
| Ver lotes y destinos | Sí | Sí | Sí |
| Crear lote | Sí | Sí | No ("sin permiso") |
| Editar lote | Sí | Sí | No ("sin permiso") |
| Eliminar lote | Sí | Sí | No ("sin permiso") |
| Configurar o quitar el destino de un estado | Sí | Sí | No ("sin permiso") |
| Usar el menú | Sí | Sí | Sí |

## Casos límite
- Nombre vacío o con solo espacios o tabulaciones: se rechaza por vacío (RF-4, RF-5).
- Nombre con espacios en los extremos (" Secas "): se guarda como "Secas" y, si ya existe, se rechaza por repetido.
- Nombre con espacios internos repetidos ("En  ordeñe"): se guarda como "En ordeñe" y choca con un "En ordeñe" existente.
- Nombre que solo difiere en mayúsculas de uno existente ("secas" frente a "Secas"): se rechaza por repetido.
- Nombre de exactamente 50 caracteres con tildes o "ñ": se acepta. Con 51 se rechaza.
- Renombrar un lote a un nombre que ya usa otro lote del tambo: se rechaza. Renombrarlo a su propio nombre, o cambiarle solo las mayúsculas ("secas" a "Secas"), se permite.
- Dos tambos distintos pueden tener lotes con el mismo nombre.
- Descripción con solo espacios: queda sin descripción. Con 201 caracteres: se rechaza.
- Lote con animales activos y además destino de algún estado: no se puede eliminar, y el mensaje nombra los dos motivos (cantidad y estados).
- Lote que solo tiene animales dados de baja y no es destino: se puede eliminar.
- Lote que dejó de tener animales activos y de ser destino: se puede eliminar.
- Ver, editar o eliminar un lote de otro tambo, uno inexistente o uno con identificador mal formado: "no encontrado".
- Configurar como destino un lote de otro tambo, uno inexistente o uno recién eliminado: "no encontrado" (RF-17).
- Veterinario que intenta modificar un lote de otro tambo o inexistente: "sin permiso", no "no encontrado" (RF-22).
- Intentar configurar un destino para el estado baja: se rechaza (RF-16).
- Elegir como destino el lote que ya es destino de ese estado: no cambia nada y no da error.
- Quitar todos los destinos: se permite, con un aviso por cada estado sin destino.
- Un tambo puede quedarse sin ningún lote si los elimina todos; todos los estados quedan sin destino, con su aviso.
- Falla una parte del registro de un tambo nuevo (por ejemplo, al crear los lotes iniciales): no queda guardado ni el tambo ni el dueño (RF-18).
- Tambo ya registrado con un lote propio "terneros" y recién nacido sin destino: se reutiliza ese lote, sin crear otro (RF-19).
- Tambo ya registrado con seca apuntando a un lote "Secas viejas": no se toca ni se crea "Secas" (RF-19).
- Completar los destinos iniciales es una operación única: no se repite y no vuelve a crear lotes que el tambo eliminó después.
- Datos previos que ya violen la regla de mayúsculas (dos lotes "Secas" y "secas" en un tambo): hoy no hay tambos registrados con lotes, pero al aplicar la regla se verifica y, si existiera el choque, se informa en vez de borrar o renombrar datos.
- Dos usuarios del mismo tambo crean a la vez un lote con el mismo nombre: solo uno se guarda; el otro recibe "Ya existe un lote con ese nombre".
- Editar o eliminar un lote que otro usuario acaba de eliminar: "no encontrado" (RF-32).
- Eliminar un lote mientras otro usuario lo elige como destino: nunca queda un destino apuntando a un lote inexistente (RF-31).
- La sesión vence con la pantalla de lotes abierta: la próxima acción lleva al login (RF-29).
- Nombre de tambo o de usuario muy largo: se recorta con "…" en el menú (RF-30).

## Criterios de aceptación
- [ ] Un dueño y un encargado pueden crear, renombrar, describir y eliminar lotes de su tambo, y la lista aparece en orden alfabético.
- [ ] Los nombres se guardan normalizados (RF-4). Los vacíos, los de más de 50 caracteres y los repetidos (sin distinguir mayúsculas) se rechazan con un mensaje en español que nombra el motivo.
- [ ] Las descripciones de más de 200 caracteres se rechazan; las vacías o con solo espacios quedan como "sin descripción"; al editar se pueden borrar.
- [ ] Al intentar eliminar un lote con animales activos o que es destino, el mensaje nombra el motivo concreto: la cantidad de animales y/o los estados.
- [ ] Los animales dados de baja no cuentan en la cantidad del lote ni impiden eliminarlo.
- [ ] Se puede elegir, cambiar y quitar el destino de recién nacido, vaquillona, en ordeñe y seca; baja no aparece como opción y se rechaza si se intenta igual.
- [ ] Cada estado sin destino muestra al abrir la pantalla de lotes un aviso que lo nombra.
- [ ] Un tambo recién registrado ya tiene "Terneros", "Vaquillonas", "En ordeñe" y "Secas" con sus destinos; si el registro falla a mitad, no queda nada guardado.
- [ ] Los tambos registrados antes de esta funcionalidad tienen completos los estados que no tenían destino, sin duplicar lotes ni tocar destinos existentes, y eso se hace una sola vez.
- [ ] La unicidad de nombres sin distinguir mayúsculas, que ningún destino apunte a otro tambo, que baja no tenga destino y que no se pueda eliminar un lote que es destino están garantizados también a nivel de almacenamiento.
- [ ] Cada acción (listar, ver, crear, editar, eliminar, configurar destino y quitar destino) tiene un test de aislamiento entre dos tambos que comprueba la respuesta "no encontrado".
- [ ] Un veterinario ve lotes y destinos pero recibe "sin permiso" en toda acción de modificación, incluso sobre lotes de otro tambo o inexistentes.
- [ ] Con la sesión iniciada se ve el menú (Inicio, Lotes, Cerrar sesión, nombre del tambo y del usuario) y la sección actual está marcada visualmente y anunciada como página actual. En login y registro no se ve.
- [ ] "Cerrar sesión" lleva al login sin pedir confirmación, y una sesión vencida también lleva al login.
- [ ] El menú y la pantalla de lotes tienen controles de al menos 48 px de alto y no se desbordan horizontalmente en 768 px y 375 px, en modo claro y oscuro. Los nombres largos se recortan con "…".

## Preguntas abiertas
- (ninguna; las decisiones de negocio se tomaron el 2026-11-10)
