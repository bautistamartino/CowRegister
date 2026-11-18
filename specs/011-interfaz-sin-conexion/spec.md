# 011 — Formularios de carga sin conexión y adaptador de la ficha

Estado: implementada
Fecha: 2026-11-18

## Contexto
La spec 009 dejó la tablet con una copia del tambo para consultar sin señal y con la carga de litros sin conexión. La spec 010 construyó por debajo todo lo necesario para cargar **servicios, tactos, partos, secados, bajas y anulaciones** sin conexión (cola de pendientes, vista local de cada vaca, reglas locales, envío ordenado), pero **sin pantallas**: hoy, en la ficha, esos botones están deshabilitados sin señal con "Esto necesita conexión".

La interfaz se parte en dos specs:
- **011 (esta): cargar.** Los formularios de servicio, tacto, parto, secado y baja; anular o descartar; y el **adaptador** que lleva lo que sabe la tablet (copia + pendientes + enviados) a lo que dibujan la ficha, la sección de reproducción y el historial.
- **012 (`specs/012-marcas-pendientes/`): mostrar.** Marcas completas del historial, baja pendiente en el listado y el buscador, "Cargado sin conexión el …", pantalla "Pendientes" ampliada, acceso del veterinario y aviso de reloj atrasado.

Lo usan dueño, encargado y veterinario (según el permiso de cada evento) en la tablet, en el tambo. Es una spec de **interfaz**: las reglas del negocio, el orden, los reenvíos y la sincronización ya están hechos y probados (spec 010) y **no cambian**.

**Depende de** las specs 003 a 006 (formularios y reglas de cada evento), 007 (historial), 008 y 009 (copia local, "Esto necesita conexión") y 010 (motor sin conexión y vista local). Parte de `specs/011-interfaz-sin-conexion/notas.md`.

## Alcance
- Incluye:
  - Formularios de servicio, tacto, parto (una o dos crías, un solo pendiente), secado y baja, **con y sin conexión**, desde la ficha de la vaca.
  - Anular el último evento, o descartarlo si todavía es un pendiente, con aviso de los pendientes posteriores.
  - El **adaptador**: la ficha, la sección de reproducción y el historial muestran la vista local cuando corresponde (estado, situación, eventos pendientes, parto con sus crías, secado, baja pendiente en solo lectura).
  - Los textos de resumen de cada tipo de pendiente ("Tacto preñada", "Parto con 2 crías (1 nacida muerta)").
  - Una única fuente de "hoy" en hora de Argentina para los formularios.
- No incluye (va en la **012**): marcas completas del historial (enviado, rechazado, en espera, anulación pendiente), baja pendiente en el listado y el buscador, "Cargado sin conexión el …", ampliar la pantalla "Pendientes", acceso y menú del veterinario, aviso de reloj atrasado.
- No incluye (sigue necesitando conexión, sin cambios): altas, edición, mover de lote, planilla, **revertir una baja**, anular litros, catálogo de semen, informes, usuarios y lotes. Revertir una baja no tiene nada que cambiar acá: la copia solo trae animales activos, así que sin conexión no hay ficha de baja a la que llegar.
- No incluye: cambios en la API, la base o las reglas de la 010; corregir un pendiente (solo reintentar o descartar); mostrar las crías de un parto pendiente como animales del listado y el buscador; proyectar el lote tras un parto o secado pendiente.

## Supuestos y reglas del dominio
- **Reglas heredadas** de las specs 003 a 010 sin cambios: preñez vigente, fechas (no futura, no anterior al 01/01/2000, al nacimiento ni al último evento no anulado), separación de partos, solo se anula el último evento, número de cría único entre activos, permisos por rol.
- **Una tablet, un usuario:** lo pendiente y lo local es del usuario y tambo de la sesión local.
- **Quién decide:** con señal y sin pendientes de la vaca delante, decide el servidor; sin señal o con pendientes delante, deciden las reglas locales y el servidor vuelve a decidir al sincronizar (spec 010, RF-15 y RF-20).
- **Anular un pendiente es descartarlo** (spec 010, RF-16): el servidor nunca lo vio.
- **Lote sin proyectar:** un parto o secado pendiente cambia el estado de la vaca en la vista pero **no su lote**.
- **Estados de un pendiente** (spec 010): esperando, enviando, "en espera del anterior" (por un rechazado de la misma vaca), rechazado; y enviado (aceptado, hasta que la copia lo refleje).

## Decisiones (de negocio, confirmadas por el usuario, 2026-11-18)
1. **Hora de Argentina siempre** para todas las fechas y horas.
2. **Mismo camino siempre** al guardar: envío directo con señal y sin pendientes delante; pendiente si falla o hay pendientes delante (RF-15).
3. **Partir la interfaz en 011 y 012.**

## Decisiones técnicas (la opción más simple)
- **Parto:** el parto **no tiene observaciones propias**; solo cada cría las tiene (como la API de hoy). Una o **dos crías** como máximo (el tope de la API).
- **Resumen de un parto:** "Parto con 1 cría", "Parto con 2 crías", y con nacidas muertas entre paréntesis: "Parto con 2 crías (1 nacida muerta)", "Parto con 2 crías (2 nacidas muertas)", "Parto con 1 cría (nacida muerta)". Se define acá y la 012 lo reutiliza.
- **Tercera cría:** el formulario no ofrece agregarla; con dos crías muestra la ayuda "Un parto admite hasta 2 crías".
- **Baja pendiente:** "Descartar baja" vive **en la ficha** (y también en "Pendientes", que ya descarta cualquier tipo). Según el estado: *esperando* → descartar con confirmación; *enviando* → se pide la confirmación y se espera el resultado (si el servidor la aceptó, "Ya estaba guardado en el servidor" y no se descarta); *en espera del anterior* → la confirmación nombra vaca, tipo y fecha; *enviada* (aceptada) → no hay "Descartar" y se lee "Baja enviada: se confirma al actualizar".
- **Espera al guardar (hasta 10 s):** el botón dice "Guardando…" y queda deshabilitado junto con "Cancelar"; los campos conservan lo escrito; no se puede enviar dos veces. Si el servidor no confirma, se guarda como pendiente y se confirma como tal (RF-8).
- **Rechazo local o del servidor:** un solo tratamiento. El resultado rechazado trae un mensaje y, a veces, el campo; si trae campo, el mensaje va junto a ese campo; si no (o si el campo no está dibujado en el formulario, por ejemplo el de las crías en bloque), va en la alerta de arriba. Las claves de campo son las mismas que usa la API (por ejemplo `crias.0.numero`), de modo que el formulario muestre igual un rechazo del servidor y uno local.
- **Animal fuera de la copia:** mensaje "Este animal no está en los datos de la tablet: actualizá los datos cuando tengas señal". No se guarda nada.
- **Fuente de la ficha (el adaptador):**
  - *Sin conexión:* siempre la **vista local** (copia + pendientes válidos + enviados que la copia no trae).
  - *Con conexión y la vaca sin pendientes sin aceptar:* el servidor, como hoy (los enviados ya están allá).
  - *Con conexión y la vaca con algún pendiente sin aceptar:* la vista local, porque el servidor todavía no los conoce. Al aceptarse el último, la ficha vuelve al servidor.
  - *Rechazados y "en espera del anterior":* no cuentan en el estado ni en la situación (son lo que dice la spec 010). La ficha los avisa con una nota "Esta vaca tiene N pendientes sin aceptar: revisalos en Pendientes" con enlace; las marcas dentro del historial son de la 012.
- **Datos de un evento pendiente en el historial** (el servidor todavía no los calculó): `registradoPor` es el **nombre del usuario de la sesión**; el "lote anterior" y la **genética** de un parto, y el lote anterior de un secado o baja, **no se muestran** y en su lugar se lee "Se completa al sincronizar". El estado anterior se toma de la vista local.
- **Hora de Argentina (hoy hay tres implementaciones):** el cálculo de "hoy", del turno y el formateo de fecha y hora de los formularios y del historial pasa a **una sola implementación** (la de resta fija de UTC-3, que no depende del huso del navegador) y las otras la usan. Lo que cambia de verdad es que ninguna fecha depende del huso del dispositivo.
- **Disponibilidad y roles:** se calculan sobre la vista (misma regla con y sin conexión) y se esconden los botones por rol; la API y las reglas locales controlan el permiso real.
- **Semen y toros:** sin conexión, los activos de la copia; con señal, los del servidor (como hoy).
- **Doble toque:** cada guardado genera su propio `id` una sola vez; mientras se guarda, el botón está deshabilitado.

## Requisitos funcionales

### Formularios de carga y anulación
- **RF-1** — Cuando un usuario abre la ficha de una vaca que admite servicios (vaquillona, en ordeñe o seca según la vista, sin preñez vigente), el sistema deberá ofrecer "Registrar servicio" **con o sin conexión**, con fecha (hoy por defecto), tipo (inseminación o monta natural) y semen o toro activos más "No especificado".
- **RF-2** — Cuando un usuario abre la ficha de una vaca que admite tactos, el sistema deberá ofrecer "Registrar tacto" con o sin conexión, con fecha, resultado (preñada o vacía), fecha probable opcional (solo en preñada) y anomalías opcionales (hasta 200 caracteres).
- **RF-3** — Cuando un dueño o encargado abre la ficha de una vaca, el sistema deberá ofrecer "Registrar parto" con o sin conexión, con fecha y **una o dos crías** (sexo, nacida muerta, número de la viva y observaciones de cada una), sin observaciones del parto, y deberá guardar el parto con todas sus crías como **un solo pendiente**. Con dos crías no deberá ofrecer una tercera y deberá mostrar "Un parto admite hasta 2 crías".
- **RF-4** — Cuando un dueño o encargado abre la ficha de una vaca **en ordeñe según la vista**, el sistema deberá ofrecer "Registrar secado" con o sin conexión, con su fecha.
- **RF-5** — Cuando un dueño o encargado abre la ficha de un animal activo, el sistema deberá ofrecer "Dar de baja" con o sin conexión (motivo venta o muerte, fecha y observaciones, con el paso de confirmación de la spec 006).
- **RF-6** — Cuando un usuario con permiso pide anular el último evento no anulado de la vaca (servicio, tacto, parto o secado, según la vista), el sistema deberá pedir un **motivo obligatorio** y registrar la anulación con o sin conexión. El veterinario solo ve "Anular" en un servicio o un tacto.
- **RF-7** — Cuando el último evento no anulado es un **pendiente** o hay una anulación pendiente de él, el sistema deberá ofrecer "Descartar" con confirmación (nombrando vaca, tipo y fecha) en lugar de "Anular", sin crear ninguna anulación. Si la misma vaca tiene otros pendientes cargados después, deberá informar **cuáles son** y que seguirán enviándose.
- **RF-8** — Cuando una carga o anulación queda guardada como pendiente, el sistema deberá confirmarlo con "Guardado en la tablet: pendiente de sincronizar" y el resumen del pendiente. Cuando el servidor la acepta en el momento, deberá confirmarla como hoy (por ejemplo "Parto registrado", con sus avisos de lote y sus crías). Nunca deberá confirmar como guardado algo que no se guardó.
- **RF-9** — Mientras una carga se está guardando (hasta 10 segundos), el sistema deberá mostrar "Guardando…", deshabilitar los botones del formulario, conservar lo escrito y no permitir un segundo envío.
- **RF-10** — Si no se puede guardar en la tablet (límite de 500 pendientes o falta de espacio), entonces el sistema deberá mostrar "No se pudo guardar en la tablet: <motivo>. Conectate para sincronizar los pendientes" y conservar lo escrito.
- **RF-11** — Si la carga es rechazada (por las reglas locales o por el servidor), entonces el sistema deberá mostrar el mensaje en español junto al campo que corresponda, o en la alerta de arriba si no hay campo o el campo no está dibujado, **sin perder lo escrito** y sin guardar nada.
- **RF-12** — Si el animal no está en la copia de la tablet, entonces el sistema deberá mostrar "Este animal no está en los datos de la tablet: actualizá los datos cuando tengas señal" y no ofrecer cargas.
- **RF-13** — El sistema deberá ofrecer cada carga con el mismo criterio con y sin conexión (no ofrecer servicio con preñez vigente, secado solo en ordeñe, nada en un animal con baja pendiente), calculado sobre la vista.
- **RF-14** — El sistema deberá mostrar los botones de carga y anulación según el rol (veterinario: solo servicio y tacto, y anular servicio o tacto; dueño y encargado: todo). El permiso real lo controlan la API y las reglas locales.
- **RF-15** — El sistema deberá usar en las fichas el mismo camino de carga con y sin conexión: con señal y sin pendientes de la vaca delante se envía en el momento; en cualquier otro caso queda pendiente detrás de los existentes.
- **RF-16** — El sistema deberá mostrar un resumen de texto por tipo de pendiente: "Servicio", "Tacto preñada", "Tacto vacía", "Parto con N crías" (con "(M nacidas muertas)" si corresponde, ver las decisiones), "Secado", "Baja por venta", "Baja por muerte", "Anulación de servicio, tacto, parto o secado".
- **RF-17** — El sistema deberá seguir deshabilitando con "Esto necesita conexión" lo que no se puede hacer sin señal (editar, mover de lote, altas, revertir baja, anular litros).

### Adaptador de la ficha
- **RF-18** — El sistema deberá elegir la fuente de la ficha, la sección de reproducción y el historial así: sin conexión, la vista local; con conexión y sin pendientes sin aceptar de la vaca, el servidor; con conexión y con algún pendiente sin aceptar, la vista local. Al dejar de haber pendientes sin aceptar, deberá volver al servidor sin recargar la pantalla a mano.
- **RF-19** — Mientras la vaca tenga pendientes que cuentan (esperando, enviando, o enviados que la copia todavía no trae), el sistema deberá mostrar su estado y su situación reproductiva (último servicio, último tacto, parto probable, estado reproductivo) calculados con la vista local. Los rechazados y los "en espera del anterior" no deberán contar.
- **RF-20** — El sistema deberá mostrar en el historial cada evento pendiente (esperando o enviando) con la marca "Pendiente de sincronizar", con **el nombre del usuario de la sesión** como quien lo registró, y con "Se completa al sincronizar" en lugar del lote anterior y la genética (los demás datos salen de la vista). Los enviados se muestran sin marca; las demás marcas son de la 012.
- **RF-21** — Mientras haya un parto pendiente, el sistema deberá mostrar a la madre "en ordeñe", las crías (sexo, nacida muerta, número) **dentro del parto** y el aviso "El lote se asigna al sincronizar". Las crías no deberán aparecer como animales del listado ni del buscador.
- **RF-22** — Mientras haya un secado pendiente, el sistema deberá mostrar la vaca "seca" y no ofrecer cargar litros; mientras haya un parto pendiente, sí deberá ofrecerlos.
- **RF-23** — Mientras haya una baja pendiente o enviada que la copia todavía no refleja, el sistema deberá mostrar la ficha del animal en **solo lectura**, sin ofrecer ningún evento, edición ni litros, con "Baja pendiente de sincronizar" y, si no se envió, "Descartar baja" (según los estados de las decisiones); si se envió, "Baja enviada: se confirma al actualizar".
- **RF-24** — Cuando la vaca tiene pendientes rechazados o "en espera del anterior", el sistema deberá mostrar en la ficha "Esta vaca tiene N pendientes sin aceptar: revisalos en Pendientes" con un enlace a esa pantalla.
- **RF-25** — Cuando cambia la cola de pendientes o llega una copia nueva, el sistema deberá actualizar solo la ficha, la sección de reproducción y el historial que están a la vista, sin perder el formulario abierto.
- **RF-26** — El sistema deberá calcular el "hoy" de los formularios (fecha por defecto y máximo) y el formateo de fechas y horas **siempre en hora de Argentina**, con una única implementación, sin depender del huso del dispositivo.

### Interfaz y seguridad
- **RF-27** — El sistema deberá mostrar campos y botones de al menos 48 px de alto, sin desborde horizontal a 768 px y 375 px, y usar las variables de color del modo claro y oscuro.
- **RF-28** — El sistema deberá mostrar y enviar solo lo pendiente y local del usuario y tambo de la sesión, sin enviar nunca un `establecimientoId` desde la pantalla.

## Permisos por rol
| Acción (con o sin conexión) | Dueño | Encargado | Veterinario |
|---|---|---|---|
| Registrar servicio o tacto | Sí | Sí | Sí |
| Registrar parto, secado o baja | Sí | Sí | No |
| Anular (o descartar) servicio o tacto | Sí | Sí | Sí |
| Anular (o descartar) parto o secado | Sí | Sí | No |
| Descartar una baja pendiente | Sí | Sí | No |
| Revertir baja, editar, mover de lote, altas | Necesita conexión | Necesita conexión | Necesita conexión |

## Casos límite
- **Vaca con un pendiente rechazado:** la carga nueva se guarda detrás y queda "en espera"; no cuenta en el estado y la ficha lo avisa con la nota de Pendientes (RF-15, RF-24).
- **Parto pendiente:** el lote de la madre no cambia en pantalla; se lee "El lote se asigna al sincronizar" (RF-21).
- **Cría con el número de otro animal activo, de otra cría pendiente o repetido en el mismo parto:** error junto al campo de esa cría, nada se guarda (RF-11).
- **Descartar el primero de una cadena:** se informan los posteriores y no se descartan solos (RF-7).
- **Descartar algo que se estaba enviando:** se espera el resultado; si el servidor lo aceptó, "Ya estaba guardado en el servidor" y no se descarta (RF-7, RF-23).
- **Baja pendiente de un animal con otros pendientes delante:** la baja queda "en espera" si uno se rechaza; la ficha lo dice (RF-23, RF-24).
- **Animal fuera de la copia, o sin copia:** no se ofrece nada (RF-12).
- **Límite de 500 pendientes o sin espacio:** nada se confirma como guardado (RF-10).
- **Señal que se va o vuelve con el formulario abierto:** lo escrito no se pierde; al guardar vale el camino que corresponda en ese momento (RF-15).
- **Señal mala (el servidor no responde en 10 s):** queda como pendiente y se confirma como tal (RF-8, RF-9).
- **Dispositivo con otro huso horario, cerca de la medianoche argentina:** "hoy" sigue siendo el de Argentina (RF-26).
- **Veterinario que manipula la tablet para cargar un parto, secado o baja:** el servidor responde 403 y el pendiente queda rechazado (spec 010).
- **Otro usuario o tambo en la misma tablet:** lo ajeno nunca se ve ni se envía (RF-28).

## Cómo se verifica
- **Vitest en la web, con reloj y conexión inyectables** (lógica pura, sin pantallas):
  - El **adaptador** (RF-18 a RF-24): para cada estado de la vaca (sin pendientes, esperando, enviando, enviado no reflejado, rechazado, en espera, parto, secado, baja pendiente, baja enviada) y con y sin conexión, qué fuente manda y qué estado, situación, eventos, `registradoPor`, "Se completa al sincronizar" y crías devuelve.
  - Los **resúmenes** de texto de cada tipo (RF-16), incluidas las nacidas muertas y una sola cría.
  - La **conversión del rechazo** local y del servidor al mismo formato de errores por campo (RF-11), incluido un campo que el formulario no dibuja.
  - **Hora de Argentina** (RF-26): un test que fija el huso del proceso en otra zona (por ejemplo Asia/Tokyo y America/New_York) y un reloj inyectado cerca de la medianoche argentina, y comprueba que "hoy", el turno y el texto de fecha y hora dan los de Argentina en todas las funciones que usan los formularios y el historial.
  - Los casos de la tabla compartida de la 010 siguen en verde (no se cambian reglas).
- **A mano en el navegador, con la red cortada** (768 px y 375 px, modo claro y oscuro): cargar cada evento (servicio, tacto, parto con dos crías, secado, baja), ver "Guardado en la tablet: pendiente de sincronizar", la ficha con el estado nuevo y el evento "Pendiente de sincronizar", anular y descartar con posteriores, baja pendiente en solo lectura con "Descartar baja", vuelta de la señal y ficha actualizada, controles de 48 px sin desborde. Una pasada con el veterinario (solo servicio y tacto).

## Criterios de aceptación
- [x] Sin conexión se cargan servicio, tacto, parto (una o dos crías, un solo pendiente), secado y baja, y se anula o descarta, con la confirmación "Guardado en la tablet: pendiente de sincronizar" (RF-1 a RF-8).
- [x] El guardado muestra "Guardando…", no se duplica, y los errores (reglas, espacio, animal fuera de la copia) se muestran sin perder lo escrito (RF-9 a RF-12).
- [x] Lo ofrecido depende de la vista y del rol, igual con y sin señal (RF-13, RF-14, RF-17).
- [x] La ficha, la reproducción y el historial usan la fuente correcta y reflejan parto, secado y baja pendientes; los rechazados no cuentan y se avisa (RF-18 a RF-25).
- [x] La fecha de "hoy" es la de Argentina aunque el dispositivo tenga otro huso (RF-26).
- [x] 768 px y 375 px, modo claro y oscuro, controles de 48 px, y la lógica de la 010 sin cambios (RF-27, RF-28).

## Preguntas abiertas
Ninguna.
