# 002 — Animales y buscador

Estado: aprobada
Fecha: 2026-11-10

## Contexto
Hoy el rodeo del tambo está en papel o en una planilla. Para reemplazarlo, la app necesita registrar a cada animal con su número (caravana = botón RFID), su estado y su lote, y poder encontrarlo rápido. Esta funcionalidad permite dar de alta animales de a uno (el día a día) o cargar el rodeo existente de una vez pegando filas copiadas desde Excel o Google Sheets, ver el listado y la ficha de cada animal, y buscar por número tipeado o leído con el bastón RFID (que "tipea" el número y Enter).

Cada animal queda en el lote que el tambo definió como destino de su estado (spec 001). La usan el dueño y el encargado (cargan y consultan) y el veterinario (consulta).

## Alcance
- Incluye:
  - Alta manual de un animal con datos básicos.
  - Carga del rodeo pegando filas de una planilla, con vista previa de filas correctas y con error (con el motivo) y guardado recién al confirmar.
  - Asignación automática del lote al dar de alta, según el estado y los destinos del tambo.
  - Listado de animales activos con filtros por estado y lote.
  - Ficha de cada animal (solo lectura).
  - Buscador por número, compatible con el bastón RFID.
- No incluye:
  - Eventos (pariciones, secados, servicios, tactos), situación reproductiva y cualquier dato de la Etapa 2.
  - Bajas por venta o muerte y el movimiento automático de lote al cambiar de estado (Etapa 3). El CHECK de la base que impide que un animal de baja tenga lote queda **pendiente para la Etapa 3** (ver MEMORY.md); esta spec solo trabaja con animales activos.
  - Editar los datos de un animal y mover un animal de lote a mano (spec aparte).
  - Subir archivos (solo se pega texto) y la carga en serie con el bastón.
  - Crear los lotes o configurar los destinos (spec 001).
  - Guardar borradores de carga en el servidor.

## Supuestos y reglas del dominio
- **Dependencia de la spec 001:** el lote de cada animal sale de los destinos configurados por estado (recién nacido, vaquillona, en ordeñe, seca). Sin esa configuración los animales quedan sin lote.
- **Animales del tambo:** en toda esta spec, "animales" son los **activos**. Los dados de baja no se listan, no se buscan y su ficha responde "no encontrado".
- **Número reutilizable:** el número de un animal dado de baja puede volver a usarse (la unicidad es solo entre activos), aunque normalmente el tambo no lo hace.
- **Normalización de textos:** "quitar los extremos" significa quitar espacios, tabulaciones, saltos de línea y espacios Unicode (por ejemplo el espacio de no separación que a veces trae Excel o el bastón). Las longitudes se cuentan en caracteres visibles, no en bytes.
- **Número normalizado:** sin los extremos, sin distinguir mayúsculas (se guarda y se busca en **mayúsculas**), de 1 a 20 caracteres, y solo letras sin tildes (A-Z), dígitos, guion y punto. "7" y "007" son números distintos. Ejemplos: " ab-12 " se guarda "AB-12"; "12 3", "ñandú" y "A_1" se rechazan.
- **Número único:** no puede haber dos animales activos con el mismo número normalizado en un tambo. Deberá garantizarse también a nivel de almacenamiento (constitución §6), sobre el valor normalizado y aun con operaciones simultáneas.
- **Datos básicos:** número, sexo (hembra o macho), estado inicial (recién nacido, vaquillona, en ordeñe o seca; nunca baja), fecha de nacimiento (opcional) y madre (opcional).
- **Combinación sexo y estado:** las hembras pueden tener cualquier estado inicial; los machos solo "recién nacido".
- **Fecha de nacimiento válida:** no es futura (el "hoy" se toma de la hora de Argentina, America/Argentina/Buenos_Aires), no es anterior al 01/01/2000 y, si la madre también tiene fecha, la madre nació **antes** que la cría (estrictamente anterior). Si la madre no tiene fecha, esa comparación no se hace.
- **Madre:** se indica por su número (con la misma normalización). Debe ser una hembra activa del mismo tambo y distinta del propio animal.
- **Lote asignado:** al dar de alta, el animal va al lote destino de su estado. Si ese estado no tiene destino, queda **sin lote** y se avisa.
- **Lote y animales:** un animal nunca apunta a un lote de otro tambo ni a un lote inexistente, y su madre nunca es de otro tambo. Deberá garantizarse también a nivel de almacenamiento. Un lote con animales no puede eliminarse (también a nivel de almacenamiento).
- **Planilla pegada:** el usuario pega texto copiado de Excel o Google Sheets. Cinco columnas fijas, separadas por tabulación, en este orden: número, sexo, fecha de nacimiento, estado, número de la madre. Fecha de nacimiento y madre pueden venir vacías; número, sexo y estado son obligatorios. El parseo del texto se escribe a mano; solo se agrega una librería si el plan lo justifica.
- **Códigos de respuesta de la API:** sin sesión 401; sin permiso por rol 403 ("sin permiso"); datos inválidos 400 con mensaje en español; recurso inexistente, de otro tambo o con identificador mal formado 404; número duplicado 409. El orden de los controles es: sesión, permiso por rol, validación, y recién entonces la búsqueda del recurso (alineado con la spec 001).
- **Garantías en el almacenamiento:** las reglas con "deberá garantizarse también a nivel de almacenamiento" tienen que cumplirse aunque fallen las validaciones previas o haya operaciones simultáneas.

## Requisitos funcionales

### Alta manual
- **RF-1** — Cuando un dueño o encargado da de alta un animal con datos válidos, el sistema deberá guardarlo en su tambo con el estado indicado, asignarlo al lote destino de ese estado y mostrar su ficha.
- **RF-2** — El sistema deberá guardar el número normalizado. Si queda vacío, supera los 20 caracteres o tiene caracteres no permitidos (incluido cualquier espacio interno), entonces deberá rechazarlo con un mensaje en español que diga cuál es el problema.
- **RF-3** — Si ya existe un animal activo del mismo tambo con ese número normalizado, entonces el sistema deberá rechazar el alta con el mensaje "Ya existe un animal activo con ese número".
- **RF-4** — Si dos usuarios dan de alta el mismo número a la vez en el mismo tambo, entonces solo uno deberá guardarse y el otro recibir el mismo mensaje y código que en RF-3. Deberá garantizarse a nivel de almacenamiento.
- **RF-5** — Si el sexo o el estado no son valores permitidos (el estado baja nunca lo es), o si se pide un macho con un estado distinto de recién nacido, entonces el sistema deberá rechazar el alta con un mensaje en español.
- **RF-6** — Donde se indique fecha de nacimiento, el sistema deberá exigir que sea una fecha válida, no futura según la hora de Argentina, no anterior al 01/01/2000 y, si la madre tiene fecha, posterior a la de la madre; si no, deberá rechazarla con un mensaje en español que diga el motivo. La fecha es opcional.
- **RF-7** — Donde se indique una madre, el sistema deberá exigir que exista como animal activo del mismo tambo, que sea hembra y que no sea el propio animal; si no, deberá rechazar el alta con un mensaje en español. Una madre que no existe, que solo existe en otro tambo o que está dada de baja recibe el mismo mensaje ("No hay una hembra activa con el número X"), sin revelar nada de otros tambos. La madre es opcional.
- **RF-8** — Si el estado del animal no tiene lote destino, entonces el sistema deberá dar de alta al animal sin lote e informarlo: la respuesta de la API incluirá un indicador de "sin lote" con el estado que no tiene destino, y la interfaz mostrará un aviso que lo nombre (por ejemplo, "Quedó sin lote porque En ordeñe no tiene lote destino").
- **RF-9** — Si el lote destino ya no existe cuando se guarda el alta (por ejemplo, otro usuario lo eliminó un instante antes), entonces el sistema deberá rechazar el alta con un mensaje en español ("El lote destino ya no existe, volvé a intentar") y no guardar nada. Nunca deberá quedar un animal con un lote inexistente. Esto vale también para la carga desde planilla.
- **RF-10** — Si se intenta eliminar un lote al mismo tiempo que se le asigna un animal y el animal ganó, entonces el sistema deberá impedir la eliminación con el mismo mensaje y código de la spec 001 para "El lote tiene N animales". Deberá garantizarse a nivel de almacenamiento: un lote con animales nunca se elimina. (Resuelve el riesgo registrado en MEMORY.md.)

### Carga desde planilla
- **RF-11** — Cuando un dueño o encargado pega filas copiadas de una planilla, el sistema deberá mostrar una vista previa con las filas correctas y las filas con error, cada una con su número de fila y el motivo, **sin guardar nada**. El número de fila es el de la planilla pegada, contando el encabezado y las filas vacías.
- **RF-12** — El sistema deberá validar cada fila con las reglas de RF-2 a RF-7, y además deberá marcar con error: la fila cuyo número ya aparece en una fila anterior de la planilla (el motivo nombra esa fila), la fila con una cantidad de columnas distinta de 5, y la fila con un campo obligatorio vacío. Un número o una madre que existe solo en otro tambo se trata como inexistente: el número se acepta y la madre da el error de RF-7.
- **RF-13** — El sistema deberá resolver las madres de cada fila así:
  - Si el número de la madre es un animal activo del tambo, la cría se vincula con ese animal (debe ser hembra). Si además ese número aparece como fila de la planilla, esa fila es un duplicado y da error por RF-3.
  - Si no existe en el tambo pero es una fila válida de la planilla, la cría se vincula con esa fila aunque aparezca después. Esa fila debe ser hembra.
  - Si es una fila con error, la cría también tiene error, y el motivo nombra la fila de la madre.
  - Si la madre es la misma fila, la fila tiene error.
  - Si varias filas se refieren entre sí formando un ciclo (A madre de B y B madre de A), todas las filas del ciclo tienen error.
  - Si no existe en el tambo ni en la planilla, la fila tiene error ("No hay una hembra activa con el número X").
  - Si ambas filas tienen fecha de nacimiento, la de la madre debe ser anterior (RF-6).
- **RF-14** — Cuando el texto pegado trae celdas entre comillas dobles, el sistema deberá interpretarlas como texto de una sola celda aunque contengan tabulaciones o saltos de línea (así copia Excel una celda con saltos), con "" como comilla dentro de la celda. Si hay comillas sin cerrar, entonces deberá rechazar todo el texto con un mensaje que indique en qué fila empezaron. Las filas vacías (todas sus celdas vacías o con solo espacios) se ignoran sin marcar error.
- **RF-15** — Si la primera fila no vacía es un encabezado, entonces el sistema deberá ignorarla. Es encabezado solo si **las cinco** celdas coinciden, sin distinguir mayúsculas ni tildes, con alguno de estos nombres, columna por columna: (1) número, caravana; (2) sexo; (3) fecha de nacimiento, fecha nacimiento, nacimiento; (4) estado; (5) madre, número de la madre, número madre. Una fila que solo coincide en parte, o que está más abajo, se trata como datos. El encabezado no cuenta para el límite de filas.
- **RF-16** — El sistema deberá interpretar los valores de la planilla así, sin distinguir mayúsculas ni tildes: sexo "hembra", "macho", "H" o "M"; estado "recién nacido", "vaquillona", "en ordeñe" o "seca"; fecha en formato día/mes/año con año de cuatro dígitos (el día y el mes pueden tener uno o dos dígitos) o AAAA-MM-DD. Cualquier otro valor o formato de fecha deberá dar error de fila con un mensaje que explique qué se esperaba.
- **RF-17** — Si el texto pegado está vacío, tiene más de 500 filas con datos (no cuentan las vacías ni el encabezado) o supera los 100.000 caracteres, entonces el sistema deberá rechazarlo con un mensaje en español, sin procesar nada; el mensaje nunca es un error genérico del servidor. Si ninguna fila no vacía contiene tabulaciones, entonces deberá mostrar el mensaje "Las columnas tienen que estar separadas por tabulación: copiá las celdas desde Excel o Google Sheets".
- **RF-18** — Cuando el usuario confirma la carga, el cliente deberá enviar el texto pegado tal cual y el sistema deberá **revalidarlo completo en ese momento** (con el estado actual de la base, no el de la vista previa) y guardar **siempre las filas que resulten correctas en ese instante**, todas juntas en una sola transacción, asignando a cada animal el lote destino de su estado. Las filas con error no se guardan.
- **RF-19** — Al terminar la confirmación, el sistema deberá informar cuántos animales se guardaron, cuáles filas quedaron afuera (con su motivo, incluidas las que eran correctas en la vista previa y dejaron de serlo) y cuántos animales quedaron **sin lote, por estado**. La vista previa muestra también ese total de animales sin lote por estado.
- **RF-20** — La vista previa no deberá guardar nada en el servidor (ni animales ni borradores): lo pegado vive solo en la pantalla hasta confirmar.
- **RF-21** — Si por una operación simultánea un número de la carga es ocupado por otro usuario mientras se guarda, entonces el sistema deberá volver a revalidar el texto completo y reintentar, y si el conflicto persiste después de tres intentos deberá responder con un mensaje en español y código 409, sin guardar nada. Nunca queda una carga a medias.
- **RF-22** — El sistema deberá permitir corregir el texto pegado y volver a ver la vista previa sin perder lo pegado. Si no hay ninguna fila correcta, el botón de confirmar no estará disponible.

### Listado
- **RF-23** — El sistema deberá mostrar solo los animales activos del tambo del usuario con su número, sexo, estado y lote (o "sin lote"), ordenados por número en **orden natural**: los tramos numéricos se comparan como números ("9" antes que "10", "A2" antes que "A10") y, si empatan, alfabéticamente.
- **RF-24** — El sistema deberá permitir filtrar por estado y por lote (incluida la opción "sin lote"); si se combinan, deberán cumplirse ambos (AND). Deberá mostrar la cantidad total de animales que cumplen el filtro.
- **RF-25** — Si el filtro por lote pide un lote que no existe, es de otro tambo o tiene un identificador mal formado, entonces el sistema deberá responder "no encontrado", igual en los tres casos. Si el filtro de estado no es un valor permitido, deberá responder 400 con un mensaje en español.
- **RF-26** — Si hay más de 2.000 animales que cumplen el filtro, entonces el sistema deberá mostrar los primeros 2.000 en el orden de RF-23 y un aviso con el total ("Mostrando 2000 de N animales: usá los filtros para acotar"). Sin paginación.
- **RF-27** — Mientras no haya animales (o ninguno cumpla el filtro), el sistema deberá mostrar un mensaje que lo diga y, a quien puede cargar, un acceso al alta y a la carga desde planilla.

### Ficha
- **RF-28** — Cuando el usuario abre un animal activo de su tambo, el sistema deberá mostrar su ficha con número, sexo, estado, nombre del lote (solo el nombre, sin enlace) o "sin lote", fecha de nacimiento, madre (con acceso a su ficha) y crías **activas** (con acceso a sus fichas). Los datos que no se cargaron se muestran como "sin dato".
- **RF-29** — Mientras no existan eventos, el sistema deberá mostrar en la ficha una sección de historial que diga "Todavía no hay eventos registrados".
- **RF-30** — Si se pide la ficha de un animal dado de baja del propio tambo, entonces el sistema deberá responder "no encontrado" (por ahora solo existen activos).

### Buscador
- **RF-31** — El sistema deberá mostrar el buscador por número en la barra de la estructura general de la app, en todas las pantallas con sesión. En celular (375 px) puede ocupar su propia fila, pero no se esconde detrás de un menú.
- **RF-32** — Cuando el usuario entra al Inicio o al listado de animales, el sistema deberá dejar el foco en el buscador. No deberá tomar el foco en pantallas con formularios (alta, carga desde planilla, inicio de sesión).
- **RF-33** — Cuando el usuario envía un número (con Enter, tipeado o leído por el bastón, que "tipea" el número y Enter) y existe un animal activo con ese número en su tambo, el sistema deberá abrir la ficha de ese animal. Mientras el usuario no haya enviado nada, no deberá buscar mientras tipea.
- **RF-34** — El sistema deberá normalizar el número buscado igual que al guardar (RF-2, incluidas las mayúsculas y la limpieza de extremos) y buscar por coincidencia exacta del número completo, no por una parte. Un número con caracteres no permitidos recibe el mismo resultado que uno inexistente.
- **RF-35** — Si no existe un animal activo con ese número en el tambo (inexistente, de otro tambo, dado de baja o con caracteres no permitidos), entonces la API de búsqueda deberá responder "no encontrado" y la interfaz deberá mostrar "No hay un animal activo con el número X" y, a quien puede cargar y siempre que el número sea válido, un acceso para darlo de alta con ese número ya completado. La respuesta es idéntica en todos esos casos.
- **RF-36** — Si el número enviado está vacío (o queda vacío al normalizarlo), entonces el sistema no deberá buscar y deberá dejar el foco en el buscador.

### Aislamiento y permisos
- **RF-37** — El sistema deberá mostrar, buscar y asignar solo animales y lotes del tambo del usuario, nunca de otro, y nunca aceptar un identificador de tambo enviado por el cliente.
- **RF-38** — Si un usuario pide la ficha de un animal que no existe, es de otro tambo o tiene un identificador mal formado, entonces el sistema deberá responder siempre "no encontrado".
- **RF-39** — Donde el usuario sea veterinario, el sistema deberá mostrar listado, fichas y buscador, sin opciones de alta ni de carga desde planilla.
- **RF-40** — Si un veterinario intenta dar de alta animales, ver la vista previa o confirmar una carga por cualquier vía, entonces el sistema deberá responder siempre "sin permiso", también con datos inválidos. Sin sesión, la respuesta es 401, antes que cualquier otro control.

### Interfaz
- **RF-41** — El sistema deberá agregar la sección Animales al menú y mostrar listado, alta, carga desde planilla, ficha y buscador con controles de al menos 48 px de alto y sin desbordes horizontales en 768 px y 375 px, en modo claro y oscuro. Las tablas anchas pueden desplazarse dentro de su propio contenedor.

## Permisos por rol
| Acción | Dueño | Encargado | Veterinario |
|---|---|---|---|
| Ver listado y fichas | Sí | Sí | Sí |
| Buscar por número | Sí | Sí | Sí |
| Alta manual | Sí | Sí | No ("sin permiso") |
| Carga desde planilla (vista previa y confirmar) | Sí | Sí | No ("sin permiso") |

## Casos límite
- Número con espacios, tabulaciones, saltos de línea o NBSP en los extremos: se limpian. Con espacios internos ("12 3"), con tildes o ñ, o con guion bajo: se rechaza.
- Número en minúsculas ("ab-1"): se guarda "AB-1"; y "ab-1" y "AB-1" son el mismo número (se rechaza el segundo).
- "7" y "007": números distintos. Exactamente 20 caracteres: se acepta; 21: se rechaza.
- Número repetido de un animal activo: se rechaza (409). Dos usuarios dan de alta el mismo número a la vez: solo uno se guarda.
- Dos tambos pueden tener animales con el mismo número. Reutilizar el número de un animal dado de baja: se permite.
- Fecha de nacimiento de hoy (hora de Argentina): se acepta; de mañana: se rechaza. 31/12/1999: se rechaza; 01/01/2000: se acepta. "31/02/2024": se rechaza por inválida.
- Cría con fecha igual o anterior a la de su madre: se rechaza. Madre sin fecha: no se compara.
- Madre inexistente, de otro tambo, de baja, macho o el propio animal: se rechaza con el mismo mensaje.
- Estado sin lote destino: el animal se guarda sin lote y con aviso (RF-8).
- Lote destino eliminado justo antes del alta: el alta falla con mensaje (RF-9). Lote con animales asignados en paralelo a su eliminación: no se elimina (RF-10).
- Planilla con encabezado coincidente: se ignora. Con solo parte de las columnas con nombre de encabezado: se trata como datos. Encabezado repetido más abajo: error de fila.
- Planilla con filas vacías intercaladas: se ignoran, no cuentan para el límite y la numeración de filas las cuenta.
- Planilla con celdas entre comillas, con tabulaciones o saltos de línea dentro: una sola celda. Comillas sin cerrar: se rechaza todo con la fila donde empezaron.
- Planilla con filas de menos o más de 5 columnas, o con campos obligatorios vacíos: error de fila.
- Planilla pegada sin ninguna tabulación (por ejemplo, copiada de un PDF): mensaje específico de RF-17.
- Planilla con el mismo número dos veces (aunque cambie en mayúsculas): la segunda fila es error.
- Planilla con la madre en una fila posterior: se acepta si esa fila es válida. Si esa fila tiene error, la cría también. Madre en la misma fila: error. Dos filas que son madre una de la otra: ambas con error (ciclo).
- Planilla con una madre que ya existe en el tambo y además es una fila de la planilla: esa fila es duplicado (error); la cría se vincula con el animal existente.
- Planilla con un número o madre que existe solo en otro tambo: el número se acepta; la madre da error de inexistente.
- Planilla con fechas "5/3/2021", "05/03/2021" o "2021-03-05": se aceptan. "5/3/21" o "marzo 2021": error de fila.
- Planilla con 500 filas con datos: se procesa. Con 501, o con más de 100.000 caracteres: se rechaza completa con mensaje.
- Planilla con todas las filas con error: se muestra la vista previa y confirmar no está disponible.
- Confirmar una carga con filas correctas e incorrectas: se guardan solo las correctas y se informa qué quedó afuera.
- Entre la vista previa y la confirmación otro usuario ocupa un número: al confirmar esa fila queda afuera con su motivo y se guardan las demás.
- Planilla en la que varios estados no tienen lote destino: los animales se guardan sin lote y se informa el total por estado.
- Veterinario que pega una planilla o da de alta: "sin permiso", también con datos inválidos. Sin sesión: 401.
- Buscar un número de otro tambo, de un animal dado de baja o con caracteres no permitidos: igual que uno inexistente (404 y "No hay un animal activo con el número X").
- Buscar " ab-1\n" (el bastón puede agregar saltos o espacios): se normaliza y encuentra "AB-1".
- Buscar "12" cuando existe "123": no abre nada. Buscador vacío: no hace nada.
- Listado con filtro de lote ajeno, inexistente o mal formado: "no encontrado" igual en los tres. Con estado inválido: 400.
- Listado con más de 2.000 resultados: se muestran 2.000 y el aviso con el total.
- Listado con números "9", "10", "A2", "A10": orden "9", "10", "A2", "A10".
- Ficha de un animal sin madre, sin crías y sin lote: muestra "sin dato" y "sin lote". Ficha de uno dado de baja del propio tambo: "no encontrado".
- La sesión vence con la pantalla abierta: la próxima acción lleva al login (comportamiento ya existente).

## Criterios de aceptación
- [ ] Un dueño y un encargado pueden dar de alta un animal y queda en el lote destino de su estado; si el estado no tiene destino queda sin lote y el indicador de la API y el aviso de la pantalla lo nombran.
- [ ] El número se guarda normalizado en mayúsculas; los vacíos, de más de 20 caracteres, con caracteres no permitidos o repetidos entre activos del tambo se rechazan con un mensaje en español (409 para repetidos). La unicidad sobre el valor normalizado está garantizada a nivel de almacenamiento.
- [ ] Sexo, estado, combinación sexo-estado, fecha de nacimiento (rango, hora de Argentina, madre anterior a la cría) y madre se validan como indican RF-5 a RF-7.
- [ ] Un animal nunca queda con lote o madre de otro tambo (a nivel de almacenamiento), y un lote con animales nunca se elimina. Un test de concurrencia comprueba que un alta y una eliminación simultáneas del mismo lote terminan con el lote eliminado y el alta rechazada, o el lote intacto y el animal guardado, nunca un animal con lote inexistente.
- [ ] Pegar una planilla muestra una vista previa con filas correctas y con error (número de fila y motivo) y los animales sin lote por estado, sin guardar nada ni crear borradores.
- [ ] El parseo cubre separador por tabulación, comillas y saltos de línea internos, filas vacías, encabezado exacto (y no el parcial), fechas con los formatos de RF-16, columnas de más o de menos, límite de 500 filas, límite de 100.000 caracteres y el mensaje de "sin tabulaciones".
- [ ] Las madres se resuelven como indica RF-13: en el tambo, en la misma planilla (incluso posterior), propia fila, ciclo, madre en fila con error, duplicado y madre solo de otro tambo.
- [ ] Al confirmar, el servidor revalida el texto crudo, guarda en una sola transacción las filas correctas en ese momento e informa las que quedaron afuera con su motivo. Un conflicto simultáneo se reintenta y, si persiste, no guarda nada (409).
- [ ] El listado muestra solo animales activos del tambo en orden natural, con filtros por estado y lote combinados con AND, cantidad total, aviso a partir de 2.000 y mensaje cuando no hay resultados; el filtro por lote ajeno, inexistente o mal formado da "no encontrado".
- [ ] La ficha muestra los datos básicos, el nombre del lote, madre y crías activas con acceso a sus fichas y el historial vacío; la de un animal de baja responde "no encontrado".
- [ ] El buscador está en la barra de todas las pantallas con sesión; abre la ficha con Enter, normaliza y busca coincidencia exacta; muestra el mensaje de "no hay" con acceso al alta cuando no existe (mismo resultado para inexistente, otro tambo y baja). El foco inicial está en el Inicio y el listado y no en los formularios.
- [ ] Cada acción (listar, filtrar por lote ajeno, ver ficha, buscar, alta, vista previa y confirmar de la planilla) tiene un test de aislamiento entre dos tambos. En la planilla, un número que existe solo en otro tambo se acepta y una madre que existe solo en otro tambo da error de inexistente.
- [ ] Un veterinario ve listado, fichas y buscador y recibe "sin permiso" en alta, vista previa y confirmación, también con datos inválidos; sin sesión recibe 401.
- [ ] Los controles de la sección Animales y del buscador tienen al menos 48 px de alto y no se desbordan horizontalmente en 768 px y 375 px, en modo claro y oscuro, y el foco automático se comporta como RF-32. Esto se verifica en el navegador; el bastón se simula con teclado (tipear el número y Enter).

## Decisiones
Tomadas el 2026-11-10 por el responsable del proyecto.

1. **Columnas de la planilla:** número, sexo, fecha de nacimiento, estado y número de la madre, en ese orden; número, sexo y estado son obligatorios y los demás opcionales.
2. **Madre:** si no existe, es macho o está dada de baja, se rechaza la fila o el alta; se aceptan madres que están en la misma planilla.
3. **Edición y movimiento manual de lote:** no entran en esta spec; la ficha es solo lectura y eso va en una spec aparte.
4. **Ficha sin eventos:** datos básicos, madre, crías y el texto "Todavía no hay eventos registrados".
5. **Número que el bastón lee y no existe:** mensaje con botón para darlo de alta con el número ya completado.
6. **Límite por pegado:** 500 filas.
7. **Roles que cargan:** dueño y encargado; el veterinario solo consulta.
8. **Machos:** solo con estado "recién nacido"; las hembras pueden tener cualquier estado inicial.
9. **Guardado parcial:** al confirmar se guardan solo las filas correctas, informando cuántas quedaron afuera.
10. **Estado sin destino:** el animal se guarda sin lote y con aviso.
11. **Listado:** orden por número, filtros por estado y lote, cantidad de resultados y sin paginación (con el tope de RF-26).
12. **Confirmar la planilla:** el cliente manda el texto pegado crudo; el servidor revalida todo al confirmar y siempre guarda las filas correctas en ese momento, todas juntas en una transacción, informando cuáles quedaron afuera y por qué. Es la única regla de confirmación (no hay "no guardar nada" por cambios entre la vista previa y la confirmación).
13. **Fecha de nacimiento:** no futura (hoy según America/Argentina/Buenos_Aires), no anterior al 01/01/2000 y, si madre y cría tienen fecha, la madre nació antes.
14. **Número:** sin distinguir mayúsculas (se guarda y se busca en mayúsculas); solo letras sin tildes, dígitos, guion y punto; máximo 20 caracteres; único entre activos sobre el valor normalizado, también en la base.
15. **Concurrencia lote-animal:** el alta con un lote que ya no existe falla con mensaje, y un lote con animales no se puede eliminar (garantizado en la base); resuelve el riesgo anotado en MEMORY.md.
16. **Listado:** orden natural de números y tope de 2.000 resultados con aviso; sin paginación.
