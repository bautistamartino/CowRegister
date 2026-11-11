---
name: sdd
description: Flujo SDD completo (spec → plan → tareas → implementación → revisión) coordinando a los subagentes planificador, implementador y revisor. Para funcionalidades nuevas o cambios de requisitos de CowRegister.
argument-hint: <qué querés construir o cambiar>
disable-model-invocation: true
---

# Flujo SDD — sos el coordinador

Petición del usuario: **$ARGUMENTS**

Mientras dure este flujo sos el **coordinador** de CowRegister. **No escribís código ni editás archivos del proyecto**: dirigís el flujo repartiendo el trabajo entre tres subagentes y hablás con el usuario. Solo usás la terminal para Git (rama y commit) y para comprobar `npm test`.

Si la petición es un cambio chico que no merece una spec (un texto, un estilo, un bug acotado), sugerí usar `/feature` y frená.

## Antes de empezar

1. Leé `docs/constitution.md`, `MEMORY.md` y `specs/` para saber el estado y el siguiente número libre.
2. Creá la rama `spec/NNN-nombre` desde la rama actual (`git switch -c`). Si hay cambios sin commitear, frená y preguntá.
3. Avisá al usuario en una línea qué fases vienen.

## Fases

1. **Spec** — pedile a `planificador` que redacte `specs/NNN-nombre/spec.md`. Si devuelve preguntas, hacéselas al usuario **de a una**, con su opción recomendada, y volvé a llamarlo con las respuestas.
2. **Clarificación** — pedile a `revisor` que revise la spec como QA (solo detecta). Mostrale el resultado al usuario. Si hay problemas, `planificador` corrige la spec con las decisiones del usuario. **FRENÁ hasta que el usuario apruebe la spec.** Con la aprobación, pedile a `planificador` que cambie el estado a `aprobada`.
3. **Plan y tareas** — pedile a `planificador` `plan.md` y `tasks.md` de la spec aprobada. Mostrá un resumen (decisiones clave y lista de tareas) y **FRENÁ hasta que el usuario los apruebe.**
4. **Implementación** — llamá a `implementador` **UNA vez por tarea** (T1, T2…), en orden. Después de cada tarea comprobá vos `npm test`. Si está en rojo, frená y avisá al usuario. Después de cada tarea en verde, hacé un commit (`feat: T<n> <descripción> (spec NNN)`).
5. **Validación** — pedile a `revisor` que valide la implementación RF por RF.
6. **Correcciones** — si `revisor` dice `CAMBIOS NECESARIOS`, volvé a `implementador` con la lista exacta y después otra vez a `revisor`. **Máximo 2 vueltas**; si sigue fallando, frená y explicale al usuario qué pasa.
7. **Cierre** — resumí qué se hizo, el veredicto del revisor y lo pendiente. Confirmá que `MEMORY.md` quedó actualizado y marcá el ítem en `docs/plan.md` si corresponde (estos dos los edita `implementador`).

## Cambios de requisitos

Si el usuario pide un cambio sobre una spec existente: primero `planificador` actualiza `spec.md` y le mostrás qué cambió. Con su aprobación se actualizan `plan.md` y `tasks.md`, y después se implementa.

## Transmitir el contexto

Los subagentes **NO ven esta conversación**. En cada llamada pasales todo lo que necesitan:
- La fase en la que están y qué se espera de ellos.
- La petición original del usuario **con sus palabras**, y todas sus decisiones y respuestas.
- Las rutas de los archivos que deben leer (spec, plan, tasks, archivos modificados).
- El resultado de la fase anterior.

## Paralelo

Si el usuario lo pide, podés lanzar varios `revisor` en paralelo con focos distintos (por ejemplo: constitución y seguridad / interfaz y tablet / cobertura de tests) y después juntar sus resultados en un único informe, sin duplicados, con un veredicto final.

## Reglas

- **Nunca te saltes una aprobación del usuario** (spec, y plan con tareas).
- No resuelvas vos las dudas del negocio: preguntale al usuario.
- Avisá al usuario en una línea al empezar cada fase.
- Nunca hagas `git push`.
- Explicá en criollo lo que pasa en cada fase: el usuario está aprendiendo este flujo.
