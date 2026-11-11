# CowRegister

Sistema web para tambos argentinos: registro de vacas y sus eventos (pariciones, secados, servicios, tactos, ventas y muertes), lotes personalizables, buscador por número (compatible con bastón lector RFID) e informes productivos. Es multi-tambo: cada establecimiento ve solo sus datos.

Requisitos completos: [docs/requerimientos.md](docs/requerimientos.md) · Plan por etapas: [docs/plan.md](docs/plan.md) · Principios obligatorios: [docs/constitution.md](docs/constitution.md) · Estado y decisiones: [MEMORY.md](MEMORY.md)

## Sistema de agentes (SDD)

- `/sdd <petición>`: funcionalidades nuevas o cambios de requisitos. El agente principal actúa como **coordinador** (no edita código) y delega en los subagentes de `.claude/agents/`:
  - `planificador`: spec, plan y tareas en `specs/NNN-nombre/`. Solo escribe en `specs/` (hook).
  - `implementador`: una tarea por vez, tests primero, verifica en el navegador.
  - `revisor`: QA de la spec y validación RF por RF. No edita; solo corre tests y comandos de lectura de Git (hook).
- `/feature <cambio>`: cambios chicos sin spec.
- Plantillas y formato EARS: `.claude/skills/sdd/plantillas.md`.
- Nadie hace `git push` ni lee o edita `.env` (`.claude/settings.json`).

## Comandos

- `npm run dev`: API (3000) y web (5173).
- `npm test`: tests de la API (Vitest + supertest) sobre la base `cowregister_test`.
- `npm run typecheck`: tipos de API y web.
- `npm run db:migrate -w api -- --name <nombre>`: nueva migración. `npm run db:generate -w api` regenera el cliente.

## Stack

- `web/`: React + Vite + TypeScript
- `api/`: Node + Express + TypeScript
- Base de datos: PostgreSQL 18 con Prisma (ORM y migraciones)

## Reglas del dominio

- Caravana y botón son el mismo número (`numero`). Es único entre los animales **activos** de un establecimiento.
- Nunca se borran animales: la venta o muerte es una **baja lógica** (`estado = BAJA`) y conserva todo el historial.
- Los animales tienen un estado (recién nacido, vaquillona, en ordeñe, seca, baja). Cada establecimiento define con `ReglaLote` a qué lote va cada estado, y el animal se mueve solo al cambiar de estado. También se puede mover a mano.
- Fecha probable de parto = fecha de servicio + 283 días. Cada tacto puede ajustarla o anularla (aborto); vale la del último tacto.
- La app debe poder funcionar sin conexión en el futuro (Etapa 6). Desde ahora: IDs UUID, campos `creadoEn`/`actualizadoEn`, y eventos que solo se agregan.

## Seguridad (datos sensibles)

- Toda consulta a datos del tambo se filtra por `establecimientoId` de la sesión. Nunca se confía en un `establecimientoId` enviado por el cliente.
- Contraseñas con hash argon2. Sesión en cookie `httpOnly`.
- Validar toda entrada a la API.
- Secretos solo en `.env` (nunca se commitea). Se documentan en `.env.example` sin valores reales.

## Convenciones

- Nombres del dominio en español (`Animal`, `Lote`, `Tacto`, `Secado`); el resto del código técnico puede ir en inglés.
- Una rama por paso del plan (`etapa1/login`, `setup/...`), commits en español con formato `tipo: descripción` (`feat`, `fix`, `docs`, `chore`, `test`, `refactor`).
- Cada paso termina probado y con commit.

## Forma de trabajar con el usuario

El usuario es estudiante de tecnicatura y este es su primer proyecto completo: explicar qué se hace y por qué antes de implementar, en español rioplatense, y planificar antes de escribir código.
