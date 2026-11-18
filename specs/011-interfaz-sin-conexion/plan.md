# Plan — 011 Formularios de carga sin conexión y adaptador de la ficha

Spec: [spec.md](spec.md)

## Resumen
Es solo web: la API, la base y las reglas de la 010 no cambian. Se agrega un **adaptador puro** que, con la copia de la vaca más sus pendientes y enviados (la vista local de la 010), arma las mismas formas de datos que hoy leen la ficha, la sección de reproducción y el historial. Las lecturas de esas pantallas pasan por el adaptador cuando corresponde (sin conexión, o con pendientes sin aceptar de esa vaca). Los formularios dejan de llamar a la API directo y guardan siempre con el **punto único de registro** de la 010 (`registrar` y `anularLocal`, ya expuestos por `useCola()`). Sin dependencias nuevas.

## Base de datos
Sin cambios (no hay migración).

## API
Sin cambios. Las rutas de carga y anulación existentes las usa el motor de la 010 al enviar. Aislamiento y permisos: ya cubiertos por la 010 (RF-10 y RF-11 de esa spec); esta spec no agrega rutas.

## Interfaz

### Fuente de datos de la ficha (RF-18, RF-19)
Un solo lugar decide: la función que hoy resuelve de la copia las lecturas de la lista cerrada (en `web/src/compartido/api.ts`, que usa `copiaLocal.ts` y `lecturaLocal.ts`) pasa a consultar también los pendientes y enviados del usuario de la sesión local. Para las tres lecturas `/animales/:id`, `/animales/:id/eventos` y `/animales/:id/historial`:

| Situación | Fuente |
|---|---|
| Sin conexión | Adaptador: copia + pendientes que cuentan + enviados no reflejados |
| Con conexión y la vaca sin pendientes sin aceptar (esperando, enviando, en espera, rechazado) | Servidor (como hoy; los enviados ya están allá) |
| Con conexión y la vaca con algún pendiente sin aceptar | Adaptador (el servidor todavía no los conoce) |

Rechazados y "en espera" no cuentan en el estado ni la situación (los descarta `entradasValidas`), pero su existencia hace que la fuente sea el adaptador y activan la nota "Esta vaca tiene N pendientes sin aceptar: revisalos en Pendientes". Las demás rutas (listado, buscador, producción) no cambian.

### Adaptador (`web/src/sinconexion/adaptadorFicha.ts`, lógica pura)
Entrada: la copia de un animal (`AnimalCopia`), las entradas válidas (`entradasValidas`), los pendientes sin aceptar de la vaca (para la nota), el semen de la copia, el nombre del usuario de la sesión, el "hoy" de Argentina y el reloj. Salida: la ficha, las eventos con su situación y el historial con la forma de la API, más campos opcionales nuevos en esos tipos de `api.ts`:
- **Ficha:** `estado` de la vista (EN_ORDENE por parto pendiente, SECA por secado pendiente, BAJA por baja pendiente o enviada no reflejada), el **lote no cambia**; `locales?: { sinAceptar: number; avisoLotePendiente: boolean; bajaPendiente?: { id; estado: 'esperando' | 'enviando' | 'enEspera' | 'enviada' } }`.
- **Situación y eventos:** salen de `construirVista` / `calcularSituacion`. Un mapeo convierte la forma local a `SituacionReproductiva`; si ya coincide se usa directo. Para una vaca sin pendientes devuelve exactamente la situación de la copia (test de paridad).
- **Historial:** las entradas de la copia más cada evento pendiente (esperando o enviando) como entrada `EVENTO` con `pendiente: true` en el evento, ubicado por fecha y orden de carga (más reciente primero); los enviados que la copia no trae, igual pero sin `pendiente`. `ultimoEventoNoAnuladoId` sale de la vista. Un evento con anulación pendiente se muestra como anulado (`anulacion` con el motivo, el usuario de la sesión y la hora de carga); la marca "Anulación pendiente" es de la 012.
- **Datos del evento pendiente** (decisión de la spec): `registradoPor` = nombre del usuario de la sesión; `loteAnterior` y `genetica` quedan en `null` y la pantalla lee "Se completa al sincronizar" cuando el evento es `pendiente`; el estado anterior sale de la vista; el semen de un servicio, de la copia.
- **Parto pendiente:** crías dentro del parto (`animal: null` y un campo `numeroPendiente` con el número; sin enlace), `locales.avisoLotePendiente: true`. Las crías no aparecen en el listado ni el buscador porque esas lecturas no usan el adaptador.
- **Nombre del usuario:** `fijarPropietarioLocal` (que ya recibe usuario y tambo) pasa a recibir también el nombre, o el componente lo agrega desde `useAuth()`; lo más simple que quede.

### Refresco (RF-25)
Un pequeño hook `useVersionCola()` (en `web/src/sinconexion/`) devuelve un texto que cambia cuando cambian los pendientes, los enviados o la copia (`generadaEn`); `AnimalFicha`, `Reproduccion` e `Historial` lo suman a las dependencias de sus efectos de lectura. No cierra formularios abiertos (los efectos no tocan el estado de los paneles).

### Guardado de las cargas (RF-8 a RF-15)
- **`web/src/sinconexion/formularioRechazo.ts` (puro):** convierte un resultado de `registrar`/`anularLocal` (`rechazado` local o del servidor, `sinLugar`) en `{ campos, general }` con la misma forma que `interpretar()` de `reproduccionDatos.ts`. Si hay campo y está dibujado, va al campo; si no, a la alerta general (el formulario le pasa la lista de campos que dibuja). `sinLugar` usa el texto "No se pudo guardar en la tablet: <motivo>. Conectate para sincronizar los pendientes" (si el mensaje de la 010 ya lo trae, se usa tal cual).
- **`web/src/sinconexion/useGuardarCarga.ts`:** hook que envuelve `useCola().registrar`: maneja "Guardando…" (un solo envío a la vez; el botón y "Cancelar" deshabilitados hasta los 10 s del tope de la 010), devuelve el resultado ya traducido y arma el texto de confirmación ("Guardado en la tablet: pendiente de sincronizar" + resumen; o el título de hoy si se aceptó en el momento). Si el animal no está en la copia, el texto de RF-12.
- **`web/src/sinconexion/resumenPendiente.ts` (puro):** texto de resumen por tipo (RF-16): "Servicio", "Tacto preñada"/"Tacto vacía", "Parto con 1 cría", "Parto con 2 crías (1 nacida muerta)", "Secado", "Baja por venta"/"Baja por muerte", "Anulación de tacto". La 012 lo reutiliza en "Pendientes".
- **Parto aceptado en el momento:** `registrar` devuelve hoy solo los avisos. Para no perder los enlaces "Ver la ficha de la cría" con señal, se agrega al resultado `enviado` un campo opcional `evento` con el cuerpo ya validado por `clasificar.ts` (cambio chico en `registrar.ts` y `clasificar.ts`, sin tocar reglas ni los tests de la 010). Si cuesta más que eso, se acepta mostrar solo los avisos y que las crías se vean en el historial.

### Pantallas
- **`Reproduccion.tsx`:** `FormServicio` y `FormTacto` guardan con `useGuardarCarga`; los botones ya no dependen de `enLinea` y se muestran según la vista y el rol. El catálogo de semen sale de `api('/semen')` (con señal) o de la copia (sin conexión; la copia ya trae el semen activo desde la 010, y la lectura de `/semen` debe resolverse de ahí — si la lista cerrada de `copiaLocal.ts` no lo incluye, se agrega esa lectura). Se quita la nota "Esto necesita conexión" de estos botones.
- **`FormParto.tsx`:** sin campo de observaciones del parto (ya no las tiene); una o dos crías; con dos crías, ayuda "Un parto admite hasta 2 crías"; guarda con `useGuardarCarga`. Su manejo de errores sueltos (`crias`) se conserva con `formularioRechazo`.
- **`FormSecado.tsx`, `FormBaja.tsx`:** igual con `useGuardarCarga`. `FormBaja`: con baja aceptada en el momento navega a `/bajas/:id` como hoy; si queda pendiente, se queda en la ficha y muestra "Guardado en la tablet: pendiente de sincronizar" (la ficha pasa sola a solo lectura, ver abajo).
- **`Historial.tsx`:** `FilaEvento` anula con `useCola().anularLocal` (motivo obligatorio). Si el evento es `pendiente` (o hay anulación pendiente de él) muestra "Descartar" con `Confirmar` (nombra vaca, tipo y fecha; usa `resumenPendiente`) y, si `anularLocal` devuelve `posteriores`, los lista. Muestra la marca "Pendiente de sincronizar" y, en eventos pendientes, "Se completa al sincronizar" en lugar de lote anterior y genética. El "Anular" por rol (veterinario solo servicio y tacto) se mantiene. Los textos de hora usan la implementación única de Argentina.
- **`AnimalFicha.tsx`:** si `ficha.locales.bajaPendiente` existe → solo lectura (sin Editar/Mover/Baja, sin Reproducción cargable ni litros) con "Baja pendiente de sincronizar", "Descartar baja" (esperando, enviando, en espera) o "Baja enviada: se confirma al actualizar"; si `locales.sinAceptar > 0` y no es baja pendiente → nota con enlace a `/pendientes`. Aviso "El lote se asigna al sincronizar" si `avisoLotePendiente`. Con conexión ya no se deshabilitan Editar/Mover (siguen necesitando conexión: se mantienen deshabilitados sin señal) pero "Dar de baja" sí está disponible sin señal. `Produccion.tsx` usa el estado ya adaptado (`enOrdene`).
- **Estilos:** reutilizar clases existentes (`formulario-evento`, `resultado-registro`, `aviso`, `etiqueta-estado`, `Confirmar`); si falta algo, agregar a `estilos.css` con las variables del tema y controles de 48 px.

### Hora de Argentina (RF-26)
`horaArgentina.ts` (resta fija UTC-3) es la única implementación. Se exportan `fechaIsoArgentina(d)` y `formatearFechaHoraArgentina(d)` y se hacen delegar: `fechaArgentinaIso` y `hoyIso` en `reproduccionDatos.ts`, `textoMomento` en `Historial.tsx` y en `produccionDatos.ts`, y `formatearFechaHora` en `fechaHora.ts` (mismos textos de salida que hoy: dd/mm/aaaa hh:mm). Cambia solo cómo se calcula; los resultados en Argentina son los mismos y ya no dependen del huso del dispositivo.

## Archivos
- Crear:
  - `web/src/sinconexion/adaptadorFicha.ts`, `formularioRechazo.ts`, `useGuardarCarga.ts`, `resumenPendiente.ts`, `useVersionCola.ts`
  - Tests en `web/tests/`: `adaptador-ficha.test.ts`, `resumen-pendiente.test.ts`, `formulario-rechazo.test.ts`, `hora-argentina.test.ts`
- Modificar:
  - `web/src/compartido/api.ts` (tipos opcionales nuevos; fuente de las tres lecturas), `web/src/sinconexion/lecturaLocal.ts` y `copiaLocal.ts` si hace falta (semen, nombre del usuario)
  - `web/src/sinconexion/horaArgentina.ts`, `fechaHora.ts`, `registrar.ts`, `clasificar.ts` (campo `evento` opcional)
  - `web/src/reproduccion/Reproduccion.tsx`, `FormParto.tsx`, `FormSecado.tsx`, `reproduccionDatos.ts`
  - `web/src/bajas/FormBaja.tsx`, `web/src/historial/Historial.tsx`, `web/src/animales/AnimalFicha.tsx`, `web/src/produccion/produccionDatos.ts`
  - `web/src/estilos.css` solo si hace falta
  - Al cierre: `MEMORY.md` y `docs/plan.md`

## Decisiones
- **Adaptador puro con las mismas formas que la API** — así las pantallas casi no cambian y se prueba con Vitest sin React. Alternativa descartada: que cada pantalla combine copia y pendientes por su cuenta; duplicaría lógica en tres lugares y no sería testeable.
- **Decidir la fuente en la capa de lecturas (`api.ts`)** — un único punto, ya existente, para las tres lecturas. Alternativa descartada: un hook de datos nuevo en cada pantalla; obligaría a reescribir las pantallas y a mantener dos caminos de lectura.
- **Con señal y pendientes sin aceptar, manda la vista local** — el servidor no los conoce y la ficha mostraría algo falso. Alternativa descartada: mostrar el servidor y una lista aparte de pendientes; el usuario no vería el efecto de lo que cargó (por ejemplo vaca "seca").
- **Rechazados y "en espera" no entran al adaptador** como eventos (es la regla de la 010); se avisan con una nota. Alternativa descartada: mostrarlos en el historial ya; son las marcas de la 012.
- **`registradoPor` es el usuario de la sesión y lote anterior/genética quedan "Se completa al sincronizar"** — el servidor los calcula al aceptar. Alternativa descartada: inventar un lote anterior desde la copia; puede ser falso si hay pendientes delante.
- **Un solo hook de guardado (`useGuardarCarga`) y una conversión de rechazos (`formularioRechazo`)** — los cinco formularios y la anulación se comportan igual. Alternativa descartada: copiar el manejo de errores de `interpretar` en cada formulario.
- **Siempre `registrar`, también con señal** (decisión del usuario) — un solo flujo probado. Alternativa descartada: usar `api()` con señal y `registrar` sin ella; dos caminos con reglas distintas.
- **Hora de Argentina por resta fija en un solo módulo** — no depende del huso del navegador y es fácil de probar. Alternativa descartada: dejar las implementaciones con `Intl`; hoy dan lo mismo pero son tres y no hay forma de fijar su comportamiento con un test.
- **Baja pendiente: ficha en solo lectura con "Descartar baja"** — además de "Pendientes". Alternativa descartada: solo en "Pendientes"; la persona que cargó la baja por error está parada en la ficha.
- **Sin dependencias nuevas.** `Confirmar`, `Campo`, `useCola` y `registrar` ya existen.

## Estrategia de tests
Vitest en `web/tests/` (entorno Node, lógica pura, con reloj y conexión inyectables), siguiendo el estilo de `vista-local.test.ts` y `registrar.test.ts`. Las pantallas no tienen tests de componentes (el proyecto no los usa); se verifican en el navegador.

| RF | Test (archivo › caso) |
|---|---|
| RF-16 | `resumen-pendiente.test.ts` › un caso por tipo; parto con 1 cría, con 2, con nacidas muertas, baja por venta y por muerte, anulación de cada tipo |
| RF-11, RF-10, RF-12 | `formulario-rechazo.test.ts` › rechazo local con campo, del servidor con campos, campo no dibujado (va a la alerta), `sinLugar`, animal fuera de la copia |
| RF-18 | `adaptador-ficha.test.ts` › fuente: sin conexión, con conexión sin pendientes, con pendientes sin aceptar, con solo enviados (función pura de decisión) |
| RF-19, RF-22, RF-23 | `adaptador-ficha.test.ts` › estado y situación con servicio, tacto, secado, parto y baja pendientes; rechazado y en espera no cuentan; vaca sin pendientes = situación de la copia (paridad) |
| RF-20 | `adaptador-ficha.test.ts` › evento pendiente con `registradoPor` del usuario, `pendiente: true`, lote anterior y genética en `null`; orden por fecha y carga; anulación pendiente como anulado; `ultimoEventoNoAnuladoId` |
| RF-21 | `adaptador-ficha.test.ts` › parto con 2 crías (una nacida muerta) dentro del parto, aviso de lote, madre en ordeñe, crías fuera del listado (el listado no usa el adaptador) |
| RF-23, RF-24 | `adaptador-ficha.test.ts` › baja pendiente en cada estado (esperando, enviando, en espera, enviada); `locales.sinAceptar` con rechazados |
| RF-26 | `hora-argentina.test.ts` › con el huso del proceso en Asia/Tokyo y en America/New_York y un reloj inyectado cerca de la medianoche argentina: "hoy", turno, y el texto de fecha y hora de `fechaHora`, `Historial` y `produccionDatos` dan los de Argentina |
| RF-13, RF-14 | `adaptador-ficha.test.ts` / `permisos.test.ts` existente › qué se ofrece según la vista y el rol (función pura que decide los botones, si se extrae) |
| RF-6, RF-7 | `anular-local.test.ts` (existe, spec 010) cubre la lógica; la UI se verifica a mano |
| RF-1 a RF-5, RF-8, RF-9, RF-15, RF-17, RF-25, RF-27, RF-28 | En el navegador con la red cortada (ver tareas); RF-15 también por `registrar.test.ts` (010) |
| Regresión | `casos-compartidos.test.ts`, `registrar.test.ts`, `vista-local.test.ts` y `npm test` de la API siguen en verde |

## Riesgos
- **Cambiar la capa de lecturas de `api.ts`** puede romper la consulta sin conexión de la 009: los tests de `copia.test.ts`/`buscador-local.test.ts` y una pasada a mano sin conexión lo cubren.
- **La forma local de la situación puede no coincidir** con `SituacionReproductiva`: el test de paridad con una vaca sin pendientes lo detecta.
- **El evento aceptado en el momento (`evento` opcional)** toca `registrar.ts`/`clasificar.ts` de la 010: el cambio es aditivo y sus tests no se editan; si algo choca, se acepta mostrar solo los avisos.
- **Cambiar el huso del proceso en un test** puede no tomar efecto en algún entorno: el test también fija instantes concretos y verifica que las funciones no usan getters locales de `Date`.
- **Vacas sin conexión con `/semen`:** si la lista cerrada de lecturas no resuelve `/semen`, el formulario de servicio no tendría catálogo; se agrega esa lectura a `copiaLocal.ts` (la copia ya trae el semen).
