# 006 — Bajas por venta o muerte

Estado: aprobada
Fecha: 2026-11-11 (aprobada el 2026-11-11)

## Contexto
Hoy un animal solo sale del rodeo activo cuando se anula el parto que lo dio de alta (spec 004). Falta lo básico del tambo: registrar que una vaca se **vendió** o **murió**, sin perder su historial, y poder corregir el error si se cargó mal. El movimiento automático de lote según el estado ya existe (specs 001, 004 y 005); esta spec cubre la **Etapa 3: bajas por venta o muerte**.

La baja la registra el dueño o el encargado desde la ficha, en la tablet. Los tres roles consultan después los animales dados de baja.

**Depende de** las specs 001 (lotes), 002 (animales, número único entre activos, ficha solo de activos, planilla), 003 y 004 (eventos que solo se agregan, anulación con motivo, lote previo, estados, crías de parto) y 005 (edición, historial de cambios manuales). **Extiende** esas specs en los puntos de "Extensiones a otras specs" (más abajo); fuera de ellos no cambian.

## Alcance
- Incluye:
  - Registrar la baja de un animal activo por venta o por muerte (fecha, motivo, observaciones).
  - Revertir una baja registrada por error (reactivar al animal), sin borrar nada.
  - Listado de bajas (con filtros) y ficha de baja de solo lectura con el historial.
  - Aviso al usar un número que perteneció a un animal dado de baja.
  - Arreglar el desborde horizontal del menú del encabezado a 375 px (riesgo pendiente de MEMORY.md), porque se suma una entrada "Bajas".
- No incluye:
  - Bajas por otros motivos (descarte, robo, etc.): la lista queda cerrada en venta y muerte (más el motivo interno "parto anulado" de la spec 004).
  - Datos de la venta (comprador, precio, peso) o de la muerte (causa): van en las observaciones de texto libre. Informes de ventas o mortandad.
  - Baja de varios animales a la vez.
  - Editar una baja registrada: si se cargó mal, se revierte y se vuelve a registrar.
  - Cambios en la regla de movimiento automático de lote por estado.
  - Uso sin conexión (Etapa 6).

## Supuestos y reglas del dominio
- **Reglas heredadas:** todo lo de las specs 002 a 005 vale acá: animales activos del tambo, número normalizado, fechas `AAAA-MM-DD`, hora de Argentina, el cliente no manda el tambo (se ignora su `establecimientoId`), recurso de otro tambo, inexistente o con id mal formado responde "no encontrado" idéntico, y los códigos: sin sesión 401, sin permiso 403, datos inválidos 400 con mensaje en español, conflicto 409. Orden de controles: sesión 401, permiso 403, formato del cuerpo 400, búsqueda 404, reglas de datos 400, conflictos 409 (la validación del cuerpo va antes que la búsqueda, como en la 004: cuerpo inválido con animal inexistente da 400).
- **Baja lógica:** el animal nunca se borra. Pasa a estado "baja", con fecha y motivo de baja, **sin lote**, y conserva sus datos, madre, crías, eventos e historial.
- **Datos de la baja (nombres):** `motivo` (el de la baja: solo `"venta"` o `"muerte"`, en minúsculas y exactos; cualquier otro valor, incluidos `"VENTA"`, con espacios, `null`, vacío o un tipo que no es texto, da 400), `fecha` y `observaciones`. El motivo de la reversión se llama **`motivoReversion`** (otro campo, otro significado).
  - `fecha`: obligatoria, texto `AAAA-MM-DD` de una fecha existente (`2026-02-30` y `null` dan 400), no futura, no anterior al 01/01/2000, no anterior a la fecha de nacimiento del animal ni al **último evento no anulado propio del animal** (igual fecha se acepta). **No se compara con las crías ni con la madre** (igual que la decisión 6 de la 005): dar de baja a una madre no revisa a sus crías.
  - `observaciones`: opcionales; `null` o ausentes quedan "sin observaciones"; un tipo que no es texto da 400; se recortan los espacios de los extremos, hasta 200 caracteres; vacías o solo espacios quedan "sin observaciones"; más de 200: 400.
  - `motivoReversion`: obligatorio, texto, recortado, de 1 a 200 caracteres; ausente, `null`, vacío, solo espacios, no texto o de más de 200: 400.
- **Quién puede ser dado de baja:** cualquier animal activo, hembra o macho, en cualquier estado. Sin condiciones por preñez vigente ni por crías.
- **Qué recuerda la baja:** el estado y el lote del animal justo antes, igual que partos y secados; "sin lote previo" y "lote previo eliminado" son dos situaciones distintas, y la baja no impide eliminar el lote previo (spec 001).
- **La baja es un evento del historial** (tipo "baja", detalle: motivo y observaciones). **Convivencia con las specs 003 y 004:**
  - La baja **no se anula** por la anulación de eventos de esas specs: se **revierte** (RF-7). La interfaz no ofrece "Anular" sobre ella, y la anulación de eventos nunca la alcanza (el animal de baja no es activo: "no encontrado").
  - El tipo "baja" **no cuenta** para la situación reproductiva, el ciclo, la fecha probable, la genética, el aviso 8, "el último evento no anulado" que se debe anular primero, "sexo con eventos o crías" (005 RF-4) ni "eventos propios no anulados" de una cría (004 RF-28). Una baja vigente solo existe mientras el animal está de baja; una baja revertida queda anulada y tampoco cuenta.
- **Fuente de verdad:** manda la baja registrada en el historial; la fecha y el motivo que lleva el animal son su copia y siempre deben coincidir con los de su baja vigente.
- **Revertir una baja:**
  - Se identifica por **el animal** (su id, de un animal de baja). Un animal activo (también uno ya revertido), inexistente, de otro tambo, con id mal formado o dado de baja por "parto anulado" responde **"no encontrado"**, idéntico en todos los casos. Una baja por "parto anulado" no se revierte (se corrige con el parto).
  - Devuelve al animal a "activo" con el estado y el lote previos, vacía su fecha y motivo de baja y marca la baja como anulada (quién, cuándo y `motivoReversion`). No pasa por el destino de lotes de su estado: respeta el lote previo aunque haya cambiado la configuración.
  - Sin límite de tiempo. Después de revertir, se puede dar de baja de nuevo: la historia muestra la primera baja anulada y la segunda vigente.
- **Número:** al dar de baja queda libre (unicidad solo entre activos, spec 002). Revertir puede chocar con un animal activo que ya lo usa (409).
- **Orden de rechazos al dar de baja:** 401, 403, 400 de formato/datos del cuerpo, 404 (animal no activo, inexistente, ajeno o mal formado), 400 de fecha (futura, 1999, anterior al nacimiento o al último evento). No hay conflictos 409 propios.
- **Orden de rechazos al revertir:** 401, 403, 400 (`motivoReversion` inválido, también con animal inexistente), 404, 409 (número ocupado). Un 404 gana siempre sobre el 409.
- **Vínculos hacia animales de baja (madre y crías):** el vínculo madre–cría no cambia al dar de baja.
  - Ficha de un animal **activo** cuya madre está de baja por venta o muerte: muestra el número de la madre con la marca "dada de baja" y acceso a su ficha de baja. Si la madre está de baja por "parto anulado": número con la marca "dada de baja", **sin acceso** (su ficha da "no encontrado").
  - Ficha (activa o de baja) de una madre: sus crías activas con acceso como hoy, y sus crías de baja por venta o muerte con la marca "dada de baja" y acceso a su ficha de baja; las de "parto anulado" con marca y sin acceso.
  - En la lista de eventos de la madre, una cría de un parto dada de baja por venta o muerte figura con su número, la marca "dada de baja" y acceso a su ficha de baja (extiende la 004 RF-38); por "parto anulado" sigue sin acceso.
  - Una madre de baja **no puede asignarse** a un animal nuevo ni a uno editado (la madre debe ser una hembra activa; mensaje genérico de la 002). Sí **se conservan** los vínculos existentes. La detección de ciclos de madres de la 005 recorre también a los animales de baja.
- **Cría de un parto dada de baja:** si después se anula ese parto, la anulación se rechaza con 409 y el mensaje "La cría N.º <número> está dada de baja por <venta|muerte>: revertí primero su baja" (004 RF-28). Para anular partos o secados de una vaca de baja, primero se revierte su baja (hoy: "no encontrado").
- **Extensiones a otras specs (solo lectura):** la 002 RF-30 y RF-35, la 003 (lectura de eventos y situación) y la 005 RF-15 y RF-18 (historial de cambios) responden "no encontrado" para un animal de baja. Esta spec habilita **solo la lectura** de un animal dado de baja **por venta o muerte del propio tambo**, y **solo** a través de la ficha de baja (RF-13) y el listado de bajas (RF-12): ahí se leen sus datos, eventos y cambios manuales. Todo lo demás sigue igual para un animal de baja: buscador, listado de activos, registrar o anular eventos, editar, mover, historial y eventos por las rutas de animales activos responden "no encontrado". Un animal de baja por "parto anulado" no tiene lectura de ningún tipo.
- **Aviso por número de un animal de baja (RF-14):** solo cuenta una baja **vigente por venta o muerte** (no "parto anulado" ni un animal ya reactivado). Si hay varias bajas con el mismo número en el tambo, se informa la **más reciente** (por fecha de baja y, a igual fecha, por momento de registro). Aplica al **alta manual**, a la **edición del número** (005) y a la **planilla** (002, por fila). No aplica a los números de las crías de un parto. El aviso no persiste.
- **Todo o nada:** cada baja o reversión se guarda completa o no se guarda nada.

## Requisitos funcionales

### Registrar la baja
- **RF-1** — Cuando un dueño o encargado registra la baja de un animal activo de su tambo con motivo y fecha válidos, el sistema deberá, en una sola operación, guardar la baja con el estado y el lote previos del animal, pasarlo a estado "baja" con su fecha y motivo y dejarlo sin lote.
- **RF-2** — Si el motivo falta o no es exactamente `"venta"` o `"muerte"`, o la fecha falta, no es texto o no es una fecha existente en formato `AAAA-MM-DD`, o las observaciones no son texto o superan los 200 caracteres (recortadas), entonces el sistema deberá rechazar la baja con 400 y un mensaje en español, sin guardar nada. El motivo "parto anulado" no se puede pedir.
- **RF-3** — Si la fecha es futura (hora de Argentina), anterior al 01/01/2000, anterior a la fecha de nacimiento del animal o anterior al último evento no anulado propio del animal, entonces el sistema deberá rechazar la baja con 400 y un mensaje en español que diga el motivo, con las fechas como `dd/mm/aaaa`. No se compara con crías ni con la madre.
- **RF-4** — Cuando se registra la baja, el sistema deberá conservar el historial completo del animal (eventos, crías, cambios manuales, madre) y liberar su número para otros animales activos.
- **RF-5** — Cuando un animal está dado de baja, el sistema deberá mostrar la baja en su lista de eventos (solo en la ficha de baja) con tipo, fecha, motivo, observaciones y quién la registró (solo el nombre); si fue revertida, con la marca de anulada, el `motivoReversion`, quién y cuándo. No ofrece "Anular" sobre ella.
- **RF-6** — Si el animal ya está dado de baja, no existe, es de otro tambo o su id está mal formado, entonces el sistema deberá responder "no encontrado" al registrar la baja, idéntico en todos los casos.

### Revertir la baja
- **RF-7** — Cuando un dueño o encargado revierte la baja por venta o muerte de un animal indicando el `motivoReversion`, el sistema deberá, en una sola operación, devolverlo a "activo" con el estado y el lote previos, vaciar su fecha y motivo de baja y marcar la baja como anulada (quién, cuándo y `motivoReversion`).
- **RF-8** — Si el número del animal ya lo tiene otro animal activo del tambo, entonces el sistema deberá rechazar la reversión con 409 y "Ya existe un animal activo con el número <número>: cambiale el número a ese animal o dejá esta baja", sin cambiar nada.
- **RF-9** — Si el lote previo ya no existe, o el animal no tenía lote antes de la baja, entonces el sistema deberá devolverlo sin lote e incluir **uno** de estos avisos (con el estado en español como lo muestra la ficha: «recién nacido», «vaquillona», «en ordeñe» o «seca»), que se muestra una sola vez y no persiste:
  - "El animal volvió a «<estado>» y quedó sin lote: su lote anterior ya no existe".
  - "El animal volvió a «<estado>» y quedó sin lote: no tenía lote antes de la baja del <dd/mm/aaaa>".
- **RF-10** — Si el `motivoReversion` es inválido, entonces el sistema deberá rechazar la reversión con 400 (también con un animal inexistente); si el animal no es un animal de baja por venta o muerte del tambo (cualquiera de los casos de "no encontrado" de las reglas, incluido uno ya revertido), deberá responder "no encontrado". El orden es: 401, 403, 400, 404, 409 (número ocupado).
- **RF-11** — Mientras un animal esté de baja, el sistema no deberá permitir registrar ni anular eventos, editarlo ni moverlo de lote (responden "no encontrado" como hoy); al revertir la baja, todo vuelve a estar disponible. Al revertir, el animal recupera su fecha de baja y motivo nulos.

### Ver las bajas
- **RF-12** — El sistema deberá ofrecer a los tres roles un listado de animales dados de baja **por venta o muerte** del tambo, con número, sexo, fecha de baja y motivo, ordenado por fecha de baja del más reciente al más antiguo y, a igual fecha, por momento de registro de la baja (más reciente primero). Filtros: por **motivo** (todos, venta o muerte) y por **número** (coincidencia exacta del número normalizado, solo entre las bajas). Las bajas por "parto anulado" no aparecen. Tope de 2.000 resultados con aviso. Un número con varias bajas muestra todas.
- **RF-13** — Cuando el usuario abre un animal dado de baja por venta o muerte desde el listado de bajas, el sistema deberá mostrar una ficha de solo lectura con: número, sexo, fecha de nacimiento, estado previo a la baja, madre y crías según las reglas de vínculos; una caja con el texto "Baja por <venta|muerte> el <dd/mm/aaaa>" y sus observaciones (o "sin observaciones") y quién la registró; el historial de eventos; y el historial de cambios manuales (con la leyenda de la 005). Donde el usuario sea dueño o encargado, deberá ofrecer "Revertir baja". Sin acciones de evento, edición ni movimiento. Un animal de baja de otro tambo, inexistente, mal formado o por "parto anulado" responde "no encontrado".
- **RF-14** — Cuando se da de alta o se edita el número de un animal (alta manual, edición de la 005 o fila de la planilla), con un número que tiene una baja vigente por venta o muerte en el tambo, el sistema deberá guardarlo igual e incluir en la respuesta el aviso "El número <número> perteneció a un animal dado de baja por <venta|muerte> el <dd/mm/aaaa>" (el de la baja más reciente). En la planilla es un aviso por fila en la vista previa y al confirmar, no un error; en el alta y la edición se muestra una sola vez al guardar y no persiste.

### Extensiones a otras specs
- **RF-15** — El sistema deberá, en las pantallas y respuestas existentes: (a) ofrecer en la ficha de la cría y la madre, y en la lista de eventos del parto, los vínculos hacia animales de baja de las reglas de "Vínculos"; (b) mensaje de la 004 RF-28 con cría de baja por venta o muerte como en las reglas; (c) detección de ciclos de madres que recorre también animales de baja; (d) que el alta y la edición con madre se resuelvan de a una respecto de la baja de esa madre (el alta bloquea a la madre; riesgo pendiente de MEMORY.md).

### Operaciones simultáneas
- **RF-16** — Si dos operaciones simultáneas afectan al mismo animal, a su madre o a su número, el sistema deberá resolverlas de a una y terminar con uno de los resultados aceptables de esta tabla, dejando cumplidos los invariantes de abajo:

| Operación A × Operación B | Resultados aceptables |
|---|---|
| Baja × baja del mismo animal | Uno 201 y el otro 404 |
| Baja × registrar servicio, tacto, parto o secado del mismo animal | Evento 201 y baja 201 o 400 (fecha anterior al evento); o baja 201 y evento 404 |
| Baja × anular servicio, tacto, parto o secado del mismo animal | Anulación 200 y baja 201 o 400 (fecha); o baja 201 y anulación 404 |
| Baja × editar o mover el mismo animal | Ambos con éxito en orden coherente, o baja 201 y la edición 404 |
| Baja de la cría × anular el parto que la dio de alta | Anulación 200 (la cría queda "parto anulado") y baja 404; o baja 201 y anulación 409 |
| Baja de una madre × alta o edición de una cría con esa madre | Ambos con éxito (la cría quedó vinculada antes de la baja), o la cría 400 (madre no activa) |
| Baja × alta, edición de número, parto o planilla con el número del animal que se da de baja | Baja 201 y el otro 201/200 (si entró después), o el otro 409 (si entró antes) |
| Baja × eliminar el lote del animal | Baja 201 y eliminación 200 (el lote previo queda "eliminado"); o eliminación 409 y baja 201 |
| Revertir × revertir el mismo animal | Uno 200 y el otro 404 |
| Revertir × baja del mismo animal | Revertir 200 y baja 201 o 404; o baja 404 y revertir 200 |
| Revertir × registrar, anular, editar o mover el mismo animal | Revertir 200 y el otro con éxito o con su 400/409 habitual; o el otro 404 (si entró antes) |
| Revertir × alta, edición de número, parto o planilla con el mismo número | Uno 200 o 201 y el otro 409 |
| Revertir × eliminar el lote previo | Revertir 200 con el lote y eliminación 409; o eliminación 200 y revertir 200 sin lote y con el aviso "su lote anterior ya no existe" |
| Revertir una cría de baja × anular el parto de su madre | Revertir 200 y anulación 200 (la cría pasa a "parto anulado") o 409; o anulación 409 y revertir 200 |

  **Invariantes:** (a) ningún animal de baja tiene lote y todo lote asignado es del tambo del animal; (b) no hay dos animales activos del mismo tambo con el mismo número; (c) todo animal de baja tiene fecha y motivo y ninguno activo los tiene; (d) todo animal de baja por venta o muerte tiene **exactamente una** baja no anulada, igual en fecha y motivo, y ningún animal activo tiene una baja no anulada; (e) toda cría vinculada a una madre de baja fue vinculada (alta o cambio de madre) antes del momento de la baja de esa madre; (f) los de la 004 (b) y (e) siguen valiendo.

### Aislamiento y permisos
- **RF-17** — El sistema deberá registrar, revertir y mostrar bajas solo de animales del tambo del usuario, nunca de otro, sin usar ningún identificador de tambo del cliente. El permiso por rol se controla en la API: quien no puede registrar ni revertir bajas (el veterinario) recibe 403, también con datos inválidos, cuerpo mal formado o un animal inexistente o de otro tambo; sin sesión, 401. El listado y la ficha de bajas los ven los tres roles.

### Garantías en el almacenamiento (constitución §6)
- **RF-18** — El sistema deberá garantizar, también a nivel de almacenamiento, con un test por cada una:
  1. un animal de baja tiene fecha y motivo; un activo no los tiene (incluido tras revertir); y no tiene lote;
  2. un animal tiene **a lo sumo una baja no anulada**, y la fecha y el motivo del animal coinciden con los de esa baja (manda la baja registrada);
  3. la baja pertenece al tambo de su animal y su detalle es de tipo baja;
  4. la anulación de la baja es completa (quién, cuándo y motivo juntos);
  5. el motivo de baja es de una lista cerrada con venta, muerte y parto anulado, y las bajas existentes ("parto anulado") siguen siendo válidas;
  6. los historiales de baja solo se agregan: una baja revertida no se borra.

### Interfaz
- **RF-19** — Cuando el usuario es dueño o encargado y el animal está activo, el sistema deberá mostrar en la ficha el botón "Dar de baja", que abre un formulario con motivo (venta o muerte, sin valor por defecto), fecha (por defecto hoy) y observaciones, y un paso de confirmación con el texto "Vas a dar de baja a «<número>». Sale de los lotes y de los listados activos, pero conserva su historial. ¿Confirmás?". Al guardar, lleva a la ficha de baja del animal con el mensaje "Baja registrada: <número>, <venta|muerte> del <dd/mm/aaaa>". El veterinario no ve el botón. La ficha de baja ofrece "Revertir baja" (pide `motivoReversion`) y, al guardar, vuelve a la ficha del animal activo con "Baja revertida" y el aviso de RF-9 si corresponde.
- **RF-20** — El sistema deberá incluir la entrada "Bajas" en el menú para los tres roles, con el menú sin desborde horizontal a 375 px (se arregla `.menu-acciones` del encabezado). El listado y la ficha de baja muestran el motivo y la fecha en la caja de baja de RF-13 (texto exacto de ahí) con el contraste de la interfaz en modo claro y oscuro. Formularios, filtros, listado y botones tienen campos y botones de al menos 48 px de alto, sin desbordes horizontales en 768 px y 375 px, con mensajes de error en español. Se verifica en el navegador.
- **RF-21** — Cuando la pantalla recibe un 404 al dar de baja o revertir (otra persona ya lo hizo o el animal cambió), el sistema deberá mostrar "El animal ya no está disponible para esta acción: otra persona pudo haberlo dado de baja o revertido. Se actualizó la pantalla." y recargar la ficha o el listado. Ante un 409 por número ocupado, deberá mostrar el mensaje en la ficha de baja sin cambiar de pantalla; ante un 400, mantener lo cargado en el formulario y mostrar el mensaje.

## Permisos por rol
| Acción | Dueño | Encargado | Veterinario |
|---|---|---|---|
| Dar de baja por venta o muerte | Sí | Sí | No ("sin permiso") |
| Revertir una baja | Sí | Sí | No ("sin permiso") |
| Ver el listado y la ficha de bajas | Sí | Sí | Sí |

## Casos límite
- Baja de una vaca preñada, en ordeñe, seca, vaquillona, recién nacida o de un macho: se acepta. Queda sin lote.
- Fecha de baja de hoy: se acepta; de mañana: 400; `2026-02-30`: 400; `null`: 400; 31/12/1999: 400. Anterior al nacimiento o al último evento no anulado: 400. Igual al último evento: se acepta. La fecha de baja de una madre no se compara con la de nacimiento de sus crías.
- Motivo `"VENTA"`, `" venta"`, `""`, `null`, número o `"parto anulado"`: 400. Observaciones de 200 caracteres: se acepta; 201: 400; solo espacios o `null`: "sin observaciones"; un número: 400. `motivoReversion` solo espacios, `null` o ausente: 400.
- Madre con crías activas dada de baja: se acepta; las crías siguen vinculadas y la ficha muestra a la madre con "dada de baja". No se puede asignar esa madre a otra cría (400, mensaje genérico de la 002).
- Madre activa con una cría dada de baja por venta o muerte: la ficha de la madre muestra la cría con "dada de baja" y acceso a su ficha de baja; la de "parto anulado", sin acceso.
- Cría de un parto dada de baja y después anular ese parto: 409 "La cría N.º X está dada de baja por <venta|muerte>: revertí primero su baja". Anular un parto o secado de una vaca de baja: "no encontrado".
- La baja no cuenta como evento reproductivo: una vaca preñada que se revierte vuelve con su preñez vigente, sin aviso 8 ni cambios del sexo bloqueados por la baja.
- Alta, edición de número o fila de planilla con el número de un animal de baja: se acepta con aviso; con dos bajas del mismo número: el aviso es el de la más reciente; con un número cuya baja fue revertida (hoy activo): 409 por número repetido (no hay aviso). Revertir luego la baja del animal viejo: 409 por número repetido.
- Revertir con el lote previo eliminado o sin lote previo: vuelve al estado previo sin lote, con el aviso que corresponde. Revertir con el lote previo existente: vuelve a ese lote aunque ya no sea el destino de su estado.
- Revertir una baja ya revertida, un animal activo, uno inexistente, ajeno, con id mal formado o con baja "parto anulado": "no encontrado" idéntico.
- Baja revertida y nueva baja del mismo animal: se acepta; la lista de eventos muestra la primera anulada y la segunda vigente; la fecha de la segunda se valida contra el último evento no anulado (la baja anulada no cuenta).
- Listado de bajas vacío: "No hay animales dados de baja". Filtro por número sin coincidencias: "No hay bajas con ese número". Las bajas "parto anulado" no aparecen.
- El número de un animal de baja no lo encuentra el buscador (mensaje de la 002 con acceso al alta).
- Veterinario que da de baja o revierte: 403 siempre. Sin sesión: 401. `establecimientoId` en el cuerpo: se ignora.
- Un animal de baja de otro tambo en listado, ficha o reversión: "no encontrado", idéntico a inexistente. Las respuestas no incluyen hashes.
- La sesión vence con la pantalla abierta: la próxima acción lleva al login.

## Criterios de aceptación
- [ ] Dueño y encargado dan de baja por venta o muerte a un animal activo en cualquier estado; queda de baja, sin lote, con fecha, motivo y observaciones, y su número queda libre (RF-1, RF-4).
- [ ] Los datos inválidos (motivo, fecha, observaciones, `motivoReversion`, `null`, tipos, espacios, mayúsculas) se rechazan con 400 y mensaje en español; un animal de baja, inexistente o de otro tambo da "no encontrado" (RF-2, RF-3, RF-6, RF-10).
- [ ] La baja figura en el historial de la ficha de baja y no ofrece "Anular"; no cuenta para situación reproductiva, ciclo, aviso 8, sexo con eventos ni eventos propios de una cría (RF-5).
- [ ] Revertir devuelve estado y lote previos, vacía fecha y motivo, marca la baja anulada, da los avisos de RF-9, 404 si no es una baja por venta o muerte, y 409 por número ocupado, con el orden de RF-10 (RF-7 a RF-10).
- [ ] El listado de bajas ordena por fecha de baja y registro, filtra por motivo y por número, excluye "parto anulado" y tiene tope con aviso; la ficha de baja es de solo lectura y no abre editar, mover, eventos ni buscador para animales de baja (RF-11 a RF-13).
- [ ] Los vínculos madre–cría hacia animales de baja y el 409 de anular un parto con cría de baja se comportan como en las reglas; los ciclos recorren bajas; el alta bloquea a la madre (RF-15).
- [ ] El aviso de número de un animal de baja sale en alta manual, edición de número y planilla, con la baja más reciente (RF-14).
- [ ] Tests de concurrencia para cada fila de RF-16, con comprobación de sus invariantes.
- [ ] Las garantías de RF-18 tienen su test directo contra la base.
- [ ] Cada acción (dar de baja, revertir, listar, ver ficha de baja) tiene un test de aislamiento entre dos tambos y uno de permisos por rol (veterinario 403 en dar de baja y revertir; sin sesión 401); ninguna respuesta incluye hashes.
- [ ] La interfaz cumple RF-19, RF-20 y RF-21 (acciones por rol, textos, 48 px, sin desbordes en 768 y 375 px incluido el menú, modo claro y oscuro), verificada en el navegador.

## Preguntas abiertas
- (ninguna; el usuario confirmó el 2026-11-11: dueño y encargado dan de baja y revierten, datos de motivo, fecha y observaciones, reversión sin límite de tiempo, listado y ficha de bajas propios con el buscador solo de activos, baja sin bloqueos por preñez ni crías, y filtro por número y orden por fecha de baja en el listado)
