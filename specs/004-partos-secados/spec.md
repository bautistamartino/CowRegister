# 004 — Partos, crías y secados

Estado: aprobada
Fecha: 2026-11-11 (aprobada el 2026-11-11)

## Contexto
Con la spec 003 el tambo ya registra servicios y tactos. Falta lo que cierra el ciclo: el **parto** (con una o dos crías, vivas o nacidas muertas), el **secado**, y que la vaca y las crías cambien de estado y de lote solos cuando corresponde. También hace falta poder corregir un parto o un secado mal cargado, volviendo atrás el estado y el lote sin borrar nada.

**Depende de la spec 003**, ya aprobada e implementada (catálogo de semen y toros, servicios, tactos, fecha probable de parto, orden total de eventos, anulación del último evento y situación reproductiva en la ficha). Esta spec parte de su comportamiento real y lo **extiende**: "el último evento no anulado" vale ahora para los cuatro tipos (servicio, tacto, parto y secado), el parto reinicia el ciclo reproductivo, y la anulación suma los partos y los secados.

La usan el dueño y el encargado (cargan y corrigen partos y secados) y el veterinario (consulta todo; sigue cargando y anulando solo servicios y tactos). Se cargan desde la ficha, en la tablet, en el tambo.

## Alcance
- Incluye:
  - Parto de una o dos crías, con alta de las vivas (madre vinculada) y registro de las nacidas muertas sin alta.
  - Secado de una vaca en ordeñe.
  - Cambio de estado y de lote de la madre y de las crías vivas, según la configuración del tambo (spec 001).
  - Genética de las crías (fecha de servicio y semen o toro) cuando es coherente.
  - Anulación de partos y secados con vuelta atrás del estado y el lote, y baja lógica de las crías vivas con motivo "parto anulado".
  - Garantía de que un animal de baja no tiene lote (riesgo pendiente de MEMORY.md).
  - En la ficha: partos y secados en la lista de eventos, crías, genética y avisos.
- No incluye:
  - Ventas, muertes y cualquier otra baja (Etapa 3): solo se agrega la baja por "parto anulado" y el lugar para los motivos futuros.
  - Editar un animal y mover de lote a mano (spec aparte).
  - Informes de natalidad y alertas automáticas ("a secar", "por parir").
  - Uso sin conexión (Etapa 6).
- Reparto esperable en 5 tareas (lo confirma el plan; los tests van con cada tarea):
  - **T1 Base de datos y reinicio del ciclo:** RF-17, RF-21 (el "último evento" de los cuatro tipos), RF-34 a RF-37.
  - **T2 API de registrar parto y secado, y lectura de eventos:** RF-1 a RF-16, RF-18 a RF-20, RF-31, RF-38 a RF-40 (datos), RF-41 a RF-43 (parto y secado).
  - **T3 API de anulación de partos y secados, con la baja de las crías:** RF-22 a RF-30, RF-32, RF-33, RF-41 a RF-43 (anulaciones).
  - **T4 Interfaz de registro y lectura:** formularios de parto y secado, lista de eventos, fichas de la madre y de la cría, avisos 1 a 5: RF-38 a RF-40 (pantalla), RF-44 (parto y secado), RF-45, RF-46.
  - **T5 Interfaz de anulación y cierre:** botón "Anular" y sus avisos 6 y 7, acciones por rol (RF-44), verificación en el navegador, MEMORY.md y revisión de las specs 001 y 002 (RF-37).

## Supuestos y reglas del dominio
- **Reglas heredadas de la 003:** todo lo dicho allí vale acá: animales activos, orden total (fecha y, a igual fecha, momento de registro), anulación con motivo, formato de fechas `AAAA-MM-DD`, reloj de Argentina fijable en los tests, orden de controles (sesión 401, permiso 403, formato del cuerpo 400, búsqueda 404, referencias y fechas 400, conflictos 409), el cliente no manda el tambo (se ignora el `establecimientoId` del cuerpo), "quién registró" solo con el nombre, las fechas en los mensajes como `dd/mm/aaaa`, y que un animal, evento o lote de otro tambo, inexistente o con id mal formado responde 404 "no encontrado", idéntico en los tres casos. Códigos: sin sesión 401, sin permiso 403, datos inválidos 400 con mensaje en español, evento que choca con el estado 409.
- **Una operación por vez por vaca:** toda operación que registra o anula un evento de un animal (de cualquier tipo) se resuelve de a una para ese animal, aun con usuarios simultáneos.
- **Último evento (extiende la 003):** el último evento no anulado de un animal, de cualquier tipo, en el orden total. Solo ese se puede anular.
- **Parto:** hembra activa en estado vaquillona, en ordeñe o seca (no macho ni recién nacida: 409). Datos: fecha y **una o dos crías**.
- **Datos de cada cría:**
  - `sexo`: obligatorio, hembra o macho (otro valor o ausente: 400).
  - `nacida muerta`: opcional, por defecto **no** (falso); si viene con un tipo que no es verdadero o falso: 400.
  - `número`: obligatorio si la cría está viva (reglas de la spec 002: mayúsculas, hasta 20 caracteres, letras sin tildes, dígitos, guion y punto); prohibido si nació muerta (400 si lo trae).
  - `observaciones`: opcionales; se recortan los espacios de los extremos, hasta 200 caracteres; vacías o solo espacios quedan "sin observaciones"; más de 200: 400.
  - Un campo no previsto en una cría se ignora.
- **Cría viva:** animal nuevo del mismo tambo, estado recién nacido, fecha de nacimiento igual a la del parto y madre vinculada. Dos crías vivas del mismo parto no pueden repetir número (aunque cambien las mayúsculas). La cría nacida muerta se registra en el parto, **no** se da de alta y **no lleva número**.
- **Vínculo cría–parto:** cada cría viva queda vinculada al parto que la dio de alta, y ese vínculo se conserva aun si después se la da de baja. Una cría viva pertenece a **un solo** parto; su madre es la madre del parto y su tambo es el del parto. Los animales dados de alta por otras vías no pertenecen a ningún parto.
- **Fecha del parto:** cumple las fechas de la 003 y además es **posterior** (estrictamente) a la fecha de nacimiento de la madre, si la tiene (misma regla que la spec 002 entre madre y cría).
- **Un parto cada 200 días como mínimo:** no puede haber dos partos no anulados de la misma vaca con menos de **200 días** entre sus fechas (409). Protege de cargar dos veces el mismo parto. Un aborto o parto prematuro dentro de ese plazo **no** se carga como parto: se registra como tacto "vacía" (003).
- **Cambio de estado y lote:** todo parto pasa la madre a "en ordeñe" y la asigna al lote destino de "en ordeñe", **aunque ya estuviera en ordeñe y en otro lote y aunque todas las crías hayan nacido muertas**; cada cría viva queda "recién nacido" en el lote destino de ese estado; la vaca pasa a "seca" y a su lote destino tras un secado. Si un estado no tiene lote destino, el animal queda **sin lote** y se avisa (como en la 002). Esta spec cambia el lote solo en estos eventos y al anularlos.
- **Vuelta atrás:** cada parto y cada secado conserva el estado y el lote de la vaca **justo antes** del evento. Hay dos situaciones distintas: **sin lote previo** (la vaca no tenía lote antes del evento; al anular vuelve sin lote, sin que sea un problema) y **lote previo eliminado** (tenía lote y el tambo lo eliminó después; al anular vuelve sin lote y se avisa). Ambas tienen su propio aviso y su propio texto en la ficha (ver "Avisos").
- **Genética:** el parto guarda como genética el **último servicio no anulado posterior al último parto no anulado** de la vaca (o, si no hubo parto, el último servicio de todo su historial), **ignorando los tactos "vacía"**. Se vincula **solo si** ese servicio está entre **240 y 300 días antes** de la fecha del parto (ambos extremos incluidos); si no hay servicio o está fuera de ese rango, el parto se guarda igual sin genética y se avisa. **No es el "servicio base" de la 003:** ese sigue usándose solo para la situación reproductiva y la fecha probable y sí depende de los tactos "vacía". La ficha de cada cría viva muestra la fecha de servicio y el semen o toro (con el nombre actual de la entrada aunque esté desactivada); si el servicio no tenía semen o toro, "sin dato".
- **El parto reinicia el ciclo (extiende la 003):** el servicio base, el ciclo y el estado reproductivo solo consideran los eventos posteriores al último parto no anulado; tras un parto el estado reproductivo es "sin servicio" y no hay fecha probable vigente ni fecha de referencia. El estado reproductivo se deriva del último evento no anulado entre servicios, tactos y partos: **el secado no cuenta** y no lo cambia (una vaca preñada se seca preñada). La regla de "servicio sobre vaca preñada" de la 003 se aplica al ciclo posterior al último parto.
- **Último servicio y último tacto en la ficha:** como en la 003, son los últimos no anulados de cualquier ciclo. Los que son anteriores al último parto no anulado se muestran rotulados "del ciclo anterior" y sin apariencia de vigentes (el estado dice "sin servicio" y no hay fecha probable).
- **Secado:** solo para una hembra "en ordeñe" (vaca seca, vaquillona, recién nacida o macho: 409). Es libre en lo demás: cualquier fecha válida (no anterior al último evento), preñada o no.
- **Baja por parto anulado:** al anular un parto, cada cría viva que dio de alta pasa a **baja lógica** (nunca se borra): estado baja, fecha de baja igual al día de la anulación (hora de Argentina), motivo "parto anulado" y **sin lote**. Conserva su historial y su número queda libre. El motivo de baja es un valor de una lista cerrada; hoy solo tiene "parto anulado" y queda lugar para venta y muerte de la Etapa 3.
- **Borrado de lotes:** el historial (lote previo de partos y secados) **no impide eliminar un lote**: la regla de la spec 001 no cambia (se elimina si no tiene animales activos ni es destino). Al eliminarlo, el lote previo del historial queda como "eliminado" sin afectar nada más ni a otro tambo. Esto obliga a revisar el borrado de lotes de las specs 001 y 002. Un lote destino **no puede eliminarse** (spec 001).
- **Lote destino inexistente:** un lote destino no puede eliminarse mientras sea destino, pero **sí puede pasar** que, entre que se lee el destino y se guarda el evento, el tambo le quite la regla al estado y elimine ese lote. En ese caso el evento se rechaza con 409 "El lote destino ya no existe, volvé a intentar" y no se guarda nada. Si en cambio la regla ya estaba quitada al leer, el animal queda sin lote y se avisa. El 409 se verifica también sembrando el dato en la base.
- **Orden de los rechazos de una anulación (409):** después del permiso (403), del motivo (400) y de la búsqueda (404), se informa siempre el **primero** que corresponda: (1) ya anulado, (2) no es el último evento no anulado, (3) el estado actual de la vaca ya no es el que dejó el evento, (4) una cría viva con eventos propios no anulados, ya no activa o madre de animales activos.
- **Defensas de la anulación:** que una cría ya no esté activa o que el estado actual de la vaca ya no sea el que dejó el evento **no pueden ocurrir hoy por la API**, pero sí cuando lleguen la edición manual de animales y las bajas de la Etapa 3. Se mantienen como controles y se verifican **sembrando los datos directo en la base**.
- **Orden de los rechazos de un parto (409):** después de los 400 (formato, fechas), los conflictos se evalúan siempre en este orden y se informa el **primero** que corresponda: (1) madre no apta, (2) menos de 200 días de otro parto, (3) número de cría existente (se informa el de la primera cría, en el orden en que vinieron), (4) lote destino que ya no existe al guardar.
- **Todo o nada:** cada registro o anulación se guarda completo o no se guarda nada (el parto con sus crías, el estado y lote de la madre).

### Avisos (lista cerrada)
Se devuelven con el resultado de la operación y la pantalla los muestra **una sola vez**, al terminarla: **no persisten** al recargar la ficha. Lo que persiste es el dato del lote previo en el historial (RF-38). Siempre salen en este orden (un aviso por situación):
1. "La vaca quedó sin lote: el estado «en ordeñe» no tiene un lote asignado" (parto).
2. "La vaca quedó sin lote: el estado «seca» no tiene un lote asignado" (secado).
3. "La cría N.º <número> quedó sin lote: el estado «recién nacido» no tiene un lote asignado" (una por cría viva, en el orden de carga).
4. "El parto se guardó sin genética: no hay un servicio cargado después del último parto" (o en todo el historial si no hubo parto).
5. "El parto se guardó sin genética: el último servicio es del <dd/mm/aaaa> y está fuera del plazo de 240 a 300 días antes del parto".
6. "La vaca volvió a «<estado>» y quedó sin lote: no tenía lote antes del <parto|secado> del <dd/mm/aaaa>" (anulación, **sin lote previo**).
7. "La vaca volvió a «<estado>» y quedó sin lote: su lote anterior ya no existe" (anulación, **lote previo eliminado**).

## Requisitos funcionales

### Parto y alta de las crías
- **RF-1** — Cuando un usuario autorizado registra un parto con fecha y datos válidos de una o dos crías, el sistema deberá guardar el parto con el estado y el lote previos de la madre, cambiar su estado a "en ordeñe" (aunque ya lo estuviera o todas las crías hayan nacido muertas) y asignarla al lote destino de "en ordeñe".
- **RF-2** — Cuando el parto trae crías vivas, el sistema deberá dar de alta a cada una (recién nacido, fecha de nacimiento igual a la del parto, madre vinculada, vinculada al parto) y asignarla al lote destino de "recién nacido".
- **RF-3** — Cuando el parto trae crías nacidas muertas, el sistema deberá registrarlas en el parto con su sexo y observaciones, sin darlas de alta y sin número.
- **RF-4** — Si cualquier parte del registro de un parto falla, entonces el sistema deberá no guardar nada: ni el parto, ni la madre modificada, ni ninguna cría.
- **RF-5** — Si el parto trae cero o más de dos crías, o a una cría le falta el sexo o tiene un sexo o un dato "nació muerta" inválido, o trae observaciones de más de 200 caracteres, entonces el sistema deberá rechazarlo con 400 y un mensaje en español. Las observaciones se guardan recortadas y vacías como "sin observaciones".
- **RF-6** — Si una cría nacida muerta trae número, o una cría viva no lo trae o lo trae inválido (reglas de la spec 002), entonces el sistema deberá rechazar el parto con 400 y un mensaje en español.
- **RF-7** — Si dos crías vivas del mismo parto tienen el mismo número (aunque cambien las mayúsculas), entonces el sistema deberá rechazar el parto con 400 y un mensaje en español, sin guardar nada.
- **RF-8** — Si el número de una cría viva ya existe entre los animales activos del tambo, entonces el sistema deberá rechazar el parto con 409 y "Ya existe un animal activo con ese número", sin guardar nada.
- **RF-9** — Si la madre es macho o está en estado recién nacido, entonces el sistema deberá rechazar el parto con 409 y un mensaje en español que diga el motivo; si no está activa o no existe, "no encontrado".
- **RF-10** — Si la fecha del parto no es posterior a la fecha de nacimiento de la madre, entonces el sistema deberá rechazarlo con 400 y un mensaje en español.
- **RF-11** — Si la fecha del parto dista menos de 200 días de la de otro parto no anulado de la misma vaca, entonces el sistema deberá rechazarlo con 409 y un mensaje en español que diga la fecha del parto existente y que, si fue un aborto o un parto prematuro, se registre como tacto "vacía".
- **RF-12** — Si el parto tiene más de un motivo de rechazo con 409, entonces el sistema deberá informar el primero según el orden: madre no apta, menos de 200 días, número de cría existente, lote destino inexistente.
- **RF-13** — Si el estado "en ordeñe" o "recién nacido" no tiene lote destino, entonces el sistema deberá guardar el parto igual, dejar sin lote a los animales afectados e incluir los avisos 1 y 3 en la respuesta.
- **RF-14** — Si el lote destino de un estado, leído al empezar, ya no existe al guardar (porque se le quitó la regla y se eliminó el lote en el medio), entonces el sistema deberá rechazar el evento con 409 y "El lote destino ya no existe, volvé a intentar", sin guardar nada.
- **RF-15** — Cuando se registra un parto con un servicio que cumple la regla de genética (último servicio no anulado posterior al último parto, ignorando tactos "vacía", entre 240 y 300 días antes), el sistema deberá guardar con el parto la referencia a ese servicio y mostrar en la ficha de cada cría viva la fecha de servicio y el semen o toro ("sin dato" si el servicio no lo tenía).
- **RF-16** — Si no hay servicio posterior al último parto o está fuera del rango de 240 a 300 días, entonces el sistema deberá guardar el parto igual sin genética (en "sin dato") e incluir el aviso 4 o 5 según el caso.
- **RF-17** — Cuando se registra un parto, el sistema deberá reiniciar el ciclo reproductivo de la vaca: el estado reproductivo pasa a "sin servicio", la fecha probable y la de referencia dejan de estar vigentes y los servicios y tactos anteriores dejan de contar como base del ciclo (siguen en la lista).

### Secado
- **RF-18** — Cuando un usuario autorizado registra el secado de una hembra activa "en ordeñe" con fecha válida, el sistema deberá guardarlo con el estado y el lote previos de la vaca, cambiar su estado a "seca" y asignarla al lote destino de "seca", en una sola operación y sin modificar su estado reproductivo. No pide ningún otro control (por ejemplo, la vaca puede no estar preñada).
- **RF-19** — Si el animal no está "en ordeñe" o es macho, entonces el sistema deberá rechazar el secado con 409 y un mensaje en español que diga el estado actual; si no está activo o no existe, "no encontrado".
- **RF-20** — Si el estado "seca" no tiene lote destino, entonces el sistema deberá guardar el secado igual, dejar a la vaca sin lote e incluir el aviso 2; si el lote destino ya no existe al guardar, deberá rechazarlo como en RF-14.

### Fechas y orden (extiende la 003)
- **RF-21** — El sistema deberá aplicar a partos y secados las reglas de fecha de la 003 (formato `AAAA-MM-DD`, existente, no futura según la hora de Argentina, no anterior al 01/01/2000, al nacimiento ni al último evento no anulado, de cualquier tipo, del animal; igual fecha se acepta), y en el parto además estrictamente posterior al nacimiento de la madre.

### Anulación de partos y secados (extiende la 003)
- **RF-22** — Cuando un dueño o encargado anula el último evento no anulado de una vaca, que es un secado, indicando el motivo, el sistema deberá devolverla al estado y al lote que tenía antes del secado y marcar el secado como anulado (quién, cuándo y motivo), en una sola operación.
- **RF-23** — Cuando un dueño o encargado anula el último evento no anulado de una vaca, que es un parto, indicando el motivo, el sistema deberá, en una sola operación todo o nada: dar de baja lógica a cada cría viva del parto, devolver la madre al estado y al lote previos, marcar el parto como anulado (quién, cuándo y motivo) y recalcular la situación reproductiva como si el parto no existiera. Las crías nacidas muertas siguen figurando en el parto anulado.
- **RF-24** — Cuando se anula un parto, el sistema deberá dar de baja a cada cría viva con estado baja, fecha de baja igual al día de la anulación (hora de Argentina), motivo "parto anulado", sin lote, conservando todo su historial y liberando su número. Una cría dada de baja no aparece en listados ni búsquedas y su ficha responde "no encontrado" (spec 002).
- **RF-25** — Si el evento ya está anulado, entonces el sistema deberá rechazar la anulación con 409 y un mensaje en español.
- **RF-26** — Si el evento que se quiere anular (de cualquier tipo) no es el último evento no anulado de su animal, entonces el sistema deberá rechazar la anulación con 409 y un mensaje que diga cuál hay que anular primero, con tipo y fecha. Cuando el que hay que anular primero es un parto o un secado y quien intenta es un veterinario, el mensaje deberá decir que lo tiene que anular un dueño o encargado (ver "Mensajes de la anulación").
- **RF-27** — Si el estado actual de la vaca ya no es el que dejó el evento que se quiere anular, entonces el sistema deberá rechazar la anulación con 409 y un mensaje en español, sin cambiar nada.
- **RF-28** — Si alguna cría viva del parto tiene eventos propios no anulados, o es madre de animales activos, o ya no está activa, entonces el sistema deberá rechazar la anulación del parto con 409 y un mensaje en español que lo explique, sin cambiar nada (aunque la otra cría esté limpia).
- **RF-29** — Si el motivo falta o supera los 200 caracteres (sin contar los extremos), entonces el sistema deberá rechazar la anulación con 400. Si el evento es de otro tambo, inexistente, de otro tipo que el que se quiere anular, de un animal no activo o con id mal formado, entonces el sistema deberá responder "no encontrado", y el permiso por rol deberá controlarse antes de buscar el evento.
- **RF-30** — Cuando se anula un parto o un secado, el sistema deberá avisar si la vaca volvió sin lote: aviso 6 si no tenía lote antes del evento, aviso 7 si su lote previo fue eliminado. En ambos casos deberá devolverla al estado previo sin lote.

#### Mensajes de la anulación
- Dueño o encargado: "Primero tenés que anular el <tipo> del <dd/mm/aaaa>".
- Veterinario, cuando el que hay que anular primero es un parto o un secado: "Primero hay que anular el <parto|secado> del <dd/mm/aaaa>; lo tiene que hacer un dueño o encargado". Si es un servicio o tacto, el mensaje es el de la 003.

### Operaciones simultáneas
- **RF-31** — Si dos operaciones simultáneas **registran** eventos de la misma vaca, o dos partos usan el mismo número de cría, o un parto se registra a la vez que cambia el lote destino de un estado, entonces el sistema deberá resolverlas de a una y terminar con uno de los resultados aceptables de esta tabla, dejando cumplidos los invariantes de RF-33.

| Operación A × Operación B | Resultados aceptables |
|---|---|
| Parto × parto de la misma vaca a menos de 200 días | Uno 201 y el otro 409; o, si entró primero el de fecha posterior, el de fecha anterior 400 (fecha) |
| Parto × parto de la misma vaca a 200 días o más | Ambos 201 en orden coherente, o el de fecha anterior 400 (fecha) |
| Parto × parto de otras vacas con el mismo número de cría | Uno 201 y el otro 409 (número existente) |
| Parto × alta de un animal con el mismo número (spec 002) | Uno 201 y el otro 409 |
| Parto × secado de la misma vaca | Parto 201 y secado 201 o 409 (según el estado); o secado 201 y parto 201 o 400 (fecha); o parto 201 y secado 400 (fecha anterior al parto) |
| Parto × servicio o tacto de la misma vaca | Ambos 201 en orden coherente, o uno 201 y el otro 409 o 400 (fecha) |
| Secado × secado de la misma vaca | Uno 201 y el otro 409 |
| Secado × servicio o tacto de la misma vaca | Ambos 201 en orden coherente, o uno 201 y el otro 400 (fecha anterior) o 409 (servicio sobre una preñez recién confirmada) |
| Parto × cambio del lote destino de "en ordeñe" o "recién nacido" (quitar la regla y eliminar el lote) | Parto 201 con el lote destino anterior; o 201 sin lote y con aviso (regla ya quitada al leer); o 409 de RF-14 (lote eliminado entre la lectura y el guardado) |

- **RF-32** — Si dos operaciones simultáneas incluyen una **anulación** sobre la misma vaca, entonces el sistema deberá resolverlas de a una y terminar con uno de los resultados aceptables de esta tabla, dejando cumplidos los invariantes de RF-33.

| Operación A × Operación B | Resultados aceptables |
|---|---|
| Anular el mismo evento dos veces | Uno 200 y el otro 409 |
| Anular un parto × registrar un secado | Secado 201 y anulación 409 (ya no es el último); o anulación 200 y secado 201 o 409 según el estado en que quedó la vaca |
| Anular un secado × registrar un parto | Parto 201 y anulación 409 (ya no es el último); o anulación 200 y parto 201, 409 o 400 (fecha) |
| Anular un parto o secado × registrar un servicio o tacto | Servicio o tacto 201 y anulación 409; o anulación 200 y el otro 201, 409 o 400 (fecha) |
| Anular un parto o secado × anular el evento anterior | Primero el último (200) y después el anterior (200), o el anterior 409 |

- **RF-33** — Mientras se resuelven operaciones simultáneas, el sistema deberá mantener estos **invariantes**, comprobables con una consulta al terminar:
  - (a) Para cada vaca, no hay dos partos no anulados con fechas a menos de 200 días.
  - (b) Ninguna cría vinculada a un parto anulado está activa.
  - (c) No hay dos animales activos del mismo tambo con el mismo número.
  - (d) Para cada animal y cada par de eventos no anulados, si A se registró antes que B (`creadoEn` menor), la fecha de A es menor o igual a la de B.
  - (e) El estado actual de la vaca es el que dejó su último parto o secado no anulado ("en ordeñe" o "seca"); si todos están anulados, es el estado previo guardado en el más antiguo de ellos; mientras no existan otras causas de cambio de estado (hoy no las hay).
  - (f) Ningún animal de baja tiene lote, y todo lote asignado es del tambo del animal.

### Integridad de datos
- **RF-34** — El sistema deberá garantizar, también a nivel de almacenamiento (constitución §6), que un animal de baja no tenga lote, considerando los registros ya existentes antes de aplicar la regla.
- **RF-35** — El sistema deberá garantizar, también a nivel de almacenamiento, que no haya dos animales activos con el mismo número en el mismo tambo, incluso con operaciones simultáneas.
- **RF-36** — El sistema deberá garantizar, también a nivel de almacenamiento, cada una de estas coherencias entre tambos, con un test por cada una:
  1. un evento nunca apunta a un animal de otro tambo;
  2. un parto nunca apunta a un servicio de otro animal ni de otro tambo;
  3. una cría nunca apunta a una madre de otro tambo (spec 002);
  4. una cría viva nunca apunta a un parto de otra madre ni de otro tambo;
  5. el lote previo de un parto o secado nunca apunta a un lote de otro tambo.
- **RF-37** — El sistema deberá permitir eliminar un lote que figura como lote previo en el historial de partos o secados siempre que cumpla la regla de la spec 001 (sin animales activos y sin ser destino), dejando el lote previo del historial como "eliminado" sin afectar nada más; deberá seguir impidiendo eliminar un lote con animales activos o que es destino.

### Ficha
- **RF-38** — El sistema deberá incluir partos y secados en la lista de eventos de la ficha, del más reciente al más antiguo según el orden total, con tipo, fecha, datos principales, quién lo registró (solo el nombre) y, si está anulado, la marca con motivo, quién anuló y cuándo. Cada parto mostrará sus crías: número y acceso a su ficha si la cría es viva y sigue activa; número con la marca "dada de baja" y **sin** acceso a su ficha si fue dada de baja por parto anulado; "nacida muerta" con sexo y observaciones si no se dio de alta; y su genética o "sin dato". Cada parto y secado mostrará el lote previo como "sin lote previo" o "lote previo eliminado" cuando corresponda.
- **RF-39** — El sistema deberá mostrar en la ficha de la cría viva el parto del que nació y su genética, y en la ficha de la madre la fecha de cada parto con acceso a él.
- **RF-40** — El sistema deberá mostrar en la ficha de la vaca el estado reproductivo de la 003 reiniciado tras el último parto no anulado, el último servicio y el último tacto anteriores a ese parto rotulados "del ciclo anterior", y los avisos del resultado que la pantalla acaba de recibir.

### Aislamiento y permisos
- **RF-41** — El sistema deberá registrar, anular y mostrar solo partos, secados, crías y lotes del tambo del usuario, sin usar ningún identificador de tambo del cliente (se ignora).
- **RF-42** — El sistema deberá controlar el permiso por rol en la API: quien no puede registrar o anular partos y secados (el veterinario) recibe 403, también con datos inválidos, con un cuerpo mal formado y con un animal o evento inexistente o de otro tambo, siguiendo el orden de controles de la 003. Sin sesión, 401.
- **RF-43** — Donde el usuario sea veterinario, el sistema no deberá mostrar los botones de parto, secado ni anulación de partos y secados, pero sí la lista de eventos, las crías y la situación reproductiva.

### Interfaz
- **RF-44** — El sistema deberá mostrar en la ficha solo las acciones que corresponden al estado y al rol, según esta tabla (las de servicio y tacto son las de la 003; el servicio tampoco se ofrece con preñez vigente):

| Animal | Dueño / encargado | Veterinario |
|---|---|---|
| Hembra vaquillona | Servicio, tacto, parto | Servicio, tacto |
| Hembra en ordeñe | Servicio, tacto, parto, secado | Servicio, tacto |
| Hembra seca | Servicio, tacto, parto | Servicio, tacto |
| Hembra recién nacida | Ninguna acción reproductiva | Ninguna |
| Macho | Ninguna | Ninguna |
| Último evento no anulado | "Anular" (de cualquier tipo) | "Anular" solo si es servicio o tacto |

- **RF-45** — Cuando el usuario registra el parto, el sistema deberá pedir en el mismo formulario los datos de una o dos crías (con la opción "nacida muerta" que oculta el número) y, al terminar, mostrar la ficha de la madre con los avisos de la lista cerrada y un acceso a la ficha de cada cría viva.
- **RF-46** — El sistema deberá mostrar los formularios de parto, secado y anulación con campos y botones de al menos 48 px de alto, sin desbordes horizontales en 768 px y 375 px, en modo claro y oscuro, y con mensajes de error en español.

## Permisos por rol
| Acción | Dueño | Encargado | Veterinario |
|---|---|---|---|
| Ver partos, secados, crías y lista de eventos | Sí | Sí | Sí |
| Registrar parto (con alta de las crías) | Sí | Sí | No ("sin permiso") |
| Registrar secado | Sí | Sí | No ("sin permiso") |
| Anular un parto o un secado | Sí | Sí | No ("sin permiso") |
| Registrar y anular servicios y tactos (spec 003) | Sí | Sí | Sí |

## Casos límite
- Parto con una cría viva: la madre pasa a "en ordeñe" y la cría queda "recién nacido". Con dos vivas: se dan de alta las dos, misma madre y misma genética.
- Una viva y una nacida muerta: solo la viva se da de alta; la muerta queda en el parto con sexo y observaciones. Todas muertas: no se da de alta ningún animal y la madre pasa igual a "en ordeñe" y a su lote.
- "Nació muerta" ausente: se toma como falso. Con un valor que no es verdadero o falso: 400. Observaciones de 201 caracteres: 400; solo espacios: "sin observaciones".
- Parto con tres crías o sin crías: 400. Cría nacida muerta con número: 400. Cría viva sin número: 400. Cría sin sexo o con sexo inválido: 400.
- Dos crías vivas con el mismo número (aunque cambie en mayúsculas): 400 completo. Número que ya existe entre activos: 409 completo, sin guardar madre ni crías.
- Parto que tiene a la vez madre no apta y número existente: gana el rechazo de la madre (orden de RF-12). Parto a menos de 200 días y número existente: gana el de los 200 días.
- Parto de una vaca sin servicio cargado (rodeo existente): se acepta, sin genética y con aviso 4. Con servicio a 239 o 301 días: se acepta sin genética y con aviso 5; a 240 o 300 días: con genética.
- Genética con servicio + tacto "vacía" y sin servicio nuevo antes del parto: se vincula ese servicio si está entre 240 y 300 días (los tactos "vacía" se ignoran para la genética). Con un servicio, un tacto "vacía" y otro servicio: vale el último servicio.
- Genética con un servicio anterior al último parto: no cuenta; solo cuentan los posteriores al último parto no anulado. Si el último parto se anuló, vuelve a contar el servicio anterior.
- Parto a 199 días de otro parto no anulado: 409 (con la sugerencia del tacto "vacía"). A 200 días: se acepta. Aborto o parto prematuro dentro del plazo: se registra como tacto "vacía".
- Parto de una vaquillona: la madre pasa a "en ordeñe". Parto de una vaca ya "en ordeñe" (no se había secado) y en otro lote: se acepta; sigue "en ordeñe" y pasa al lote destino de "en ordeñe".
- Parto con fecha igual o anterior al nacimiento de la madre, o anterior al último evento: 400.
- Parto que reinicia el ciclo: una vaca preñada con fecha vigente pasa a "sin servicio" y sin fecha; un servicio nuevo ya se acepta. En la ficha, el último servicio y el último tacto anteriores al parto figuran "del ciclo anterior".
- Tacto "preñada" después de un parto, sin servicio nuevo: se exige la fecha probable (400 si falta), porque ya no hay servicio base ni fecha del ciclo anterior. Con fecha: se acepta.
- Tacto "vacía" justo después del parto: se acepta; el estado reproductivo pasa a "vacía".
- Parto precedido de servicio y tacto "vacía": se acepta; la genética sale del servicio (si está en rango) aunque ya no sea el servicio base.
- Lote destino sin configurar: se guarda sin lote y con aviso (1, 2 o 3). Lote destino que desaparece entre la lectura y el guardado (se le quitó la regla al estado y se eliminó el lote): 409 con nada guardado, o parto sin lote y con aviso si la regla ya estaba quitada al leer; también se verifica sembrando el dato.
- Secado de una vaca "en ordeñe", preñada o no: se acepta, sigue con el mismo estado reproductivo. Secado de una vaca seca, de una vaquillona, de una recién nacida o de un macho: 409.
- Secado cargado después de un servicio o un tacto: no cambia el estado reproductivo; la fecha no puede ser anterior a ese evento.
- Parto de una vaca con tacto "preñada" vigente cuya fecha probable aún no llegó (o ya pasó): se acepta igual; solo cuenta la fecha del parto.
- Anular un parto o un secado que no es el último evento no anulado de la vaca: 409 con el mensaje de qué anular primero. En particular, anular un parto cuando ya hay servicios o tactos del ciclo nuevo: 409 (hay que anular primero esos eventos). Ya anulado: 409.
- Veterinario que anula un servicio o tacto cuando el último evento es un parto o un secado: 409 con el mensaje "lo tiene que hacer un dueño o encargado"; la pantalla no le ofrece esa anulación.
- Anular un parto con crías sin eventos: las crías pasan a baja "parto anulado", sin lote, sus números quedan libres y la madre vuelve al estado y lote previos (por ejemplo "seca" y su lote, o vaquillona).
- Anular un parto con una cría que tiene un evento propio no anulado o crías propias: 409; hay que anular primero ese evento. Con dos crías y una con eventos: 409 y no se da de baja ninguna.
- Anular un parto o secado con el lote previo eliminado: la vaca vuelve al estado previo sin lote, con aviso 7. Si no tenía lote antes del evento: vuelve sin lote, con aviso 6.
- Anular un parto o secado con el estado actual distinto del que dejó el evento, o una cría ya no activa (por ejemplo, dada de baja por otra vía): 409; se verifica sembrando los datos directo en la base.
- Eliminar un lote que solo figura en el historial como lote previo: se permite (sin animales activos y sin ser destino). Con animales activos o destino: 409 como siempre.
- Animal de baja por "parto anulado": no aparece en listados ni búsquedas, su ficha responde "no encontrado" y nunca tiene lote.
- Anular un parto o secado de otro tambo, inexistente, con id mal formado o con el id de un evento de otro tipo: "no encontrado" idéntico para dueño y encargado. El veterinario recibe 403 siempre en esas operaciones, porque el permiso se controla antes de buscar.
- Veterinario que intenta registrar un parto, un secado o anularlos: 403, también con datos inválidos o cuerpo mal formado. Sin sesión: 401.
- Cuerpo inválido con animal inexistente: 400 (la validación va antes que la búsqueda). Un `establecimientoId` en el cuerpo: se ignora.
- Dos partos o dos secados simultáneos de la misma vaca, o dos partos con el mismo número de cría: uno 201 y el otro 409 (tabla de RF-31). Dos partos simultáneos a menos de 200 días con el posterior entrando primero: el de fecha anterior recibe 400 por fecha.
- Anulación con varios motivos de rechazo: se informa el primero según el orden (ya anulado, no es el último, estado actual distinto, cría con eventos o no activa).
- Cría dada de baja por parto anulado: en la lista de eventos figura con su número y "dada de baja", sin acceso a su ficha.
- Los avisos no persisten: al recargar la ficha ya no aparecen; el lote previo "sin lote previo" o "eliminado" sí queda visible en el evento.
- La sesión vence con la pantalla abierta: la próxima acción lleva al login.

## Criterios de aceptación
- [ ] Un parto de una o dos crías da de alta solo a las vivas (recién nacido, madre vinculada, vinculadas al parto), registra las muertas sin alta ni número, pasa la madre a "en ordeñe" y a su lote destino aun si ya estaba en ordeñe o todas nacieron muertas; sin destino quedan sin lote con aviso; todo o nada ante cualquier error.
- [ ] Los campos de las crías se validan como indica RF-5 a RF-7 (sexo, "nació muerta" por defecto falso, observaciones recortadas, número según viva o muerta).
- [ ] Los rechazos del parto siguen el orden de RF-12 y los avisos salen en el orden fijo de la lista cerrada.
- [ ] Dos partos a menos de 200 días se rechazan (409, con la sugerencia del tacto "vacía"); a 200 días se aceptan.
- [ ] La genética es el último servicio no anulado posterior al último parto, ignorando tactos "vacía", y se vincula solo entre 240 y 300 días antes; si no, el parto se guarda sin genética y con aviso. No se confunde con el servicio base de la situación reproductiva.
- [ ] Un parto reinicia el ciclo: estado "sin servicio", sin fecha probable ni de referencia; el último servicio y tacto anteriores se rotulan "del ciclo anterior"; un tacto "preñada" posterior sin servicio exige la fecha probable.
- [ ] Un secado pasa la vaca a "seca" y a su lote destino, solo si está en ordeñe, sin otros controles, y no cambia su estado reproductivo.
- [ ] Solo se anula el último evento no anulado (de los cuatro tipos); otro da 409 con el mensaje de qué anular primero y, para el veterinario, con el texto de "lo tiene que hacer un dueño o encargado". El permiso se controla antes de buscar el evento.
- [ ] Anular un secado devuelve la vaca al estado y lote previos; anular un parto da de baja a las crías vivas ("parto anulado", sin lote, números libres) y devuelve la madre al estado y lote previos; con eventos propios en una cría, 409 sin cambios.
- [ ] Con el lote previo eliminado (aviso 7) y con la vaca que no tenía lote antes (aviso 6), anular devuelve a la vaca sin lote con el aviso que corresponde. Un test elimina un lote que figura solo en el historial, y otro comprueba que un lote con animales activos o destino sigue sin poder eliminarse (impacto en las specs 001 y 002).
- [ ] Las defensas (cría no activa, estado actual distinto, lote destino inexistente) también se verifican con datos sembrados directo en la base.
- [ ] Un animal de baja nunca tiene lote (garantizado en el almacenamiento, con registros existentes contemplados); el motivo de baja es de una lista cerrada con "parto anulado".
- [ ] Tests de concurrencia para cada fila de las tablas de RF-31 y RF-32, con comprobación de los invariantes de RF-33.
- [ ] Un evento, una cría, el vínculo cría–parto y un lote previo nunca apuntan a un animal, madre, parto o lote de otro tambo (a nivel de almacenamiento).
- [ ] "Quién registró o anuló" muestra solo el nombre del usuario y ninguna respuesta incluye hashes (con test).
- [ ] Cada acción (registrar parto y secado, anular ambos, ver la lista) tiene un test de aislamiento entre dos tambos y un test de permisos por rol (el veterinario recibe 403 en parto, secado y sus anulaciones); sin sesión 401.
- [ ] La ficha muestra las acciones según la tabla de RF-44 por estado y rol.
- [ ] Los formularios de parto y secado cumplen 48 px, sin desbordes en 768 px y 375 px, modo claro y oscuro; se verifica en el navegador.

## Preguntas abiertas
- (ninguna; decisiones de negocio tomadas con el usuario el 2026-11-11: la spec queda entera, la genética usa el último servicio posterior al último parto ignorando tactos "vacía", el secado es libre, se mantienen los 200 días entre partos y todo parto mueve la madre al lote de "en ordeñe")
