# 015 — Acciones del administrador: baja y reactivación de tambos, reactivar usuarios, contraseñas y último ingreso

Estado: aprobada
Fecha: 2026-11-19

## Contexto
**Depende de la spec 014** (rol de administrador, ingreso, listado de tambos como cuentas, crear tambos y la excepción acotada a la constitución). Esta spec le suma al administrador lo que necesita para sostener la plataforma: cortar el acceso a un tambo que dejó de usar el sistema (y volver a abrirlo), ayudar a un dueño o a un usuario que no puede ingresar (restablecerle la contraseña o reactivarlo) y saber cuándo ingresó cada uno por última vez.

La baja de un tambo es una **baja lógica** (principio 3 de la constitución): nada se borra, nadie del tambo puede ingresar ni operar, y se puede reactivar.

## Cambio a la constitución (requiere aprobación explícita del responsable)
La excepción acotada de la 014 (principio 1, punto 2) solo habilita "estado, último ingreso y motivo de baja". Esta spec necesita mostrar además **quién y cuándo dio de baja y reactivó** el tambo, y el **último ingreso de cada usuario** (el estado activo o no del usuario ya está en la lista blanca). Al aprobar esta spec, el responsable aprueba también ampliar la lista blanca con: estado del tambo, motivo, quién y cuándo de la última baja, quién y cuándo de la última reactivación, y último ingreso (por usuario y del tambo). La enmienda a `docs/constitution.md` es parte de la última tarea del plan. No se pide ningún otro cambio a la constitución.

## Alcance
- Incluye: estado del tambo (activo o dado de baja) y su registro; dar de baja y reactivar un tambo; corte de sesiones; ingreso rechazado con mensaje propio; tablet con el tambo de baja; último ingreso por usuario y por tambo; restablecer la contraseña de un usuario; **reactivar a un usuario desactivado** de un tambo activo; auditoría de estas acciones; límite de acciones sensibles.
- No incluye: **desactivar** usuarios desde el administrador (lo hace el dueño; el administrador solo reactiva); cerrar sesiones por separado; que un usuario cambie su propia contraseña u obligar a cambiarla al primer ingreso (otra spec); borrar un tambo; ver datos internos del tambo (constitución, spec 014); paginación; mostrar al administrador el historial de bajas anteriores (se guarda, pero solo se muestra la vigente).

## Requisitos funcionales

### Estado del tambo
- **RF-1** — El sistema deberá tener para cada tambo un estado, activo o dado de baja; todos los tambos existentes (migrados) y los que cree la 014 deberán nacer activos, sin registro de baja.
- **RF-2** — El tambo deberá guardar solo su estado; la fuente de verdad de quién, cuándo y por qué es el registro de bajas y reactivaciones. El listado y el detalle de la 014 deberán mostrar el estado y: si está dado de baja, quién lo dio de baja, cuándo y con qué motivo (la baja vigente); si fue reactivado, el estado activo con quién y cuándo reactivó (sin motivo). Tras una segunda baja se muestra la segunda (la vigente), no la anterior.
- **RF-3** — El sistema deberá permitir filtrar el listado por estado (todos, activos, dados de baja) con el filtro resuelto en el servidor; un valor de filtro inválido deberá responder 400.

### Dar de baja un tambo
- **RF-4** — Cuando el administrador da de baja un tambo activo indicando un motivo, el sistema deberá marcarlo como dado de baja y registrar quién, cuándo y por qué, sin borrar ningún dato. El id del tambo sale solo de la ruta.
- **RF-5** — El motivo se recorta (espacios al principio y al final) y deberá tener de 1 a 200 caracteres contados por caracteres (no por bytes) después del recorte; si está vacío o es más largo, entonces el sistema deberá rechazar la baja y pedir el motivo. El motivo es texto libre: la web lo muestra siempre escapado, nunca como HTML.
- **RF-6** — Cuando el administrador va a dar de baja un tambo, la interfaz deberá pedir una confirmación explícita que nombre el tambo y avise que sus usuarios van a perder el acceso (solo de interfaz: la API no la exige).
- **RF-7** — Cuando se da de baja un tambo, el sistema deberá cerrar de inmediato todas las sesiones de todos sus usuarios, en todos los dispositivos, en la misma operación atómica que cambia el estado y registra la baja.
- **RF-8** — Mientras un tambo está dado de baja, el sistema deberá rechazar con 401 y el mensaje genérico "tenés que iniciar sesión" todo pedido con sesión de un usuario de ese tambo a cualquier ruta del tambo (incluidos el perfil de la sesión `/auth/yo`, la copia local y los envíos de pendientes de la tablet), aunque la sesión haya quedado abierta o se haya creado después de la baja. Quedan exentos: el ingreso (RF-10), el cierre de sesión (`/auth/logout`), la sonda de salud (`/api/salud`), el registro de tambos nuevos y las rutas del administrador; `/auth/yo` sin cookie sigue respondiendo lo de siempre.
- **RF-9** — El estado del tambo deberá comprobarse en cada pedido con sesión y en cada ingreso, además de cerrar las sesiones, de modo que una sesión creada después de la baja nunca sirva.
- **RF-10** — Si un usuario **activo** de un tambo dado de baja ingresa con email y contraseña correctos, entonces el sistema no deberá crear sesión y deberá responder **403** con el código estable `TAMBO_DE_BAJA` y el mensaje "Tu tambo está dado de baja. Consultá con el administrador de la plataforma." (sin datos de contacto). Con email o contraseña incorrectos, o con un usuario desactivado, el mensaje genérico de siempre (el mensaje específico exige credenciales correctas y usuario activo). La pantalla de ingreso deberá mostrar ese mensaje.
- **RF-11** — Mientras un tambo está dado de baja, el sistema deberá conservar todo (usuarios, animales, eventos, litros, lotes e historial) y los emails de sus usuarios seguirán reservados.
- **RF-12** — Si el administrador intenta dar de baja un tambo ya dado de baja, o reactivar uno activo, entonces el sistema deberá rechazarlo (409) con un mensaje claro sin cambiar nada. El cambio de estado deberá ser **una única operación atómica condicionada al estado actual**, de modo que ante pedidos simultáneos uno se aplique y los otros reciban el rechazo, nunca un error del servidor ni un doble registro. Esto cubre: dos bajas simultáneas, una baja contra una reactivación, una baja contra un restablecimiento de contraseña o una reactivación de usuario (el estado del tambo se comprueba dentro de la misma transacción de esas acciones) y una baja contra un alta de usuario hecha por el dueño (no deberá quedar un usuario activo con sesión en un tambo de baja).
- **RF-13** — Si el tambo que se pide no existe o tiene un id mal formado, entonces el sistema deberá responder que no se encontró, nunca un error del servidor.

### Reactivar un tambo
- **RF-14** — Cuando el administrador reactiva un tambo dado de baja, el sistema deberá marcarlo como activo y registrar quién y cuándo (no pide motivo); los usuarios que estaban activos podrán ingresar de nuevo con su contraseña de siempre, sin perder ningún dato. Las sesiones cerradas por la baja no se restauran.
- **RF-15** — La reactivación del tambo no deberá cambiar el estado individual de los usuarios (uno desactivado por el dueño sigue desactivado) ni sus contraseñas.
- **RF-16** — El sistema deberá conservar el registro de cada baja (con su motivo) y de cada reactivación; **la base de datos deberá rechazar** modificar o borrar esos registros (solo se agregan).

### Tablet con el tambo dado de baja
- **RF-17** — Cuando una tablet con la copia local de un tambo dado de baja recupera la conexión, sus pedidos con sesión reciben 401 (RF-8): la web deberá tratarlos como sesión vencida y llevar al ingreso; la clasificación de respuestas de los pendientes deberá devolver "sesión" y nunca "rechazado". (El 403 `TAMBO_DE_BAJA` es solo del ingreso, que no pasa por esa clasificación.)
- **RF-18** — Mientras el tambo esté dado de baja, el sistema no deberá aceptar ningún registro pendiente de la tablet y la web no deberá borrar la copia local ni los pendientes, ni cuando recibe el 401 ni cuando un ingreso es rechazado con `TAMBO_DE_BAJA`.
- **RF-19** — Cuando el tambo se reactiva y el mismo usuario vuelve a ingresar en la misma tablet, el sistema deberá retomar el envío de sus pendientes con el comportamiento ya existente del modo sin conexión.
- **RF-20** — El invariante de la baja es: **ningún pedido de un usuario del tambo dado de baja tiene éxito después de la baja**, ni siquiera con un ingreso que ocurre en el mismo instante. Para eso, el ingreso deberá leer el estado del tambo con bloqueo en la misma transacción que crea la sesión (de modo que o ve la baja y se rechaza, o su sesión queda anterior a la baja y la baja la cierra).

### Último ingreso
- **RF-21** — Cuando un usuario de un tambo inicia sesión con email y contraseña correctos y la sesión se crea, el sistema deberá registrar la fecha y hora. No deberá registrarla con contraseña incorrecta, con usuario desactivado, con tambo de baja, al reabrir la aplicación con una sesión viva (`/auth/yo`) ni al crear la cuenta (el alta del dueño no cuenta como ingreso).
- **RF-22** — El sistema deberá mostrar al administrador, en el detalle del tambo, el último ingreso de cada usuario (o "nunca ingresó") y, en el listado y el detalle, el último ingreso del tambo: el más reciente de todos sus usuarios, activos o no.
- **RF-23** — El sistema deberá mostrar esas fechas (y las de baja y reactivación) en hora de Argentina con formato `dd/mm/aaaa HH:mm`, usando la función única de hora de Argentina de la web.

### Restablecer la contraseña
- **RF-24** — Cuando el administrador restablece la contraseña de un usuario de un tambo activo indicando la contraseña nueva, el sistema deberá reemplazarla y cerrar todas las sesiones de ese usuario; la ruta bajo `/api/admin/tambos/:id/usuarios/:uid/` identifica al tambo y al usuario. Esta ruta es la que corresponde a usuarios de tambo; se ajusta el test de la 014 (RF-12, "ninguna ruta crea o modifica administradores") para distinguir usuarios de tambo de administradores.
- **RF-25** — La contraseña nueva deberá cumplir las mismas reglas que cualquier alta de usuario (`passwordSchema`), y el administrador se la pasa al usuario por fuera de la aplicación.
- **RF-26** — Si el usuario no existe, tiene un id mal formado, pertenece a otro tambo distinto del indicado o **es un administrador** (un id de administrador en esa ruta no existe para ella), entonces el sistema deberá responder 404 sin cambiar nada y sin revelar que existe. No existe ninguna vía para restablecer la contraseña de un administrador, incluido el propio. Si el tambo está dado de baja, deberá rechazarlo (409) con un mensaje claro.
- **RF-27** — Si el usuario está desactivado, entonces el sistema deberá permitir restablecer su contraseña pero **no deberá reactivarlo**: restablecer y reactivar son acciones separadas.
- **RF-28** — La contraseña nueva nunca deberá aparecer en la auditoría, en los registros del servidor ni en ninguna respuesta (se prueba con un test automático que busca el valor).

### Reactivar un usuario
- **RF-29** — Cuando el administrador reactiva a un usuario desactivado de un tambo activo, el sistema deberá marcarlo como activo, sin cambiar su contraseña ni sus datos y sin crear sesión: el usuario ingresa después con su contraseña. La ruta (bajo `/api/admin/tambos/:id/usuarios/:uid/`) identifica al tambo y al usuario.
- **RF-30** — Si el usuario ya está activo, entonces el sistema deberá rechazarlo (409) sin cambiar nada; si no existe, es de otro tambo, tiene un id mal formado o es un administrador, 404 (igual que RF-26); si el tambo está dado de baja, rechazo (409) con un mensaje claro (primero se reactiva el tambo). La comprobación del estado del tambo y el cambio del usuario ocurren en la misma transacción (RF-12).
- **RF-31** — Reactivar a un usuario que es dueño es válido aunque sea el último dueño: simplemente el tambo vuelve a tener un dueño activo. El dueño del tambo puede volver a desactivarlo con su gestión de usuarios, bajo las reglas que ya tiene. Si el usuario está activo en un tambo que se reactiva, no hay nada que hacer; el administrador no puede desactivar usuarios.

### Auditoría y seguridad
- **RF-32** — Cuando el administrador da de baja o reactiva un tambo, restablece una contraseña o reactiva un usuario, el sistema deberá dejar en la auditoría quién lo hizo, cuándo, sobre qué tambo y (si corresponde) sobre qué usuario, identificado por su **id** (no solo el email); la auditoría solo se agrega y la base lo hace cumplir. Se audita **solo lo aplicado**: los intentos rechazados (409, 404, validación, límite) no se auditan.
- **RF-33** — El sistema deberá limitar las acciones sensibles del administrador (baja, reactivación de tambo, restablecer contraseña y reactivar usuario) a **30 por hora por administrador**, con un único contador compartido entre las cuatro; cada pedido que llega a esas rutas con sesión válida cuenta. El valor se podrá cambiar en los tests con una variable de entorno (como `LIMITE_INTENTOS_LOGIN`). Un pedido rechazado por el límite responde con el mensaje de demasiados intentos y no cambia nada. El límite de crear tambos de la 014 sigue aparte.
- **RF-34** — Todas las rutas nuevas del administrador deberán quedar bajo el único control de acceso de la 014, y sus respuestas solo deberán contener las claves de la lista blanca ampliada.

### Interfaz
- **RF-35** — El detalle del tambo deberá ofrecer: "Dar de baja" (formulario con el motivo y contador de caracteres, y el diálogo de confirmación del RF-6) si está activo; "Reactivar" si está dado de baja; en cada usuario, "Restablecer contraseña" y, si está desactivado, "Reactivar usuario". El listado deberá tener el filtro de estado y mostrar el estado y el último ingreso del tambo.
- **RF-36** — El formulario de contraseña deberá tener el campo oculto (tipo contraseña), aplicar las reglas del RF-25, **limpiarse después de guardar** y no repetir el valor en ninguna confirmación ("Contraseña restablecida").
- **RF-37** — Sin conexión, las acciones y las pantallas deberán avisar "Esto necesita conexión" (como en la 014). Campos y botones de al menos 48 px, español rioplatense, modo claro y oscuro, usables en tablet (768 px) y celular (375 px).

## Permisos por rol
| Acción | Administrador | Dueño | Encargado | Veterinario |
|---|---|---|---|---|
| Dar de baja o reactivar un tambo | Sí | No | No | No |
| Restablecer la contraseña de un usuario de un tambo | Sí | No | No | No |
| Reactivar a un usuario desactivado | Sí | No (el dueño solo gestiona su propio tambo con su gestión de usuarios existente) | No | No |
| Desactivar a un usuario | No | Sí (ya existente) | No | No |
| Ver estado, motivo y último ingreso de tambos y usuarios | Sí | No | No | No |
| Ingresar y operar en su tambo | No | Si está activo | Si está activo | Si está activo |

## Límites aceptados
- Al restablecer una contraseña, el administrador la conoce y podría entrar como ese usuario hasta que la cambie (cuando exista esa función, otra spec); la acción queda en la auditoría.
- **Último ingreso aproximado:** como las sesiones duran 30 días, un usuario que usa la app todos los días sin volver a iniciar sesión mostrará un último ingreso viejo. Solo cuentan los ingresos que crean sesión.
- Tras una baja, la tablet sin conexión sigue mostrando sus datos locales hasta volver la señal (riesgo ya aceptado en la spec 009).
- Los intentos rechazados no se auditan (solo lo aplicado).
- Sin paginación en el listado. Ayuda mínima: solo estado, usuarios, último ingreso, restablecer contraseña y reactivar usuario.

## Casos límite
- Baja mientras un usuario está cargando un evento: su siguiente pedido recibe 401 "tenés que iniciar sesión"; lo guardado antes queda guardado.
- Un tambo con varios usuarios: la baja los alcanza a todos, activos o no.
- Ingreso simultáneo con la baja (RF-20): o se rechaza, o su sesión queda cerrada por la baja; nunca queda una sesión válida.
- Un tambo sin usuarios activos: se puede dar de baja y reactivar; el último ingreso del tambo es el de sus usuarios desactivados o "nunca ingresó".
- Usuario con la sesión ya vencida al restablecer o reactivar: la acción se aplica igual; no hay sesiones que cerrar.
- Reactivar un tambo cuyo dueño ya no está activo: se reactiva igual; el administrador puede reactivar al dueño (RF-29) o restablecerle la contraseña.
- Tambos migrados: nacen activos sin ningún registro de baja (RF-1).
- Pendientes en una tablet de un tambo que nunca se reactiva: quedan hasta que se cierre sesión o ingrese otro usuario (confirmación ya existente).
- Un tambo recién creado y sin ingresos: último ingreso "nunca ingresó".
- Crear un tambo (014) con el email de un usuario de un tambo dado de baja: 409.
- Restablecer o reactivar con un id de usuario de otro tambo: 404, sin cambios y sin revelar que existe.
- Un dueño con contraseña incorrecta en un tambo de baja: mensaje genérico.
- Dar de baja el tambo A no afecta las sesiones, el ingreso ni los pendientes del tambo B.
- El motivo de baja con HTML (por ejemplo `<b>x</b>`) se muestra como texto.
- Restablecer la contraseña de un usuario desactivado: la cambia y sigue desactivado; si luego el administrador lo reactiva, entra con la contraseña nueva.

## Criterios de aceptación
- [ ] RF-1/2/3: tambos migrados y nuevos quedan activos sin registro de baja; listado y detalle muestran estado, y la baja vigente (quién, cuándo, motivo) o la reactivación; tras una segunda baja se muestra la segunda; el filtro se resuelve en el servidor y un valor inválido da 400.
- [ ] RF-4/5/6: la baja pide motivo (recortado, de 1 a 200 caracteres contados por caracteres), registra quién, cuándo y por qué, y no borra nada; el motivo con HTML se ve como texto; la confirmación de interfaz nombra el tambo y avisa de la pérdida de acceso.
- [ ] RF-7/8/9: tras la baja no queda ninguna sesión; con una sesión creada después de la baja, el pedido da 401; `/auth/yo`, la copia local y los envíos de pendientes dan 401; `/auth/logout`, `/api/salud` y el registro de tambos siguen funcionando; `/auth/yo` sin cookie responde lo de siempre.
- [ ] RF-10: con credenciales correctas de un usuario activo el ingreso da 403 `TAMBO_DE_BAJA` y el mensaje, sin sesión; con incorrectas o con usuario desactivado, el genérico; la pantalla de ingreso muestra el mensaje.
- [ ] RF-11/15: nada se borró y los emails siguen reservados; la reactivación no cambia a los usuarios, ni siquiera a uno desactivado individualmente (sigue desactivado), ni sus contraseñas.
- [ ] RF-12/13: dar de baja uno dado de baja y reactivar uno activo se rechazan (409); tests deterministas de concurrencia: dos bajas simultáneas (una aplicada y una rechazada, un solo registro, sin 500), baja contra reactivación, baja contra restablecer contraseña, baja contra reactivar usuario, y baja contra alta de usuario del dueño (ningún usuario activo con sesión en el tambo de baja); id inexistente o mal formado da 404.
- [ ] RF-14: la reactivación no pide motivo, registra quién y cuándo, y los usuarios activos pueden ingresar con su contraseña.
- [ ] RF-16/32: el registro de bajas y reactivaciones y la auditoría rechazan `UPDATE` y `DELETE` en la base (test directo); baja, reactivación de tambo, restablecimiento y reactivación de usuario quedan auditados con el id del usuario, y un intento rechazado no deja auditoría.
- [ ] RF-17/18/19: test de la web: con la respuesta 401 de tambo de baja `clasificar` devuelve `sesion` y nunca `rechazado`; la copia y los pendientes siguen en la tablet (también tras un ingreso rechazado con `TAMBO_DE_BAJA`); al reactivar y reingresar el mismo usuario se retoma el envío.
- [ ] RF-20: test determinista: una sesión creada después de la baja da 401 en el siguiente pedido; el ingreso lee el estado con bloqueo en la misma transacción que crea la sesión; un ingreso concurrente con la baja no deja ninguna sesión válida.
- [ ] RF-21/22/23: el ingreso correcto registra la hora; `/auth/yo`, el alta del dueño, la contraseña incorrecta, el usuario desactivado y el tambo de baja no la registran; el listado muestra el máximo de los usuarios (activos o no); "nunca ingresó" para quien no ingresó; hora de Argentina y formato `dd/mm/aaaa HH:mm` correctos.
- [ ] RF-24/25/28: restablecer cambia la contraseña, cierra las sesiones de ese usuario (no las de otros), valida con `passwordSchema`, y un test automático comprueba que la contraseña no aparece en la auditoría, los logs ni las respuestas.
- [ ] RF-26/27: usuario de otro tambo, id mal formado o id de un administrador dan 404 sin cambios; tambo de baja, rechazo; usuario desactivado se restablece y sigue desactivado; el test de la 014 (RF-12) sigue pasando distinguiendo usuarios de tambo de administradores.
- [ ] RF-29/30/31: reactivar a un usuario desactivado de un tambo activo lo deja activo sin sesión ni cambio de contraseña; reactivar uno activo, 409; de otro tambo, mal formado o administrador, 404; con tambo de baja, rechazo; reactivar al último dueño es válido; el dueño puede volver a desactivarlo.
- [ ] RF-33/34: el límite compartido entre las cuatro acciones responde con el mensaje de demasiados intentos y no cambia nada (con el valor inyectado en el test); el test que recorre todas las rutas del administrador sigue pasando con las nuevas; las claves de las respuestas coinciden con la lista blanca ampliada.
- [ ] RF-35/36/37: pantallas verificadas en 768 px y 375 px, claro y oscuro, con controles de al menos 48 px; formulario de motivo con contador, diálogo de confirmación, filtro de estado; el campo de contraseña está oculto, se limpia tras guardar y la confirmación no repite el valor; sin conexión se avisa "Esto necesita conexión".
- [ ] Test de aislamiento A/B: dar de baja el tambo A deja intactas las sesiones, el ingreso y los pendientes del tambo B; el id del tambo sale solo de la ruta; ningún rol de tambo accede a las rutas nuevas y el administrador sigue sin acceder a datos del tambo.
- [ ] La constitución quedó actualizada con la ampliación de la lista blanca.

## Preguntas abiertas
- (ninguna). Nota: la ampliación de la lista blanca de la constitución (sección "Cambio a la constitución") se aprueba junto con la spec.
