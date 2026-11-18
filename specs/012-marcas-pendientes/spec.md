# 012 — Marcas de lo pendiente, "Pendientes" ampliada y aviso de reloj

Estado: aprobada
Fecha: 2026-11-18

## Contexto
La spec 011 permite cargar servicios, tactos, partos, secados, bajas y anulaciones sin conexión desde la ficha, y la ficha muestra lo pendiente. Falta que cualquiera pueda **entender de un vistazo qué quedó pendiente, qué se envió, qué se rechazó y qué cargó otra persona sin señal**: las marcas completas del historial, la baja pendiente en el listado y el buscador, la pantalla "Pendientes de sincronizar" con resúmenes claros, el acceso del veterinario y el aviso de reloj atrasado. Lo usan dueño, encargado y veterinario en la tablet, en el tambo.

Es la segunda parte de la interfaz sin conexión (la 011 es la primera). Es solo interfaz: no cambia la API, la base ni las reglas de la 010.

**Depende de** las specs 007 (historial), 009 (copia local, "Pendientes"), 010 (motor, vista local, estados, avisos guardados) y 011 (formularios, adaptador de la ficha y resúmenes de texto).

## Alcance
- Incluye:
  - Marcas completas en el historial: "Pendiente de sincronizar", "Enviado: se confirma al actualizar", "Rechazado: <motivo>", "En espera del anterior", "Anulación pendiente".
  - Baja pendiente en el listado y el buscador, con y sin señal.
  - "Cargado sin conexión el <fecha y hora>" en el historial.
  - Pantalla "Pendientes de sincronizar": resumen completo por tipo, acciones, avisos del servidor, ayuda ante rechazo por vaca no activa y acceso del veterinario (incluido el enlace del menú).
  - Aviso de reloj atrasado y su efecto en los formularios.
- No incluye: cambios en los formularios y en el adaptador de la 011 (salvo lo del reloj), marcas de otros eventos en el listado, crías de partos pendientes como animales, cambios en la API, la base o las reglas.

## Supuestos y reglas del dominio
- **Reglas heredadas** de las specs 009, 010 y 011. Los estados de un pendiente son los de la 010: esperando, enviando, "en espera del anterior", rechazado, y enviado (hasta que la copia lo refleja).
- **Resúmenes de texto** de cada tipo: los definidos en la 011 (RF-16).
- **Hora de Argentina siempre** (decisión del usuario); una sola implementación (spec 011, RF-26).
- **Reloj:** la tablet no puede saber su error contra el servidor sin conexión, salvo comparándose con la hora de la última copia (que viene del servidor).

## Decisiones (de negocio, confirmadas por el usuario, 2026-11-18)
1. **Hora de Argentina siempre** para todas las fechas y horas.
2. **El veterinario ve "Pendientes" solo cuando tiene pendientes o avisos**, sin entrada fija en el menú.
3. **En el listado y el buscador, solo "Baja pendiente de sincronizar"**; las demás marcas, en la ficha y el historial.
4. **"Cargado sin conexión el …" solo si pasaron más de 5 minutos** entre la hora de la tablet y el registro en el servidor.
5. **Mismo camino siempre** para guardar (spec 011).

## Decisiones técnicas (la opción más simple)
- **Menú del veterinario:** hoy el enlace "Pendientes" se muestra si el rol carga litros o si hay pendientes, pero **no mira los avisos**, mientras que la pantalla sí los mira. Se unifica: el enlace aparece cuando el usuario carga litros, o hay pendientes sin aceptar, o hay avisos sin cerrar; y la pantalla usa la misma condición. Sin ninguna de las tres, no hay enlace ni se muestra la pantalla (se redirige).
- **Reloj atrasado:** se compara la hora de la tablet con la hora de generación de la última copia local; si es anterior por **más de 5 minutos**, se avisa. **Reloj adelantado:** no se detecta sin servidor (no hay con qué comparar); lo cubre el servidor, que rechaza una fecha futura con "La fecha no puede ser futura" y el pendiente queda rechazado y visible en "Pendientes". Es un riesgo aceptado.
- **Dónde se muestra el aviso de reloj:** arriba de cada formulario de carga de la 011 (los únicos lugares donde la fecha importa), con el texto exacto; no es un cartel global.
- **Efecto en los inputs de fecha con reloj atrasado:** el campo fecha queda **vacío y obligatorio** (no propone hoy) y **sin máximo** (el máximo sale de "hoy", que no es confiable); el mínimo se mantiene. El servidor y las reglas locales siguen validando la fecha futura.
- **"Cargado sin conexión":** sale del dato que ya devuelve la API en el historial; se compara con el momento de registro en el servidor.
- **Baja pendiente en el listado con señal:** el listado viene del servidor, que todavía tiene al animal activo; la tablet le agrega la marca si hay una baja **no aceptada o enviada que la copia no refleja**. Si el servidor ya la tiene (baja aceptada), el animal desaparece del listado como hoy.
- **Número reutilizable:** un animal con baja pendiente sigue en el listado hasta que la copia deje de traerlo. Una cría de un parto cargado **después** de esa baja puede usar su número (spec 010, RF-21); como las crías pendientes no figuran en el listado, el buscador de ese número devuelve solo al animal con baja pendiente y no hay dos filas iguales.

## Requisitos funcionales

### Marcas del historial
- **RF-1** — El sistema deberá mostrar en el historial de la ficha cada evento que la tablet conoce y el servidor todavía no confirmó, con su marca: "Pendiente de sincronizar" (esperando o enviando), "Enviado: se confirma al actualizar" (aceptado y la copia todavía no lo trae), "Rechazado: <motivo>" y "En espera del anterior".
- **RF-2** — Cuando un evento tiene una anulación pendiente, el sistema deberá mostrar en ese evento la marca "Anulación pendiente".
- **RF-3** — El sistema deberá mostrar los eventos rechazados y "en espera del anterior" con su marca aunque no cuenten en el estado ni en la situación de la vaca, y deberá ofrecer en ellos el acceso a "Pendientes" para reintentar o descartar.
- **RF-4** — Cuando un evento del historial tiene la hora de carga de la tablet y es anterior en **más de 5 minutos** al momento en que el servidor lo registró, el sistema deberá mostrar "Cargado sin conexión el <fecha y hora>" en hora de Argentina; en cualquier otro caso (5 minutos o menos, o sin el dato) no deberá mostrar nada.

### Listado y buscador
- **RF-5** — Mientras un animal tenga una baja pendiente o enviada que la copia todavía no refleja, el sistema deberá mostrarlo en el listado y en el buscador con "Baja pendiente de sincronizar", **con y sin conexión**, sin ocultarlo ni bloquear su acceso a la ficha (que está en solo lectura, spec 011).
- **RF-6** — El sistema no deberá marcar en el listado ni en el buscador ningún otro pendiente (servicio, tacto, parto, secado, anulación) ni deberá mostrar las crías de un parto pendiente como animales.
- **RF-7** — Cuando se descarta la baja pendiente, o cuando la copia nueva ya no trae al animal, el sistema deberá quitar la marca (o el animal, si ya está de baja) del listado y del buscador sin recargar la pantalla a mano.

### Pantalla "Pendientes de sincronizar"
- **RF-8** — El sistema deberá mostrar, de cada pendiente de cualquier tipo: número de la vaca, **resumen de tipo** (el de la 011), fecha del evento, cuándo se cargó (hora de Argentina) y su estado: esperando, enviando, "En espera del anterior" o rechazado con su motivo.
- **RF-9** — El sistema deberá mantener, para cada pendiente, "Reintentar" (rechazado), "Reintentar ahora" (esperando) y "Descartar" con confirmación que nombre vaca, tipo y fecha; si es "en espera del anterior", deberá decirlo y avisar de los posteriores de la misma vaca.
- **RF-10** — Cuando el servidor devolvió avisos al aceptar un pendiente, el sistema deberá mostrarlos con el resumen del pendiente y permitir cerrarlos uno por uno.
- **RF-11** — Cuando un pendiente es rechazado porque la vaca ya no está activa (404), el sistema deberá agregar "Puede que el animal haya sido dado de baja: actualizá los datos y revisá su historial".
- **RF-12** — Mientras el usuario tenga pendientes sin aceptar o avisos sin cerrar, el sistema deberá mostrar el enlace "Pendientes" del menú y permitir abrir la pantalla, **sea cual sea su rol** (incluido el veterinario, con las mismas acciones sobre lo suyo). Sin pendientes ni avisos, un veterinario no deberá ver el enlace ni la pantalla vacía.
- **RF-13** — El sistema deberá seguir mostrando el conteo del menú (rechazados destacados) y las confirmaciones de cierre de sesión y cambio de usuario con la cantidad total, como ya hace la 010.

### Aviso de reloj
- **RF-14** — Si la hora de la tablet es anterior en **más de 5 minutos** a la de la última copia local, entonces el sistema deberá mostrar arriba de cada formulario de carga "El reloj de la tablet parece atrasado: revisá que la fecha sea la correcta".
- **RF-15** — Mientras el reloj parezca atrasado, el sistema deberá dejar el campo fecha de los formularios **vacío, obligatorio y sin máximo**, y deberá pedir que se elija la fecha.
- **RF-16** — Cuando el reloj de la tablet está adelantado, el sistema no deberá detectarlo; la fecha futura la rechaza el servidor (o las reglas locales con el "hoy" de la tablet) con "La fecha no puede ser futura", y el pendiente rechazado se ve en "Pendientes".

### Interfaz y seguridad
- **RF-17** — El sistema deberá mostrar campos y botones de al menos 48 px de alto, sin desborde horizontal a 768 px y 375 px, y usar las variables de color del modo claro y oscuro; las marcas deberán distinguirse también sin depender solo del color (con su texto).
- **RF-18** — El sistema deberá mostrar solo lo pendiente y local del usuario y tambo de la sesión.

## Permisos por rol
| Acción | Dueño | Encargado | Veterinario |
|---|---|---|---|
| Ver marcas del historial y del listado | Sí | Sí | Sí |
| Ver "Pendientes" | Sí | Sí | Sí, solo si tiene pendientes o avisos |
| Reintentar, descartar y cerrar avisos de lo propio | Sí | Sí | Sí (de servicios y tactos) |

## Casos límite
- **Baja pendiente cuya cadena tiene un rechazado delante:** la baja está "en espera"; el listado igual la marca como baja pendiente si cuenta, y si no cuenta (en espera) sigue como activa, con la nota de Pendientes en la ficha (RF-3, RF-5).
- **Veterinario con un aviso del servidor y sin pendientes:** ve el enlace y la pantalla hasta cerrarlo (RF-12).
- **Evento anulado después de cargado sin conexión:** muestra la marca de anulado y "Cargado sin conexión el …" (RF-4).
- **Hora de tablet 4 minutos antes del registro:** no se muestra "Cargado sin conexión" (RF-4).
- **Reloj atrasado y luego corregido:** al recibirse una copia nueva y estar bien el reloj, desaparece el aviso y vuelve la fecha por defecto (RF-14, RF-15).
- **Reloj adelantado:** el pendiente se rechaza por fecha futura y se ve en "Pendientes" (RF-16).
- **Pendiente rechazado por animal que ya no está activo:** se muestra la ayuda (RF-11).
- **Descartar un "en espera del anterior":** pide confirmación con vaca, tipo y fecha (RF-9).
- **Número de un animal con baja pendiente reutilizado por una cría cargada después:** el buscador devuelve un solo animal (el de la baja pendiente) (RF-5, RF-6).
- **Otro usuario o tambo en la misma tablet:** lo ajeno nunca se ve (RF-18).

## Cómo se verifica
- **Vitest en la web, con reloj inyectable** (lógica pura):
  - El cálculo de la **marca** de cada evento según su estado, incluido "Anulación pendiente" (RF-1 a RF-3).
  - La **regla de "Cargado sin conexión"** con 4, 5 y 6 minutos de diferencia y sin el dato (RF-4).
  - Qué animales del listado y del buscador llevan "Baja pendiente de sincronizar" con y sin conexión, que ningún otro pendiente marca y que las crías no figuran (RF-5 a RF-7).
  - **Condición del enlace y de la pantalla "Pendientes"** por rol, con pendientes, con avisos y sin nada (RF-12).
  - **Detección del reloj atrasado** con 4, 5 y 6 minutos de diferencia con la copia, y qué valores reciben el campo fecha (vacío, obligatorio, sin máximo) (RF-14, RF-15).
  - Los resúmenes y la ayuda de rechazo por vaca no activa (RF-8, RF-11).
- **A mano en el navegador, con la red cortada** (768 px y 375 px, modo claro y oscuro): historial con cada marca; listado y buscador con una baja pendiente; "Pendientes" con cada tipo, rechazo, avisos y "Descartar" de uno en espera; el veterinario con y sin pendientes o avisos; el aviso de reloj atrasado cambiando la hora del dispositivo; controles de 48 px y sin desborde.

## Criterios de aceptación
- [ ] El historial muestra todas las marcas (pendiente, enviado, rechazado, en espera, anulación pendiente) y "Cargado sin conexión el …" solo pasados 5 minutos (RF-1 a RF-4).
- [ ] El listado y el buscador marcan solo la baja pendiente, con y sin señal, y quitan la marca al resolverse (RF-5 a RF-7).
- [ ] "Pendientes" muestra el resumen completo, la ayuda de rechazo y los avisos cerrables, y la ve el veterinario cuando corresponde, con el enlace del menú coherente con la pantalla (RF-8 a RF-13).
- [ ] El aviso de reloj atrasado aparece con el umbral de 5 minutos y los formularios piden elegir la fecha (RF-14 a RF-16).
- [ ] 768 px y 375 px, modo claro y oscuro, controles de 48 px y marcas legibles sin depender del color (RF-17, RF-18).

## Preguntas abiertas
Ninguna.
