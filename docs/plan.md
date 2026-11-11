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
- [ ] 2.2 Partos y secados (spec 004, en sesión nueva; depende de la 003)

## Etapa 3 — Reglas y bajas
Movimiento automático entre lotes según el estado; bajas por venta o muerte.

## Etapa 4 — Historial e informes
Historial por animal; informes de resultado de inseminación y natalidad.

## Etapa 5 — Producción
Litros por vaca en cada ordeño; informes de producción.

## Etapa 6 — Modo sin conexión
App instalable (PWA), datos locales en la tablet y sincronización al volver la conexión.

## Etapa 7 — Publicación
Subir la app a un hosting con HTTPS y backups de la base de datos.
