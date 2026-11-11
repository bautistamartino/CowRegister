---
name: feature
description: Cambio chico en CowRegister sin spec (un texto, un estilo, un bug acotado, un ajuste menor), respetando la constitución y con tests.
argument-hint: <qué cambio chico querés>
disable-model-invocation: true
---

# Cambio chico (sin spec)

Pedido: **$ARGUMENTS**

1. **¿Es chico de verdad?** Si agrega una funcionalidad nueva, cambia reglas del negocio, toca la estructura de la base o lleva más de unos pocos archivos, frená y sugerí `/sdd`.
2. Leé `docs/constitution.md` y el código afectado.
3. Explicale al usuario en 2–3 líneas qué vas a cambiar y por qué, y creá una rama `fix/<nombre>` o `mejora/<nombre>`.
4. Si toca lógica, **test primero** (rojo → verde) en `api/tests/`.
5. Implementá el cambio.
6. Corré `npm test` y `npm run typecheck`. Si es visual, verificalo en el navegador (escritorio, 768 px y 375 px).
7. Pedile a `revisor` una revisión rápida del `git diff` contra la constitución.
8. Mostrale al usuario qué cambió y el veredicto, y hacé el commit con su OK. Nunca hagas `git push`.
