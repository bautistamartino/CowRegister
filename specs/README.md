# Specs

Cada funcionalidad tiene su carpeta `NNN-nombre/` (por ejemplo `001-lotes/`) con tres archivos:

| Archivo | Qué tiene | Quién lo escribe |
|---|---|---|
| `spec.md` | **Qué** se quiere y **por qué**: requisitos en formato EARS, casos límite y criterios de aceptación. Sin tecnología. | planificador |
| `plan.md` | **Cómo**: archivos, decisiones (con la alternativa descartada), estrategia de tests y qué requisito cubre cada parte. | planificador |
| `tasks.md` | Hasta 10 tareas en orden, cada una con sus requisitos y "Hecho cuando:". | planificador (el implementador las marca como hechas) |

El flujo completo se lanza con `/sdd <petición>`. Ver [.claude/skills/sdd/SKILL.md](../.claude/skills/sdd/SKILL.md).
