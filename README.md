# CowRegister

Sistema web para registrar las vacas de un tambo y sus eventos (pariciones, secados, servicios, tactos, ventas y muertes), organizar el rodeo en lotes y consultar informes productivos.

> 🚧 En desarrollo. Ver el [plan por etapas](docs/plan.md) y los [requerimientos](docs/requerimientos.md).

## Tecnologías

- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js + Express + TypeScript
- **Base de datos:** PostgreSQL + Prisma

## Requisitos para desarrollar

- Node.js 24 o superior
- PostgreSQL 18
- Git

## Cómo correrlo en desarrollo

```bash
npm install
cp api/.env.example api/.env
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:3000 (en desarrollo, la web reenvía `/api` a la API)

## Estructura

```
api/    → servidor Express + TypeScript
web/    → app React + Vite + TypeScript
docs/   → requerimientos y plan
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta API y web juntas |
| `npm run typecheck` | Revisa los tipos de todo el proyecto |
| `npm run build` | Genera la versión de producción |
