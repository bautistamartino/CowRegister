# Memoria del proyecto

Estado actual y decisiones importantes. La actualiza el implementador al terminar cada spec, y cualquiera que tome una decisión de diseño. Lo más reciente va arriba en cada sección.

## Estado

- **Etapa 1 — Base del sistema** (ver [docs/plan.md](docs/plan.md))
  - Hecho: 1.0 preparación, 1.1 esqueleto, 1.2 base de datos, 1.3 login y seguridad.
  - Siguiente: 1.4 lotes y reglas estado → lote (primera spec con el flujo `/sdd`).
- Hay una API de gestión de usuarios (`/api/usuarios`) **sin pantalla** todavía.

## Decisiones

- **2026-11-10 — Sistema de agentes:** coordinador como skill `/sdd`, subagentes planificador, implementador y revisor (`.claude/agents/`). Cambios chicos con `/feature`.
- **2026-11-10 — Tests:** Vitest + supertest sobre la base `cowregister_test`. `LIMITE_INTENTOS_LOGIN` permite subir el límite de intentos en los tests.
- **2026-11-10 — Sesiones en la base** (no JWT): se pueden revocar. Cookie httpOnly + SameSite=Lax, 30 días.
- **2026-11-10 — Prisma fijado en 7.10.1:** la etiqueta `latest` de npm apuntaba a una 8.0.0-rc.
- **2026-11-10 — Stack:** React + Vite + TS, Express + TS, PostgreSQL 18 + Prisma.

## Ramas

Las ramas de la Etapa 1 están apiladas y todavía no existe `main`: `setup/estructura-inicial` → `etapa1/esqueleto` → `etapa1/base-de-datos` → `etapa1/login` → `config/agentes`. Se juntan en `main` al cerrar la etapa.

## Pendiente de definir con el responsable

- Si los litros se cargan a mano o se importan del equipo de ordeñe.
- Destino final de los terneros.
- Otros informes.
