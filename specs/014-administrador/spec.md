# 014 — Administrador de la plataforma: ingreso, ver tambos y crear tambos

Estado: aprobada
Fecha: 2026-11-19

## Contexto
Hoy CowRegister solo tiene usuarios que pertenecen a un tambo (dueño, encargado y veterinario). Quien administra la plataforma no tiene dónde mirar qué tambos hay, ni cómo dar de alta uno nuevo. Con el registro público cerrado en producción (decisión de la spec 013), crear un tambo nuevo no puede depender de un formulario abierto a cualquiera.

Se agrega un cuarto rol, el **administrador de la plataforma**: una persona (el responsable del sistema) que no pertenece a ningún tambo. Inicia sesión, ve el listado de todos los tambos **solo como cuentas** (nombre, dueño, fecha de alta, cuántos usuarios y animales activos) y crea tambos nuevos con su dueño.

El administrador **no mira el trabajo del tambo**: no ve animales, eventos, litros ni historiales.

Esta spec es la primera de dos. La **015 (acciones del administrador)** suma dar de baja y reactivar tambos, restablecer contraseñas y el último ingreso, y **depende de esta**. Cada una se puede usar sola.

## Cambio a la constitución (requiere aprobación explícita del responsable)
Al aprobar esta spec, el responsable aprueba también este agregado al principio 1 de `docs/constitution.md` ("Datos de cada tambo aislados"):

> **Excepción acotada: administrador de la plataforma.**
> 1. Existe un rol que no pertenece a ningún tambo. Sus cuentas y sus sesiones están separadas de las de los usuarios de tambo.
> 2. Lo único que ve del tambo es esta **lista blanca de la cuenta**: id, nombre, fecha de alta, dueño (nombre y email), cantidad de usuarios activos, cantidad de animales activos y la lista de usuarios (nombre, email, rol, si está activo); y lo que sumen las specs posteriores que la amplíen explícitamente (la 015 agrega estado, último ingreso y motivo de baja).
> 3. **El conteo de animales activos es la única consulta permitida sobre datos del tambo.** Nunca ve ni modifica animales (ni sus números), eventos, litros, lotes, historial, informes ni la copia local.
> 4. Las rutas `/api/admin` son la **única excepción** a "nunca se acepta un identificador de tambo del cliente": ahí el id del tambo viaja en la ruta y es legítimo, porque quien lo envía es el administrador. Todas las demás rutas siguen tomando el tambo de la sesión.
> 5. Todo `/api/admin` está detrás de **un único control de acceso** aplicado al conjunto de rutas, y un test recorre todas las rutas del administrador para comprobarlo. Hay además un test de aislamiento propio: ningún rol de tambo accede, y el administrador no accede a ninguna ruta de datos del tambo.
> 6. Las tablas nuevas llevan UUID y `creadoEn`/`actualizadoEn` (las editables); el registro de auditoría y los registros de baja que sume la 015 solo se agregan.

El resto del principio 1 no cambia: para todos los demás roles, el tambo sale siempre de la sesión y un recurso ajeno responde 404.

## Alcance
- Incluye: rol de administrador con cuentas y sesiones separadas; ingreso unificado; alta única del primer administrador; listado y detalle de tambos como cuentas; crear un tambo con su dueño; auditoría de los ingresos del administrador y de las altas de tambos.
- No incluye (los hace la **015**): dar de baja y reactivar tambos, mostrar el estado, restablecer contraseñas, último ingreso.
- No incluye: ver o tocar animales, eventos, litros, lotes, historial o informes de un tambo; borrar un tambo; editar el nombre de un tambo ni cambiar de dueño; crear, desactivar o modificar usuarios de un tambo (lo hace su dueño); crear más administradores desde la aplicación; que un usuario cambie su propia contraseña; modo sin conexión para el administrador; el cierre del registro público y los backups (spec 013).

## Decisión de diseño que fija esta spec (el modelo exacto va en el plan)
El administrador **no es un usuario de tambo con el tambo vacío**: es una cuenta de otra tabla (administradores), con sus propias sesiones y su propia cookie. Así ninguna ruta del tambo puede recibir nunca una sesión sin tambo: **en toda ruta de datos del tambo el tambo de la sesión nunca es nulo** (garantía verificable con test).

## Requisitos funcionales

### Rol e ingreso
- **RF-1** — El sistema deberá tener un rol de administrador de la plataforma que no pertenece a ningún tambo, con sus cuentas separadas de las de los usuarios de tambo.
- **RF-2** — El sistema deberá tener un único ingreso (misma pantalla, misma ruta de ingreso y el mismo contador de intentos por IP) para administradores y usuarios de tambo, que busque el email en ambos grupos y tarde un tiempo parecido exista o no el email.
- **RF-3** — Si el email o la contraseña son incorrectos, entonces el sistema deberá responder con el mismo mensaje genérico de hoy ("Email o contraseña incorrectos"), sin revelar si el email existe ni de qué grupo es.
- **RF-4** — Cuando un administrador ingresa con email y contraseña correctos, el sistema deberá iniciar su sesión y llevarlo a la pantalla de tambos de la plataforma.
- **RF-5** — Cuando se inicia una sesión de administrador, el sistema deberá usar una cookie distinta de la de los usuarios de tambo, con un token nuevo en cada ingreso, y la sesión deberá durar poco tiempo y no renovarse con el uso (la duración exacta va en el plan).
- **RF-6** — El sistema no deberá aceptar la sesión de un administrador en ninguna ruta del tambo, ni la de un usuario de tambo en ninguna ruta del administrador.
- **RF-7** — El sistema deberá impedir que un mismo email sea a la vez de un administrador y de un usuario de tambo, en todos los puntos de alta: el registro de tambo, el alta de usuarios que hace el dueño, la creación de tambo del administrador y el alta única del primer administrador.
- **RF-8** — La unicidad del email entre administradores y usuarios deberá estar garantizada también en la base de datos, incluso si dos altas simultáneas usan el mismo email (una se acepta y la otra recibe el rechazo de email repetido, nunca un error del servidor).
- **RF-9** — El sistema deberá permitir crear al primer administrador mediante un procedimiento de alta única, ejecutado una sola vez, sin ninguna ruta ni pantalla pública para hacerlo.
- **RF-10** — Si ya existe un administrador o el email indicado ya pertenece a una cuenta, entonces el procedimiento de alta única deberá detenerse sin cambiar nada y explicar el motivo.
- **RF-11** — El procedimiento de alta única deberá recibir la contraseña por una entrada que no la muestre en pantalla o por una variable de entorno que no se guarde en ningún archivo, deberá guardarla solo con hash, y su salida nunca deberá contenerla (se prueba revisando la salida).
- **RF-12** — El sistema no deberá ofrecer, desde la aplicación, ninguna ruta que cree o modifique administradores (alta, cambio de rol, baja, cambio de contraseña); un test que liste todas las rutas deberá fallar si aparece una así.
- **RF-13** — Cuando el administrador cierra sesión, el sistema deberá cerrarla en el servidor y la web no deberá borrar, leer ni guardar nada del almacenamiento local de la tablet (copia, pendientes o perfil), ni al ingresar ni al cerrar sesión.
- **RF-14** — Cuando un administrador ingresa en una tablet que tiene datos locales de un tambo, el sistema no deberá borrarlos ni pedir la confirmación de "datos de otro usuario": los datos locales quedan intactos.
- **RF-15** — El sistema deberá registrar en la auditoría cada ingreso correcto del administrador y cada intento fallido contra una cuenta de administrador (con el email y la hora, nunca la contraseña).

### Ver los tambos (solo como cuentas)
- **RF-16** — Mientras haya una sesión de administrador, el sistema deberá mostrar el listado de todos los tambos con: nombre, dueño (el más antiguo: nombre y email) y cuántos dueños adicionales tiene (por ejemplo "Ana López +1"), fecha de alta, cantidad de usuarios activos y cantidad de animales activos. Un tambo puede tener varios dueños y cada uno ingresa de forma independiente.
- **RF-17** — El sistema deberá ordenar el listado por nombre y mostrarlo completo, sin paginación.
- **RF-18** — Cuando el administrador abre un tambo, el sistema deberá mostrar los datos del listado y todos sus usuarios (activos o no) con nombre, email, rol y si está activo, destacando a los dueños.
- **RF-19** — El sistema nunca deberá mostrar al administrador animales (ni sus números), eventos, litros, lotes, historial, informes ni la copia local de un tambo, y el único dato del tambo que se podrá consultar es el conteo de animales activos.
- **RF-20** — Si el id de tambo pedido no existe o tiene un formato inválido, entonces el sistema deberá responder que no se encontró, nunca un error del servidor.
- **RF-21** — Mientras el administrador no tenga conexión, el sistema deberá avisar "Esto necesita conexión" en vez de mostrar datos viejos.

### Crear un tambo
- **RF-22** — Cuando el administrador crea un tambo indicando el nombre del tambo y el nombre, email y contraseña inicial de su dueño, el sistema deberá crear, en una sola operación todo o nada, el tambo, su usuario dueño con los lotes iniciales y sus destinos (igual que el registro de hoy) y el registro de auditoría "creado por" ese administrador, con la fecha y hora.
- **RF-23** — Cuando el administrador crea un tambo, el sistema no deberá iniciar sesión como el dueño nuevo, no deberá modificar la sesión del administrador y no deberá devolver la contraseña ni su hash.
- **RF-24** — Si el email del dueño ya pertenece a una cuenta (de un usuario de cualquier tambo, aunque el tambo esté dado de baja según la 015, o de un administrador), entonces el sistema deberá rechazar la creación con un mensaje claro y no deberá dejar nada guardado.
- **RF-25** — Si falla cualquier paso de la creación (por ejemplo el alta del dueño), entonces el sistema no deberá dejar guardados tambo, lotes ni auditoría.
- **RF-26** — Si algún dato no cumple las reglas (nombre vacío o demasiado largo, email inválido, contraseña corta), entonces el sistema deberá rechazar la creación y señalar el campo, con las mismas reglas que el registro actual.
- **RF-27** — Si ya existe un tambo con el mismo nombre (sin distinguir mayúsculas ni espacios de más, al principio, al final o repetidos en el medio), entonces el sistema deberá rechazar la creación con el mensaje "Ya existe un tambo con ese nombre" y no deberá dejar nada guardado; lo mismo vale para cualquier otra alta de tambo (el registro de hoy) y debe estar garantizado también en la base de datos, incluso con dos altas simultáneas con el mismo nombre (una se acepta y la otra recibe el rechazo, nunca un error del servidor).
- **RF-28** — El sistema deberá limitar la cantidad de creaciones de tambo por período para el administrador, con un límite razonable.
- **RF-34** — Cuando el sistema se actualiza y ya existen tambos con nombres que se repiten según la regla del RF-27, el sistema no deberá fallar ni borrar nada: deberá conservar el nombre del tambo más antiguo y renombrar a los más nuevos agregando un número entre paréntesis (por ejemplo "Libertad (2)"), para que el dueño o el administrador lo corrijan después.

### Seguridad e interfaz
- **RF-29** — El sistema deberá permitir las funciones del administrador solo a un administrador con sesión: sin sesión, "tenés que iniciar sesión"; dueño, encargado o veterinario, "no tenés permiso", controlado en la API y con un único control de acceso para todo el conjunto de rutas del administrador.
- **RF-30** — El sistema no deberá permitir que un administrador acceda a ninguna función de datos del tambo (animales, eventos, lotes, informes, copia local, usuarios del tambo): cualquier intento deberá ser rechazado.
- **RF-31** — El sistema nunca deberá incluir contraseñas, hashes ni claves de sesión en ninguna respuesta del administrador, y las respuestas solo deberán contener las claves de la lista blanca de la constitución.
- **RF-32** — El sistema deberá mostrar al administrador solo sus pantallas (tambos, detalle, crear tambo), sin el menú del tambo, y no deberá mostrar a los demás roles ningún acceso a ellas.
- **RF-33** — El sistema deberá mostrar esas pantallas en español rioplatense, con campos y botones de al menos 48 px, en modo claro y oscuro, usables en tablet y celular.

## Permisos por rol
| Acción | Administrador | Dueño | Encargado | Veterinario |
|---|---|---|---|---|
| Ver el listado y el detalle de todos los tambos (como cuentas) | Sí | No | No | No |
| Crear un tambo con su dueño | Sí | No | No | No |
| Ver animales, eventos, litros, lotes, historial e informes de un tambo | No | Su tambo | Su tambo | Su tambo |
| Gestionar usuarios de su tambo | No | Sí | No | No |

## Límites aceptados
- El administrador escribe la contraseña inicial del dueño y se la pasa por fuera de la aplicación: la conoce hasta que exista el cambio de contraseña por el propio usuario (otra spec), y con ella podría entrar como ese dueño. La creación queda en la auditoría.
- Un solo administrador; si pierde su contraseña, se resuelve a mano en el servidor.
- El listado no tiene paginación (se asume una cantidad chica de tambos).
- Nombre de tambo repetido: **no se permite** (decisión del usuario). Si dos tambos que ya existían tenían el mismo nombre, el más nuevo se renombra con un número (RF-34); no hay pantalla para editar nombres en esta spec.

## Casos límite
- Un tambo recién creado se muestra con cero animales.
- Un tambo con dos dueños: el listado muestra al más antiguo con "+1" y el detalle lista a los dos como dueños.
- Crear un tambo llamado " libertad  " cuando ya existe "Libertad": se rechaza con "Ya existe un tambo con ese nombre".
- Dos creaciones simultáneas del mismo nombre de tambo: una se crea y la otra recibe el rechazo; no queda ninguna a medias.
- Un email con otras mayúsculas o con espacios se trata como el mismo al buscar duplicados.
- Dos creaciones de tambo simultáneas con el mismo email de dueño: una se crea y la otra recibe el rechazo de email repetido; no queda un tambo sin dueño.
- Un dueño intenta dar de alta (como usuario de su tambo) el email de un administrador: recibe el mismo rechazo de "ya existe una cuenta con ese email".
- El administrador ingresa en una tablet con datos de un tambo y con pendientes sin enviar: no se toca nada; al volver el usuario del tambo, retoma normalmente.
- Ingreso del administrador con credenciales incorrectas: mismo mensaje que cualquier otro ingreso fallido; queda un intento fallido en la auditoría si el email es de un administrador.
- Aislamiento: el administrador ve a todos los tambos solo como cuentas; un dueño nunca ve otro tambo.

## Criterios de aceptación
- [ ] RF-2/3: un ingreso con email inexistente, con email de administrador y contraseña mala, y con email de usuario y contraseña mala dan la misma respuesta; comparten el contador de intentos.
- [ ] RF-4/5: el administrador ingresa y va a la pantalla de tambos; la cookie es distinta de la de tambo; dos ingresos dan tokens distintos; la sesión no se renueva con el uso.
- [ ] RF-6/30: la cookie de administrador en una ruta del tambo (incluidas la copia local y el perfil) da rechazo, y la de tambo en una ruta del administrador también.
- [ ] Test con base: en toda ruta de datos del tambo el tambo de la sesión nunca es nulo.
- [ ] RF-7/8: el email repetido se rechaza en los cuatro puntos de alta (registro, usuarios del dueño, crear tambo, alta única), cada uno con su test; dos altas simultáneas con el mismo email dejan una sola cuenta y ningún error 500; la base rechaza el duplicado aun saltándose el código.
- [ ] RF-9/10/11: el alta única crea un administrador; repetirla no cambia nada y avisa; con un email existente se detiene; la salida no contiene la contraseña.
- [ ] RF-12: el test que lista las rutas falla si aparece una que cree o modifique administradores.
- [ ] RF-13/14: test de la web: el ingreso y el cierre de sesión del administrador no llaman al almacén local; una tablet con datos de un tambo conserva todo.
- [ ] RF-15: ingresos correctos y fallidos del administrador quedan auditados sin contraseña.
- [ ] RF-16/17/18/19/31: el listado y el detalle traen todos los tambos con las cantidades correctas (usuarios activos en el listado, todos en el detalle); un test compara las claves de las respuestas con la lista blanca; ninguna contiene animales, eventos, litros ni hashes.
- [ ] RF-20: id inexistente o mal formado da "no encontrado", nunca 500.
- [ ] RF-22/23/25: crear un tambo deja tambo, dueño, lotes y auditoría; no cambia la sesión del administrador; no devuelve contraseña ni hash; si falla el alta del dueño no queda tambo, lotes ni auditoría.
- [ ] RF-24: crear con el email de un usuario de otro tambo o de un administrador da 409 y no deja nada.
- [ ] RF-26/28: datos inválidos se rechazan señalando el campo; el límite de creaciones responde con el mensaje de demasiados intentos.
- [ ] RF-27: un nombre repetido (con otras mayúsculas o espacios de más) da 409 "Ya existe un tambo con ese nombre" en la creación del administrador y en el registro de hoy; la base lo rechaza aun saltándose el código; dos altas simultáneas con el mismo nombre dejan un solo tambo y ningún 500.
- [ ] RF-34: con dos tambos de nombre repetido ya cargados, la actualización de la base no falla, no borra nada, deja el nombre del más antiguo y renombra al más nuevo con " (2)".
- [ ] RF-29: un único control de acceso cubre todo `/api/admin`; un test recorre todas las rutas: sin sesión, 401; dueño, encargado y veterinario, 403.
- [ ] RF-21/32/33: las pantallas se ven bien en tablet y celular, claro y oscuro, con controles de al menos 48 px; sin conexión avisan.
- [ ] La constitución quedó actualizada con la excepción acotada.

## Relación con la spec 013 (publicación)
La 013 está commiteada en la rama `spec/013-publicacion` (no en esta rama), así que acá no se lista requisito por requisito; lo que seguro cambia:
- El "script de primer tambo" de la 013 se reemplaza por el procedimiento de alta única del **primer administrador** (RF-9 a RF-11); el primer tambo real se crea desde la pantalla del administrador (RF-22).
- Los requisitos de "registro público cerrado en producción" se mantienen: esta spec no reabre el registro. Conviene que la 013 diga que los tambos nuevos nacen por el administrador.
- El procedimiento de despliegue debe incluir correr el alta del administrador antes de entregar el sistema.

## Preguntas abiertas
- (ninguna: spec aprobada por el usuario el 2026-11-19, incluida la excepción acotada al principio 1 de la constitución, con la decisión de que el nombre de tambo no se puede repetir)
