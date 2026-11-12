# 007 — Historial por animal e informes (resultado de inseminación y natalidad)

Estado: aprobada
Fecha: 2026-11-12 (aprobada el 2026-11-12)

## Contexto
La ficha de un animal ya muestra por separado dos cosas: la lista de eventos de las hembras (servicios, tactos, partos, secados y bajas, con sus anulaciones) y los "cambios manuales" (número, sexo, fecha de nacimiento, madre, lote). Los machos no muestran ningún historial de eventos. No hay forma de ver **todo lo que le pasó a un animal en una sola línea de tiempo**, ni de saber cómo le va al tambo en general.

Esta spec cubre la **Etapa 4**: (1) un **historial único por animal**, ordenado por fecha, y (2) los dos informes del tambo que pide `docs/requerimientos.md`: **resultado de inseminación** (cuántos servicios terminaron en preñez) y **natalidad** (cuántos partos y crías hubo). Los usan el dueño, el encargado y el veterinario, en la tablet, para decidir qué semen o toro conviene seguir usando y cómo va la parición.

**Depende de** las specs 002 (animales), 003 (servicios, tactos, semen), 004 (partos, crías, secados, anulaciones), 005 (cambios manuales) y 006 (bajas). No cambia ninguna de sus reglas: solo lee sus datos.

## Alcance
- Incluye:
  - Historial único del animal (eventos + cambios manuales), de solo lectura, en la ficha del animal activo (hembra o macho) y en la ficha de baja.
  - Informe de **resultado de inseminación** por período, con resumen, desglose por semen o toro y detalle.
  - Informe de **natalidad** por período, con resumen y detalle.
  - Entrada "Informes" en el menú para los tres roles.
- No incluye:
  - Litros de leche e informes de producción (Etapa 5).
  - Exportar a Excel, PDF u otros formatos ni botones de imprimir: se lee en pantalla.
  - Gráficos: los informes son tablas y números.
  - Una "tasa de natalidad" sobre el total del rodeo (la app no guarda cuántas vacas había en cada fecha).
  - Filtros ni búsqueda dentro del historial.
  - Otros informes (ventas, mortandad, intervalos entre partos, etc.).
  - Uso sin conexión (Etapa 6).
  - Cambiar cómo se registran, anulan o editan los eventos.

## Supuestos y reglas del dominio
- **Reglas heredadas:** el tambo sale de la sesión (se ignora cualquier `establecimientoId` del cliente, también en la query); recurso de otro tambo, inexistente o con id mal formado responde "no encontrado" idéntico; fechas `AAAA-MM-DD` con hora de Argentina; códigos: sin sesión 401, datos inválidos 400 con mensaje en español.
- **Se calcula al leer:** nada se guarda; si se anula un evento o se revierte una baja, el historial y los informes cambian solos.
- **Orden total de eventos:** fecha y, a igual fecha, momento de registro (specs 003 y 004). "Posterior" y "anterior" entre eventos de una misma vaca siempre se entienden en ese orden total (un tacto del mismo día que el servicio, pero registrado después, es posterior).
- **Eventos anulados:** no cuentan en ningún informe. En el historial del animal **sí se muestran**, marcados como anulados con quién, cuándo y motivo, y ubicados en la **fecha del evento** (no en la de la anulación).
- **Los informes son del tambo entero** e incluyen los eventos de animales dados de baja por venta o muerte (una vaca vendida igual tuvo sus servicios y partos). Los animales dados de baja por "parto anulado" son crías de partos anulados: nunca tienen servicios ni partos no anulados, así que no pueden aparecer en ningún informe.
- **Período de un informe:** `desde` y `hasta`, ambos inclusive.
  - La API los exige siempre (si faltan, 400). El **período por defecto lo pone la pantalla**: `hasta` = hoy en Argentina y `desde` = el mismo día del año anterior más un día (son 12 meses justos; el 29/02 se toma como 28/02 al restar el año). Ejemplo: hoy 12/11/2026 → desde 13/11/2025.
  - Condiciones: ambas fechas existentes, `desde` no posterior a `hasta`, `hasta` no futura (hoy argentino sí), `desde` no anterior al 01/01/2000, y el rango no puede abarcar **más de 5 años**: `hasta` no puede ser posterior al día anterior al quinto aniversario de `desde` (el 29/02 se toma como 28/02). Ejemplo: desde 01/01/2000 → hasta máximo 31/12/2004.
  - Un parámetro repetido (`desde=a&desde=b`) o que no sea texto da 400.
- **Resultado de un servicio:** el informe de inseminación se arma por servicio. Entran los servicios **no anulados** (inseminación y monta natural) con fecha en el período. El resultado se mide **"a hoy"**, con toda la información registrada hasta hoy, aunque el tacto o el parto sean posteriores al fin del período. Para cada servicio:
  1. El **tramo** del servicio va desde él hasta el siguiente servicio no anulado o el siguiente parto no anulado de esa vaca (lo que ocurra primero, en el orden total), sin incluirlos.
  2. Se toma el **primer tacto no anulado** dentro del tramo. Si es "preñada": **preñada**; si es "vacía": **vacía**. Un tacto posterior que lo contradiga (por ejemplo "preñada" y luego "vacía" por aborto, o "vacía" y luego "preñada") **no** cambia el resultado: se mide la confirmación en el primer tacto.
  3. Si no hay tacto en el tramo pero el servicio quedó vinculado como genética de un **parto no anulado** (el que se registró con ese servicio), cuenta como **preñada** (decisión del usuario). Si hay tacto en el tramo, el tacto manda.
  4. Si no se cumple nada de lo anterior: **sin tacto**.
  - Los tactos que no tienen un servicio previo en su ciclo no entran: el informe parte siempre de los servicios.
- **Porcentaje de preñez** = preñadas ÷ (preñadas + vacías). Se redondea al entero con el medio punto hacia arriba (ej. 2 de 3 = 66,67 % → 67 %; 1 de 8 = 12,5 % → 13 %). Los "sin tacto" **no entran** en el cálculo; se muestran aparte, con su cantidad bien visible, y el porcentaje lleva al lado la leyenda "No incluye servicios sin tacto". Se muestra también la base ("X de Y"). Si no hay ninguna preñada ni vacía, se muestra "—" (nunca 0 % ni 100 %).
- **Desglose por semen o toro:** se agrupa por semen o toro (por su identidad, mostrando su **nombre actual**, también si está desactivado o fue renombrado). Los servicios sin semen o toro cargado (una inseminación sin semen o una monta sin toro) van juntos en la fila **"No especificado"**.
- **Natalidad:** se cuentan los **partos no anulados** con fecha en el período y, de ellos, las crías vivas y las nacidas muertas (total y por sexo) y los partos de dos crías (mellizos). Una cría viva cuenta aunque después se haya dado de baja por venta o muerte; si el parto se anuló, no cuenta nada. **Porcentaje de nacidas muertas** = nacidas muertas ÷ total de crías, con el mismo redondeo, "—" si no hubo crías.
- **Orden del historial:** del más reciente al más antiguo por fecha y, a igual fecha, por momento de registro (más reciente primero). La fecha de una entrada es la del evento o, en un cambio manual, el **día argentino** en que se guardó (un cambio guardado a las 22:00 ART del 12/11 es del 12/11, aunque en UTC ya sea el 13/11).
- **Qué entradas tiene el historial:** servicio, tacto, parto, secado y baja (todas con su estado de anulación o reversión) y cambio manual (una entrada por cada dato cambiado, como hoy).
- **Topes (inyectables en los tests):** el historial muestra hasta **500 entradas** (las más recientes) y los informes hasta **2.000 filas** de detalle. Si se supera el tope se informa el total y se avisa; los totales y desgloses de los informes siempre cuentan todo. El tope del historial no puede dejar sin identificar el último evento no anulado (ver RF-3).

## Requisitos funcionales

### Historial por animal
- **RF-1** — El sistema deberá ofrecer, a través de una lectura nueva dedicada al historial, el historial único de un animal activo (hembra o macho) y el de un animal dado de baja por venta o muerte, armado en el servidor, que reúna sus eventos (servicios, tactos, partos, secados y bajas) y sus cambios manuales, ordenado como indican las reglas. Las lecturas existentes de eventos y de cambios manuales no cambian de comportamiento. El historial de un animal activo se lee con la ruta de animales activos y el de una baja con la ruta de bajas (un animal de baja da "no encontrado" en la primera y uno activo da "no encontrado" en la segunda, como hoy).
- **RF-2** — El sistema deberá mostrar en cada entrada el tipo, la fecha, un resumen de lo registrado (por ejemplo semen o toro de un servicio, resultado y fecha probable de un tacto, crías de un parto, motivo de una baja, dato anterior y nuevo de un cambio manual) y el nombre de quien lo registró. Mientras un evento esté anulado (o una baja revertida), deberá mostrarlo con la marca "anulado" ("revertida" para la baja), quién, cuándo y el motivo.
- **RF-3** — El sistema deberá indicar en la respuesta del historial cuál es el **último evento no anulado** del animal (el único que puede anularse, con los permisos de las specs 003 y 004) aunque quede fuera del tope, y deberá informar el total de entradas y si se cortó en 500; en ese caso la pantalla deberá avisar "Se muestran las 500 entradas más recientes de N".
- **RF-4** — Si el animal no tiene ninguna entrada, entonces el sistema deberá mostrar "Todavía no hay historial registrado".
- **RF-5** — El sistema deberá mostrar para un macho el mismo historial: sin eventos reproductivos, pero con sus cambios manuales y sus bajas (también las revertidas).
- **RF-6** — El sistema deberá seguir mostrando, sin cambios, la situación reproductiva actual de la hembra, los formularios de servicio, tacto, parto y secado y el botón "Anular" del último evento (con los permisos de las specs 003 y 004). El historial único **reemplaza** las dos listas que hoy existen (eventos y cambios manuales), sin duplicarlas. Al anular un evento, el historial y la situación se actualizan.

### Informe de resultado de inseminación
- **RF-7** — Cuando el usuario elige un período, el sistema deberá mostrar el resumen de los servicios del período según las reglas de "Resultado de un servicio": total, preñada, vacía, sin tacto y porcentaje de preñez con su leyenda y su base.
- **RF-8** — El sistema deberá mostrar el desglose por semen o toro con el mismo resumen (total, preñada, vacía, sin tacto, porcentaje) por cada uno, con la fila "No especificado" para los servicios sin dato de semen, ordenado por cantidad de servicios de mayor a menor (a igual cantidad, por nombre).
- **RF-9** — El sistema deberá listar el detalle de los servicios: número de la vaca, fecha del servicio, semen o toro y resultado ("preñada por tacto", "preñada por parto (sin tacto)", "vacía" o "sin tacto"), del más reciente al más antiguo. El número de una vaca activa lleva a su ficha y el de una dada de baja por venta o muerte, a su ficha de baja.
- **RF-10** — Si en el período no hay servicios, entonces el sistema deberá mostrar "No hay servicios en este período" y no mostrar porcentajes.

### Informe de natalidad
- **RF-11** — Cuando el usuario elige un período, el sistema deberá mostrar el resumen de natalidad: cantidad de partos, crías vivas (total y por sexo), crías nacidas muertas (total y por sexo), partos de dos crías y porcentaje de nacidas muertas.
- **RF-12** — El sistema deberá listar el detalle de los partos: número de la vaca, fecha y crías (sexo, si nació viva o muerta y, de la viva, su número), del más reciente al más antiguo, con los mismos enlaces de RF-9 para la vaca y para cada cría viva (activa: su ficha; dada de baja por venta o muerte: su ficha de baja).
- **RF-13** — Si en el período no hay partos, entonces el sistema deberá mostrar "No hay partos en este período" y no mostrar porcentajes.

### Período y valores comunes de los informes
- **RF-14** — El sistema deberá ofrecer en ambos informes los campos "Desde" y "Hasta" con el período por defecto de las reglas. Cuando ambas fechas estén completas y sean válidas, deberá consultar el informe (al cambiar cualquiera de las dos); mientras alguna falte o sea inválida, deberá mostrar el mensaje en pantalla sin consultar. Si se cambia el período mientras hay una consulta en curso, deberá descartar la respuesta de la consulta vieja y mostrar solo la del último período elegido.
- **RF-15** — Si el período falta, `desde` o `hasta` no son fechas existentes `AAAA-MM-DD`, `desde` es posterior a `hasta`, `hasta` es futura (hora de Argentina), `desde` es anterior al 01/01/2000, el rango abarca más de 5 años, o un parámetro está repetido o no es texto, entonces el sistema deberá rechazar el pedido con 400 y un mensaje en español que diga el motivo, sin calcular nada. Un `establecimientoId` en la query se ignora.
- **RF-16** — Si el detalle supera el tope de 2.000 filas, entonces el sistema deberá mostrar las más recientes con un aviso "Se muestran las 2.000 más recientes de N", manteniendo los totales completos. El resultado de cada servicio del período deberá calcularse leyendo los tactos, servicios y partos de esas vacas **hasta hoy**, no solo los del período.
- **RF-17** — Cuando se anula un servicio, tacto, parto o secado, o se revierte una baja, el sistema deberá reflejarlo en el siguiente cálculo del informe y del historial, sin pasos manuales.

### Aislamiento y permisos
- **RF-18** — El sistema deberá calcular los informes y el historial solo con datos del tambo del usuario, sin usar ningún identificador de tambo enviado por el cliente. Cada ruta nueva (historial de activos, historial de bajas e informes) tiene su test de aislamiento entre dos tambos, con "no encontrado" idéntico para el historial, y un test explícito de que un `establecimientoId` enviado se ignora.
- **RF-19** — El sistema deberá permitir a los tres roles (dueño, encargado y veterinario) ver el historial y los informes; son solo lectura. Sin sesión, 401. El orden de controles de los informes es: 401, 400 (período).

### Interfaz
- **RF-20** — El sistema deberá incluir la entrada "Informes" en el menú para los tres roles, con una pantalla que permita elegir entre "Resultado de inseminación" y "Natalidad" y el período, sin desborde horizontal del encabezado a 375 px.
- **RF-21** — El sistema deberá mostrar en la ficha del animal (activo y de baja) **una única sección "Historial"**: no deben quedar la lista de eventos ni la sección "Cambios manuales" por separado, ningún dato debe aparecer duplicado, el botón "Anular" debe aparecer solo en el último evento no anulado (como hoy: al veterinario solo si es servicio o tacto; nunca en una baja ni en un cambio manual; nunca en la ficha de baja), y los eventos anulados deben verse marcados. Se verifica en el navegador.
- **RF-22** — El sistema deberá mostrar los informes y el historial con campos y botones de al menos 48 px de alto, tablas que se adapten a 768 px y 375 px sin desborde horizontal de la página, textos en español rioplatense y contraste en modo claro y oscuro. Mientras el informe se calcula deberá mostrar "Calculando…"; si falla, deberá mostrar el mensaje de error sin perder el período elegido. Se verifica en el navegador.

## Permisos por rol
| Acción | Dueño | Encargado | Veterinario |
|---|---|---|---|
| Ver el historial de un animal (activo o de baja) | Sí | Sí | Sí |
| Ver el informe de resultado de inseminación | Sí | Sí | Sí |
| Ver el informe de natalidad | Sí | Sí | Sí |

## Casos límite
- Animal recién cargado sin eventos ni cambios: "Todavía no hay historial registrado".
- Macho: historial con cambios manuales y bajas; nunca eventos reproductivos.
- Evento anulado: aparece en el historial en la fecha del evento, marcado; no cuenta en los informes.
- Dos entradas con la misma fecha: manda el momento de registro. Cambio manual guardado a las 22:00 ART: figura en el día argentino.
- Animal con más de 500 entradas: se muestran las 500 más recientes con el aviso; el último evento no anulado sigue identificado.
- Baja revertida y nueva baja: el historial muestra la primera revertida y la segunda vigente.
- Servicio sin semen cargado (inseminación sin semen o monta sin toro): fila "No especificado". Semen desactivado o renombrado: se agrupa con su nombre actual.
- Servicio anulado: no aparece en el informe. Tacto anulado: se ignora y puede pasar a contar el siguiente tacto del tramo.
- Tacto "preñada" seguido de otro "vacía" (aborto), o "vacía" seguido de "preñada": cuenta solo el primero.
- Tacto del mismo día que el servicio: es posterior si se registró después, y no cuenta si se registró antes.
- Tacto sin servicio previo en su ciclo: no entra en el informe.
- Servicio sin tacto pero con un parto vinculado no anulado: "preñada por parto (sin tacto)". Si además hay un tacto en su tramo, manda el tacto. Si el parto se anula, vuelve a "sin tacto".
- Servicio seguido de otro servicio o de un parto sin ningún tacto en medio: "sin tacto" para siempre (salvo el caso del parto vinculado); no entra en el porcentaje.
- Servicios recientes sin tacto todavía: "sin tacto"; la leyenda y la cantidad visible avisan que el porcentaje no los incluye.
- Tacto posterior al fin del período: se usa igual (el resultado se mide a hoy).
- Servicio de una vaca que después se vendió o murió: cuenta; su número enlaza a la ficha de baja.
- Parto de dos crías: cuenta como un parto, dos crías y un parto de mellizos, sea cual sea el resultado: dos vivas, una viva y una muerta, **dos muertas** o crías de **distinto sexo** (cada una suma a su sexo).
- Parto anulado: no cuenta ni en la natalidad ni como cría viva.
- Cría viva de un parto del período que se vendió o murió: cuenta como nacida viva y su número enlaza a su ficha de baja.
- Período de un solo día (`desde` igual a `hasta`): se acepta. `hasta` de hoy: se acepta; de mañana: 400. `desde` posterior a `hasta`: 400. Rango de exactamente 5 años (hasta el 31/12/2004 desde el 01/01/2000): se acepta; un día más: 400. Parámetros repetidos o sin valor: 400.
- Porcentajes: 12,5 % se muestra como 13 %; sin preñadas ni vacías se muestra "—", también si solo hay servicios "sin tacto".
- Tambo nuevo o período sin movimientos: mensajes de "no hay", sin porcentajes ni divisiones por cero.
- Pedir el historial de un animal de otro tambo, inexistente o con id mal formado: "no encontrado" idéntico.
- La sesión vence con la pantalla abierta: la próxima acción lleva al login.
- Las respuestas no incluyen hashes ni datos de otros tambos.

## Criterios de aceptación
- [x] La ficha de un animal activo (hembra o macho) y la de baja muestran una única sección "Historial" con eventos y cambios manuales, del más reciente al más antiguo, con los anulados marcados y sin listas duplicadas; "Anular" solo en el último evento no anulado (RF-1 a RF-6, RF-21).
- [x] El historial respeta el tope de 500 con aviso, identifica el último evento no anulado y ubica cada cambio manual en su día argentino (RF-3).
- [x] El informe de resultado de inseminación da total, preñada, vacía, sin tacto y porcentaje (con leyenda y base) por período, con el resultado medido a hoy, el parto vinculado como preñada y el desglose por semen o toro con "No especificado" (RF-7 a RF-10).
- [x] El informe de natalidad da partos, crías vivas y muertas por sexo, mellizos (incluidos dos muertas y distinto sexo) y porcentaje de nacidas muertas (RF-11 a RF-13).
- [x] El período se valida (fechas existentes, orden, no futuro, 5 años máximo, parámetros repetidos) con 400 y mensaje en español; la pantalla descarta respuestas viejas; el detalle tiene tope inyectable con aviso (RF-14 a RF-16).
- [x] Anular un evento o revertir una baja se refleja en el siguiente cálculo (RF-17).
- [x] Cada ruta nueva tiene un test de aislamiento entre dos tambos, uno de permisos (los tres roles pueden; sin sesión 401), uno de que un `establecimientoId` enviado se ignora y ninguna respuesta incluye hashes (RF-18, RF-19).
- [x] Los eventos anulados no entran en los informes y los de animales dados de baja por venta o muerte sí.
- [x] La interfaz cumple RF-20 a RF-22 (menú sin desborde, 48 px, 768 y 375 px, modo claro y oscuro), verificada en el navegador.

## Notas para el plan
- Reparto sugerido en 5 tareas: (1) API del historial único (activos y bajas, con tests); (2) API de informes (si resulta muy grande, el plan puede partirla en resumen/desglose y detalle, sin superar 5 tareas); (3) web: historial único en ambas fichas; (4) web: informes, período y menú; (5) cierre y verificación en el navegador.
- Los informes leen eventos por tambo, tipo y fecha, y las rutas de eventos de hoy tienen índice por animal y fecha. El plan debe decidir si hace falta un índice nuevo (sería una migración) y avisarlo; esta spec no fija ningún criterio de rendimiento.
- Los dos topes (500 y 2.000) deben poder cambiarse en los tests (sin crear miles de filas).

## Preguntas abiertas
- (ninguna; el usuario confirmó el 2026-11-12: resultado por primer tacto con el parto vinculado sin tacto como preñada, desglose por semen con "No especificado", período Desde/Hasta con 12 meses por defecto y máximo 5 años, natalidad con conteos y porcentaje de nacidas muertas, historial con anulados y cambios manuales, informes que cuentan a los animales dados de baja con enlace a su ficha, tres roles solo lectura, sin exportar; el porcentaje de preñez se muestra con la leyenda "No incluye servicios sin tacto" y la cantidad de sin tacto visible)
