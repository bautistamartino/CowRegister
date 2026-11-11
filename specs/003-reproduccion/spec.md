# 003 — Reproducción: catálogo de semen, servicios y tactos

Estado: aprobada
Fecha: 2026-11-11

## Contexto
Hoy la app sabe qué animales tiene el tambo, pero no qué les pasó. En el papel, lo más consultado de cada vaca es su ciclo reproductivo: cuándo se la inseminó y con qué semen, si quedó preñada y cuándo va a parir. Esta funcionalidad registra los **servicios** (inseminación o monta natural) y los **tactos**, calcula la **fecha probable de parto** y muestra la **situación reproductiva** en la ficha. También permite cargar la situación actual de las vacas que ya estaban en el rodeo (pendiente desde la Etapa 1) y **corregir** un servicio o tacto mal cargado sin borrarlo, anulándolo.

Para elegir el semen o el toro de cada servicio desde una lista, el tambo carga de antemano su **catálogo de semen y toros**, en una pantalla de configuración parecida a la de lotes.

Esta spec es la primera de dos: los **partos** (con alta de crías), los **secados** y la anulación con vuelta atrás de estado y lote están en la spec 004, que depende de esta. Mientras la 004 no esté hecha, una vaca preñada sigue figurando así hasta que se cargue un tacto "vacía" (no hay parto que reinicie el ciclo).

La usan el dueño y el encargado (cargan y corrigen todo) y el veterinario (consulta todo y carga y anula servicios y tactos). Los eventos se cargan desde la ficha de cada animal, en la tablet, en el tambo.

## Alcance
- Incluye:
  - Catálogo de semen y toros por tambo: alta, edición de nombre y raza, desactivación y reactivación.
  - Registro de servicio y de tacto sobre una hembra activa.
  - Cálculo y seguimiento de la fecha probable de parto (servicio + 283 días; el último tacto la ajusta o la anula).
  - Anulación explícita y registrada del último evento no anulado del animal (servicio o tacto).
  - En la ficha: situación reproductiva y lista de estos eventos ordenada por fecha.
- No incluye:
  - Partos, crías, secados, cambios de estado y de lote, y bajas (spec 004 y Etapa 3).
  - Eliminar entradas del catálogo, contador de usos y stock de pajuelas.
  - Editar un animal y mover de lote a mano (spec aparte, ver MEMORY.md).
  - Informes de inseminación e historial unificado de todos los eventos (Etapa 4) y alertas automáticas.
  - Uso sin conexión (Etapa 6): solo se conserva lo ya preparado (ids UUID, `creadoEn`, eventos que solo se agregan).

## Supuestos y reglas del dominio
- **Animales:** los eventos son sobre animales **activos** del tambo del usuario. Un animal de baja, inexistente, de otro tambo o con id mal formado responde "no encontrado".
- **Orden de los eventos de un animal:** el orden total es la **fecha del evento** y, a igual fecha, el **momento de registro** (con precisión de milisegundos; el plan define el mecanismo para que nunca haya empates). Todas las palabras "posterior", "anterior", "último", "servicio base" y "estado reproductivo" de esta spec usan ese orden. Para que sea confiable, toda operación que registra o anula un evento de un animal se procesa **de a una por vez para ese animal**, aun con usuarios simultáneos.
- **Eventos que solo se agregan (constitución §3):** un servicio o tacto registrado no se modifica ni se borra. Si se cargó mal, se **anula**: queda guardado, marcado como anulado, con quién lo anuló, cuándo y el **motivo** (obligatorio, hasta 200 caracteres sin contar los extremos). Para corregir, se anula y se vuelve a cargar. Un evento anulado no cuenta para ningún cálculo, pero sigue visible en la lista.
- **Último evento del animal:** el último evento **no anulado** en el orden total. Solo ese se puede anular; para anular uno anterior hay que anular primero los posteriores. Esto vale para todos los tipos de evento: la spec 004 lo extiende a partos y secados.
- **Un evento olvidado:** no se puede cargar un evento con fecha anterior a la del último evento no anulado. Si falta un evento entre dos ya cargados, hay que anular los posteriores, cargar el olvidado y volver a cargar los demás.
- **Catálogo de semen y toros:** lista propia de cada tambo. Cada entrada tiene nombre (por ejemplo "Holando Toro 1234"), raza opcional y estado activa o desactivada. El nombre se normaliza como el de los lotes (spec 001): sin espacios ni tabulaciones en los extremos, espacios internos repetidos reducidos a uno, de 1 a 50 caracteres visibles, y único dentro del tambo **sin distinguir mayúsculas y contando también las entradas desactivadas**. La raza es de hasta 50 caracteres; vacía o con solo espacios queda "sin raza". Dos tambos pueden tener entradas con el mismo nombre. Las entradas no se eliminan.
- **Semen o toro de un servicio:** opcional. En el formulario se elige de una lista con la opción "No especificado" y solo con entradas **activas**. Un servicio ya cargado muestra siempre su entrada, aunque luego se la desactive, con el nombre que tenga en ese momento.
- **Servicio:** hembra activa en estado vaquillona, en ordeñe o seca (no recién nacida, no macho). Datos: fecha, tipo (inseminación o monta natural) y semen o toro (opcional).
- **Tacto:** hembra activa en estado vaquillona, en ordeñe o seca (no recién nacida, no macho). Datos: fecha, resultado (preñada o vacía), fecha probable de parto (solo si es preñada; ver RF-13) y anomalías detectadas (texto opcional de hasta 200 caracteres). Un tacto **no necesita un servicio previo** cargado: así se registra la situación de las vacas que ya estaban en el rodeo.
- **Servicio base:** el último servicio no anulado posterior al último tacto "vacía" no anulado (si no hay tacto "vacía", el último servicio). Puede no existir. (La spec 004 agrega que también debe ser posterior al último parto.)
- **Ciclo:** los eventos posteriores al último tacto "vacía" no anulado (la 004 suma el último parto). La "fecha indicada" de un tacto es la que el usuario escribió en él.
- **Estado reproductivo:** se deriva del último evento no anulado entre los servicios y tactos: sin ninguno, "sin servicio"; servicio, "servida (sin tacto)"; tacto "preñada", "preñada"; tacto "vacía", "vacía". (La 004 agrega que el parto reinicia el ciclo.)
- **Fecha probable de parto vigente:** solo existe si el estado reproductivo es "preñada". Es la del último tacto "preñada" no anulado, calculada así: la fecha indicada en ese tacto; si no indicó, la última fecha indicada por un tacto "preñada" anterior del mismo ciclo; si no hay ninguna, la del servicio base + 283 días. Si el estado es "servida (sin tacto)" no hay preñez confirmada ni fecha vigente, aunque se informa servicio + 283 días como referencia. Un tacto "vacía" anula la preñez (aborto o falsa preñez). La fecha derivada se muestra aunque ya esté vencida, con un aviso.
- **Fechas (de eventos y fecha probable):** formato `AAAA-MM-DD`, solo día (se rechaza todo otro formato, incluidas horas), y deben existir (se rechaza el 30/02). La fecha de un evento no puede ser futura (el "hoy" es el de Argentina, America/Argentina/Buenos_Aires, y debe poder fijarse en los tests), ni anterior al 01/01/2000, ni anterior a la fecha de nacimiento del animal si la tiene, ni anterior a la del último evento no anulado del mismo animal. Igual fecha que el último evento se permite.
- **Quién registró o anuló:** siempre se muestra solo el **nombre del usuario**; ninguna respuesta incluye datos de acceso (contraseñas, hashes, tokens).
- **Códigos de la API:** sin sesión 401; sin permiso por rol 403; datos inválidos 400 con mensaje en español; recurso inexistente, de otro tambo o con id mal formado en la ruta 404; evento que choca con el estado actual 409.
- **Orden de controles:** sesión (401), permiso por rol (403), formato del cuerpo (400), búsqueda del animal o evento de la ruta (404), referencias del cuerpo y reglas de fecha (400), conflictos con el estado (409). Por eso, un cuerpo mal formado gana sobre un animal inexistente en la ruta (400 y no 404), igual que en las specs 001 y 002. El semen o toro inexistente, de otro tambo o con formato inválido en el **cuerpo** responde 400 con mensaje (igual que la madre en la spec 002); el desactivado, 409.
- **Datos que manda el cliente:** el `establecimientoId` u otros campos no previstos en el cuerpo se **ignoran** (así lo hacen hoy las specs 001 y 002); nunca se usan.
- **Todo o nada:** cada registro o anulación se guarda completo o no se guarda nada.
- **Garantías en el almacenamiento:** un evento nunca apunta a un animal de otro tambo, un servicio nunca apunta a una entrada del catálogo de otro tambo, y el nombre del catálogo es único por tambo sin distinguir mayúsculas. Deberá garantizarse también a nivel de almacenamiento (constitución §6).
- **Roles existentes (spec 001):** dueño, encargado y veterinario; los tres figuran en la tabla de permisos.

## Requisitos funcionales

### Catálogo de semen y toros
- **RF-1** — El sistema deberá mostrar a los tres roles las entradas del catálogo del tambo del usuario (activas y desactivadas), ordenadas alfabéticamente por nombre sin distinguir mayúsculas, con nombre, raza (o "sin raza") y si está activa o desactivada.
- **RF-2** — Cuando un dueño o encargado crea una entrada con un nombre válido y, opcionalmente, una raza, el sistema deberá guardarla como activa en su tambo.
- **RF-3** — El sistema deberá guardar el nombre normalizado. Si queda vacío o supera los 50 caracteres, o si la raza supera los 50, entonces deberá rechazarlo con 400 y un mensaje en español que diga cuál es el problema.
- **RF-4** — Si el nombre normalizado coincide con el de otra entrada del mismo tambo (activa o desactivada), sin distinguir mayúsculas, entonces el sistema deberá rechazarlo con 409 y el mensaje "Ya existe un semen o toro con ese nombre". Vale al crear y al editar, y con dos usuarios simultáneos. Deberá garantizarse a nivel de almacenamiento.
- **RF-5** — Cuando un dueño o encargado edita una entrada de su tambo, el sistema deberá permitir cambiarle el nombre y la raza, también si está desactivada. Renombrarla a su propio nombre o cambiarle solo las mayúsculas se permite.
- **RF-6** — Cuando un dueño o encargado desactiva una entrada, el sistema deberá dejar de ofrecerla en los servicios nuevos y seguir mostrándola en los ya cargados; cuando la reactiva, deberá volver a ofrecerla.

### Servicio
- **RF-7** — Cuando un usuario autorizado registra un servicio de una hembra activa de su tambo con fecha, tipo y, opcionalmente, un semen o toro activo del catálogo, el sistema deberá guardarlo y mostrarlo en la ficha con el estado reproductivo "servida (sin tacto)".
- **RF-8** — El sistema deberá exigir fecha y tipo. Si falta alguno, o el tipo o la fecha no son válidos, entonces deberá rechazarlo con 400 y un mensaje en español.
- **RF-9** — Si el semen o toro indicado en el cuerpo no existe, es de otro tambo o tiene un formato inválido, entonces el sistema deberá rechazar el servicio con 400 y un mensaje en español, sin revelar nada de otros tambos; si está desactivado, deberá rechazarlo con 409 y un mensaje en español.
- **RF-10** — Si el animal es macho, recién nacido, o de otro modo no admite el evento, entonces el sistema deberá rechazar el servicio con 409 y un mensaje en español que diga el motivo.
- **RF-11** — Si el estado reproductivo de la vaca es "preñada", entonces el sistema deberá rechazar el servicio con 409 y un mensaje que diga que hay una preñez vigente y que primero hay que registrar un tacto "vacía".

### Tacto y fecha probable de parto
- **RF-12** — Cuando un usuario autorizado registra un tacto con fecha y resultado (preñada o vacía) sobre una hembra activa en estado vaquillona, en ordeñe o seca, el sistema deberá guardarlo. Si el animal es macho o recién nacido, entonces deberá rechazarlo con 409 y un mensaje en español. Si falta el resultado o la fecha, deberá rechazarlo con 400.
- **RF-13** — Cuando se registra un tacto "preñada", el sistema deberá fijar la fecha probable de parto así: la que el tacto indique; si no indica, la última fecha indicada por un tacto "preñada" anterior del mismo ciclo; si no hay ninguna, el servicio base + 283 días. Si no hay ninguna de las tres (por ejemplo, una vaca que ya estaba en el rodeo), entonces deberá exigir que el tacto indique la fecha y rechazarlo con 400 y un mensaje en español si falta. En ningún caso deberá inventar una fecha.
- **RF-14** — Si el tacto indica una fecha probable de parto, entonces el sistema deberá exigir que sea posterior a la fecha del tacto y que no supere los 283 días después de ella, haya o no servicio base; si no, deberá rechazarla con 400 y un mensaje en español. No deberá aceptar fecha probable en un tacto "vacía".
- **RF-15** — Cuando se registra un tacto "vacía", el sistema deberá guardarlo, dejar el estado reproductivo en "vacía" y, si había preñez vigente, anularla (aborto o falsa preñez), sin fecha vigente. Se acepta también sobre una vaca sin servicio ni preñez. No cambia el estado ni el lote del animal.
- **RF-16** — El sistema deberá considerar vigente la fecha probable del último tacto "preñada" no anulado, calculada como indica "Fecha probable de parto vigente", sin perder los tactos anteriores, que quedan en la lista. Si la fecha derivada (servicio + 283) ya pasó, deberá mostrarla igual con un aviso de que está vencida, sin error.
- **RF-17** — Donde el tacto traiga anomalías (hasta 200 caracteres, sin contar los extremos; vacías se guardan como "sin anomalías"), el sistema deberá guardarlas como texto y mostrarlas en la lista de eventos. Si superan los 200 caracteres, deberá rechazarlas con 400.

### Fechas
- **RF-18** — El sistema deberá rechazar con 400 y un mensaje en español que diga el motivo una fecha de evento (o fecha probable) con formato distinto de `AAAA-MM-DD`, inexistente (30/02), futura (hora de Argentina), anterior al 01/01/2000, anterior al nacimiento del animal o anterior a la del último evento no anulado de ese animal. Una fecha igual a la del último evento se acepta.

### Corrección: anular un servicio o un tacto
- **RF-19** — Cuando un usuario autorizado anula un servicio o un tacto indicando el motivo, el sistema deberá marcarlo como anulado (sin borrarlo), guardando quién lo anuló, cuándo y el motivo, y deberá recalcular la situación reproductiva y la fecha probable sin tenerlo en cuenta. La anulación de servicios y la de tactos tienen cada una su propia ruta, de modo que el permiso por rol se controla antes de buscar el evento y se mantiene el orden normal de controles. Un evento de otro tambo, inexistente, de otro tipo que el de la ruta, de un animal no activo o con id mal formado responde "no encontrado".
- **RF-20** — Si el evento no es el último evento no anulado de su animal, entonces el sistema deberá rechazar la anulación con 409 y un mensaje en español que diga cuál es el evento que hay que anular primero. Si ya está anulado, deberá rechazarla con 409. Si el motivo falta o supera los 200 caracteres, deberá rechazarla con 400.
- **RF-21** — Cuando se anula un servicio o un tacto, el sistema no deberá cambiar el estado ni el lote del animal: solo se recalcula la situación reproductiva (por ejemplo, al anular un tacto "vacía" vuelve a valer el estado anterior).
- **RF-22** — Si dos operaciones simultáneas afectan al mismo animal (dos anulaciones del mismo evento, un servicio con un tacto, una anulación con un registro), entonces el sistema deberá resolverlas de a una y dejar siempre datos coherentes: cada operación termina en 201 o 200, o en 409 (o 400 por fecha) si ya no corresponde, y nunca queda un servicio registrado sobre una preñez vigente ni un evento con fecha anterior al de otro posterior.

### Situación reproductiva y ficha
- **RF-23** — El sistema deberá mostrar en la ficha de toda hembra la situación reproductiva: estado reproductivo ("sin servicio", "servida (sin tacto)", "preñada", "vacía"), el último servicio (con su semen o toro), el último tacto y la fecha probable de parto vigente (o, si está "servida (sin tacto)", la fecha de referencia servicio + 283 días rotulada como tal), con "sin dato" donde corresponda. A los machos no se les muestra.
- **RF-24** — El sistema deberá mostrar, para una vaca preñada, los días que faltan (o que pasaron) hasta la fecha probable vigente, tomando el día de hoy de Argentina.
- **RF-25** — El sistema deberá mostrar en la ficha la lista de servicios y tactos ordenada del más reciente al más antiguo según el orden total, con tipo, fecha, datos principales (semen o toro, resultado, fecha probable, anomalías), quién lo registró y, si fue anulado, la marca de anulado con el motivo, quién lo anuló y cuándo. Mientras no haya eventos, deberá seguir mostrando "Todavía no hay eventos registrados" (RF-29 de la spec 002).
- **RF-26** — El sistema deberá mostrar quién registró o anuló un evento solo con el nombre del usuario, sin incluir en ninguna respuesta contraseñas, hashes ni tokens.

### Aislamiento y permisos
- **RF-27** — El sistema deberá registrar, anular y mostrar solo eventos y entradas del catálogo del tambo del usuario, y no deberá usar ningún identificador de tambo enviado por el cliente (se ignora). Un animal, evento o entrada de la ruta que sea de otro tambo, inexistente o con id mal formado responde siempre "no encontrado", idéntico en los tres casos.
- **RF-28** — El sistema deberá controlar el permiso por rol en la API: quien no puede gestionar el catálogo recibe 403, también con datos inválidos y con una entrada inexistente o de otro tambo. Sin sesión, la respuesta es 401, antes que cualquier otro control. Los veterinarios y el resto de los roles ven el catálogo y los eventos.
- **RF-29** — Donde el usuario no pueda gestionar el catálogo, el sistema no deberá mostrar los botones de alta, edición ni desactivación, pero sí el catálogo y la situación reproductiva en modo lectura.

### Interfaz
- **RF-30** — El sistema deberá permitir registrar un servicio y un tacto y anular el último evento desde la ficha de la hembra, mostrando solo las acciones que corresponden al estado del animal y al rol, con el semen o toro como lista desplegable con "No especificado", campos y botones de al menos 48 px de alto, sin desbordes horizontales en 768 px y 375 px, en modo claro y oscuro, con mensajes de error en español.
- **RF-31** — El sistema deberá agregar al menú una sección "Semen y toros" con el listado del catálogo y los formularios de alta, edición, desactivación y reactivación, con controles de al menos 48 px de alto y sin desbordes horizontales en 768 px y 375 px, en modo claro y oscuro.

## Permisos por rol
| Acción | Dueño | Encargado | Veterinario |
|---|---|---|---|
| Ver situación reproductiva, lista de eventos y catálogo (activas y desactivadas) | Sí | Sí | Sí |
| Registrar servicio | Sí | Sí | Sí |
| Registrar tacto | Sí | Sí | Sí |
| Anular un servicio o un tacto | Sí | Sí | Sí |
| Gestionar el catálogo (crear, editar, desactivar, reactivar) | Sí | Sí | No ("sin permiso") |

## Casos límite
- Servicio sin semen o toro ("No especificado"): se acepta. Con entrada de otro tambo, inexistente o con formato inválido: 400. Con entrada desactivada: 409.
- Entrada desactivada después de usarla: los servicios viejos la siguen mostrando, no aparece en servicios nuevos; reactivada, vuelve a aparecer.
- Nombre del catálogo vacío, de 51 caracteres, o que solo difiere en mayúsculas o espacios de otro del mismo tambo (incluida una entrada desactivada): se rechaza. Dos tambos con el mismo nombre: se permite. Dos usuarios crean el mismo nombre a la vez: solo uno se guarda.
- Servicio nuevo sobre una vaca ya servida (sin tacto) o con tacto "vacía": se acepta. Sobre una preñada: 409; primero hay que cargar un tacto "vacía".
- Servicio a una vaquillona o a una vaca seca o en ordeñe: no cambia estado ni lote. Servicio o tacto a un macho o a una recién nacida: 409.
- Tacto "preñada" sin servicio previo y con fecha probable: se acepta. Sin fecha: 400.
- Tacto "preñada" con fecha probable igual o anterior a la fecha del tacto, o a más de 283 días de él: 400.
- Tacto "preñada" con servicio de hace 300 días y sin fecha indicada: la fecha derivada (servicio + 283) ya pasó; se muestra vencida con aviso, sin error.
- Tacto "preñada" con fecha indicada, y después otro tacto "preñada" sin fecha: conserva la fecha indicada del primero. Si el primero se anuló (hay que anular primero el segundo), no cuenta.
- Tacto "preñada" que ajusta la fecha, y después un tacto "vacía": vale el último (sin preñez); el anterior queda en la lista. Si se anula el tacto "vacía", vuelve a valer el anterior.
- Servicio, tacto "vacía" y después tacto "preñada" sin nuevo servicio ni fecha anterior del ciclo: la fecha indicada es obligatoria, porque el servicio anterior a la "vacía" no cuenta como base.
- Tacto "vacía" sobre una vaca nunca servida: se acepta. Tacto "vacía" con fecha probable: 400.
- Aborto: el tacto "vacía" anula la preñez y no cambia estado ni lote.
- Evento olvidado entre dos ya cargados: se rechaza por fecha; hay que anular los posteriores, cargarlo y recargar los demás.
- Fecha "30/02", "2026-02-30", "2026-11-11T10:00" o "11/11/2026": 400 por formato o inexistencia. Fecha de mañana (hora de Argentina): 400. Fecha de hoy: se acepta.
- Dos eventos del mismo día: se ordenan por momento de registro; el segundo puede cargarse porque la fecha es igual.
- Anular un servicio o tacto que no es el último evento no anulado: 409 con el mensaje de qué anular primero. Anular uno ya anulado: 409. Anular el último y después el anterior: se permite, de a uno.
- Anular con el motivo vacío o de 201 caracteres: 400. Anular un evento de otro tambo, inexistente, con id mal formado, o usando la ruta de servicios con el id de un tacto: "no encontrado", idéntico.
- Un cuerpo inválido con un animal inexistente en la ruta: 400 (la validación va antes que la búsqueda).
- Un `establecimientoId` en el cuerpo: se ignora; el evento se guarda en el tambo de la sesión.
- Concurrencia: un servicio y un tacto "preñada" simultáneos sobre la misma vaca terminan con los dos guardados en orden coherente, o con uno guardado y el otro rechazado (409 o 400); nunca con un servicio registrado sobre una preñez vigente. Dos anulaciones del mismo evento: una 200 y una 409. Anulación del último evento y del anterior a la vez: las dos se guardan (primero el último) o la segunda recibe 409.
- Veterinario que intenta tocar el catálogo: 403, también con datos inválidos o entrada inexistente. Sin sesión: 401.
- La sesión vence con la pantalla abierta: la próxima acción lleva al login (comportamiento ya existente).

## Criterios de aceptación
- [ ] El catálogo permite crear, editar, desactivar y reactivar; el nombre se normaliza y es único por tambo sin distinguir mayúsculas y con las desactivadas incluidas, también en el almacenamiento. Los tres roles lo ven.
- [ ] El servicio se registra con semen o toro de la lista activa o "No especificado"; entradas desactivadas (409) y de otro tambo, inexistentes o mal formadas (400) se rechazan como indican RF-9 y RF-27.
- [ ] Un servicio sobre una vaca preñada da 409; después de un tacto "vacía" se acepta.
- [ ] Tacto y servicio se rechazan en machos y recién nacidas (409).
- [ ] Un tacto sin servicio previo se acepta; si es "preñada" y no hay fecha para conservar ni servicio base, exige la fecha probable.
- [ ] La fecha probable es la indicada, la conservada del ciclo o servicio + 283; la indicada debe ser posterior al tacto y a no más de 283 días; la derivada vencida se muestra con aviso; un tacto "vacía" la anula; siempre vale la del último tacto no anulado.
- [ ] Ningún evento se modifica ni se borra: la anulación guarda quién, cuándo y el motivo, se sigue viendo como anulado y no cuenta para los cálculos. Solo se anula el último evento no anulado; cualquier otro da 409 con el mensaje de qué anular primero.
- [ ] La anulación de servicios y tactos tiene una ruta por tipo; el permiso se controla antes de la búsqueda.
- [ ] Las fechas se validan como indica RF-18 con la hora de Argentina (con reloj fijable en los tests), solo `AAAA-MM-DD` y rechazando fechas inexistentes.
- [ ] Un test de concurrencia comprueba que servicio con tacto y dos anulaciones del mismo evento dejan datos coherentes con los resultados aceptables de RF-22, y que dos altas del mismo nombre de catálogo dejan una sola.
- [ ] Un evento o un servicio nunca apuntan a un animal o entrada de otro tambo (a nivel de almacenamiento).
- [ ] Ninguna respuesta de las rutas nuevas incluye hashes ni datos de acceso; "quién registró" muestra solo el nombre (con test).
- [ ] Cada acción (gestionar el catálogo, registrar servicio y tacto, anular, ver la situación y la lista) tiene un test de aislamiento entre dos tambos y un test de permisos por rol (el veterinario puede lo suyo y recibe 403 en el catálogo); sin sesión 401.
- [ ] Los formularios de la ficha y la pantalla del catálogo cumplen 48 px, sin desbordes en 768 px y 375 px, modo claro y oscuro; se verifica en el navegador.

## Preguntas abiertas
- (ninguna; las decisiones de negocio se tomaron el 2026-11-11)
