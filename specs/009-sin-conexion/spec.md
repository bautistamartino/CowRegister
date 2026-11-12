# 009 — Modo sin conexión: consulta y carga de litros

Estado: aprobada
Fecha: 2026-11-12 (aprobada el 2026-11-12, con todas las cifras y las propuestas "a confirmar")

## Contexto
En el corral de un tambo muchas veces no hay señal. Hoy, sin conexión, la tablet no sirve para nada: no abre la app, no busca una vaca ni carga los litros del ordeño. Esta spec cubre la primera parte de la **Etapa 6**: que la app se pueda **instalar** en la tablet, que se pueda **consultar sin conexión** (listado, buscador por número y fichas) y que los **litros de un ordeño** se puedan **cargar sin conexión** y se envíen solos cuando vuelva la señal.

Se eligió litros como único evento de carga sin conexión porque es lo que más se carga en el corral, los registros solo se agregan y la carga ya es repetible sin duplicarse (spec 008, RF-34). Los demás eventos dependen de reglas encadenadas (preñez vigente, "solo se anula el último", ciclos) y del orden por fecha y hora de registro, que se complica con relojes distintos: quedan para la spec 010.

Lo usan el dueño y el encargado para cargar litros y los tres roles para consultar, en la tablet, en el tambo.

**Depende de** las specs 001 (lotes), 002 (animales y buscador), 003 y 004 (situación reproductiva en la ficha), 005 (historial de cambios), 007 (historial) y 008 (producción, `id` idempotente de la carga). No cambia ninguna de sus reglas.

**Cambios en la API que esta spec declara** (el plan decide cómo; acá solo el QUÉ):
1. Una **descarga completa del tambo en una sola foto**: todos los animales activos con sus datos, situación reproductiva, historial y producción, más los lotes. El listado actual se recorta en 2.000 resultados con aviso; la copia local **no** puede recortarse en silencio.
2. La carga de litros acepta además un dato **solo informativo** con la hora en que se cargó en la tablet (RF-26 a RF-28).

## Alcance
- Incluye:
  - App **instalable** en la tablet, que abre aunque no haya conexión.
  - **Copia local completa del tambo** en la tablet (animales activos, lotes, fichas con historial, situación reproductiva y producción), actualizada al abrir la app con señal. Cartel "Datos al día de <fecha y hora>".
  - **Consulta sin conexión**: listado, buscador por número (tipeado o bastón RFID) y fichas de los animales activos.
  - **Carga de litros sin conexión** (vaca por vaca, como en la spec 008), guardada en la tablet como "pendiente" y **enviada sola** al volver la conexión.
  - Pantalla **"Pendientes de sincronizar"**: litros esperando, litros rechazados con su motivo y las opciones "Reintentar" y "Descartar".
  - **Aviso de "sin conexión"** visible en toda la interfaz y aviso de cuántos pendientes hay.
  - Sesión sin conexión, revalidación al volver la señal y cierre de sesión que borra los datos locales.
- No incluye (**fuera de alcance, para la spec 010**):
  - Cargar sin conexión servicios, tactos, partos, secados, bajas, altas, ediciones o movimientos de lote, y anular cualquier evento (incluidos los litros) sin conexión.
  - El **orden de eventos con relojes distintos** y los conflictos entre dispositivos de esos otros eventos. Acá la hora de la tablet nunca ordena nada (RF-26).
  - Fichas de animales dados de baja, informes y catálogo de semen sin conexión (se siguen usando con conexión).
  - Cifrar los datos guardados en la tablet.
  - Avisos de "hay una versión nueva" y sincronización con la app cerrada.
  - Corregir un pendiente (solo se puede reintentar o descartar).

## Supuestos y reglas del dominio
(Las decisiones de negocio están confirmadas por el usuario; ver "Decisiones tomadas".)
- **Reglas heredadas:** el tambo sale de la sesión; un recurso de otro tambo, inexistente o con id mal formado responde "no encontrado" (404) idéntico; la carga de litros conserva todas las reglas de la spec 008 (litros de 0 a 99,9 con un decimal, fecha no futura ni anterior al 01/01/2000, turno mañana o tarde, solo vacas activas en ordeñe, un solo registro vigente por vaca, fecha y turno, solo dueño y encargado).
- **Copia local:** foto del tambo en la tablet. Pertenece a **un tambo y un usuario**. Es **siempre completa o no existe**: nunca queda una copia a medias ni recortada.
- **Foto consistente:** la copia refleja el tambo en **un único instante** (no varios pedidos hechos en momentos distintos que puedan mostrar, por ejemplo, un animal en el listado y no en sus lotes).
- **Tamaño esperado y tope:** se espera un tambo de hasta **2.000 animales activos con historial**. El **tope de la copia es de 5.000 animales activos** (inyectable en los tests). Cada ficha conserva los topes que ya tiene (historial 500, producción 200) con su aviso.
- **"Al día de":** fecha y hora de la última copia completa y exitosa. Todo lo que se ve sin conexión corresponde a ese momento y puede haber cambiado en el servidor.
- **Pendiente:** registro de litros cargado sin conexión (o con señal mala, RF-24) que el servidor todavía no aceptó. Tiene un `id` propio generado en la tablet (el de la spec 008). Estados: **esperando**, **enviando** y **rechazado**. Al aceptarse deja de ser pendiente (RF-34).
- **Dos "mismos datos":** un reenvío es "con los mismos datos" cuando coinciden **vaca, fecha, turno y litros**. No cuentan la hora informativa de la tablet ni el lote.
- **Cómo se clasifica la respuesta del servidor al enviar un pendiente** (regla general; la tabla es cerrada):

| Respuesta | Resultado del pendiente |
|---|---|
| Aceptado con la forma esperada de la API (incluye "ya estaba guardado" con el mismo `id` y los mismos datos) | **Aceptado** |
| 400 (datos inválidos), 403 por rol, 404 (vaca inexistente, de otro tambo, mal formada o de baja: mismo mensaje), 409 (duplicado por vaca-fecha-turno, vaca que no está en ordeñe, `id` ya usado con otros datos o de otro tambo) | **Rechazado**, con el motivo en español de la API; no se reintenta solo |
| 401 (sesión no válida) | **Sesión** (RF-31): el pendiente sigue esperando |
| 408, 429, cualquier 5xx, corte de red, tiempo agotado, respuesta que no tiene la forma de la API (por ejemplo, un portal de WiFi que devuelve una página HTML con código 200) o cualquier otro código no listado | **Esperando**: se reintenta solo, con esperas crecientes, y siempre se puede forzar con "Reintentar ahora" |

- **Rechazo por duplicado:** gana el que llegó primero al servidor; el pendiente queda rechazado con el aviso de duplicado y el usuario elige entre descartarlo o anular el otro registro con conexión y reintentar.
- **Limitación aceptada del duplicado local:** el control de duplicado de la tablet (RF-20) usa los datos locales, que pueden estar viejos. Un duplicado cargado en otro dispositivo después de la última actualización recién se detecta al sincronizar (rechazo por duplicado).
- **Fecha y turno sin conexión:** salen de la hora del dispositivo convertida a hora de Argentina (mañana antes de las 14:00, tarde desde las 14:00) y se pueden cambiar.
- **Lote del registro:** el que tiene la vaca **en el servidor cuando el registro se acepta**, no el de la tablet.
- **Estado de la vaca sin conexión:** la tablet solo ofrece cargar a una vaca que en la copia es una hembra activa en ordeñe. El servidor decide al sincronizar (spec 008, RF-5).
- **Hora informativa de la tablet:** el servidor guarda `creadoEn` con su propio reloj, como siempre (así el orden y la unicidad de las specs 003 y 005 no cambian). La hora en que se cargó en la tablet se guarda **aparte**, solo para consulta: **nunca** se usa para ordenar, validar reglas, calcular promedios ni informes.
- **Sesión:** la sesión (30 días) sigue valiendo en la tablet sin conexión y se revalida al volver la conexión. Si venció o fue revocada, se piden las credenciales; si vuelve a ingresar el **mismo usuario del mismo tambo**, se conservan y se envían sus pendientes.
- **Ninguna copia ni pendiente de otro usuario o tambo queda nunca en la tablet visible o enviable.** Al cerrar sesión se borra todo lo local. Si, tras una sesión vencida o revocada, ingresa un usuario o tambo distinto, se avisa y, con **confirmación explícita**, se borra todo lo del anterior antes de mostrar nada del nuevo (RF-46).
- **Rol:** el rol sin conexión es el de la última revalidación; el servidor controla el permiso al sincronizar.
- **Orden de envío:** de a uno, en el orden en que se cargaron.
- **Límites en la tablet:** hasta **500 pendientes** (inyectable en los tests) y el espacio que dé el navegador. Si no alcanza, nada se confirma como guardado (RF-22 y RF-9).
- **Primer uso:** la primera descarga necesita conexión y bloquea el uso hasta terminar (RF-4).

## Requisitos funcionales

### App instalable
- **RF-1** — Cuando el usuario abre la app en un navegador compatible, el sistema deberá cumplir los criterios de instalación de ese navegador (nombre, íconos, inicio en pantalla completa propia) para poder instalarla en la tablet.
- **RF-2** — Cuando el usuario abre la app instalada, con sesión y copia local, sin conexión, el sistema deberá abrir la app sin errores de red y mostrar los datos locales.
- **RF-3** — Cuando el usuario recarga la app sin conexión (con la red cortada), el sistema deberá volver a mostrar la app y la última pantalla con datos locales, sin pantalla de error del navegador.

### Copia local
- **RF-4** — Cuando el usuario inicia sesión con conexión y no tiene copia local, el sistema deberá descargar la copia completa del tambo, bloqueando el uso y mostrando "Descargando los datos del tambo…" hasta terminar. Si la descarga falla o se interrumpe, entonces deberá mostrar el motivo y "Reintentar", y **no dejar copia parcial**.
- **RF-5** — Cuando el usuario abre la app con conexión y sesión válida, el sistema deberá actualizar la copia, usar la anterior mientras tanto mostrando "Actualizando…", y mostrar "Datos al día de <fecha y hora>" (hora de Argentina) al terminar.
- **RF-6** — El sistema deberá armar la copia con una foto única y consistente del tambo en un solo instante.
- **RF-7** — Si la actualización falla o se corta a mitad, entonces el sistema deberá conservar la copia anterior completa y su fecha "al día de" y avisarlo. Nunca deberá reemplazarla por una a medias.
- **RF-8** — Si el tambo tiene más animales activos que el tope de la copia, entonces el sistema **no** deberá descargar nada, deberá mostrar "El tambo tiene más animales de los que entran en la tablet (N). Pedí ayuda para usarlo sin conexión" y conservar la copia anterior si existe. La copia nunca se recorta en silencio.
- **RF-9** — Si la tablet no tiene espacio para guardar la copia, entonces el sistema deberá avisar "No hay espacio en la tablet para guardar los datos sin conexión", conservar la copia anterior si existe y no mostrar como actualizada la copia nueva.
- **RF-10** — Cuando hay conexión, el sistema deberá ofrecer "Actualizar ahora", y deberá reintentar solo una actualización fallida al volver la conexión.
- **RF-11** — Si el usuario abre la app sin conexión y no hay copia local, entonces el sistema deberá explicar "Necesitás conexión para descargar los datos del tambo la primera vez" y no mostrar pantallas vacías.

### Consulta sin conexión
- **RF-12** — Sin conexión, el sistema deberá ofrecer **solo** estas pantallas y acciones, y ninguna otra (lista cerrada):
  1. Inicio.
  2. Listado de animales activos (todos los de la copia, sin el recorte de 2.000 del listado con conexión) con sus filtros.
  3. Buscador por número.
  4. Ficha de un animal activo, en solo lectura.
  5. Cargar litros de una vaca en ordeñe (dueño y encargado).
  6. "Pendientes de sincronizar".
  7. Cerrar sesión.
- **RF-13** — Cuando el usuario, sin conexión, navega a algo fuera de esa lista (fichas de baja y listado de bajas, informes, catálogo de semen, lotes, usuarios, o cualquier acción de reproducción, bajas, edición o anulación), el sistema deberá mostrar una pantalla o aviso "Esto necesita conexión" con un botón para volver al listado, sin intentar la acción ni guardarla para después. Las opciones del menú y de la ficha que no estén disponibles aparecerán deshabilitadas con esa misma explicación.
- **RF-14** — Sin conexión, el sistema deberá buscar por número (tipeado o leído por bastón RFID con Enter) con el mismo criterio de normalización y de orden natural que la búsqueda con conexión, y con el mismo resultado para los mismos datos.
- **RF-15** — Sin conexión, el sistema deberá mostrar la ficha del animal activo con sus datos, situación reproductiva, historial y producción de la copia, indicando que son datos locales y la fecha "al día de".
- **RF-16** — Si un animal no está en la copia, entonces el sistema deberá mostrar "No encontrado en los datos de la tablet (al día de <fecha y hora>)" y no decir que el animal no existe.
- **RF-17** — Cuando el dato local de un animal sea de otro tambo o usuario distinto al de la sesión, el sistema no deberá mostrarlo (ver RF-46).

### Carga de litros sin conexión
- **RF-18** — Cuando un dueño o encargado carga los litros de una vaca en ordeñe (según la copia) sin conexión, el sistema deberá guardar un pendiente con la vaca, fecha, turno, litros, quién lo cargó, la hora de carga en la tablet y un `id` propio, y confirmar en pantalla "Guardado en la tablet: pendiente de sincronizar".
- **RF-19** — El sistema deberá aplicar en la tablet las mismas validaciones de formato y rango que la carga con conexión (spec 008), con los mismos mensajes en español, sin guardar un pendiente inválido.
- **RF-20** — Si en la copia hay un registro vigente de esa vaca, fecha y turno, o ya hay un pendiente no descartado (esperando, enviando o rechazado) de lo mismo, entonces el sistema deberá rechazar la carga con un mensaje que diga qué hacer: si es un pendiente, descartarlo desde "Pendientes"; si ya está cargado, anularlo con conexión.
- **RF-21** — El sistema deberá proponer sin conexión la fecha de hoy y el turno según la hora de Argentina calculada desde el reloj del dispositivo, y dejar cambiar el turno (spec 008, RF-30).
- **RF-22** — Si ya hay 500 pendientes en la tablet o el navegador no tiene espacio para guardar el pendiente, entonces el sistema deberá avisar "No se pudo guardar en la tablet: <motivo>. Conectate para sincronizar los pendientes" y **no** deberá confirmarlo como guardado.
- **RF-23** — Mientras se carga sin conexión, el sistema deberá mostrar el número de la vaca, su lote y su **último registro**: el más reciente **por fecha y turno** (la tarde después de la mañana), entre los registros no anulados de la copia y los pendientes esperando o enviando (no los rechazados), marcando los pendientes como "pendiente"; o "—" si no hay. Al guardar, deberá dejar listo el buscador para la vaca siguiente (spec 008, RF-7).
- **RF-24** — Cuando hay señal, el sistema deberá enviar la carga de inmediato. Si el servidor no confirma en **10 segundos** o falla la red, entonces deberá guardarla como pendiente con su `id`, para que reenviarla después no genere un duplicado. Si el servidor responde con un rechazo (tabla de reglas), deberá mostrarlo y no guardarlo como pendiente.
- **RF-25** — Si el usuario no es dueño ni encargado, entonces el sistema no deberá ofrecerle cargar litros, tampoco sin conexión.

### Hora informativa de la tablet
- **RF-26** — El sistema deberá guardar la hora en que se cargó el registro en la tablet en un dato aparte de `creadoEn` (que sigue siendo la hora del servidor), solo informativo: nunca se usa para ordenar, validar reglas, calcular promedios ni informes.
- **RF-27** — Si la carga trae la hora de la tablet con un formato que no es una fecha y hora válida, entonces el sistema deberá rechazarla con 400 y un mensaje en español. Si no la trae (carga con conexión directa o versión anterior), entonces deberá guardar el registro sin ese dato.
- **RF-28** — Si la hora de la tablet es posterior en más de **5 minutos** al reloj del servidor, o anterior al 01/01/2000, entonces el sistema deberá guardar el litro igual y **sin** ese dato informativo, sin rechazar la carga.

### Sincronización
- **RF-29** — Cuando vuelve la conexión y la sesión es válida, el sistema deberá enviar los pendientes esperando de a uno, en el orden de carga, sin intervención del usuario, mostrando el avance ("Enviando 3 de 12").
- **RF-30** — Cuando el servidor responde con un rechazo de la tabla de reglas (400, 403 por rol, 404, 409), el sistema deberá marcar el pendiente como **rechazado**, guardar el motivo en español de la API, no reintentarlo solo y seguir con los demás.
- **RF-31** — Cuando el servidor responde 401, el sistema deberá detener el envío, conservar todos los pendientes y pedir iniciar sesión; si ingresa el mismo usuario del mismo tambo, deberá retomar el envío.
- **RF-32** — Cuando el envío falla por 408, 429, 5xx, otro código no listado, corte de red, tiempo agotado o respuesta que no tiene la forma esperada de la API, el sistema deberá dejar el pendiente **esperando** y reintentarlo solo, con esperas crecientes, sin marcarlo rechazado.
- **RF-33** — Si un pendiente tiene un animal inexistente o de otro tambo, entonces el servidor deberá responder el mismo 404 en ambos casos y el pendiente quedar rechazado con ese mensaje, sin revelar cuál de los dos es.
- **RF-34** — Cuando el servidor acepta un pendiente (o responde "ya estaba guardado" con el mismo `id` y los mismos datos), el sistema deberá quitarlo de "Pendientes" y **mantenerlo visible en la ficha de la vaca como "Enviado: se confirma al actualizar"** hasta que una copia nueva lo incluya, de modo que el litro no desaparezca de la ficha entre la aceptación y la actualización.
- **RF-35** — Cuando termina una sincronización con litros aceptados, el sistema deberá actualizar la copia (RF-5).

### Pantalla "Pendientes de sincronizar"
- **RF-36** — El sistema deberá ofrecer la pantalla "Pendientes de sincronizar", que liste para cada pendiente: número de la vaca, fecha, turno, litros, cuándo se cargó y su estado (esperando, enviando, rechazado con el motivo).
- **RF-37** — Cuando el usuario toca "Reintentar" en un pendiente rechazado, el sistema deberá volver a enviarlo con su mismo `id` en cuanto haya conexión y mostrar el nuevo resultado. Cuando toca "Reintentar ahora" en uno que espera, deberá enviarlo de inmediato.
- **RF-38** — Cuando el usuario toca "Descartar" en un pendiente (esperando o rechazado), el sistema deberá pedir confirmación indicando vaca, fecha, turno y litros, y recién después quitarlo. No deberá existir ninguna forma de descartar un pendiente sin una acción explícita del usuario. Un rechazo por `id` ya usado con otros datos se resuelve descartando y cargando de nuevo.
- **RF-39** — Si el usuario descarta un pendiente que se está enviando, entonces el sistema deberá esperar el resultado y, si fue aceptado, avisar "Ya estaba guardado en el servidor" en vez de borrarlo.
- **RF-40** — Si no hay pendientes, entonces el sistema deberá mostrar "No hay nada pendiente de sincronizar".

### Aviso de conexión y sesión
- **RF-41** — Mientras no hay conexión, el sistema deberá mostrar en toda la interfaz el aviso "Sin conexión: datos al día de <fecha y hora>", y quitarlo cuando vuelva.
- **RF-42** — Mientras hay pendientes (esperando o rechazados), el sistema deberá mostrar su cantidad en el menú, también con conexión, destacando si hay rechazados.
- **RF-43** — Cuando el usuario cierra sesión, el sistema deberá borrar **todos** los datos locales (copia y pendientes) de esa sesión.
- **RF-44** — Si al cerrar sesión quedan pendientes (esperando o rechazados), entonces el sistema deberá pedir confirmación con la cantidad y "Se van a perder" y no cerrar la sesión si el usuario cancela.
- **RF-45** — Si no hay conexión al cerrar sesión, el sistema deberá avisar que la sesión del servidor no se pudo cerrar y hacer igual el cierre y borrado local (con la confirmación de RF-44 si hay pendientes).
- **RF-46** — Si al ingresar hay en la tablet datos de otro usuario o de otro tambo (por una sesión vencida o revocada), entonces el sistema deberá avisar cuántos pendientes se perderían y, solo con confirmación explícita, borrar todo lo del anterior antes de mostrar nada del nuevo. Si el usuario cancela, deberá volver a la pantalla de ingreso sin mostrar ningún dato. Si no había pendientes, deberá reemplazar la copia sin pedir confirmación.
- **RF-47** — Si ingresa el mismo usuario del mismo tambo tras una sesión vencida o revocada, el sistema deberá conservar la copia y los pendientes y retomar el envío.
- **RF-48** — Cuando se revalida la sesión y el servidor informa que fue revocada o el usuario dado de baja, el sistema deberá pedir las credenciales; los datos locales siguen sin mostrarse hasta ingresar (RF-46 y RF-47).

### Aislamiento y permisos
- **RF-49** — El sistema deberá tomar el tambo de la sesión al sincronizar y al descargar la copia, sin usar ningún identificador de tambo enviado por el cliente.
- **RF-50** — Si el cliente envía un `establecimientoId` (en el cuerpo o en la consulta), entonces el sistema deberá ignorarlo.
- **RF-51** — El sistema deberá incluir en la descarga solo datos del tambo de la sesión, sin hashes.
- **RF-52** — El sistema deberá permitir descargar la copia a los tres roles y responder 401 sin sesión.
- **RF-53** — El sistema deberá controlar en el servidor, al sincronizar, que quien carga sea dueño o encargado (spec 008, RF-27): un veterinario recibe 403 aunque haya manipulado la tablet.
- **RF-54** — Cada ruta nueva de descarga y la carga con el dato informativo deberán tener su test de aislamiento entre dos tambos.

### Interfaz
- **RF-55** — El sistema deberá mostrar campos y botones de al menos 48 px de alto, pantallas sin desborde horizontal a 768 px y 375 px, y contraste en modo claro y oscuro, incluida la pantalla "Pendientes de sincronizar", los carteles y las confirmaciones.
- **RF-56** — El sistema deberá mostrar exactamente estos textos de estado: "Sin conexión", "Pendiente de sincronizar", "Enviando…", "Rechazado: <motivo>", "Enviado: se confirma al actualizar", "Esto necesita conexión", "Actualizando…" y "Datos al día de <fecha y hora>".

## Cómo se verifica
- **Por tests automáticos:** la descarga completa, su tope y su consistencia (RF-6, RF-8, RF-49 a RF-54), la carga con la hora informativa (RF-26 a RF-28), el rechazo de un animal ajeno igual a uno inexistente (RF-33), la clasificación de respuestas (tabla de reglas, RF-29 a RF-32), orden de envío y estados, unicidad local de RF-20, búsqueda local igual a la del servidor (RF-14), la copia que se conserva ante fallos (RF-7 a RF-9), los borrados y confirmaciones de RF-43 a RF-48, el límite de 500 pendientes y la hora de Argentina sin conexión (RF-21), con el estado de conexión y la hora inyectables.
- **Evidencia mínima de la app instalable (RF-1 a RF-3), verificable en el navegador:** el manifiesto es válido (nombre, íconos, inicio propio), el navegador ofrece instalar la app y, con la red cortada, recargar sigue mostrando la app con los datos locales.
- **Solo en el navegador (con la red cortada, a 768 px y 375 px, modo claro y oscuro):** RF-4, RF-5, RF-10 a RF-13, RF-15, RF-16, RF-23, RF-24, RF-34, RF-36 a RF-42, RF-44 y RF-45, RF-55 y RF-56.

## Permisos por rol
| Acción | Dueño | Encargado | Veterinario |
|---|---|---|---|
| Instalar la app y consultar listado, buscador y fichas sin conexión | Sí | Sí | Sí |
| Cargar litros sin conexión (queda pendiente) | Sí | Sí | No |
| Ver "Pendientes de sincronizar", reintentar y descartar los propios | Sí | Sí | No (no tiene pendientes) |
| Cerrar sesión (borra los datos locales) | Sí | Sí | Sí |

## Casos límite
- **Primera vez sin conexión:** no hay datos; se explica que hace falta conexión (RF-11).
- **Primera descarga interrumpida:** no queda copia parcial; se muestra el error y "Reintentar" (RF-4).
- **Actualización interrumpida:** se conserva la copia anterior completa con su fecha (RF-7).
- **Tambo con más animales activos que el tope:** no se descarga; mensaje claro; la copia previa se conserva (RF-8).
- **Tablet sin espacio al descargar la copia o al guardar un pendiente:** aviso claro; la copia previa se conserva; nada se confirma como guardado (RF-9, RF-22). **500 pendientes:** no deja cargar más hasta sincronizar.
- **Datos viejos:** una vaca vendida, seca o ingresada después de la última actualización se ve como estaba; un animal ausente no se declara inexistente (RF-16). El duplicado cargado en otro dispositivo después de la última actualización se detecta recién al sincronizar (limitación aceptada).
- **Reloj mal configurado en la tablet:** la fecha propuesta puede estar mal; si queda futura, el servidor rechaza el pendiente con ese motivo; si queda en el pasado, se acepta (spec 008). **La hora informativa de la tablet** no afecta a nada: si está más de 5 minutos adelantada respecto del servidor o es anterior al 2000, el litro se guarda igual y sin ese dato (RF-28); si no es una fecha y hora válida, se rechaza con 400 (RF-27). `creadoEn` y el orden no cambian.
- **Portal cautivo de WiFi (200 con HTML) o servidor caído, 429 o 5xx:** el pendiente queda esperando y se reintenta solo; nunca se marca rechazado ni se pierde.
- **Señal mala al cargar con conexión:** si no se confirma en 10 segundos, queda como pendiente; el `id` evita el duplicado si el servidor sí lo había recibido (RF-24).
- **Mismo ordeño dos veces en la misma tablet:** se rechaza al cargar (RF-20). **En dos tablets o una tablet y la web:** gana la primera que sincroniza; la otra queda rechazada con aviso de duplicado y el usuario elige (descartar, o anular el otro con conexión y reintentar).
- **Mismo `id` con otros datos:** el pendiente queda rechazado; se descarta y se carga de nuevo (RF-38).
- **Vaca seca, vendida o inexistente antes de sincronizar:** el pendiente queda rechazado con el motivo. **Vaca de otro tambo:** mismo 404 que inexistente (RF-33).
- **Sesión vencida o revocada al volver la conexión:** se piden las credenciales (RF-31, RF-48). Si vuelve el **mismo usuario del mismo tambo**, se conservan y envían sus pendientes (RF-47). Si ingresa **otro usuario o de otro tambo**, se avisa y, con confirmación explícita, se borra todo lo anterior antes de mostrar nada (RF-46); si cancela, vuelve al ingreso. Así nunca quedan visibles ni enviables datos de otro usuario o tambo.
- **El usuario pasó a ser veterinario o fue dado de baja desde que cargó:** el servidor rechaza (403 o sesión inválida) y el pendiente queda rechazado, o se piden credenciales.
- **Cerrar sesión con pendientes:** confirmación con la cantidad; si cancela, no se cierra. **Sin conexión:** se cierra y borra localmente y se avisa (RF-45).
- **Muchos pendientes tras un día sin señal:** se envían de a uno, en orden, con avance; los no enviados siguen esperando.
- **Descartar mientras se envía:** se espera el resultado (RF-39).
- **Entre la aceptación y la próxima actualización:** el litro aceptado se sigue viendo en la ficha como "Enviado: se confirma al actualizar" (RF-34).
- **Dos pestañas de la app abiertas:** un mismo pendiente no se envía dos veces a la vez; si pasara, el reenvío con el mismo `id` no duplica.
- **Lote de la vaca:** el registro queda con el lote del servidor al aceptarse.
- **Litros 0:** se carga como cualquier litro válido (spec 008).
- **Anular, otros eventos, informes, bajas y semen sin conexión:** no se ofrecen (RF-13).
- Un `establecimientoId` enviado se ignora; la descarga y las respuestas no incluyen hashes ni datos de otros tambos.

## Riesgos aceptados
- **Tras revocar una sesión o dar de baja a un usuario, la tablet sigue mostrando los datos locales** (y permitiendo cargar litros pendientes) **hasta que vuelve la señal**; ahí se revalida, se piden credenciales y, si ingresa otro usuario, se borra todo lo anterior. Decisión del usuario.
- Los datos locales están **sin cifrar**: quien tenga la tablet con la sesión abierta ve el tambo (decisión del usuario).
- El control de duplicado local usa datos que pueden estar viejos (ver casos límite).

## Criterios de aceptación
- [ ] La app cumple los criterios de instalación (manifiesto válido), se instala en la tablet y, con la red cortada, recarga y abre mostrando los datos locales (RF-1 a RF-3).
- [ ] Al iniciar sesión se descarga la copia completa del tambo, en una foto consistente, con pantalla de espera y sin copia parcial si falla; al abrir con señal se actualiza y se muestra "Datos al día de…"; si falla, hay un tope o no hay espacio, se conserva la copia anterior con un mensaje claro (RF-4 a RF-11).
- [ ] Sin conexión solo están disponibles las pantallas de la lista cerrada; lo demás muestra "Esto necesita conexión" (RF-12, RF-13).
- [ ] El buscador, el listado y las fichas locales dan el mismo resultado que con conexión; un animal ausente no se declara inexistente (RF-14 a RF-17).
- [ ] Sin conexión se cargan litros como pendiente con las mismas validaciones, sin duplicar en la tablet, con el último registro por fecha y turno y con los límites claros (RF-18 a RF-25).
- [ ] La hora de la tablet se guarda aparte, solo informativa, y no cambia `creadoEn`, el orden ni los informes (RF-26 a RF-28).
- [ ] Los pendientes se envían solos en orden y sin duplicar; solo los rechazos de la tabla pasan a "rechazado"; 429, 5xx, cortes, portales y respuestas no válidas siguen esperando; el litro aceptado no desaparece de la ficha (RF-29 a RF-35).
- [ ] "Pendientes de sincronizar" permite reintentar y descartar con confirmación y no pierde nada sin decisión del usuario (RF-36 a RF-40).
- [ ] El aviso "sin conexión" y los pendientes se ven; cerrar sesión borra todo lo local con confirmación si hay pendientes; nunca quedan datos de otro usuario o tambo (RF-41 a RF-48).
- [ ] El tambo se toma de la sesión, se ignora el `establecimientoId` enviado, solo dueño y encargado cargan, y las rutas nuevas tienen su test de aislamiento (RF-49 a RF-54).
- [ ] La interfaz cumple RF-55 y RF-56, verificada en el navegador con la red cortada.

## Preguntas abiertas
- (ninguna)

## Decisiones tomadas
Confirmadas por el usuario el 2026-11-12:
1. **Alcance de la 009:** app instalable, consulta sin conexión (listado, buscador por número, fichas), carga de **litros** sin conexión con cola y sincronización automática, pantalla "Pendientes de sincronizar" y aviso de "sin conexión". Todo lo demás queda para la **spec 010**.
2. **Rechazo al sincronizar por una regla de negocio:** el litro queda en "Pendientes" con el motivo y las opciones "Reintentar" o "Descartar". No se pierde nada sin decisión del usuario.
3. **Dos dispositivos cargan el mismo vaca–fecha–turno sin conexión:** gana el primero en sincronizar; el otro queda en "Pendientes" con aviso de duplicado y el usuario elige.
4. **Copia de todo el tambo** (animales activos, lotes, fichas con historial y situación reproductiva), actualizada al abrir la app con señal, con el cartel "Datos al día de <fecha y hora>"; el buscador funciona completo sin señal.
5. **Sesión:** sigue valiendo localmente sin conexión (30 días) y se revalida al volver la señal; si venció, se piden credenciales y los pendientes del mismo usuario se conservan.
6. **Datos locales sin cifrar;** al cerrar sesión se borra todo lo local, con confirmación si hay pendientes.
7. **`creadoEn` sigue siendo la hora del servidor;** la hora de carga de la tablet se guarda aparte, solo informativa (no ordena, no valida, no calcula).
8. **Tope de la copia:** si el tambo tiene más animales activos que el tope, no se descarga y se conserva la copia previa; la copia es completa o no se hace.
9. **Respuestas al sincronizar:** solo 400, 403 por rol, 404 y 409 pasan a "rechazado"; 429, 5xx, cortes, tiempos agotados, respuestas no válidas y códigos no listados siguen esperando y se reintentan solos; 401 es sesión.
10. **Nunca quedan datos de otro usuario o tambo** en la tablet; tras sesión vencida, solo el mismo usuario conserva sus pendientes.
11. **Riesgo aceptado:** con una sesión revocada o un usuario dado de baja, la tablet sigue mostrando datos locales hasta volver la señal.

**A confirmar por el usuario al aprobar** (propuestas del planificador):
- Anular registros sigue necesitando conexión; las fichas de baja, los informes, los lotes y el catálogo de semen no se descargan ni se usan sin conexión.
- El lote del registro es el que la vaca tiene en el servidor al aceptarse.
- Si ingresa un usuario o tambo distinto al dueño de los datos locales, se avisa y se borra con confirmación explícita antes de mostrar nada; si cancela, vuelve al ingreso.
- Rechazado = no se reintenta solo; solo se reintenta con "Reintentar" del usuario.
- Cifras: tope de la copia de 5.000 animales, hasta 500 pendientes, 10 segundos para decidir carga inmediata o pendiente, y 5 minutos de tolerancia del reloj de la tablet.
- Un litro aceptado se sigue mostrando en la ficha como "Enviado: se confirma al actualizar" hasta la próxima copia.
