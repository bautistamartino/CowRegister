# Plan — 012 Marcas de lo pendiente, "Pendientes" ampliada y aviso de reloj

Spec: [spec.md](spec.md)

## Resumen
Es solo web: la API, la base y las reglas de la 010 no cambian (sin migración, sin rutas nuevas, sin dependencias nuevas). Se apoya en lo que dejó la 011: el adaptador de la ficha (`adaptadorFicha.ts`), `resumenPendiente.ts`, `horaArgentina.ts`, `useVersionCola.ts` y la pantalla `Pendientes.tsx`. Primero se escribe la **lógica pura con tests** (marcas del historial, "Cargado sin conexión", marca del listado, condición del enlace "Pendientes", reloj atrasado, ayudas de rechazo) y después se la conecta a las pantallas existentes: historial, listado y buscador, "Pendientes" y menú, y los cinco formularios de carga.

## Base de datos
Sin cambios (no hay migración). IndexedDB tampoco cambia de versión: no se agregan campos a los pendientes, enviados ni avisos guardados.

## API
Sin cambios. Aislamiento y permisos ya cubiertos por la 010 (RF-10 y RF-11 de esa spec); esta spec no agrega rutas. RF-18 (solo lo propio) se cumple porque todo sale de `useCola()` y de `leerContextoFicha()`, que ya filtran por usuario y tambo de la sesión local.

## Interfaz

### 1. Marcas del historial (RF-1 a RF-4)
- **Dónde se calculan:** en el adaptador (`adaptadorFicha.ts`), no en la pantalla. Se suman al tipo `EventoReproductivo` (`web/src/compartido/api.ts`) dos campos opcionales que nunca vienen de la API:
  - `marca?: { estado: 'pendiente' | 'enviado' | 'rechazado' | 'enEspera'; motivo?: string }`
  - `anulacionPendiente?: boolean`
  El campo `pendiente` de la 011 se conserva (true en esperando y enviando) para no tocar lo que ya anda.
- **Eventos que hoy no se ven:** `entradasValidas` descarta los rechazados y los "en espera del anterior", por eso el historial no los mostraba. El adaptador los agrega **aparte** como entradas `EVENTO` con su marca, ubicados por fecha y orden de carga como los demás, **sin** pasar por `construirVista`: así no cambian el estado, la situación ni `ultimoEventoNoAnuladoId` (RF-3). Para armarlos se extrae de `armarEvento` una función que construye un `EventoReproductivo` desde un `Pendiente` (servicio, tacto, parto, secado y baja; las anulaciones rechazadas o en espera no son un evento y quedan solo en "Pendientes" y en la nota de la ficha).
- **Marca por estado:** esperando o enviando -> `pendiente`; enviado que la copia no refleja -> `enviado`; rechazado (con `motivo`) -> `rechazado`; "en espera del anterior" (`estadoVisible`) -> `enEspera`. `anulacionPendiente` es true si hay una anulación esperando o enviando de ese evento (la anulación enviada ya se ve como "Anulado").
- **Textos exactos** (en `marcasHistorial.ts`, puro): "Pendiente de sincronizar", "Enviado: se confirma al actualizar", "Rechazado: <motivo>", "En espera del anterior", "Anulación pendiente". Se dibujan como etiquetas con texto (`etiqueta-estado`, con una variante para rechazado), así se distinguen sin depender del color (RF-17).
- **Rechazados y en espera:** además de la marca llevan el enlace "Ver en Pendientes" (`/pendientes`) para reintentar o descartar. No llevan "Anular" ni "Descartar" en la fila (eso se hace en la pantalla Pendientes).
- **Detalle del parto, genética y lote anterior:** hoy `DetalleParto` decide con `evento.pendiente`; un parto **enviado** (pendiente false) mostraría sus crías como "nacida muerta". Se cambia a "tiene alguna marca" (`!!evento.marca`) para los tres casos (cualquier evento que el servidor todavía no confirmó muestra "Se completa al sincronizar" y las crías sin enlace).
- **"Cargado sin conexión el <fecha y hora>" (RF-4):** función pura `textoCargadoSinConexion(registradoEn, cargadoEnDispositivo)` que devuelve el texto solo si la hora de la tablet es **anterior en más de 5 minutos** al registro en el servidor (exactamente 5 no cuenta), en hora de Argentina (`formatearFechaHoraArgentina`); sin alguno de los dos datos, `null`. Los eventos que vienen del servidor o de la copia traen ambos datos (la 010 ya devuelve `cargadoEnDispositivo`). En los pendientes y enviados del adaptador el registro es la misma hora de carga o falta el dato, así que no muestran nada. Se muestra también en un evento anulado.

### 2. Listado y buscador (RF-5 a RF-7)
- **Lógica pura (`marcasListado.ts`):**
  - `animalesConBajaPendiente(pendientes, enviados)`: ids de animales con una baja que **cuenta** (esperando o enviando, no "en espera del anterior" ni rechazada, según la vista local de la 010) o con una baja enviada que la copia todavía no refleja.
  - `marcarListado(listado, ids)`: agrega `bajaPendiente: true` a esas filas (campo opcional nuevo en el tipo `Animal`) y no toca ninguna otra fila. No marca servicios, tactos, partos, secados ni anulaciones, y como las crías pendientes no existen en el listado (ni la copia ni el servidor las traen) no aparecen (RF-6).
  - `completarConBajasEnviadas(listado, enviados, animalesCopia, filtros)`: con señal, el servidor ya no trae al animal cuya baja se **aceptó** (ya está de baja allá); mientras la copia siga trayéndolo, la tablet lo vuelve a sumar desde la copia (respetando los filtros de estado y lote) con su marca, para cumplir el RF-5 "con y sin conexión". Sin señal el listado sale de la copia y ya lo trae.
- **`Animales.tsx`:** usa `useCola()` (`pendientes`, `enviados`) y `useVersionCola()` en las dependencias del efecto de lectura: el listado se relee solo cuando cambia la cola o la copia (RF-7: al descartar la baja o al llegar una copia que ya no trae al animal, la marca o la fila se van sin recargar a mano). La marca "Baja pendiente de sincronizar" va **dentro de la celda del número**, debajo del enlace, como etiqueta con texto: sin columna nueva, sin desborde a 375 px (la tabla ya tiene su contenedor con scroll). La fila sigue siendo un enlace a la ficha (solo lectura, spec 011).
- **Buscador:** `Buscador.tsx` navega directo a la ficha, y la ficha del animal con baja pendiente ya muestra "Baja pendiente de sincronizar" arriba (011). Para que RF-5 valga también con señal cuando la baja ya fue **enviada**, el buscador, ante un 404 del servidor, busca ese número entre las bajas enviadas locales (`animalConBajaEnviada(numero, enviados)`, puro) y, si lo encuentra, navega igual a la ficha. Si el número lo reutilizó una cría pendiente, el resultado sigue siendo un solo animal (el de la baja), porque las crías pendientes no están en ningún buscador (RF-6). No se agrega una pantalla de resultados: se mantiene el flujo del bastón (número + Enter va a la ficha).

### 3. Pantalla "Pendientes de sincronizar" y menú (RF-8 a RF-13)
- **Resumen completo:** `Pendientes.tsx` deja de usar sus textos mínimos (`TEXTO_TIPO`, `textoTipo`, `resumen`) y usa `resumenPendiente.ts` de la 011. Se agrega ahí una función pura `resumenCompleto(p)` -> "Vaca 214 · Parto con 2 crías (1 nacida muerta)" (los litros siguen como "Vaca N · fecha · turno · L"). Cada fila muestra: número, resumen, **fecha del evento** (nuevo: `datos.fecha`), "Cargado el <hora de Argentina>" y el estado (esperando, enviando, "En espera del anterior" o "Rechazado: <motivo>").
- **Descartar:** la confirmación nombra vaca, tipo y **fecha** ("Vaca 214: Tacto preñada del 10/11/2026"); si es "en espera del anterior" lo dice y avisa de los posteriores de la misma vaca (ya existe: se mantiene y se prueba).
- **Ayuda ante rechazo 404:** función pura `ayudaRechazo(p)` que devuelve "Puede que el animal haya sido dado de baja: actualizá los datos y revisá su historial" si el rechazo es 404; se muestra bajo el motivo. (Limitación aceptada: un 404 por otro recurso, como un semen eliminado, recibe la misma ayuda; el texto dice "puede que".) La ayuda del duplicado de litros (409) se conserva.
- **Avisos del servidor:** cada aviso muestra el resumen del pendiente. `AvisoGuardado` no guarda los datos del pendiente (y no se cambia el formato de IndexedDB), así que el resumen se arma buscando el enviado con el mismo `id` en `useCola().enviados` (sigue ahí hasta que la copia lo refleje); si ya no está, se usa el texto del tipo ("Vaca 214 · Parto"). Se cierran de a uno como hoy.
- **Una sola condición para el enlace y la pantalla (RF-12):** función pura `mostrarPendientes({ rol, total, avisos })` en `condicionPendientes.ts`: verdadero si el rol carga litros (dueño y encargado), o hay pendientes sin aceptar (`total > 0`), o hay avisos sin cerrar. `Layout.tsx` la usa para el enlace (reemplaza `puedeCargar || pendientes > 0`, que no miraba los avisos) y `Pendientes.tsx` para decidir entre mostrarse o redirigir a `/`. Mantiene el conteo del menú con los rechazados destacados y las confirmaciones de cierre de sesión y cambio de usuario con la cantidad total, sin cambios (RF-13).
- **Veterinario:** sin pendientes ni avisos no hay enlace ni pantalla vacía; con alguno, ve el enlace y la pantalla con las mismas acciones sobre lo suyo.

### 4. Aviso de reloj atrasado (RF-14 a RF-16)
- **Lógica pura (`relojTablet.ts`, con reloj inyectable):**
  - `relojAtrasado(ahora, generadaEn)`: verdadero si `ahora` es anterior a `generadaEn` por **más de 5 minutos** (5 exactos no; sin copia, `generadaEn` nulo, no hay aviso).
  - `opcionesFecha(atrasado, hoy)`: bien -> `{ valorInicial: hoy, max: hoy, obligatorio: true }`; atrasado -> `{ valorInicial: '', max: undefined, obligatorio: true }`. El mínimo (`FECHA_MINIMA`) no cambia.
- **Hook `useRelojTablet()`** (`web/src/sinconexion/`): lee `generadaEn` de `useSinConexion()` y devuelve `{ atrasado, fechaInicial, fechaMaxima }`. Se calcula al montar el formulario y cada vez que cambia `generadaEn`, así, al llegar una copia nueva con el reloj bien, el aviso se va y vuelve la fecha por defecto (caso límite de la spec).
- **Componente `AvisoReloj`:** "El reloj de la tablet parece atrasado: revisá que la fecha sea la correcta" (clase `aviso`, `role="status"`), arriba de **cada formulario de carga**: servicio, tacto (ambos en `Reproduccion.tsx`), `FormParto`, `FormSecado` y `FormBaja`. No es un cartel global. Con el reloj atrasado el campo fecha queda vacío, obligatorio y sin `max`, con la ayuda "Elegí la fecha del evento". Los formularios cuya fecha era estado (`FormBaja`, el tacto) arrancan con `''`.
- **Reloj adelantado (RF-16):** no se detecta. Lo rechaza el servidor o las reglas locales con "La fecha no puede ser futura" y el pendiente rechazado se ve en "Pendientes" (ya funciona; se prueba a mano). Riesgo aceptado en la spec.
- Los formularios que no son de carga de eventos (producción de litros, informes, edición de animal) no cambian.

### 5. Interfaz y estilos (RF-17)
Se reutilizan `etiqueta-estado`, `etiqueta-pendiente`, `aviso`, `evento`, `acciones`, `boton-secundario` y `enlace-boton`; si falta una variante (por ejemplo `etiqueta-rechazado` para el historial o `etiqueta-baja-pendiente` para el listado) se agrega a `estilos.css` con las variables de color del modo claro y oscuro. Los enlaces y botones nuevos son de 48 px. Toda marca lleva su texto.

## Archivos
- Crear:
  - `web/src/sinconexion/marcasHistorial.ts` (textos de las marcas y `textoCargadoSinConexion`)
  - `web/src/sinconexion/marcasListado.ts` (`animalesConBajaPendiente`, `marcarListado`, `completarConBajasEnviadas`, `animalConBajaEnviada`)
  - `web/src/sinconexion/condicionPendientes.ts` (`mostrarPendientes`)
  - `web/src/sinconexion/relojTablet.ts`, `useRelojTablet.ts`, `AvisoReloj.tsx`
  - Tests en `web/tests/`: `marcas-historial.test.ts`, `marcas-listado.test.ts`, `condicion-pendientes.test.ts`, `reloj-tablet.test.ts`
- Modificar:
  - `web/src/compartido/api.ts` (campos opcionales `marca`, `anulacionPendiente` en `EventoReproductivo` y `bajaPendiente` en `Animal`)
  - `web/src/sinconexion/adaptadorFicha.ts` (marcas, rechazados y en espera en el historial)
  - `web/src/sinconexion/resumenPendiente.ts` (`resumenCompleto`, `ayudaRechazo`)
  - `web/src/historial/Historial.tsx` (marcas, "Cargado sin conexión", enlace a Pendientes, `DetalleParto` por `marca`)
  - `web/src/animales/Animales.tsx`, `web/src/animales/Buscador.tsx`
  - `web/src/sinconexion/Pendientes.tsx`, `web/src/compartido/Layout.tsx`
  - `web/src/reproduccion/Reproduccion.tsx` (servicio y tacto), `FormParto.tsx`, `FormSecado.tsx`, `web/src/bajas/FormBaja.tsx`
  - `web/src/estilos.css` (solo si falta alguna variante)
  - Tests existentes que se extienden: `web/tests/adaptador-ficha.test.ts`, `web/tests/resumen-pendiente.test.ts`
  - Cierre: `MEMORY.md`, `docs/plan.md`, tildar los criterios de `spec.md`

## Decisiones
- **Marcas calculadas en el adaptador con campos opcionales nuevos (`marca`, `anulacionPendiente`)** — así Historial solo dibuja y la lógica queda con tests puros. Alternativa descartada: calcular la marca dentro de `Historial.tsx` cruzando `useCola()` con los eventos, porque duplicaría la lógica de estados y no se podría probar sin React.
- **Rechazados y "en espera" entran al historial por fuera de la vista** — no cambian estado ni situación (RF-3). Alternativa descartada: dejarlos pasar por `construirVista`, porque rompería la regla de la 010 de que no cuentan.
- **Un solo estilo de marca por texto, sin columna nueva en el listado** — la etiqueta va en la celda del número. Alternativa descartada: una columna "Marca" en la tabla, porque agrega ancho (riesgo de desborde a 375 px) para un caso raro.
- **El buscador sigue llevando directo a la ficha** — la marca se ve ahí y se conserva el flujo del bastón. Alternativa descartada: mostrar un resultado intermedio con la marca, porque agrega un paso por cada lectura de un animal normal.
- **Con señal, la baja enviada se vuelve a sumar al listado desde la copia** — cumple el RF-5 "con y sin conexión". Alternativa descartada (la más simple y la que insinúa la decisión técnica de la spec): que desaparezca apenas el servidor la acepta; contradice el RF-5 y hace "saltar" al animal durante la ventana en que la ficha todavía dice "Baja enviada".
- **El resumen de un aviso sale del `Enviado` con el mismo `id`** — no cambia el formato de IndexedDB. Alternativa descartada: guardar el resumen dentro de `AvisoGuardado` (nueva versión de IndexedDB y migración) por una mejora de texto.
- **La condición del enlace "Pendientes" es una función pura compartida por el menú y la pantalla** — evita que vuelvan a divergir. Alternativa descartada: arreglar cada lugar por separado.
- **Reloj atrasado: se compara con `generadaEn` al montar el formulario** (no un temporizador) — suficiente porque el reloj se corrige entre cargas. Alternativa descartada: un reloj en vivo con intervalo, que re-renderizaría formularios con datos escritos para un caso raro.
- **Anulaciones rechazadas o en espera sin marca en el historial** — no son un evento y el servidor no las muestra; se ven en "Pendientes" y en la nota de la ficha. Alternativa descartada: una marca "Anulación rechazada" en el evento, que no pide la spec.

## Estrategia de tests
Todo con Vitest en `web/tests/` (entorno Node, lógica pura, reloj inyectable; no se agregan librerías de tests de React). La parte visual se verifica en el navegador.

| RF | Test (archivo › caso) |
|---|---|
| RF-1 | `marcas-historial.test.ts` › marca de un pendiente esperando o enviando, de un enviado que la copia no trae, de un rechazado (con motivo) y de uno en espera; `adaptador-ficha.test.ts` › esos eventos aparecen en el historial con su marca |
| RF-2 | `marcas-historial.test.ts` › anulación esperando o enviando marca "Anulación pendiente"; una enviada no |
| RF-3 | `adaptador-ficha.test.ts` › rechazado y en espera aparecen en el historial pero no cambian estado, situación ni `ultimoEventoNoAnuladoId`; el parto enviado no muestra sus crías como nacidas muertas |
| RF-4 | `marcas-historial.test.ts` › "Cargado sin conexión" con 4, 5 y 6 minutos de diferencia, sin el dato, formato en hora de Argentina, evento anulado |
| RF-5 | `marcas-listado.test.ts` › baja esperando, enviando y enviada marcan; en espera y rechazada no; con y sin conexión (`completarConBajasEnviadas` respeta los filtros); `animalConBajaEnviada` encuentra el número |
| RF-6 | `marcas-listado.test.ts` › servicio, tacto, parto, secado y anulación no marcan; las crías de un parto pendiente no figuran; número reutilizado por una cría: una sola fila |
| RF-7 | `marcas-listado.test.ts` › al descartar la baja o al reflejarla la copia, la marca (o la fila reinyectada) desaparece; relectura automática: a mano |
| RF-8 | `resumen-pendiente.test.ts` › `resumenCompleto` de cada tipo, con la fecha del evento |
| RF-9 | `dependencias.test.ts` (ya existe) para "en espera" y posteriores; texto de la confirmación con vaca, tipo y fecha: a mano |
| RF-10 | `resumen-pendiente.test.ts` › resumen de un aviso con y sin el enviado a mano |
| RF-11 | `resumen-pendiente.test.ts` › `ayudaRechazo` con 404, con otros códigos y sin rechazo |
| RF-12 | `condicion-pendientes.test.ts` › dueño, encargado y veterinario, con pendientes, con avisos y sin nada |
| RF-13 | Tests existentes de la cola (conteo) siguen en verde; menú y confirmaciones: a mano |
| RF-14 | `reloj-tablet.test.ts` › `relojAtrasado` con 4, 5 y 6 minutos, sin copia y reloj adelantado (no detecta) |
| RF-15 | `reloj-tablet.test.ts` › `opcionesFecha` con reloj bien y atrasado (vacío, obligatorio, sin máximo) |
| RF-16 | `reloj-tablet.test.ts` › reloj adelantado no da aviso; rechazo por fecha futura: ya cubierto por `casos-compartidos.test.ts` y probado a mano |
| RF-17 | A mano en el navegador (768 px y 375 px, claro y oscuro): controles de 48 px, sin desborde, marcas con texto |
| RF-18 | A mano: otro usuario o tambo en la misma tablet no ve lo ajeno; los datos salen de `useCola()` y del contexto ya filtrado por la 010 (sus tests siguen en verde) |

## Tabla RF -> parte del plan
| RF | Parte del plan | Tarea |
|---|---|---|
| RF-1, RF-2, RF-3 | 1. Marcas del historial (adaptador + `Historial.tsx`) | T1, T2 |
| RF-4 | 1. "Cargado sin conexión" | T1, T2 |
| RF-5, RF-6, RF-7 | 2. Listado y buscador | T1, T2 |
| RF-8, RF-9, RF-10, RF-11 | 3. Pantalla "Pendientes" | T1, T3 |
| RF-12, RF-13 | 3. Condición del enlace y menú | T1, T3 |
| RF-14, RF-15, RF-16 | 4. Aviso de reloj | T1, T4 |
| RF-17, RF-18 | 5. Interfaz y estilos; verificación a mano | T2 a T5 |

## Riesgos
- **Contradicción menor de la spec en el listado con señal:** el RF-5 pide la marca "con y sin conexión" también para la baja **enviada**, pero la decisión técnica dice que, si el servidor ya la tiene, el animal desaparece. El plan sigue el RF (reinyecta desde la copia). Si el usuario prefiere lo otro, se quita `completarConBajasEnviadas` y el buscador deja de buscar entre las enviadas.
- **El buscador no muestra un resultado propio con la marca:** la marca se ve en la ficha a la que lleva.
- **Un 404 por otro motivo** (por ejemplo un semen eliminado) también muestra la ayuda de "animal dado de baja".
- **Reloj adelantado:** no se detecta (aceptado por el usuario).
- **Hora del reloj en el adaptador:** `registradoEn` de un pendiente es la misma hora de carga de la tablet, así que "Cargado sin conexión" solo aparece en eventos que ya trae el servidor.
- **Las reglas portadas de la 010** pueden divergir del servidor (riesgo ya aceptado); esta spec no agrega reglas.
