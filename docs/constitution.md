# Constitución de CowRegister

Principios que **ninguna spec, plan o implementación puede romper**. Si una petición choca con alguno, se frena y se consulta al responsable del proyecto. Cambiar esta constitución requiere su aprobación explícita.

## 1. Datos de cada tambo aislados
- Toda consulta a datos de un tambo se filtra por el `establecimientoId` **de la sesión**.
- Nunca se acepta un `establecimientoId` enviado por el cliente.
- Pedir un recurso de otro tambo responde **404** (no 403), para no revelar que existe.
- Toda ruta nueva que toque datos de un tambo tiene un test de aislamiento entre dos tambos.

> **Excepción acotada: administrador de la plataforma.**
> 1. Existe un rol que no pertenece a ningún tambo. Sus cuentas y sus sesiones están separadas de las de los usuarios de tambo.
> 2. Lo único que ve del tambo es esta **lista blanca de la cuenta**: id, nombre, fecha de alta, dueño (nombre y email), cantidad de usuarios activos, cantidad de animales activos y la lista de usuarios (nombre, email, rol, si está activo); y lo que sumen las specs posteriores que la amplíen explícitamente (la 015 agrega estado, último ingreso y motivo de baja).
> 3. **El conteo de animales activos es la única consulta permitida sobre datos del tambo.** Nunca ve ni modifica animales (ni sus números), eventos, litros, lotes, historial, informes ni la copia local.
> 4. Las rutas `/api/admin` son la **única excepción** a "nunca se acepta un identificador de tambo del cliente": ahí el id del tambo viaja en la ruta y es legítimo, porque quien lo envía es el administrador. Todas las demás rutas siguen tomando el tambo de la sesión.
> 5. Todo `/api/admin` está detrás de **un único control de acceso** aplicado al conjunto de rutas, y un test recorre todas las rutas del administrador para comprobarlo. Hay además un test de aislamiento propio: ningún rol de tambo accede, y el administrador no accede a ninguna ruta de datos del tambo.
> 6. Las tablas nuevas llevan UUID y `creadoEn`/`actualizadoEn` (las editables); el registro de auditoría y los registros de baja que sume la 015 solo se agregan.
>
> El resto del principio 1 no cambia: para todos los demás roles, el tambo sale siempre de la sesión y un recurso ajeno responde 404. (Aprobada por el responsable el 2026-11-19, spec [014-administrador](../specs/014-administrador/spec.md).)

## 2. Seguridad
- Contraseñas solo con hash argon2id. Tokens de sesión solo hasheados en la base.
- Las respuestas nunca incluyen `passwordHash` ni `tokenHash`.
- Toda entrada a la API se valida con zod. Los mensajes de error van en español.
- Los permisos por rol se controlan en la API, nunca solo en la interfaz.
- Los secretos van en `.env`, que nunca se commitea.

## 3. El historial no se pierde
- Los animales no se borran: venta o muerte es una **baja lógica** (`estado = BAJA` + `fechaBaja`).
- Los eventos (partos, servicios, tactos, secados, bajas) solo se **agregan**. Corregir un error se hace de forma explícita y queda registrado.

## 4. Reglas del dominio
- Caravana y botón son el mismo `numero` (texto). Es único entre los animales **activos** del tambo (índice parcial en la base).
- El estado del animal define su lote mediante `ReglaLote`. Siempre se puede mover a mano.
- Fecha probable de parto = fecha de servicio + 283 días. Vale la del último tacto, que puede anularla (aborto).

## 5. Preparado para funcionar sin conexión (Etapa 6)
- IDs UUID. Todas las tablas tienen `creadoEn`; las editables, también `actualizadoEn`.
- No depender de IDs autoincrementales ni de que el servidor genere datos imprescindibles.

## 6. Base de datos
- Todo cambio de estructura se hace con una migración de Prisma, versionada en Git.
- Las reglas críticas (unicidad, coherencia) se garantizan **también en la base**, no solo en el código.
- Lo que Prisma no expresa (índices parciales, CHECK) se agrega a mano en el SQL de la migración, con un comentario.

## 7. Calidad
- La lógica nueva se escribe con **tests primero** (Vitest + supertest en `api/tests/`).
- Nunca se da una tarea por terminada con tests en rojo o errores de tipos (`npm test`, `npm run typecheck`).
- Los tests usan la base `cowregister_test`, nunca la de desarrollo.
- Los cambios visuales se verifican en el navegador, también en ancho de tablet (768 px) y celular (375 px).

## 8. Interfaz
- En español rioplatense y pensada para la tablet en el tambo: campos y botones de al menos 48 px de alto.
- El buscador acepta el número tipeado o leído por el bastón RFID (que "tipea" el número y Enter).
- Modo claro y oscuro con las variables de `web/src/estilos.css`.

## 9. Simplicidad
- Se construye lo que pide la spec, no más. Sin dependencias nuevas sin justificarlo en el plan.
- Nombres del dominio en español (`Animal`, `Lote`, `Tacto`). Código claro y comentado donde la intención no sea obvia: el responsable del proyecto está aprendiendo.

## 10. Git
- Una rama por spec o cambio. Commits en español con formato `tipo: descripción`.
- Nadie hace `git push` sin que el responsable lo pida.
