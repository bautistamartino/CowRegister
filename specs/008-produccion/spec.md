# 008 — Producción: litros por vaca e informe de leche

Estado: aprobada
Fecha: 2026-11-12 (aprobada el 2026-11-12)

## Contexto
Hoy el tambo anota en papel cuántos litros dio cada vaca en cada ordeño. Sin ese dato no se sabe qué vacas rinden más o menos, cómo viene un lote ni cuánta leche produjo el tambo en un período. Esta spec cubre la **Etapa 5**: (1) registrar los **litros de una vaca en un ordeño**, (2) verlos en la **ficha de la vaca** (activa y de baja) y (3) el informe de **litros de leche** por período (por vaca, por lote, por día, totales y promedios), uno de los informes más usados según `docs/requerimientos.md`.

Lo usan el dueño y el encargado para cargar y el veterinario para consultar (ver permisos), en la tablet, en el tambo.

**Depende de** las specs 001 (lotes), 002 (animales, estados), 006 (bajas) y 007 (informes y período). No cambia ninguna de sus reglas.

## Alcance
- Incluye:
  - Registro **a mano**, de a una vaca por vez, de los litros de un ordeño.
  - Anulación de un registro (con motivo, sin borrarlo) y corrección volviendo a cargar.
  - Sección "Producción" en la ficha de la vaca activa (con carga y anulación) y en la ficha de baja (solo lectura).
  - Informe de litros de leche por período: totales, promedios, por lote, por vaca y por día.
- No incluye:
  - Importar los litros desde el equipo de ordeñe (diferido: spec aparte si el tambo lo necesita).
  - Carga de varias vacas en una sola planilla o pantalla de ordeño por lote (diferido: spec posterior; esta spec es vaca por vaca).
  - **Rechazar un ordeño con fecha anterior al nacimiento de la vaca** (decisión del usuario: no se controla; solo rigen las reglas de fecha de abajo).
  - Calidad de la leche (grasa, proteínas, células somáticas), leche descartada, de terneros o de tanque.
  - Gráficos, exportar a Excel o PDF, alertas de baja producción, curvas de lactancia ("análisis productivos avanzados").
  - Uso sin conexión (Etapa 6): solo se la deja preparada.
  - Editar un registro (se anula y se carga de nuevo).

## Supuestos y reglas del dominio
(Las decisiones de negocio están confirmadas por el usuario; ver "Decisiones tomadas".)
- **Reglas heredadas:** el tambo sale de la sesión; un recurso de otro tambo, inexistente o con id mal formado responde "no encontrado" (404) idéntico; fechas `AAAA-MM-DD` con hora de Argentina; sin sesión 401, datos inválidos 400 con mensaje en español; los registros solo se agregan (corregir = anular con motivo).
- **Ordeño:** un ordeño se identifica por **fecha y turno**. Hay dos turnos fijos: **mañana** y **tarde**.
- **Registro de producción:** litros de **una vaca** en **un ordeño** (fecha + turno). Guarda quién lo cargó y cuándo.
- **Quién puede recibir una carga:** solo una hembra **activa** con estado **en ordeñe** al momento de cargar. El estado de la vaca en la fecha cargada no se revisa (la app no guarda el historial de estados): si hoy está en ordeñe, se puede cargar un ordeño de un día anterior. Tampoco se revisa la fecha de nacimiento.
- **Códigos al cargar:** animal inexistente, de otro tambo, con id mal formado **o dado de baja** = 404 idéntico (el mensaje no distingue cuál de los casos es). Macho, vaquillona, seca o recién nacida = **409** con un mensaje específico del motivo (igual que servicio y tacto en la spec 003: el animal existe pero su estado no admite la operación). Después, el 409 por registro duplicado.
- **Litros:** guardados de forma **exacta** (sin errores de punto flotante), con **un decimal** como máximo, mayor o igual a 0 y **hasta 99,9**. El 0 se admite (la vaca se ordeñó y no dio leche).
  - Formato aceptado por la API: un número JSON o un texto con **un solo punto decimal**, de forma `d`, `dd`, `d.d` o `dd.d`, sin signo, sin notación científica ni separador de miles. "5.0" es válido; "5.00", "5.", ".5", "1e1", "5,0" y "+5" no. **La coma la convierte la pantalla** (el usuario tipea coma o punto).
- **Fecha del ordeño:** no futura (hoy argentino sí) y no anterior al 01/01/2000.
- **Un solo registro vigente por vaca, fecha y turno.** Para corregir un error hay que anular el registro y cargar otro.
- **Id del registro:** la carga acepta un `id` UUID opcional generado por el cliente (pensado para el modo sin conexión). Si no se envía, lo genera el servidor.
- **Anulación:** cualquier registro no anulado de una vaca activa puede anularse (no solo el último, porque no dependen entre sí), también si la vaca ya no está en ordeñe (se secó); con un motivo obligatorio de **hasta 200 caracteres sin contar los extremos** (se recortan los espacios; "solo espacios" equivale a vacío), guardando quién y cuándo. El registro anulado se conserva, se marca y no cuenta en ningún informe ni promedio. La anulación se pide sobre una vaca **y** un registro: si el registro no pertenece a esa vaca (o a ese tambo), es 404 idéntico.
- **Lote del registro:** al cargar, se conserva el lote que tenía la vaca (o "Sin lote"), con su nombre. El informe por lote usa **ese** lote, aunque después la vaca cambie de lote o el lote se elimine.
- **Vacas dadas de baja:** sus registros se conservan, se ven en la ficha de baja y el informe del tambo los cuenta (una vaca vendida igual produjo en el período). No se carga ni se anula producción de una vaca de baja (404). Si se revierte la baja, vuelve a mostrarse su producción previa en la ficha de la vaca (con el lote original de cada registro) y vuelve a admitir carga si su estado es en ordeñe.
- **Se calcula al leer:** totales y promedios no se guardan.
- **Período del informe:** mismas reglas que la spec 007 (ambas fechas inclusive, `desde` no posterior a `hasta`, `hasta` no futura, `desde` desde el 01/01/2000, máximo 5 años). A diferencia de la 007, la pantalla propone por defecto el **mes en curso hasta hoy** (`desde` = día 1 del mes actual, `hasta` = hoy argentino).
- **Cálculo y redondeo:** los totales y promedios se calculan sobre los valores **exactos** y solo al mostrarlos se redondean a **un decimal** con el medio punto hacia arriba (0,1 + 0,2 da exactamente 0,3). Sin base de cálculo se muestra "—" (nunca 0).
- **Definiciones del informe:**
  - **Total de litros**: suma de los registros no anulados del período.
  - **Vaca-día**: una vaca con al menos un registro no anulado en un día (suma sus turnos).
  - **Promedio por vaca-día** = total de litros ÷ cantidad de vaca-días. Es el número principal ("litros por vaca por día").
  - **Promedio por ordeño** = total de litros ÷ cantidad de registros.
  - **Vacas distintas** (en el período, en un lote o en un día): cantidad de vacas con al menos un registro no anulado en ese conjunto. En el desglose por día, **"vacas ordeñadas" = vacas distintas con registro ese día**.
  - **Vaca-días de un lote**: combinaciones (vaca, día, lote del registro) con al menos un registro. Una vaca que el mismo día tuvo la mañana en un lote y la tarde en otro cuenta un vaca-día en cada uno, así que **las vacas distintas y los vaca-días de los lotes pueden sumar más que el total** del resumen. Es esperado y la pantalla lo aclara con una nota.
- **Topes (inyectables en los tests):** la ficha muestra hasta **200 registros** (los más recientes) y el desglose por vaca del informe hasta **2.000 filas**. El desglose por día **no tiene tope** (el período máximo de 5 años da como mucho 1.827 filas) y el desglose por lote tampoco (son pocos). Los totales siempre cuentan todo.
- **Aviso de tope:** igual que la spec 007: se informa el total N y se avisa en pantalla. **Excepción:** el desglose por vaca no corta por "más reciente" sino por **mayor promedio** (por eso el aviso dice "primeras" y no "más recientes").
- **Modo sin conexión (Etapa 6):** el identificador de cada registro se puede generar en el dispositivo (ver `id` opcional); el choque de dos cargas del mismo vaca–fecha–turno hechas sin conexión se resolverá al sincronizar (spec de la Etapa 6) y no se resuelve acá.

## Requisitos funcionales

### Registro de litros
- **RF-1** — Cuando el usuario con permiso elige una vaca, una fecha, un turno (mañana o tarde) y los litros, el sistema deberá guardar el registro de producción con quién lo cargó y cuándo, y confirmarlo en pantalla.
- **RF-2** — El sistema deberá aceptar litros exactos con hasta un decimal, entre 0 y 99,9 inclusive, en el formato descripto en las reglas (la pantalla acepta coma o punto y envía punto).
- **RF-3** — Si los litros faltan, no son un número o un texto del formato aceptado, son negativos, superan 99,9 o tienen más de un decimal, entonces el sistema deberá rechazar el pedido con 400 y un mensaje en español que diga el motivo.
- **RF-4** — Si la fecha no existe, es futura (hora de Argentina) o es anterior al 01/01/2000, o el turno no es "mañana" ni "tarde", o el `id` enviado no es un UUID válido, entonces el sistema deberá rechazar el pedido con 400 y un mensaje en español.
- **RF-5** — Si el animal no existe, es de otro tambo, tiene el id mal formado o está dado de baja, entonces el sistema deberá responder 404 con el mismo mensaje en todos esos casos. Si el animal es un macho, una vaquillona, una vaca seca o un recién nacido, entonces el sistema deberá rechazar la carga con **409** y un mensaje en español con el motivo específico (por ejemplo "Solo se carga producción de vacas en ordeñe; esta vaca está seca"), sin guardar nada.
- **RF-6** — Si ya existe un registro no anulado de esa vaca en esa fecha y turno, entonces el sistema deberá rechazar la carga con 409 y un mensaje que lo diga e indique que hay que anularlo para corregirlo.
- **RF-7** — Mientras se carga producción de una vaca, el sistema deberá mostrar su número, su lote y su **último registro**: el más reciente por fecha y turno (la tarde después de la mañana) entre los no anulados, con su fecha, turno y litros, o "—" si no tiene, para que quien carga confirme que es la vaca correcta. Cuando el guardado termina bien, deberá dejar listo el formulario para cargar la vaca siguiente (se vuelve al buscador por número, compatible con el bastón RFID).
- **RF-8** — Cuando se guarda un registro, el sistema deberá conservar el lote que tenía la vaca en ese momento (o "Sin lote"), con su nombre.
- **RF-34** — Cuando la carga trae un `id` y ese id ya existe en el tambo con **los mismos datos** (vaca, fecha, turno y litros), el sistema deberá responder igual que si la carga hubiera salido bien, devolviendo el registro ya guardado y **sin crear otro** (la misma carga repetida es idempotente). Si ese id ya existe con datos distintos o pertenece a otro tambo, entonces deberá rechazarla con 409 y un mensaje genérico que no revele de quién es. La repetición idempotente se resuelve antes de revisar el estado de la vaca y el duplicado por vaca–fecha–turno.
- **RF-35** — Mientras se guarda una carga, el sistema deberá bloquear la vaca para validar su estado y tomar su lote en un mismo paso consistente, de modo que dos pedidos sobre la misma vaca se serialicen. Si dos cargas del mismo ordeño llegan al mismo tiempo, entonces una deberá guardarse y la otra deberá responder 409 (nunca 500, ni siquiera si el choque lo detecta la base). Se prueba con pedidos simultáneos.
- **RF-37** — El sistema deberá guardar y sumar los litros de forma exacta y redondear a un decimal (medio punto hacia arriba) solo al mostrar, sobre el valor exacto: la suma de 0,1 y 0,2 es 0,3 y un promedio de 12,25 se muestra 12,3.

### Corrección (anulación)
- **RF-9** — Cuando el usuario con permiso anula un registro de producción de una vaca activa indicando un motivo, el sistema deberá marcarlo como anulado guardando quién, cuándo y el motivo, sin borrarlo, y dejar de contarlo en la ficha y en el informe.
- **RF-10** — Si el motivo falta, está vacío, tiene solo espacios o supera los 200 caracteres (sin contar los extremos), entonces el sistema deberá rechazar la anulación con 400. Si el registro ya está anulado, entonces deberá rechazarla con 409. Si la vaca o el registro no existen, son de otro tambo, tienen el id mal formado, el registro no es de esa vaca o la vaca está dada de baja, entonces deberá responder 404 idéntico. La anulación **se permite** aunque la vaca ya no esté en ordeñe (por ejemplo, ahora seca).
- **RF-11** — Cuando se anula un registro, el sistema deberá permitir cargar otro para la misma vaca, fecha y turno.
- **RF-36** — Si dos anulaciones del mismo registro llegan al mismo tiempo, entonces el sistema deberá anularlo una sola vez y responder 409 a la otra (nunca 500). Se prueba con pedidos simultáneos.

### Ficha de la vaca
- **RF-12** — El sistema deberá mostrar en la ficha de la vaca activa una sección "Producción" con sus registros del más reciente al más antiguo por fecha y turno (la tarde antes que la mañana del mismo día): fecha, turno, litros, quién lo cargó, y los anulados marcados con quién, cuándo y motivo.
- **RF-13** — El sistema deberá mostrar en esa sección el promedio de litros por vaca-día de los últimos 30 días corridos (hoy argentino y los 29 anteriores, sin contar anulados), o "—" si en esa ventana no hay registros.
- **RF-14** — Si la vaca no tiene registros, entonces el sistema deberá mostrar "Todavía no hay producción registrada". Si hay más de 200, deberá mostrar los 200 más recientes con el aviso "Se muestran los 200 registros más recientes de N".
- **RF-15** — Donde la vaca no esté en ordeñe, el sistema deberá mostrar igual sus registros anteriores pero no ofrecer el formulario de carga; explicará que solo se carga producción de vacas en ordeñe. El botón "Anular" sigue disponible en sus registros no anulados para dueño y encargado.
- **RF-16** — El historial único de la spec 007 no cambia: la producción se muestra en su propia sección y no entra en él.
- **RF-33** — El sistema deberá mostrar la misma sección "Producción" en la ficha de un animal dado de baja por venta o muerte, **solo en lectura** (mismo orden, marcas de anulados, promedio de 30 días y aviso de tope; sin formulario de carga ni botón "Anular"), para los tres roles. Su lectura es una ruta de la parte de bajas: un animal activo da "no encontrado" ahí y uno de baja da "no encontrado" en la lectura de activos, igual que el historial de la spec 007.

### Informe de litros de leche
- **RF-17** — Cuando el usuario elige un período, el sistema deberá mostrar el resumen: total de litros, cantidad de ordeños registrados, vacas distintas, promedio por vaca-día y promedio por ordeño.
- **RF-18** — El sistema deberá mostrar el desglose **por lote** (el del registro, con "Sin lote" si no tenía): litros, vacas distintas, vaca-días y promedio por vaca-día, ordenado por litros de mayor a menor (a igual cantidad, por nombre), con la nota de que las vacas y los vaca-días por lote pueden sumar más que el total.
- **RF-19** — El sistema deberá mostrar el desglose **por vaca**: número, litros, días con registro y promedio por vaca-día, ordenado por **promedio exacto** de mayor a menor (se compara el valor exacto, no el redondeado) y, a igual promedio exacto, por número en **orden natural** (A2 antes que A10, como en la spec 002). El número de una vaca activa lleva a su ficha y el de una dada de baja por venta o muerte, a su ficha de baja.
- **RF-20** — El sistema deberá mostrar el desglose **por día**: litros totales del tambo, vacas ordeñadas (vacas distintas con registro ese día) y el total de cada turno (mañana y tarde), del día más reciente al más antiguo y sin tope.
- **RF-21** — Si en el período no hay registros, entonces el sistema deberá mostrar "No hay producción registrada en este período" y no mostrar promedios.
- **RF-22** — El sistema deberá ofrecer los campos "Desde" y "Hasta" con el período por defecto de las reglas, consultar al cambiar cualquiera de las dos cuando ambas sean válidas, mostrar el mensaje sin consultar si alguna falta o es inválida, y descartar la respuesta de una consulta vieja si se cambia el período en curso.
- **RF-23** — Si el período es inválido (falta, fechas inexistentes, `desde` posterior a `hasta`, `hasta` futura, `desde` anterior al 01/01/2000, más de 5 años, parámetro repetido o que no es texto), entonces el sistema deberá rechazarlo con 400 y un mensaje en español, sin calcular nada. Un `establecimientoId` en la query se ignora.
- **RF-24** — Si el desglose por vaca supera 2.000 filas, entonces el sistema deberá mostrar las primeras 2.000 del orden de RF-19 con el aviso "Se muestran las 2.000 primeras de N" (excepción a la 007: corta por mayor promedio y no por más reciente), manteniendo los totales completos.
- **RF-25** — Cuando se anula un registro, el sistema deberá reflejarlo en el siguiente cálculo del informe y de la ficha sin pasos manuales. El informe deberá incluir los registros de vacas dadas de baja.

### Aislamiento y permisos
- **RF-26** — El sistema deberá leer y escribir producción solo con datos del tambo de la sesión, sin usar ningún identificador de tambo enviado por el cliente. **Cada una de las rutas nuevas tiene su test de aislamiento entre dos tambos:** (a) carga, (b) anulación (incluye vaca propia con registro de otro tambo, vaca de otro tambo con registro propio y registro de otra vaca del mismo tambo, todos "no encontrado" idéntico), (c) lectura de la ficha de la vaca activa, (d) lectura de la ficha de baja e (e) informe. Hay además un test explícito de que un `establecimientoId` enviado (en el cuerpo o en la query) se ignora.
- **RF-27** — El sistema deberá permitir cargar y anular registros solo al dueño y al encargado (el veterinario recibe 403 con el mensaje exacto "Esta acción la tiene que hacer un dueño o encargado"), y ver la sección "Producción" (activa y de baja) y el informe a los tres roles. Sin sesión, 401. Orden de controles al cargar: 401, 403, 400, 404, 409 por estado de la vaca, 409 por duplicado. Al anular: 401, 403, 400, 404, 409 por ya anulado. Al leer: 401 y, en el informe, 400 por período.
- **RF-28** — El sistema deberá garantizar, también en la base, que no haya dos registros no anulados de la misma vaca, fecha y turno, que los litros estén en rango y con un decimal, que el turno sea válido, que un registro anulado tenga quién, cuándo y motivo, y que dos cargas simultáneas del mismo ordeño no creen un duplicado (una responde 409).
- **RF-29** — El sistema deberá identificar cada registro con un UUID y guardar `creadoEn` (y `actualizadoEn` si se modifica por anulación), sin depender de identificadores generados en orden, para no cerrar la puerta al modo sin conexión.

### Interfaz
- **RF-30** — El sistema deberá incluir en la ficha de la vaca en ordeñe el formulario de carga (fecha por defecto hoy y litros) con el turno propuesto según la **hora de Argentina (UTC-3)**: mañana antes de las 14:00 y tarde desde las 14:00, sin depender de la zona horaria del navegador (la hora se puede inyectar en los tests); el usuario puede **cambiar el turno** antes de guardar. Deberá incluir el botón "Anular" en cada registro no anulado, solo para dueño y encargado.
- **RF-31** — El sistema deberá sumar el informe "Litros de leche" a la pantalla "Informes" de la spec 007, para los tres roles.
- **RF-32** — El sistema deberá mostrar campos y botones de al menos 48 px de alto, teclado numérico con decimales para los litros, tablas que se adapten a 768 px y 375 px sin desborde horizontal de la página, textos en español rioplatense, contraste en modo claro y oscuro, "Calculando…" mientras se consulta y el mensaje de error sin perder el período si falla.

## Cómo se verifica
- **Por tests automáticos (API y funciones puras):** RF-1 a RF-6, RF-8 a RF-11, RF-13 (cálculo), RF-14 (tope), RF-17 a RF-21, RF-23 a RF-29, RF-33 a RF-37, y la hora por defecto del turno (función con hora inyectada).
- **Solo en el navegador (a 768 px y 375 px, modo claro y oscuro):** RF-7 (flujo de pantalla y vuelta al buscador), RF-12, RF-15, RF-22 (descarte de respuestas viejas), RF-30 a RF-32.

## Permisos por rol
| Acción | Dueño | Encargado | Veterinario |
|---|---|---|---|
| Cargar litros de una vaca | Sí | Sí | No |
| Anular un registro de producción | Sí | Sí | No |
| Ver la producción en la ficha de la vaca (activa o de baja) | Sí | Sí | Sí |
| Ver el informe de litros de leche | Sí | Sí | Sí |

## Casos límite
- Animal inexistente, de otro tambo, con id mal formado o dado de baja: 404 idéntico al cargar. Macho, vaquillona, seca o recién nacida: 409 con el motivo específico.
- Vaca en ordeñe que se seca después: sus registros anteriores se conservan, se ven en la ficha y cuentan en el informe; no se puede cargar más producción, pero **sí se puede anular** un registro suyo.
- Dos cargas del mismo ordeño (misma vaca, fecha y turno): la segunda da 409, también si llegan al mismo tiempo (nunca 500).
- La misma carga reenviada con el mismo `id` y los mismos datos: responde igual que la primera vez y no crea otro registro. Mismo `id` con otros datos o de otro tambo: 409. `id` que no es UUID: 400.
- Dos anulaciones simultáneas del mismo registro: una se aplica, la otra da 409.
- Error de tipeo (ej. 25,0 en vez de 52,0): se anula con motivo y se carga el correcto en el mismo turno; el anulado queda visible y no cuenta.
- Motivo de anulación de solo espacios o de 201 caracteres: 400; de exactamente 200 (sin contar extremos): se acepta.
- Litros 0: se acepta, entra en el total y suma un vaca-día (baja el promedio). Litros 100, 99,95, -1, "abc", "5.00", "1e1", "5," o vacío: 400. "5.0" y "99.9": válidos.
- Fecha de ayer o de hace meses para una vaca hoy en ordeñe: se acepta (no se revisa su estado de ese día). **Fecha anterior al nacimiento de la vaca: se acepta** (no se controla). Fecha de mañana: 400. Hoy: se acepta.
- Vaca con un solo turno cargado en el día: es un vaca-día con ese único turno (el promedio por vaca-día queda más bajo; no se completa ni se estima el turno faltante).
- Cambio de lote de la vaca después de cargar: el informe por lote sigue usando el lote de cuando se cargó. Lote eliminado después: el nombre se conserva en el registro. Vaca con la mañana en un lote y la tarde en otro: un vaca-día en cada lote, y los lotes pueden sumar más vaca-días y vacas distintas que el total.
- Vaca vendida o muerta durante el período: cuenta en el informe con su número enlazado a su ficha de baja, y su ficha de baja muestra su producción en solo lectura. Cargar o anular sobre ella: 404.
- Baja revertida: la ficha de la vaca vuelve a mostrar toda su producción previa (con el lote original de cada registro) y vuelve a admitir carga si su estado es en ordeñe.
- Desglose por vaca con empate de promedio exacto: se ordena por número en orden natural. Dos promedios que se redondean igual pero difieren: manda el exacto.
- Promedio de 12,25 L: se muestra 12,3. Suma de 0,1 y 0,2 litros: 0,3.
- Período de un solo día, `hasta` hoy, rango de 5 años exactos: se aceptan; un día más de 5 años o `hasta` mañana: 400. Período de 5 años: el desglose por día muestra todas sus filas (sin tope).
- Período sin registros o tambo nuevo: "No hay producción registrada en este período", sin promedios ni divisiones por cero.
- Registro anulado: no entra en ningún total, promedio ni conteo; puede anularse solo una vez.
- Id de vaca o de registro de otro tambo, inexistente o mal formado: "no encontrado" idéntico.
- Un `establecimientoId` en el cuerpo o en la query se ignora.
- La sesión vence con la pantalla abierta: la próxima acción lleva al login.
- Las respuestas no incluyen hashes ni datos de otros tambos.

## Criterios de aceptación
- [ ] Dueño y encargado cargan litros (0 a 99,9, un decimal exacto) de una vaca en ordeñe por fecha y turno; el veterinario no, con el mensaje exacto (RF-1 a RF-8, RF-27, RF-37).
- [ ] No se admite carga de animales que no sean vacas activas en ordeñe (404 para inexistente, ajeno, mal formado o de baja; 409 con motivo para macho, vaquillona, seca o recién nacida), ni un segundo registro vigente del mismo ordeño, ni datos inválidos (RF-3 a RF-6, RF-28).
- [ ] La carga bloquea la vaca, el choque de unicidad da 409 y nunca 500, y la misma carga con el mismo `id` es idempotente (RF-34, RF-35).
- [ ] Un registro se anula con motivo (400 si falta, solo espacios o más de 200) sin borrarse, también en una vaca que ya no está en ordeñe; deja de contar y permite recargar ese ordeño; dos anulaciones simultáneas dan una sola anulación (RF-9 a RF-11, RF-25, RF-36).
- [ ] La ficha de la vaca y la ficha de baja muestran la sección "Producción" (la de baja solo en lectura) con registros, anulados marcados, promedio de 30 días y avisos (RF-12 a RF-16, RF-33).
- [ ] El informe da totales, promedios exactos redondeados solo al mostrar, desglose por lote, por vaca (orden por promedio exacto y número natural) y por día, con el lote tal como estaba al cargar y las bajas incluidas (RF-17 a RF-21, RF-25, RF-37).
- [ ] El período se valida y la pantalla descarta respuestas viejas; el tope del desglose por vaca es inyectable y avisa (RF-22 a RF-24).
- [ ] Cada ruta nueva (carga, anulación, ficha activa, ficha de baja, informe) tiene su test de aislamiento entre dos tambos, permisos por rol, `establecimientoId` ignorado y sin hashes (RF-26, RF-27).
- [ ] La interfaz cumple RF-30 a RF-32 (48 px, 768 y 375 px, modo claro y oscuro, turno por hora argentina y cambiable), verificada en el navegador.

## Notas para el plan
- **Rendimiento (riesgo a resolver en el plan):** el informe lee registros por tambo y fecha de hasta 5 años. Se pide un **índice por tambo y fecha** (una migración). El plan tiene que decidir dónde se agrega (en la base con SQL o en TypeScript, como los informes de la 007) y fijar un **límite claro** de filas leídas, avisándolo si se supera. Esta spec no fija un criterio de rendimiento.
- Los topes (200 en la ficha, 2.000 en el desglose por vaca) deben poder cambiarse en los tests.
- La hora por defecto del turno necesita una hora inyectable en la web para probarse.

## Preguntas abiertas
- (ninguna)

## Decisiones tomadas
Confirmadas por el usuario el 2026-11-12:
1. **Carga a mano.** La importación desde el equipo de ordeñe queda fuera de alcance, para una spec aparte.
2. **Dos turnos fijos por día:** mañana y tarde.
3. **Carga vaca por vaca**, por número o bastón RFID. La planilla por lote queda fuera de alcance, para una spec posterior.
4. **Litros con un decimal, de 0 a 99,9**; el 0 se admite.
5. **Cargan y anulan dueño y encargado;** el veterinario solo lee.
6. **El informe por lote usa el lote de la vaca al momento de cargar.**
7. **Período por defecto del informe:** mes en curso hasta hoy.
8. **Cargar litros a una vaca de baja da 404 genérico**, idéntico al de animal inexistente, ajeno o con id mal formado.
9. **La ficha de baja muestra la producción en solo lectura.**
10. **No se rechaza un ordeño con fecha anterior al nacimiento** de la vaca.
11. **El desglose por vaca se ordena por promedio exacto**; los empates, por número en orden natural (como la spec 002).
Decididas al corregir la spec tras el QA del revisor: macho, vaquillona, seca o recién nacida dan 409 (igual que servicio y tacto en la spec 003); se puede anular un registro de una vaca activa que ya no está en ordeñe; la carga acepta un `id` UUID opcional y es idempotente.
