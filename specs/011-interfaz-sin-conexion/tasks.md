# Tareas — 011 Formularios de carga sin conexión y adaptador de la ficha

Cada tarea es autónoma: releé `spec.md`, `plan.md`, `docs/constitution.md` y el código antes de empezar. Tests primero (Vitest en `web/tests/`, con reloj inyectable). Sin dependencias nuevas. No tocar la API ni las reglas de la 010.

- [x] **T1** — Base pura: adaptador de la ficha, resúmenes, conversión de rechazos y hora de Argentina única
  - Crear `web/src/sinconexion/adaptadorFicha.ts` (decisión de fuente + ficha, situación, eventos e historial a partir de la vista local, con los campos opcionales nuevos en los tipos de `web/src/compartido/api.ts`), `resumenPendiente.ts` y `formularioRechazo.ts`.
  - Unificar la hora de Argentina: exportar `fechaIsoArgentina` y `formatearFechaHoraArgentina` desde `horaArgentina.ts` y hacer que `reproduccionDatos.ts` (`fechaArgentinaIso`, `hoyIso`), `fechaHora.ts`, `Historial.tsx` (`textoMomento`) y `produccionDatos.ts` deleguen en ellas, sin cambiar los textos de salida.
  - Agregar a `registrar.ts` y `clasificar.ts` el campo opcional `evento` en el resultado `enviado` (aditivo; si complica, omitirlo y dejarlo anotado).
  - Tests: `adaptador-ficha.test.ts`, `resumen-pendiente.test.ts`, `formulario-rechazo.test.ts`, `hora-argentina.test.ts` (con el huso del proceso en otra zona).
  - RF: RF-10, RF-11, RF-12, RF-16, RF-18 a RF-24 (lógica), RF-26
  - Hecho cuando: los tests nuevos pasan; `npm test` y `npm run typecheck` en verde; los tests de la 009 y la 010 siguen en verde; no se ve ningún cambio de pantalla (no hace falta navegador).

- [x] **T2** — Ficha, reproducción e historial con la vista local (lectura)
  - En `web/src/compartido/api.ts` (con `lecturaLocal.ts` / `copiaLocal.ts` si hace falta) las tres lecturas `/animales/:id`, `/eventos` e `/historial` usan el adaptador según la tabla de fuentes del plan; pasar el nombre del usuario de la sesión al adaptador. Agregar la lectura de `/semen` a lo que resuelve la copia si falta.
  - `useVersionCola.ts` y sumarlo a los efectos de lectura de `AnimalFicha`, `Reproduccion` e `Historial` (se actualizan solos al cambiar la cola o la copia, sin cerrar formularios).
  - Dibujar: estado y situación de la vista; eventos pendientes con "Pendiente de sincronizar" y "Se completa al sincronizar" en lugar del lote anterior y la genética; parto con crías dentro (sin enlaces) y "El lote se asigna al sincronizar"; secado ("seca", sin litros); ficha de baja pendiente en solo lectura con "Baja pendiente de sincronizar", "Descartar baja" (con `Confirmar`, según estado) o "Baja enviada: se confirma al actualizar"; nota "Esta vaca tiene N pendientes sin aceptar: revisalos en Pendientes" con enlace.
  - Tests: ya cubiertos por T1 (adaptador); sumar los de la decisión de fuente si quedaron en `api.ts`.
  - RF: RF-18 a RF-25, RF-28
  - Hecho cuando: `npm test` y `npm run typecheck` en verde; en el navegador a **768 px, modo claro**, sembrando en IndexedDB pendientes de cada tipo (un fragmento de consola que no se commitea), con la red cortada y con señal: la ficha muestra la fuente correcta, las marcas y la baja pendiente en solo lectura; la consulta sin conexión de la 009 (listado, buscador, ficha sin pendientes) sigue igual.

- [ ] **T3** — Formularios de servicio, tacto, secado y baja con el punto único de registro
  - Crear `useGuardarCarga.ts` (estado "Guardando…", un solo envío, confirmaciones, errores por campo vía `formularioRechazo`, animal fuera de la copia, "No se pudo guardar en la tablet…").
  - Reproduccion.tsx (`FormServicio`, `FormTacto`), `FormSecado.tsx` y `FormBaja.tsx` guardan con `useGuardarCarga`; los botones se ofrecen según la vista y el rol (veterinario: solo servicio y tacto), con y sin conexión; "Dar de baja" y las cargas ya no se deshabilitan sin señal (el resto sigue con "Esto necesita conexión"). `FormBaja`: aceptada en el momento navega a `/bajas/:id`; pendiente se queda en la ficha con "Guardado en la tablet: pendiente de sincronizar" y el resumen.
  - Fecha por defecto y máximo con la hora de Argentina única; el catálogo de semen activo sale de la copia sin conexión.
  - RF: RF-1, RF-2, RF-4, RF-5, RF-8 a RF-15, RF-17, RF-26, RF-27
  - Hecho cuando: `npm test` y `npm run typecheck` en verde; en el navegador a **768 px, modo claro**, con la red cortada: se carga cada uno de los cuatro eventos, aparece la confirmación y la ficha refleja el cambio; un rechazo local (por ejemplo servicio con preñez vigente) se ve junto al campo sin perder lo escrito; con señal se acepta en el momento como hoy; el veterinario solo ve servicio y tacto.

- [ ] **T4** — Parto (una o dos crías) y anulación o descarte
  - `FormParto.tsx`: sin observaciones del parto, una o dos crías, ayuda "Un parto admite hasta 2 crías", errores por cría con `formularioRechazo`, guardado con `useGuardarCarga` como un solo pendiente; aceptado en el momento, conservar los enlaces "Ver la ficha de la cría" si T1 dejó el `evento` en el resultado.
  - `Historial.tsx` (`FilaEvento`): "Anular" con motivo obligatorio vía `useCola().anularLocal` (con y sin conexión); si el evento es pendiente (o tiene anulación pendiente), "Descartar" con `Confirmar` (vaca, tipo y fecha) y lista de los posteriores de la misma vaca que seguirán enviándose; el veterinario solo anula servicio y tacto.
  - RF: RF-3, RF-6, RF-7, RF-8 a RF-11, RF-14, RF-21, RF-27
  - Hecho cuando: `npm test` y `npm run typecheck` en verde; en el navegador a **768 px, modo claro**, con la red cortada: parto con dos crías (una nacida muerta) queda como un solo pendiente y se ve dentro del parto; una tercera cría no se ofrece; anular un evento ya sincronizado deja una anulación pendiente; "Descartar" un pendiente con otros cargados después los lista; con señal el parto se acepta en el momento.

- [ ] **T5** — Cierre: verificación final, criterios, MEMORY.md y docs/plan.md
  - Repasar el código nuevo para que no use otra hora que la de Argentina ni envíe `establecimientoId` (RF-26, RF-28).
  - Pasada visual final con la red cortada a **768 px y 375 px, modo claro y oscuro**: controles de al menos 48 px y sin desborde horizontal en los formularios, la confirmación, la nota de Pendientes y la ficha de baja pendiente; una pasada con el veterinario; volver la señal y ver la ficha actualizada.
  - `npm test` y `npm run typecheck` en verde; repasar uno por uno los criterios de aceptación de `spec.md`.
  - Actualizar `MEMORY.md` (estado de la 011 y decisiones: adaptador y fuente de la ficha, `useGuardarCarga`, hora de Argentina única, evento aceptado en `registrar`, lo que queda para la 012) y `docs/plan.md` (6.2 sigue parcial: 011 hecha, 012 pendiente). Dejar todo commiteado.
  - RF: RF-26 a RF-28 y repaso de todos
  - Hecho cuando: tests y typecheck en verde, criterios de aceptación tildados, `MEMORY.md` y `docs/plan.md` al día y commit hecho.
