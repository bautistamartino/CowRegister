# Plantillas SDD de CowRegister

## Formato EARS para requisitos

EARS (*Easy Approach to Requirements Syntax*) escribe cada requisito con una estructura fija, así no hay ambigüedad:

| Tipo | Estructura | Ejemplo |
|---|---|---|
| Siempre | El sistema **deberá** … | El sistema deberá mostrar solo los lotes del tambo del usuario. |
| Evento | **Cuando** <evento>, el sistema **deberá** … | Cuando se registra un secado, el sistema deberá mover la vaca al lote configurado para "Seca". |
| Estado | **Mientras** <estado>, el sistema **deberá** … | Mientras un lote tenga animales, el sistema deberá impedir eliminarlo. |
| Opcional | **Donde** <condición/característica>, el sistema **deberá** … | Donde el usuario sea veterinario, el sistema deberá mostrar los lotes en modo lectura. |
| No deseado | **Si** <situación no deseada>, **entonces** el sistema **deberá** … | Si el nombre del lote ya existe en el tambo, entonces el sistema deberá rechazarlo con un mensaje claro. |

---

## spec.md

```markdown
# NNN — <Nombre de la funcionalidad>

Estado: borrador | aprobada
Fecha: AAAA-MM-DD

## Contexto
Qué problema del tambo resuelve y por qué hace falta. Quién lo usa.

## Alcance
- Incluye: …
- No incluye: …

## Requisitos funcionales
- **RF-1** — <requisito en EARS>
- **RF-2** — …

## Permisos por rol
| Acción | Dueño | Encargado | Veterinario |
|---|---|---|---|

## Casos límite
- …

## Criterios de aceptación
- [ ] …

## Preguntas abiertas
- (vacío cuando la spec se aprueba)
```

---

## plan.md

```markdown
# Plan — NNN <Nombre>

Spec: [spec.md](spec.md)

## Resumen
2–3 líneas del enfoque.

## Base de datos
Modelos nuevos o modificados, migración, SQL a mano (índices parciales, CHECK).

## API
| Método y ruta | Rol | Qué hace | RF |
|---|---|---|---|

## Interfaz
Pantallas y componentes, y cómo se ven en tablet.

## Archivos
- Crear: …
- Modificar: …

## Decisiones
- **<Decisión>** — elegida porque … Alternativa descartada: … porque …

## Estrategia de tests
| RF | Test (archivo › caso) |
|---|---|

## Riesgos
- …
```

---

## tasks.md

```markdown
# Tareas — NNN <Nombre>

- [ ] **T1** — <tarea>
  - RF: RF-1, RF-2
  - Hecho cuando: <condición verificable, por ejemplo "los tests X pasan">
- [ ] **T2** — …
```

Máximo 10 tareas, en orden, cada una chica y verificable.
