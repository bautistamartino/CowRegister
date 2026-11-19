# 015 — Acciones del administrador: baja y reactivación de tambos, contraseñas y último ingreso

Estado: borrador
Fecha: 2026-11-19

## Contexto
**Depende de la spec 014** (rol de administrador, ingreso, listado de tambos como cuentas, crear tambos y la excepción acotada a la constitución). Esta spec le suma al administrador lo que necesita para sostener la plataforma: cortar el acceso a un tambo que dejó de usar el sistema (y volver a abrirlo), ayudar a un dueño que no puede ingresar y saber cuándo ingresó cada uno por última vez.

La baja de un tambo es una **baja lógica** (principio 3 de la constitución): nada se borra, nadie del tambo puede ingresar ni operar, y se puede reactivar.

## Alcance
- Incluye: estado del tambo (activo o dado de baja) y su registro; dar de baja y reactivar; corte de sesiones; ingreso rechazado con mensaje propio; tablet con el tambo de baja; último ingreso por usuario y por tambo; restablecer la contraseña de un usuario; auditoría de estas acciones.
- No incluye: cerrar sesiones por separado ni activar o desactivar usuarios desde el administrador (el dueño ya lo hace); que un usuario cambie su propia contraseña u obligar a cambiarla al primer ingreso (otra spec); borrar un tambo; ver datos internos del tambo (constitución, spec 014); paginación.

## Requisitos funcionales

### Estado del tambo
- **RF-1** — El sistema deberá tener para cada tambo un estado, activo o dado de baja; todos los tambos existentes y los que cree la 014 deberán quedar activos.
- **RF-2** — El sistema deberá mostrar el estado en el listado y en el detalle de tambos de la 014, y permitir filtrar el listado por estado (todos, activos, dados de baja); un tambo dado de baja deberá mostrar quién lo dio de baja, cuándo y con qué motivo.

### Dar de baja
- **RF-3** — Cuando el administrador da de baja un tambo activo indicando un motivo de 1 a 200 caracteres, el sistema deberá marcarlo como dado de baja y registrar quién, cuándo y por qué, sin borrar ningún dato.
- **RF-4** — Si el motivo está vacío o tiene más de 200 caracteres, entonces el sistema deberá rechazar la baja y pedir el motivo.
- **RF-5** — Cuando el administrador va a dar de baja un tambo, la interfaz deberá pedir una confirmación explícita que nombre el tambo y avise que sus usuarios van a perder el acceso (la confirmación es solo de interfaz: la API no la exige).
- **RF-6** — Cuando se da de baja un tambo, el sistema deberá cerrar de inmediato todas las sesiones de todos sus usuarios, en todos los dispositivos, en la misma operación que cambia el estado.
- **RF-7** — Mientras un tambo está dado de baja, el sistema deberá responder a todo pedido a las rutas del tambo de uno de sus usuarios —incluidos el perfil de la sesión, la copia local y los envíos de pendientes de la tablet— con el rechazo genérico "tenés que iniciar sesión", aunque la sesión haya quedado abierta o se haya creado después de la baja.
- **RF-8** — El estado del tambo deberá comprobarse en cada pedido con sesión y en cada ingreso, además de cerrar las sesiones, de modo que una sesión creada después de la baja nunca sirva.
- **RF-9** — Si un usuario de un tambo dado de baja ingresa con email y contraseña correctos, entonces el sistema no deberá crear sesión y deberá responder un rechazo propio, distinguible por un código (`TAMBO_DE_BAJA`), con el mensaje "Tu tambo está dado de baja. Consultá con el administrador de la plataforma." (sin datos de contacto); con email o contraseña incorrectos, el mensaje genérico de siempre.
- **RF-10** — Mientras un tambo está dado de baja, el sistema deberá conservar todo (usuarios, animales, eventos, litros, lotes e historial) y los emails de sus usuarios seguirán reservados.
- **RF-11** — Si el administrador intenta dar de baja un tambo ya dado de baja, o reactivar uno activo, entonces el sistema deberá rechazarlo con un mensaje claro sin cambiar nada; dos pedidos simultáneos sobre el mismo tambo deberán resolverse en la base (uno se aplica y el otro recibe el rechazo), nunca con un error del servidor.

### Reactivar
- **RF-12** — Cuando el administrador reactiva un tambo dado de baja, el sistema deberá marcarlo como activo y registrar quién y cuándo (la reactivación no pide motivo), y los usuarios que estaban activos deberán poder ingresar de nuevo, sin perder ningún dato.
- **RF-13** — La reactivación no deberá cambiar el estado individual de los usuarios (uno desactivado por el dueño sigue desactivado).
- **RF-14** — El sistema deberá conservar el registro de cada baja (con su motivo) y de cada reactivación, que solo se agrega y nunca se borra ni se edita.

### Tablet con el tambo dado de baja
- **RF-15** — Cuando una tablet con la copia local de un tambo dado de baja recupera la conexión, el sistema deberá tratar la respuesta como una sesión vencida: la web llevará al ingreso y la clasificación de respuestas de la tablet deberá devolver "sesión" y nunca "rechazado".
- **RF-16** — Mientras el tambo esté dado de baja, el sistema no deberá aceptar ningún registro pendiente de la tablet y la web no deberá borrar la copia local ni los pendientes.
- **RF-17** — Cuando el tambo se reactiva y el mismo usuario vuelve a ingresar en la misma tablet, el sistema deberá retomar el envío de sus pendientes con el comportamiento ya existente del modo sin conexión.
- **RF-18** — Si un usuario ingresa en el mismo instante en que se da de baja su tambo, entonces el sistema deberá garantizar que no quede ninguna sesión válida de ese tambo.

### Último ingreso
- **RF-19** — Cuando un usuario de un tambo inicia sesión con email y contraseña, el sistema deberá registrar la fecha y hora; no deberá registrarla al reabrir la aplicación con una sesión viva ni al crear la cuenta (el alta del dueño no cuenta como ingreso).
- **RF-20** — El sistema deberá mostrar al administrador, en el detalle del tambo, el último ingreso de cada usuario (o "nunca ingresó" si no tiene ninguno) y, en el listado y el detalle, el último ingreso del tambo, que es el más reciente de todos sus usuarios (activos o no).
- **RF-21** — El sistema deberá mostrar esas fechas con fecha y hora de Argentina, en formato día/mes/año y hora de 24 horas.

### Restablecer la contraseña
- **RF-22** — Cuando el administrador restablece la contraseña de un usuario de un tambo activo indicando la contraseña nueva, el sistema deberá reemplazarla y cerrar todas las sesiones de ese usuario; la ruta identifica al tambo y al usuario.
- **RF-23** — La contraseña nueva deberá cumplir las mismas reglas que la contraseña de cualquier alta de usuario (las del esquema de validación existente), y el administrador se la pasará al usuario por fuera de la aplicación.
- **RF-24** — Si el usuario no existe, tiene un id mal formado o pertenece a otro tambo distinto del indicado, entonces el sistema deberá responder que no se encontró, sin cambiar nada; si el tambo está dado de baja, deberá rechazarlo con un mensaje claro.
- **RF-25** — Si el usuario está desactivado, entonces el sistema deberá permitir restablecer su contraseña pero no deberá reactivarlo.
- **RF-26** — El sistema no deberá permitir restablecer la contraseña de un administrador, incluido el propio (esa vía no existe).
- **RF-27** — La contraseña nueva nunca deberá aparecer en la auditoría, en los registros del servidor ni en ninguna respuesta.

### Auditoría y seguridad
- **RF-28** — Cuando el administrador da de baja, reactiva o restablece una contraseña, el sistema deberá dejar en la auditoría quién lo hizo, cuándo, sobre qué tambo y (si corresponde) sobre qué usuario; la auditoría solo se agrega.
- **RF-29** — El sistema deberá limitar la cantidad de acciones sensibles del administrador (baja, reactivación y restablecer contraseñas) por período, con un límite razonable.
- **RF-30** — Todas las rutas nuevas del administrador deberán quedar bajo el único control de acceso de la 014, y las respuestas solo deberán contener las claves de la lista blanca (que ahora suma estado, motivo y último ingreso).

## Permisos por rol
| Acción | Administrador | Dueño | Encargado | Veterinario |
|---|---|---|---|---|
| Dar de baja o reactivar un tambo | Sí | No | No | No |
| Restablecer la contraseña de un usuario de un tambo | Sí | No | No | No |
| Ver estado y último ingreso de tambos y usuarios | Sí | No | No | No |
| Ingresar y operar en su tambo | No | Si está activo | Si está activo | Si está activo |

## Límites aceptados
- Al restablecer una contraseña, el administrador la conoce y podría entrar como ese usuario hasta que la cambie (cuando exista esa función, otra spec); la acción queda en la auditoría.
- Tras una baja, la tablet sin conexión sigue mostrando sus datos locales hasta volver la señal (riesgo ya aceptado en la spec 009).
- Sin paginación en el listado.
- Ayuda mínima: solo estado, usuarios, último ingreso y restablecer contraseña.

## Casos límite
- Baja mientras un usuario está cargando un evento: su siguiente pedido recibe "tenés que iniciar sesión"; lo guardado antes queda guardado.
- Un tambo con varios usuarios: la baja los alcanza a todos, activos o no.
- Ingreso simultáneo con la baja (RF-18): no queda sesión válida; el ingreso o se rechaza o su sesión no sirve.
- Pendientes en una tablet de un tambo que nunca se reactiva: quedan hasta que se cierre sesión o ingrese otro usuario (con la confirmación ya existente).
- Un tambo recién creado y sin ingresos: último ingreso "nunca ingresó".
- Crear un tambo (014) con el email de un usuario de un tambo dado de baja: 409.
- Restablecer la contraseña de un usuario con un id de otro tambo: no encontrado, sin cambios y sin revelar que existe.
- Un dueño con contraseña incorrecta en un tambo de baja: mensaje genérico; el mensaje específico exige credenciales correctas.

## Criterios de aceptación
- [ ] RF-1/2: tambos existentes y nuevos quedan activos; el listado y el detalle muestran el estado y se filtran.
- [ ] RF-3/4/5/14: la baja pide motivo de 1 a 200 caracteres, registra quién, cuándo y por qué y no borra nada; la confirmación existe en la interfaz.
- [ ] RF-6/7/8: tras la baja no queda ninguna sesión; una sesión creada después de la baja no sirve; el perfil, la copia local y los envíos de pendientes responden "tenés que iniciar sesión".
- [ ] RF-9: con credenciales correctas el ingreso da el código `TAMBO_DE_BAJA` y el mensaje, sin sesión; con incorrectas, el genérico.
- [ ] RF-10/13: nada se borró y los emails siguen reservados; la reactivación no cambia a los usuarios.
- [ ] RF-11: dar de baja uno dado de baja (y reactivar uno activo) se rechaza; un test con dos bajas simultáneas deja una aplicada y una rechazada, sin 500.
- [ ] RF-12: la reactivación no pide motivo, registra quién y cuándo, y los usuarios activos pueden ingresar.
- [ ] RF-15/16/17: test de la web: con la respuesta de tambo de baja, `clasificar` devuelve `sesion` y nunca `rechazado`; la copia y los pendientes siguen en la tablet; al reactivar y reingresar el mismo usuario se retoma el envío.
- [ ] RF-18: un test de ingreso concurrente con la baja no deja ninguna sesión válida.
- [ ] RF-19/20/21: el ingreso registra la hora; `/auth/yo` y el alta del dueño no; el listado muestra el máximo de los usuarios; "nunca ingresó" para quien no ingresó; hora de Argentina y formato correctos.
- [ ] RF-22/23/27: restablecer cambia la contraseña, cierra las sesiones de ese usuario, valida con las reglas existentes y la contraseña no aparece en auditoría, logs ni respuestas (se revisa).
- [ ] RF-24/25/26: usuario de otro tambo o id mal formado, 404 sin cambios; tambo de baja, rechazo; usuario desactivado se restablece y sigue desactivado; un administrador no se puede restablecer.
- [ ] RF-28/29/30: baja, reactivación y restablecimiento quedan en la auditoría; el límite responde con el mensaje de demasiados intentos; el test que recorre todas las rutas del administrador sigue pasando con las nuevas; las claves de las respuestas coinciden con la lista blanca.
- [ ] Test de aislamiento: ningún rol de tambo accede a las rutas nuevas y el administrador sigue sin acceder a datos del tambo.

## Preguntas abiertas
- (ninguna)
