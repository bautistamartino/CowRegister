# 004 — Partos, crías y secados

Estado: borrador
Fecha: 2026-11-11

## Contexto
Con la spec 003 el tambo ya registra servicios y tactos. Falta lo que cierra el ciclo: el **parto** (con una o dos crías, vivas o nacidas muertas), el **secado**, y que la vaca y las crías cambien de estado y de lote solos cuando corresponde. También hace falta poder corregir un parto o un secado mal cargado, volviendo atrás el estado y el lote sin borrar nada.

**Depende de la spec 003** (catálogo de semen, servicios, tactos, fecha probable de parto, orden total de eventos y anulación). Esta spec **extiende** esas reglas: "el último evento no anulado" vale ahora para los cuatro tipos (servicio, tacto, parto y secado), el parto reinicia el ciclo reproductivo, y la anulación suma las rutas de partos y secados. No se puede implementar antes de que la 003 esté aprobada y hecha.

La usan el dueño y el encargado (cargan y corrigen partos y secados) y el veterinario (consulta todo; sigue cargando y anulando solo servicios y tactos). Se cargan desde la ficha, en la tablet, en el tambo.

## Alcance
- Incluye:
  - Parto de una o dos crías, con alta de las vivas (madre vinculada) y registro de las nacidas muertas sin alta.
  - Secado de una vaca en ordeñe.
  - Cambio de estado y de lote de la madre y de las crías vivas, según la configuración del tambo (spec 001).
  - Vínculo del parto con el servicio base ("genética") cuando es coherente.
  - Anulación de partos y secados con vuelta atrás del estado y el lote, y baja lógica de las crías vivas con motivo "parto anulado".
  - Garantía en la base de que un animal de baja no tiene lote (riesgo pendiente de MEMORY.md).
  - En la ficha: partos y secados en la lista de eventos, crías y genética.
- No incluye:
  - Ventas, muertes y cualquier otra baja (Etapa 3): solo se agrega la baja por "parto anulado" y el lugar para los motivos futuros.
  - Editar un animal y mover de lote a mano (spec aparte).
  - Informes de natalidad y alertas automáticas ("a secar", "por parir").
  - Uso sin conexión (Etapa 6).

## Supuestos y reglas del dominio
- **Reglas heredadas de la 003:** todo lo dicho allí vale acá: animales activos, orden total (fecha y, a igual fecha, momento de registro), anulación con motivo, formato de fechas `AAAA-MM-DD`, reloj de Argentina fijable en los tests, orden de controles (sesión, permiso, formato del cuerpo, búsqueda, referencias y fechas, conflictos), el cliente no manda el tambo (se ignora el `establecimientoId` del cuerpo), "quién registró" solo con el nombre.
- **Bloqueo por animal:** toda operación que registra o anula un evento de un animal (de cualquier tipo) se procesa de a una por vez para ese animal, aun con usuarios simultáneos: así se evitan dos partos de la misma vaca, o un parto y un secado cruzados.
- **Último evento (extiende la 003):** el último evento no anulado de un animal, de cualquier tipo, en el orden total. Solo ese se puede anular.
- **Parto:** hembra activa en estado vaquillona, en ordeñe o seca (no macho ni recién nacida: 409). Datos: fecha y **una o dos crías**. De cada cría: sexo (hembra o macho), observaciones opcionales (hasta 200 caracteres sin contar los extremos) y si **nació muerta**. La cría viva lleva además su número y se da de alta como animal; la nacida muerta se registra en el parto pero **no** se da de alta y **no lleva número**.
- **Fecha del parto:** cumple las fechas de la 003 y además es **posterior** (estrictamente) a la fecha de nacimiento de la madre, si la tiene (misma regla que la spec 002 entre madre y cría).
- **Un parto cada 200 días como mínimo:** no puede haber dos partos no anulados de la misma vaca con menos de **200 días** entre sus fechas (409). Protege de cargar dos veces el mismo parto.
- **Cría viva:** animal nuevo del mismo tambo, estado recién nacido, fecha de nacimiento igual a la del parto y madre vinculada. Su número sigue las reglas de la spec 002 (normalizado en mayúsculas, hasta 20 caracteres, solo letras sin tildes, dígitos, guion y punto, único entre activos). Dos crías vivas del mismo parto no pueden repetir número.
- **Cambio de estado y lote:** la madre pasa a "en ordeñe" tras un parto, **aunque todas las crías hayan nacido muertas**; cada cría viva queda "recién nacido"; la vaca pasa a "seca" tras un secado. Cada animal va al **lote destino de su nuevo estado**. Si ese estado no tiene destino queda **sin lote** y se avisa (como en la 002). Si el lote destino ya no existe al guardar, el evento se rechaza con 409 ("El lote destino ya no existe, volvé a intentar") y no se guarda nada. Esta spec cambia el lote solo en estos eventos y al anularlos.
- **Vuelta atrás:** cada parto y cada secado conserva el estado y el lote de la vaca **justo antes** del evento. Si el lote previo se elimina después, el tambo puede borrarlo igual (ver "Borrado de lotes") y al anular la vaca vuelve **sin lote**, con un aviso.
- **Genética:** el parto guarda el servicio base (de la 003, ahora posterior también al último parto) **solo si** ese servicio está entre **240 y 300 días antes** de la fecha del parto; si no hay servicio base, o está fuera de ese rango, el parto se guarda igual **sin genética** y la pantalla lo avisa. Cuando se vincula, la ficha de cada cría viva muestra la fecha de servicio y el semen o toro ("genética", con el nombre actual de la entrada aunque esté desactivada); si el servicio no tenía semen o toro, "sin dato".
- **El parto reinicia el ciclo (extiende la 003):** el servicio base, el ciclo y el estado reproductivo solo consideran los eventos posteriores al último parto no anulado; tras un parto el estado reproductivo es "sin servicio" y no hay fecha probable vigente. El secado no cambia el estado reproductivo: una vaca preñada se seca preñada. La regla de "servicio sobre vaca preñada" de la 003 se aplica al ciclo posterior al último parto.
- **Secado:** solo para una hembra "en ordeñe" (vaca seca, vaquillona, recién nacida o macho: 409).
- **Baja por parto anulado:** al anular un parto, cada cría viva que dio de alta pasa a **baja lógica** (nunca se borra): estado baja, fecha de baja igual al día de la anulación (hora de Argentina), motivo "parto anulado" y **sin lote**. Conserva su historial y su número queda libre. El motivo de baja es un valor de una lista cerrada; hoy solo tiene "parto anulado" y queda lugar para venta y muerte de la Etapa 3.
- **Animal de baja y lote:** un animal de baja nunca tiene lote. Deberá garantizarse también a nivel de almacenamiento, considerando los registros ya existentes (se desasigna antes a cualquier animal de baja que tuviera lote; hoy no hay bajas).
- **Borrado de lotes:** el historial (lote previo de partos y secados) **no impide eliminar un lote**: la regla de la spec 001 no cambia (se elimina si no tiene animales activos ni es destino). El historial conserva el aislamiento entre tambos: el lote previo nunca apunta a un lote de otro tambo; al eliminar el lote, el previo queda "eliminado" sin tocar nada más. Cómo se logra a nivel de almacenamiento (clave compuesta que anula solo la columna del lote) se define en el plan. Esto obliga a revisar el borrado de lotes de las specs 001 y 002: el paso que desasigna a los animales de baja pasa a ser innecesario pero inofensivo.
- **Defensas de la anulación:** que una cría ya no esté activa o que el estado actual de la vaca ya no sea el que dejó el evento **no pueden ocurrir hoy por la API** (solo existen estas bajas y las anulaciones solo permiten el último evento), pero sí cuando lleguen la edición manual de animales y las bajas de la Etapa 3. Se mantienen como controles y se verifican en los tests **sembrando los datos directo en la base**.
- **Códigos de la API:** los de la 003. Número de cría ya existente o evento que choca con el estado (secado de una vaca no en ordeñe, parto a menos de 200 días, anulación de un evento que no es el último, cría con eventos) 409; datos inválidos 400.
- **Todo o nada:** cada registro o anulación se guarda completo o no se guarda nada (el parto con sus crías, el estado y lote de la madre).
- **Garantías en el almacenamiento:** un evento nunca apunta a un animal de otro tambo, el parto nunca a un servicio de otro animal ni de otro tambo, una cría nunca a una madre de otro tambo (spec 002), el lote previo nunca a un lote de otro tambo, y un animal de baja nunca tiene lote.

## Requisitos funcionales

### Parto y alta de las crías
- **RF-1** — Cuando un usuario autorizado registra un parto con fecha y datos válidos de una o dos crías, el sistema deberá, en una sola operación todo o nada: guardar el parto con el estado y el lote previos de la madre, dar de alta a cada cría viva (recién nacido, fecha de nacimiento igual a la del parto, madre vinculada), registrar en el parto las crías nacidas muertas sin darlas de alta, cambiar el estado de la madre a "en ordeñe" (aun si todas nacieron muertas) y asignar a la madre y a cada cría viva al lote destino de su nuevo estado.
- **RF-2** — El sistema deberá exigir una o dos crías y, de cada una, el sexo. Si hay cero o más de dos, o falta el sexo, entonces deberá rechazar el parto con 400 y un mensaje en español. Una cría nacida muerta no lleva número: si lo trae, deberá rechazarlo con 400; una cría viva debe traerlo. Las observaciones son opcionales, de hasta 200 caracteres.
- **RF-3** — El sistema deberá validar el número de cada cría viva con las reglas de la spec 002. Si dos crías vivas del mismo parto tienen el mismo número (aunque cambie en mayúsculas), entonces deberá rechazar el parto con 400 y un mensaje en español. Si el número ya existe entre los animales activos del tambo, deberá rechazarlo con 409 y "Ya existe un animal activo con ese número". En ambos casos no se guarda nada, ni la madre ni ninguna cría.
- **RF-4** — Si la madre es macho, está en estado recién nacido o no está activa, entonces el sistema deberá rechazar el parto (409 si existe y no es apta; "no encontrado" si no está activa) con un mensaje en español. Si la fecha del parto no es posterior al nacimiento de la madre, deberá rechazarlo con 400.
- **RF-5** — Si la fecha del parto dista menos de 200 días de la fecha de otro parto no anulado de la misma vaca, entonces el sistema deberá rechazarlo con 409 y un mensaje en español que diga la fecha del parto existente.
- **RF-6** — Si el estado "en ordeñe" o "recién nacido" no tiene lote destino, entonces el sistema deberá guardar el parto igual, dejar sin lote a los animales afectados e informarlo (la API incluye el indicador de "sin lote" con el estado; la pantalla muestra un aviso que lo nombra). Si el lote destino ya no existe al guardar, deberá rechazar el parto con 409 y "El lote destino ya no existe, volvé a intentar", sin guardar nada.
- **RF-7** — Cuando existe servicio base y está entre 240 y 300 días antes de la fecha del parto, el sistema deberá guardar con el parto la referencia a ese servicio, y la ficha de cada cría viva deberá mostrar la fecha de servicio y el semen o toro. Si no hay servicio base, está fuera de ese rango o no tenía semen o toro, deberá guardar el parto igual con la genética en "sin dato" y, si había servicio base fuera de rango, avisarlo en la pantalla.
- **RF-8** — Cuando se registra un parto, el sistema deberá reiniciar el ciclo reproductivo de la vaca: el estado reproductivo pasa a "sin servicio" y la fecha probable deja de estar vigente, y los servicios y tactos anteriores dejan de contar como base del ciclo (siguen en la lista).
- **RF-9** — Si dos usuarios registran a la vez un parto con el mismo número de cría en el mismo tambo, o dos partos de la misma vaca, entonces el sistema deberá resolverlo de a uno: uno se guarda (201) y el otro recibe 409 con un mensaje en español. Un parto con un servicio, tacto o secado simultáneo sobre la misma vaca debe terminar con ambos guardados en orden coherente o con uno rechazado (409 o 400 por fecha). Deberá garantizarse a nivel de almacenamiento el número único entre activos.

### Secado
- **RF-10** — Cuando un usuario autorizado registra el secado de una hembra activa "en ordeñe" con fecha válida, el sistema deberá guardarlo con el estado y el lote previos de la vaca, cambiar su estado a "seca" y asignarla al lote destino de "seca", en una sola operación, sin modificar su estado reproductivo.
- **RF-11** — Si el animal no está "en ordeñe", no es hembra o no está activo, entonces el sistema deberá rechazar el secado (409 si existe; "no encontrado" si no está activo) con un mensaje en español que diga el estado actual.
- **RF-12** — Si el estado "seca" no tiene lote destino, entonces el sistema deberá guardar el secado igual, dejar a la vaca sin lote e informarlo como en RF-6. Si el lote destino ya no existe al guardar, deberá rechazarlo con el mensaje y código de RF-6.
- **RF-13** — Si dos usuarios registran a la vez el secado de la misma vaca, entonces el sistema deberá guardar uno (201) y rechazar el otro con 409 y un mensaje en español.

### Fechas y orden (extiende la 003)
- **RF-14** — El sistema deberá aplicar a partos y secados las reglas de fecha de la 003 (formato `AAAA-MM-DD`, existente, no futura según la hora de Argentina, no anterior al 01/01/2000, al nacimiento ni al último evento no anulado, de cualquier tipo, del animal; igual fecha se acepta), además de la fecha estrictamente posterior al nacimiento de la madre en el parto.

### Anulación de partos y secados (extiende la 003)
- **RF-15** — El sistema deberá permitir anular un parto y un secado, cada uno por su propia ruta (la de partos y la de secados), de modo que el permiso por rol se controle antes de buscar el evento. Si el evento no es el último evento no anulado de su animal (de cualquier tipo), entonces deberá rechazar la anulación con 409 y un mensaje que diga cuál hay que anular primero; si ya está anulado, 409; si el motivo falta o supera los 200 caracteres, 400. Un evento de otro tambo, inexistente, de otro tipo que el de la ruta o con id mal formado responde "no encontrado".
- **RF-16** — Cuando se anula un secado, el sistema deberá devolver la vaca al estado y al lote que tenía antes del secado ("en ordeñe" y su lote previo), en la misma operación que marca el evento como anulado, guardando quién, cuándo y el motivo.
- **RF-17** — Cuando se anula un parto, el sistema deberá, en una sola operación todo o nada: dar de baja lógica a cada cría viva que el parto dio de alta (RF-21), devolver la madre al estado y al lote previos al parto, marcar el parto como anulado (quién, cuándo y motivo) y recalcular la situación reproductiva como si el parto no existiera. Las crías nacidas muertas siguen figurando en el parto anulado.
- **RF-18** — Si alguna cría viva del parto tiene eventos propios no anulados, o es madre de animales activos, o ya no está activa, entonces el sistema deberá rechazar la anulación del parto con 409 y un mensaje en español que lo explique, sin cambiar nada (aunque la otra cría esté limpia).
- **RF-19** — Si al anular un parto o un secado el estado actual de la vaca ya no es el que dejó ese evento, entonces el sistema deberá rechazar la anulación con 409 y un mensaje en español. Si el lote previo guardado ya no existe, entonces deberá devolver a la vaca al estado previo **sin lote** e informarlo con un aviso (mismo indicador que RF-6).
- **RF-20** — Si dos operaciones simultáneas afectan a la misma vaca (dos anulaciones del mismo evento, anular un parto y registrar un secado, anular un parto y un servicio), entonces el sistema deberá resolverlas de a una y dejar datos coherentes: cada una termina en 200/201 o en 409 (o 400 por fecha) si ya no corresponde; nunca queda un evento posterior a otro anulado, ni crías vivas de un parto anulado.

### Baja por parto anulado y almacenamiento
- **RF-21** — El sistema deberá dar de baja lógica a la cría viva de un parto anulado con estado baja, fecha de baja igual al día de la anulación (hora de Argentina), motivo "parto anulado" (valor de una lista cerrada que deja lugar a los motivos de la Etapa 3) y sin lote, conservando todo su historial y liberando su número. Una cría dada de baja no aparece en listados ni búsquedas y su ficha responde "no encontrado" (spec 002).
- **RF-22** — El sistema deberá garantizar, también a nivel de almacenamiento, que un animal dado de baja no tenga lote, considerando los registros existentes antes de aplicar la regla.
- **RF-23** — El sistema deberá permitir eliminar un lote que figura como lote previo en el historial de partos o secados siempre que cumpla la regla de la spec 001 (sin animales activos y sin ser destino), dejando el lote previo del historial como "eliminado" sin afectar nada más; deberá seguir impidiendo eliminar un lote con animales activos o que es destino. La eliminación de un lote nunca puede dejar a un evento apuntando a un lote de otro tambo.

### Ficha
- **RF-24** — El sistema deberá incluir partos y secados en la lista de eventos de la ficha de la 003, ordenada del más reciente al más antiguo según el orden total, con tipo, fecha, datos principales, quién lo registró (solo el nombre) y, si está anulado, la marca con motivo, quién anuló y cuándo. Cada parto mostrará sus crías: número y acceso a su ficha si la cría es viva y sigue activa; "nacida muerta" con sexo y observaciones si no; y su genética o "sin dato".
- **RF-25** — El sistema deberá mostrar en la ficha de la cría viva el parto del que nació y su genética, y en la ficha de la madre la fecha de cada parto con acceso a él.
- **RF-26** — El sistema deberá mostrar en la ficha de la vaca los avisos de "sin lote" y de lote previo eliminado cuando corresponda, y el estado reproductivo de la 003 reiniciado tras el último parto no anulado.

### Aislamiento y permisos
- **RF-27** — El sistema deberá registrar, anular y mostrar solo partos, secados, crías y lotes del tambo del usuario, y no deberá usar ningún identificador de tambo del cliente (se ignora). Un animal, evento o lote de otro tambo, inexistente o con id mal formado responde siempre "no encontrado".
- **RF-28** — El sistema deberá controlar el permiso por rol en la API: quien no puede registrar o anular partos y secados (el veterinario) recibe 403, también con datos inválidos y con un animal o evento inexistente o de otro tambo, siguiendo el orden de la 003 (sesión, permiso, formato, búsqueda, referencias y fechas, conflictos). Sin sesión, 401.
- **RF-29** — Donde el usuario sea veterinario, el sistema no deberá mostrar los botones de parto, secado ni anulación de esos eventos, pero sí la lista de eventos, las crías y la situación reproductiva.

### Interfaz
- **RF-30** — El sistema deberá permitir registrar un parto y un secado y anular el último evento desde la ficha, mostrando solo las acciones que corresponden al estado y al rol (por ejemplo, "Secado" solo si está en ordeñe), con campos y botones de al menos 48 px de alto, sin desbordes horizontales en 768 px y 375 px, en modo claro y oscuro, con mensajes de error en español y avisos de "sin lote".
- **RF-31** — Cuando el usuario registra el parto, el sistema deberá pedir en el mismo formulario los datos de una o dos crías (con la opción "nacida muerta" que oculta el número) y, al terminar, mostrar la ficha de la madre con el aviso del resultado (sin lote, sin genética, etc.) y un acceso a la ficha de cada cría viva.

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
- Parto con tres crías o sin crías: 400. Cría nacida muerta con número: 400. Cría viva sin número: 400.
- Dos crías vivas con el mismo número (aunque cambie en mayúsculas): 400 completo. Número que ya existe entre activos: 409 completo, sin guardar madre ni crías.
- Parto de una vaca sin servicio cargado (rodeo existente): se acepta, sin genética. Con servicio base a 239 o 301 días: se acepta sin genética y con aviso; a 240 o 300 días: con genética.
- Parto a 199 días de otro parto no anulado: 409. A 200 días: se acepta. Dos partos de la misma vaca cargados a la vez: uno 201 y otro 409.
- Parto de una vaquillona: la madre pasa a "en ordeñe". Parto de una vaca ya "en ordeñe" (no se había secado): se acepta; sigue "en ordeñe".
- Parto con fecha igual o anterior al nacimiento de la madre, o anterior al último evento: 400.
- Parto que reinicia el ciclo: una vaca preñada con fecha vigente pasa a "sin servicio" y sin fecha; un servicio nuevo ya se acepta.
- Lote destino eliminado justo antes de guardar: el evento falla con 409 y no queda nada a medias. Lote destino sin configurar: se guarda sin lote y con aviso.
- Secado de una vaca preñada y en ordeñe: se acepta y sigue "preñada". Secado de una vaca seca, de una vaquillona o de un macho: 409.
- Anular un parto o un secado que no es el último evento no anulado de la vaca: 409 con el mensaje de qué anular primero (incluye servicios y tactos posteriores). Ya anulado: 409.
- Anular un parto con crías sin eventos: las crías pasan a baja "parto anulado", sin lote, sus números quedan libres y la madre vuelve al estado y lote previos (por ejemplo "seca" y su lote, o vaquillona).
- Anular un parto con una cría que tiene un evento propio no anulado o crías propias: 409; hay que anular primero ese evento. Con dos crías y una con eventos: 409 y no se da de baja ninguna.
- Anular un parto o secado con el lote previo eliminado: la vaca vuelve al estado previo sin lote, con aviso. Se verifica eliminando el lote antes de anular.
- Anular un parto o secado con el estado actual distinto del que dejó el evento, o una cría ya no activa: 409; se verifica sembrando los datos directo en la base (hoy la API no los produce).
- Eliminar un lote que solo figura en el historial como lote previo: se permite (sin animales activos y sin ser destino). Con animales activos o destino: 409 como siempre.
- Anular un parto cuya cría ya fue dada de baja con anterioridad por otra vía: 409 (ver defensas).
- Animal de baja por "parto anulado": no aparece en listados ni búsquedas, su ficha responde "no encontrado" y nunca tiene lote.
- Anular un parto o un secado de otro tambo, inexistente o con id mal formado: "no encontrado" idéntico para dueño y encargado. El veterinario recibe 403 siempre en esas rutas, porque el permiso se controla antes de buscar.
- Veterinario que intenta registrar un parto, un secado o anularlos: 403, también con datos inválidos. Sin sesión: 401.
- Cuerpo inválido con animal inexistente en la ruta: 400 (la validación va antes que la búsqueda). Un `establecimientoId` en el cuerpo: se ignora.
- La sesión vence con la pantalla abierta: la próxima acción lleva al login.

## Criterios de aceptación
- [ ] Un parto de una o dos crías da de alta solo a las vivas (recién nacido, madre vinculada), registra las muertas sin alta ni número, pasa la madre a "en ordeñe" aun si todas nacieron muertas y asigna cada animal al lote destino; sin destino quedan sin lote con aviso; todo o nada ante cualquier error, incluido el número repetido entre las dos crías.
- [ ] Dos partos a menos de 200 días se rechazan (409); a 200 días se aceptan.
- [ ] La genética se vincula solo si el servicio base está entre 240 y 300 días antes del parto; si no, el parto se guarda sin genética y con aviso.
- [ ] Un parto reinicia el ciclo: estado reproductivo "sin servicio", sin fecha probable vigente y servicio base posterior al parto.
- [ ] Un secado pasa la vaca a "seca" y a su lote destino, solo si está en ordeñe, y no cambia su estado reproductivo.
- [ ] Solo se anula el último evento no anulado (de los cuatro tipos); otro da 409 con el mensaje de qué anular primero. La anulación de partos y secados tiene una ruta por tipo y el permiso se controla antes de la búsqueda.
- [ ] Anular un secado devuelve la vaca al estado y lote previos; anular un parto da de baja a las crías vivas ("parto anulado", sin lote, números libres) y devuelve la madre al estado y lote previos; con eventos propios en una cría, 409 sin cambios.
- [ ] Con el lote previo eliminado, anular devuelve a la vaca sin lote y con aviso. Un test elimina un lote que figura solo en el historial, y otro comprueba que un lote con animales activos o destino sigue sin poder eliminarse (impacto en las specs 001 y 002).
- [ ] Las defensas (cría no activa, estado actual distinto) se verifican con datos sembrados directo en la base.
- [ ] Un animal de baja nunca tiene lote (garantizado en el almacenamiento, con registros existentes contemplados); el motivo de baja es de una lista cerrada con "parto anulado".
- [ ] Tests de concurrencia: dos partos con el mismo número de cría, dos partos de la misma vaca, dos secados, dos anulaciones del mismo evento, anular un parto con un secado en paralelo y un parto en paralelo a la eliminación del lote destino dejan siempre datos coherentes con los resultados aceptables (un 201 y un 409, o ambos en orden coherente).
- [ ] Un evento, una cría o un lote previo nunca apuntan a un animal, madre o lote de otro tambo (a nivel de almacenamiento).
- [ ] "Quién registró o anuló" muestra solo el nombre del usuario y ninguna respuesta incluye hashes (con test).
- [ ] Cada acción (registrar parto y secado, anular ambos, ver la lista) tiene un test de aislamiento entre dos tambos y un test de permisos por rol (el veterinario recibe 403 en parto, secado y sus anulaciones); sin sesión 401.
- [ ] Los formularios de parto y secado cumplen 48 px, sin desbordes en 768 px y 375 px, modo claro y oscuro; se verifica en el navegador.

## Preguntas abiertas
- (ninguna; las decisiones de negocio se tomaron el 2026-11-11 con la spec 003)
