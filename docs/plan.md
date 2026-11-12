# Plan de desarrollo — CowRegister

Cada etapa termina con algo que funciona y se puede probar. Cada paso va en su propia rama y termina con un commit.

## Etapa 1 — Base del sistema

Objetivo: un dueño registra su tambo, inicia sesión, crea sus lotes, carga sus vacas y las encuentra con el buscador o el bastón.

- [x] 1.0 Preparación: PostgreSQL, Git, `CLAUDE.md`, documentación
- [x] 1.1 Esqueleto: API y web corriendo y conectadas
- [x] 1.2 Base de datos: `Establecimiento`, `Usuario`, `Lote`, `ReglaLote`, `Animal` (UUID y fechas de auditoría)
- [x] 1.3 Login y seguridad: registro de tambo y dueño, login/logout, argon2, roles, aislamiento por establecimiento
- [x] 1.4 Lotes: alta, edición y baja; configuración estado → lote
- [x] 1.5 Animales: alta con estado inicial, número único entre activos, asignación automática de lote, listado y ficha
- [x] 1.6 Buscador: número o bastón + Enter abre la ficha
- [x] 1.7 Cierre: tests de login, aislamiento y número único; rama `main` (falta subir a GitHub)

## Etapa 2 — Reproducción
Servicios, tactos con fecha probable de parto, partos con alta del ternero, secados.

- [x] 2.1 Semen, servicios y tactos (spec [003-reproduccion](../specs/003-reproduccion/spec.md)): catálogo de semen y toros, situación reproductiva, anulación del último evento
- [x] 2.2 Partos, crías y secados (spec [004-partos-secados](../specs/004-partos-secados/spec.md)): registro y anulación de partos y secados, alta de las crías, genética y reinicio del ciclo
- [x] 2.3 Editar animal y mover de lote a mano (spec [005-editar-animal](../specs/005-editar-animal/spec.md)): edición de número, sexo, fecha y madre, mover de lote, historial de cambios manuales y aviso 8 al anular

## Etapa 3 — Bajas
Bajas por venta o muerte con historial conservado, listado y ficha de baja, y reversión de la baja. (El movimiento automático entre lotes según el estado ya quedó hecho en las etapas 1 y 2.)

- [x] 3.1 Bajas por venta o muerte (spec [006-bajas](../specs/006-bajas/spec.md)): dar de baja y revertir (dueño y encargado), listado y ficha de baja (los tres roles), vínculos madre–cría hacia animales de baja y aviso al reutilizar el número de un animal de baja

## Etapa 4 — Historial e informes
Historial por animal; informes de resultado de inseminación y natalidad.

## Etapa 5 — Producción
Litros por vaca en cada ordeño; informes de producción.

## Etapa 6 — Modo sin conexión
App instalable (PWA), datos locales en la tablet y sincronización al volver la conexión.

## Etapa 7 — Publicación
Subir la app a un hosting con HTTPS y backups de la base de datos.
