# Tareas — 012 Marcas de lo pendiente, "Pendientes" ampliada y aviso de reloj

Cada tarea es autónoma: releé `spec.md`, `plan.md`, `docs/constitution.md` y el código antes de empezar. Tests primero (Vitest en `web/tests/`, con reloj inyectable). Sin dependencias nuevas. No tocar la API, la base ni las reglas de la 010, ni el formato de IndexedDB. Hora siempre de Argentina (`horaArgentina.ts`).

- [ ] **T1** — Lógica pura con tests: marcas, "Cargado sin conexión", marca del listado, condición de "Pendientes", reloj y ayudas
  - Crear `marcasHistorial.ts`, `marcasListado.ts`, `condicionPendientes.ts` y `relojTablet.ts` en `web/src/sinconexion/`; ampliar `resumenPendiente.ts` (`resumenCompleto`, `ayudaRechazo`).
  - En `web/src/compartido/api.ts` sumar los campos opcionales `marca` y `anulacionPendiente` a `EventoReproductivo` y `bajaPendiente` a `Animal`.
  - Adaptador (`adaptadorFicha.ts`): poner `marca` y `anulacionPendiente` en los eventos y **agregar al historial** los rechazados y "en espera del anterior" (por fuera de la vista: no cambian estado, situación ni `ultimoEventoNoAnuladoId`).
  - Tests: `marcas-historial.test.ts`, `marcas-listado.test.ts`, `condicion-pendientes.test.ts`, `reloj-tablet.test.ts`; extender `adaptador-ficha.test.ts` y `resumen-pendiente.test.ts`. Casos de 4, 5 y 6 minutos para "Cargado sin conexión" y el reloj.
  - RF: RF-1 a RF-8, RF-10, RF-11, RF-12, RF-14, RF-15, RF-16 (lógica)
  - Hecho cuando: los tests nuevos pasan; `npm test` y `npm run typecheck` en verde; los tests de la 009, 010 y 011 siguen en verde; ninguna pantalla cambió todavía (no hace falta navegador).

- [ ] **T2** — Historial, listado y buscador con las marcas
  - `Historial.tsx`: dibujar la marca de cada evento (texto exacto), "Anulación pendiente", "Cargado sin conexión el …" y, en rechazados y en espera, el enlace "Ver en Pendientes" (sin "Anular" ni "Descartar" en la fila). `DetalleParto` y la genética deciden "Se completa al sincronizar" y crías sin enlace por `!!evento.marca`, no por `pendiente` (un parto enviado no debe mostrar "nacida muerta").
  - `Animales.tsx`: `useCola()` + `useVersionCola()`; marca "Baja pendiente de sincronizar" en la celda del número; con señal, suma desde la copia el animal con baja enviada que la copia todavía trae (`completarConBajasEnviadas`); la marca y la fila se van solas al resolverse.
  - `Buscador.tsx`: ante un 404 del servidor, buscar el número entre las bajas enviadas locales y, si está, ir a su ficha (que ya muestra "Baja pendiente/enviada").
  - Estilos nuevos solo si faltan (variables de color, claro y oscuro).
  - RF: RF-1 a RF-7, RF-17, RF-18
  - Hecho cuando: `npm test` y `npm run typecheck` en verde; en el navegador a **768 px, modo claro**, con la red cortada y sembrando en IndexedDB un fragmento de consola que no se commitea: un historial con cada marca (pendiente, enviado, rechazado, en espera, anulación pendiente, "Cargado sin conexión" con más de 5 minutos y sin él); el listado y el buscador con una baja pendiente; la marca desaparece al descartar la baja; con señal la baja enviada sigue marcada hasta que la copia no la trae.

- [ ] **T3** — Pantalla "Pendientes" ampliada, acceso del veterinario y menú
  - `Pendientes.tsx`: resumen completo con `resumenCompleto` (sin los textos mínimos), fecha del evento y "Cargado el …"; confirmación de descarte con vaca, tipo y fecha (y el aviso de "en espera" y de posteriores); ayuda de rechazo 404; avisos del servidor con el resumen (buscando el enviado por `id`, si no el texto del tipo) y cierre de a uno.
  - `Layout.tsx` y `Pendientes.tsx` usan `mostrarPendientes({ rol, total, avisos })`: el enlace del menú y la pantalla comparten condición (el veterinario ve ambos solo con pendientes o avisos; sin nada, no hay enlace y la pantalla redirige). El conteo con rechazados destacados y las confirmaciones de cierre de sesión y cambio de usuario no cambian.
  - RF: RF-8 a RF-13, RF-17, RF-18
  - Hecho cuando: `npm test` y `npm run typecheck` en verde; en el navegador a **768 px, modo claro**, con la red cortada: "Pendientes" con un pendiente de cada tipo, uno rechazado (404 con la ayuda), uno "en espera del anterior" y su "Descartar" con la confirmación completa, avisos cerrables; el veterinario (sesión de veterinario) sin pendientes ni avisos no ve el enlace ni la pantalla, y con un aviso o un servicio pendiente sí.

- [ ] **T4** — Aviso de reloj atrasado en los formularios de carga
  - Crear `useRelojTablet.ts` y `AvisoReloj.tsx`; usarlos arriba de `FormServicio` y `FormTacto` (`Reproduccion.tsx`), `FormParto.tsx`, `FormSecado.tsx` y `FormBaja.tsx`: con el reloj atrasado el campo fecha queda vacío, obligatorio y sin máximo (el mínimo se mantiene) con la ayuda "Elegí la fecha del evento"; con una copia nueva y el reloj bien, el aviso se va y vuelve la fecha por defecto.
  - RF: RF-14, RF-15, RF-16, RF-17
  - Hecho cuando: `npm test` y `npm run typecheck` en verde; en el navegador a **768 px, modo claro**, cambiando la hora del dispositivo (o sembrando `generadaEn` en el futuro): aparece el aviso con el texto exacto en los cinco formularios y la fecha viene vacía y sin máximo; con el reloj bien no hay aviso y la fecha propone hoy; una fecha futura con el reloj adelantado queda rechazada y visible en "Pendientes".

- [ ] **T5** — Cierre: verificación final, criterios, MEMORY.md y docs/plan.md
  - Pasada visual final con la red cortada a **768 px y 375 px, modo claro y oscuro** (es la verificación en los dos anchos que pide la constitución para todo lo visual de la spec): historial con cada marca, listado y buscador con la baja pendiente, "Pendientes" con cada tipo, rechazo, avisos y descarte de uno en espera, el veterinario con y sin pendientes o avisos, y el aviso de reloj; controles de al menos 48 px y sin desborde horizontal; las marcas se distinguen por su texto. Otro usuario o tambo en la misma tablet no ve lo ajeno. Volver la señal y ver todo actualizarse solo.
  - Repasar que el código nuevo no use otra hora que la de Argentina ni envíe `establecimientoId`; `npm test` y `npm run typecheck` en verde; repasar uno por uno los criterios de aceptación de `spec.md` y tildarlos.
  - Actualizar `MEMORY.md` (estado: spec 012 hecha y **6.2 completa**; decisiones: marcas en el adaptador, rechazados fuera de la vista, baja enviada reinyectada en el listado, buscador a la ficha, condición única del enlace, reloj; quitar de "Riesgos pendientes" el renglón "Marcas y avisos de la 012"; anotar que los tests de concurrencia de la API siguen lentos) y `docs/plan.md` (6.2 hecha). Dejar todo commiteado.
  - RF: RF-17, RF-18 y repaso de todos
  - Hecho cuando: tests y typecheck en verde, criterios de aceptación tildados, `MEMORY.md` y `docs/plan.md` al día y commit hecho.
