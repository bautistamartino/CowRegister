# 005 — Editar animal y mover de lote a mano

Estado: aprobada
Fecha: 2026-11-11 (aprobada el 2026-11-11)

## Contexto
Hoy la ficha de un animal es solo lectura (spec 002). Si el tambo cargó mal un número, un sexo, una fecha de nacimiento o la madre, no hay forma de corregirlo, y tampoco de mover un animal de lote a mano (por ejemplo, pasar una vaca a un lote de "enfermería"), aunque el requisito original lo pide. Esta spec agrega ambas cosas cuidando no romper lo que ya registraron las specs 003 y 004 (partos, secados, crías).

La usan el dueño y el encargado, desde la ficha, en la tablet. El veterinario solo consulta.

**Depende de** las specs 001 (lotes y destinos), 002 (animales, número, fecha y madre) y 004 (crías de un parto, estado que dejan los partos y secados, lote previo, avisos). **Extiende la 004** con un aviso nuevo en la anulación de partos y secados (RF-13).

## Alcance
- Incluye:
  - Editar número, sexo, fecha de nacimiento y madre de un animal activo.
  - Mover un animal activo a otro lote, o dejarlo sin lote, a mano.
  - Reglas para que la edición respete los partos y crías ya registrados.
  - Historial de los cambios hechos a mano (qué, antes, después, quién, cuándo) y su lectura en la ficha.
  - Un aviso nuevo al anular un parto o secado cuando se pierde un lote puesto a mano.
- No incluye:
  - Cambiar el estado a mano: solo lo cambian los eventos (parto, secado y sus anulaciones) y, en la Etapa 3, las bajas.
  - Editar animales dados de baja y las bajas (Etapa 3).
  - Editar o corregir eventos (siguen solo agregándose y anulándose).
  - Mover varios animales a la vez.
  - Validar la fecha de nacimiento contra los eventos o las crías del animal (solo contra su madre).

## Supuestos y reglas del dominio
- **Reglas heredadas:** todo lo de las specs 002, 003 y 004 vale acá: animales activos, número normalizado (mayúsculas, 1 a 20 caracteres, letras sin tildes, dígitos, guion y punto), fecha de nacimiento (no futura según la hora de Argentina, no anterior al 01/01/2000), madre (hembra activa del mismo tambo, distinta del animal), combinación sexo y estado (los machos solo "recién nacido"), y los códigos: sin sesión 401, sin permiso 403, datos inválidos 400 con mensaje en español, inexistente, de otro tambo, mal formado o de baja 404, conflicto 409.
- **Estado:** no se edita (decisión 1); lo determinan los eventos y la spec 004 exige que el estado de la vaca coincida con el que dejó su último parto o secado.
- **Cría de parto:** animal dado de alta por un parto (spec 004). Su fecha y su madre son los del parto, así que de ella **solo se puede editar el número**.
- **"Eventos" y "crías" para el sexo:** cuentan los **eventos no anulados** del animal (servicio, tacto, parto, secado) y **todas sus crías, también las dadas de baja** (así una hembra que fue madre de una cría de un parto anulado no puede pasar a macho).
- **Fecha de nacimiento:** se valida solo contra la madre: la de la madre debe ser **estrictamente anterior**. No se compara con eventos ni con crías (decisión 6): editar la fecha de un animal no revisa a sus crías ni a sus eventos. Puede **vaciarse** (queda "sin dato") siempre que el animal no sea cría de parto (ahí rige RF-7); no hay otra condición.
- **Datos del pedido de edición:**

| Campo | Omitido | Valor | `null` |
|---|---|---|---|
| número | no se toca | texto a normalizar | 400 |
| sexo | no se toca | "hembra" o "macho" | 400 |
| fecha de nacimiento | no se toca | `AAAA-MM-DD` | la vacía |
| madre (por su número) | no se toca | número de una hembra activa | deja al animal sin madre |

- **Datos del pedido de mover:** solo el lote (identificador de un lote del tambo, o `null` para "sin lote"). Omitido o cuerpo vacío: 400.
- **Campos que dan 400** (con su mensaje): `estado` ("El estado no se cambia a mano: lo cambian los eventos"), `loteId` o `lote` en la edición ("Para cambiar de lote usá «Mover de lote»"), `id`, cualquier campo de un evento o del historial y cualquier otro campo no previsto ("El dato «X» no se puede editar"). En «Mover de lote» cualquier campo distinto del lote da el mismo tipo de 400. `establecimientoId` se **ignora sin error** (constitución §1). Cuerpo `{}`, o con todos los datos iguales a los actuales: 400 "No hay cambios para guardar".
- **Orden de los rechazos (RF-16):** sesión 401 → permiso 403 → formato del cuerpo 400 → búsqueda del animal (y del lote al mover) 404 → "sin cambios" 400 → reglas de datos 400 (combinación sexo-estado, fecha, madre) → conflictos 409 (cría de parto, sexo con eventos o crías, número repetido, lote eliminado en el medio). Se informa siempre el **primero** que corresponda.
- **Lote a mano:** a cualquier lote del tambo o sin lote; no cambia el estado. El destino por estado se vuelve a aplicar cuando un evento cambia el estado (parto, secado); anular un parto o secado devuelve a la vaca al lote previo **del evento** (spec 004), no al manual; si hubo un movimiento manual después del evento, se avisa (RF-13).
- **Historial (decisiones 3, 7 y 8):** registra **solo lo manual** (ediciones y movimientos de lote). Cada registro guarda el campo, el valor anterior y el nuevo **como texto copiado en ese momento** (nombre del lote, número de la madre, valores de sexo y fecha), el nombre y el id del usuario (copia del texto, sin vínculo que impida cambiar o eliminar usuarios), y el momento. Un lote que aparece en el historial **puede eliminarse** (la regla de la spec 001 no cambia). Los registros solo se agregan, nunca se editan ni se borran. Los cambios automáticos (estado y lote por partos y secados) no entran: se ven en los eventos, y la ficha lo aclara.
- **Garantías en el almacenamiento (constitución §6):**
  - **También en la base** (ya existen o se agregan): número único entre activos y de formato válido; un animal no es su propia madre; madre y lote siempre del mismo tambo; un animal de baja no tiene lote; una cría de parto no cambia de madre (la clave exige la del parto); el historial pertenece al tambo de su animal y no se puede modificar ni borrar.
  - **Solo en el código** (no se pueden expresar con una restricción simple): ciclos de madres (A madre de B y B de A, o más largos), que la madre sea hembra y anterior en fecha, sexo con eventos o crías, combinación sexo-estado, campos no editables. Se protegen con el bloqueo de RF-17.
- **Buscador:** al cambiar el número, el número viejo deja de encontrar al animal y el nuevo lo encuentra.

## Requisitos funcionales

### Editar datos
- **RF-1** — Cuando un dueño o encargado envía cambios válidos de número, sexo, fecha de nacimiento o madre de un animal activo de su tambo, el sistema deberá guardarlos y mostrar la ficha actualizada, conservando los campos omitidos y vaciando los enviados en `null` donde corresponde (ver tabla de datos).
- **RF-2** — Si el pedido trae un campo no editable (los de la lista de arriba), un `null` en número o sexo, un valor de formato inválido, o no cambia ningún dato respecto de los actuales (incluido `{}`), entonces el sistema deberá rechazarlo con 400 y el mensaje en español que corresponda, sin guardar nada. `establecimientoId` se ignora sin error.
- **RF-3** — Si el nuevo número, ya normalizado, está vacío, supera los 20 caracteres o tiene caracteres no permitidos, entonces el sistema deberá rechazarlo con 400 y un mensaje en español (spec 002). Si ya lo tiene otro animal activo del tambo, entonces deberá rechazarlo con 409 y "Ya existe un animal activo con ese número". Con operaciones simultáneas por el mismo número (edición, alta o parto), solo una deberá guardarse, también a nivel de almacenamiento.
- **RF-4** — Cuando se cambia el sexo, el sistema deberá aplicar la combinación sexo-estado de la spec 002 (un macho solo puede ser "recién nacido"; si no, 400 con mensaje en español). Si el animal tiene eventos no anulados o crías (aunque estén de baja), entonces deberá rechazar el cambio con 409 y un mensaje en español que diga el motivo.
- **RF-5** — Cuando se cambia la fecha de nacimiento, el sistema deberá exigir que sea válida (spec 002) y, si el animal tiene madre con fecha de nacimiento, que la de la madre sea estrictamente anterior; si no, deberá rechazarla con 400 y un mensaje en español que diga el motivo. Podrá vaciarse (ver reglas).
- **RF-6** — Cuando se cambia la madre, el sistema deberá exigir que sea una hembra activa del mismo tambo, distinta del animal, que no sea una de sus crías ni una descendiente suya, y con fecha de nacimiento anterior a la del animal si ambas la tienen; si no, deberá rechazarlo con 400. Mensajes: uno **genérico** para madre inexistente, de otro tambo o de baja ("No hay una hembra activa con el número X", sin revelar nada de otros tambos) y mensajes **propios** para macho del propio tambo, para el mismo animal, para ciclo ("X ya es descendiente de este animal") y para fecha. Se puede dejar al animal sin madre.
- **RF-7** — Si el animal es una cría de parto y el pedido trae sexo, fecha de nacimiento o madre (con cualquier valor, aun `null`), entonces el sistema deberá rechazarlo con 409 y un mensaje en español que explique que esos datos vienen del parto. El número de esa cría sí se puede cambiar.
- **RF-8** — Si cualquier parte de la edición falla, entonces el sistema deberá no guardar nada: ni los datos ni su historial.

### Mover de lote a mano
- **RF-9** — Cuando un dueño o encargado mueve un animal activo a un lote de su tambo, o a "sin lote", el sistema deberá hacerlo sin cambiar su estado y mostrar la ficha actualizada.
- **RF-10** — Si el lote pedido es el que el animal ya tiene (o ya está sin lote y se pide "sin lote"), entonces el sistema deberá rechazarlo con 400 y un mensaje en español.
- **RF-11** — Si el lote pedido no existe, es de otro tambo o tiene un identificador mal formado, entonces el sistema deberá responder "no encontrado", igual en los tres casos. Si el lote se elimina entre que se lee y se guarda el movimiento, entonces deberá rechazarlo con 409 y "El lote destino ya no existe, volvé a intentar", sin guardar nada. La carrera entre mover y eliminar se verifica en el plan.
- **RF-12** — El sistema deberá respetar el lote puesto a mano hasta que un evento cambie el estado del animal (parto, secado o sus anulaciones), que aplican las reglas de la spec 004.
- **RF-13** — Cuando se anula un parto o un secado y, después del momento en que se registró ese evento, hubo un movimiento manual de lote de la vaca y su lote actual es distinto del lote previo del evento, el sistema deberá devolverla igual al lote previo del evento y agregar a los avisos el **aviso 8** de la spec 004: "La vaca volvió al lote «<lote previo>» y se descartó el lote que se le había puesto a mano después del <parto|secado> del <dd/mm/aaaa>" (con "sin lote" si el previo era ninguno). Va al final de la lista y puede salir junto con el aviso 6 o el 7. Un movimiento manual anterior al evento, o ninguno, no lo genera.

### Historial de cambios manuales
- **RF-14** — Cuando se guarda una edición o un movimiento de lote, el sistema deberá agregar, en la misma operación, un registro por cada dato modificado con el campo, el valor anterior y el nuevo (copia del texto del momento), el nombre y el id de quien lo hizo y cuándo. Solo se agregan: nunca se editan ni se borran. No se registran los cambios automáticos.
- **RF-15** — El sistema deberá mostrar en la ficha, a los tres roles, el historial del más nuevo al más antiguo; los cambios de un mismo guardado van en este orden fijo de campo: número, sexo, fecha de nacimiento, madre, lote. Muestra los últimos 100 con el total (un animal rara vez tiene tantos y así la respuesta no crece sin límite) y la leyenda "Acá se ven los cambios hechos a mano; los cambios automáticos (estado y lote por partos y secados) están en los eventos". Se lee bien aunque el lote o la madre ya no existan, porque guarda texto.

### Orden de rechazos y operaciones simultáneas
- **RF-16** — Si un pedido tiene más de un motivo de rechazo, entonces el sistema deberá informar el primero según este orden: sesión 401, permiso 403, formato 400, búsqueda 404, "sin cambios" 400, reglas de datos 400 (sexo-estado, fecha, madre), conflictos 409 (cría de parto, sexo con eventos o crías, número repetido, lote eliminado). Dentro de cada grupo se evalúan los campos en el orden: número, sexo, fecha, madre.
- **RF-17** — Cuando se edita o mueve un animal, el sistema deberá resolver de a una las operaciones que comparten animales: bloquea a la vez al animal y a la nueva madre (en un orden fijo para no trabarse entre sí) y, para las ediciones de madre, serializa todas las del mismo tambo (así se detectan ciclos de cualquier largo). Debe terminar con uno de estos resultados, dejando cumplidos los invariantes de abajo:

| Operación A × Operación B | Resultados aceptables |
|---|---|
| A.madre = B × B.madre = A | Uno 200 y el otro 400 (ciclo) |
| A.madre = B × B.madre = C × C.madre = A | Dos 200 y uno 400 (ciclo) |
| X.madre = M × M pasa a macho (M sin crías) | Madre 200 y sexo 409 (ahora tiene crías); o sexo 200 y madre 400 (es macho) |
| X.madre = M × M cambia su fecha de nacimiento | Ambos 200 (la fecha de M cambia primero y X se valida contra la nueva, o al revés: la edición de M no revisa a sus crías); o madre 400 (fecha de M igual o posterior a la de X) |
| Número igual en dos ediciones, o en una edición y un alta o parto | Uno 200 o 201 y el otro 409 |
| Cambiar el sexo × registrar un evento de la misma vaca | Evento 201 y sexo 409; o sexo 200 y evento 201 o 409 (macho no apto) |
| Mover × eliminar ese lote | Mover 200 y eliminación 409; o eliminación 200 y mover 409 (RF-11) |
| Editar o mover × anular el parto que da de baja a esa cría | Ambos 200 en cualquier orden, o anulación 200 y la edición 404 |
| Mover × registrar parto o secado de la misma vaca | Ambos 200 y 201 en cualquier orden coherente: el lote final es el del último que entró |

  **Invariantes:** (a) no hay dos animales activos del mismo tambo con el mismo número; (b) no hay ciclos de madres; (c) toda madre asignada es hembra; (d) ningún animal de baja tiene lote y todo lote asignado es del tambo del animal; (e) todo dato cambiado a mano tiene su registro de historial.

### Aislamiento y permisos
- **RF-18** — El sistema deberá editar, mover y mostrar el historial solo de animales y lotes del tambo del usuario, nunca de otro. Un animal de otro tambo, inexistente, de baja o con identificador mal formado recibe "no encontrado", idéntico en los cuatro casos.
- **RF-19** — El sistema deberá controlar el permiso por rol en la API: quien no puede editar ni mover (el veterinario) recibe 403, también con datos inválidos, cuerpo mal formado o un animal inexistente o de otro tambo. Sin sesión, 401.

### Interfaz
- **RF-20** — Cuando el usuario es dueño o encargado, el sistema deberá mostrar en la ficha las acciones "Editar" y "Mover de lote"; cuando es veterinario, no deberá mostrarlas pero sí el historial. El formulario de edición viene con los datos actuales, no ofrece el estado ni, en una cría de parto, los datos que vienen del parto (explicando por qué); el de mover ofrece los lotes del tambo y "sin lote". Al guardar vuelve a la ficha con un mensaje de confirmación y los avisos del resultado en la caja de resultado; los errores se muestran en español.
- **RF-21** — El sistema deberá mostrar estos formularios, el historial y los avisos con campos y botones de al menos 48 px de alto, sin desbordes horizontales en 768 px y 375 px, en modo claro y oscuro. Se verifica en el navegador (también RF-20).

## Permisos por rol
| Acción | Dueño | Encargado | Veterinario |
|---|---|---|---|
| Ver ficha y historial de cambios | Sí | Sí | Sí |
| Editar número, sexo, fecha de nacimiento y madre | Sí | Sí | No ("sin permiso") |
| Mover de lote a mano | Sí | Sí | No ("sin permiso") |

## Casos límite
- Número libre, en minúsculas o con espacios en los extremos: se guarda normalizado. De un animal activo: 409. De uno de baja o de otro tambo: se acepta. Igual al actual (solo cambian mayúsculas) y nada más: 400 "No hay cambios". El número viejo deja de encontrar al animal en el buscador.
- Cambiar el número de una cría de parto: se acepta. Cambiar su sexo, fecha o madre (aun `null`): 409.
- Sexo de una hembra con un servicio no anulado: 409. Con solo eventos anulados y sin crías: se acepta (si el estado lo permite). Con una cría ya dada de baja: 409. Hembra recién nacida sin eventos ni crías a macho: se acepta. Vaca en ordeñe sin eventos a macho: 400 (sexo-estado).
- Fecha: de hoy se acepta, de mañana 400, 31/12/1999 400. Igual o anterior a la de la madre: 400. Vaciarla: se acepta (animal que no es cría de parto) y queda "sin dato". Posterior a un evento o a la fecha de una cría del animal: se acepta (no se valida).
- Madre inexistente, de otro tambo o de baja: mismo mensaje genérico. Macho propio, el mismo animal y una cría o nieta suya: mensajes propios, todos 400. Hembra nacida el mismo día o después: 400. `null`: queda sin madre.
- Pedido con `estado`, `loteId`, `id` o un campo desconocido: 400 con su mensaje. Con `establecimientoId`: se ignora. Con `numero: null` o `sexo: null`: 400. Con `fechaNacimiento: null`: la vacía. Con `{}`: 400 "No hay cambios".
- Cruces de rechazos: sexo con eventos y fecha inválida a la vez: gana el 400 de la fecha (400 antes que 409). Cría de parto con sexo y número repetido: gana el 409 de la cría de parto. Número repetido y sexo con eventos: gana el de sexo. Madre inexistente y número repetido: gana el 400 de la madre.
- Mover al mismo lote: 400. A "sin lote" estando sin lote: 400. A un lote ajeno, inexistente o mal formado: 404 idéntico. Cuerpo sin lote: 400.
- Anular un parto o secado después de mover a mano a la vaca: vuelve al lote previo del evento con el aviso 8. Si movieron a mano antes del evento, sin aviso. Si el lote manual coincide con el previo, sin aviso.
- Mover a mano y después registrar un secado: el secado guarda como lote previo el manual y deja a la vaca en el destino de "seca".
- El lote que figura solo en el historial se puede eliminar; el historial conserva su nombre.
- Dueño que edita mientras otro usuario le anula el parto a su madre o da de baja a la cría: se resuelven de a una; si la baja llega primero, "no encontrado".
- Veterinario que edita o mueve: 403 siempre, también con datos inválidos. Sin sesión: 401.
- La sesión vence con la pantalla abierta: la próxima acción lleva al login.

## Criterios de aceptación
- [ ] Un dueño y un encargado pueden cambiar número, sexo, fecha de nacimiento y madre con la tabla de datos (omitido, valor, `null`) y las reglas de RF-3 a RF-6; cada rechazo da el código y el mensaje que corresponde.
- [ ] El estado y los demás campos no editables dan 400 con su mensaje; `establecimientoId` se ignora; `{}` y los pedidos sin cambios dan 400 (RF-2).
- [ ] Una cría de parto solo cambia de número (RF-7); sexo respeta eventos no anulados y crías (aun de baja) (RF-4).
- [ ] La fecha se valida solo contra la madre y puede vaciarse (RF-5); la madre no admite ciclos de ningún largo (RF-6).
- [ ] Mover de lote (a un lote o a "sin lote") no cambia el estado, rechaza el mismo lote y los ajenos o inexistentes, y da 409 si el lote se elimina en el medio (RF-9 a RF-11); un evento posterior reaplica la regla de la 004 (RF-12).
- [ ] Anular un parto o secado tras un movimiento manual posterior devuelve el lote previo del evento y agrega el aviso 8, y no lo agrega si el movimiento fue anterior o no hubo (RF-13).
- [ ] Cada cambio manual guarda su registro en la misma operación y nada más (los cambios automáticos no); solo se agrega; la ficha lo muestra a los tres roles, más nuevo primero, con orden fijo de campo, tope de 100, la leyenda y los textos copiados aunque el lote o la madre ya no existan (RF-8, RF-14, RF-15).
- [ ] El orden de rechazos de RF-16 se cumple con los cruces de los casos límite.
- [ ] Tests de concurrencia para cada fila de la tabla de RF-17, con comprobación de sus invariantes.
- [ ] Las garantías "también en la base" (número único, propia madre, tambo de madre y lote, baja sin lote, historial del tambo y sin modificar ni borrar) tienen su test directo contra la base.
- [ ] Cada acción (editar, mover, ver historial) tiene un test de aislamiento entre dos tambos y uno de permisos por rol (veterinario 403, sin sesión 401). Ninguna respuesta incluye hashes.
- [ ] La ficha ofrece "Editar" y "Mover de lote" solo a dueño y encargado; los formularios, el historial y los avisos cumplen 48 px sin desbordes en 768 y 375 px, modo claro y oscuro; se verifica en el navegador (RF-20, RF-21).

## Decisiones tomadas
Tomadas el 2026-11-11 por el responsable del proyecto.
1. **Estado:** no se cambia a mano, solo por eventos.
2. **Sexo:** solo se cambia si el animal no tiene eventos ni crías y no es cría de un parto.
3. **Registro de cambios:** sí, tabla que solo se agrega (campo, antes, después, quién, cuándo), visible en la ficha.
4. **Mover de lote:** a cualquier lote del tambo o "sin lote"; el lote manual dura hasta el próximo evento que cambie el estado.
5. **Roles:** dueño y encargado editan y mueven; el veterinario solo consulta.
6. **Fecha de nacimiento:** se valida solo contra la madre; no contra eventos ni crías.
7. **Historial:** guarda una copia del texto del momento (nombre del lote, número de la madre, nombre del usuario) más el id del usuario, sin clave foránea que bloquee nada; un lote del historial se puede eliminar.
8. **Qué registra el historial:** solo lo manual; la ficha aclara que los cambios automáticos están en los eventos.
9. **Anular tras un movimiento manual:** la vaca vuelve igual al lote previo del evento y se agrega un aviso nuevo (aviso 8 de la lista de la 004).

## Preguntas abiertas
- (ninguna)
