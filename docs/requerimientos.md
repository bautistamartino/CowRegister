# Requerimientos — CowRegister

## Objetivo

Software simple y funcional para registrar los eventos importantes de las vacas de un establecimiento lechero (nacimientos, secados, muertes, ventas, inseminaciones y tactos), reemplazando los registros en papel. Debe facilitar la carga, la búsqueda de un dato puntual y la generación de informes.

## Usuarios

- Sistema para **varios tambos**. Cada establecimiento tiene sus propios usuarios y datos, aislados de los demás.
- Roles: **dueño**, **encargado**, **veterinario**.
- Requiere **login** y manejo cuidadoso de datos sensibles.

## Funcionalidades

### Animales
- Identificación por número de caravana, que es el mismo número que el botón RFID leído con un bastón y consultado en una tablet.
- Al dar de baja un animal, normalmente no se reutiliza su número.
- Baja por venta o muerte, conservando el historial (baja lógica).
- **Carga de animales** (decidido el 2026-11-10):
  - **Alta manual** de a una, para las vacas que se agregan en el día a día.
  - **Pegar desde una planilla** (Excel o Google Sheets) para cargar el rodeo existente de una vez: el usuario copia las filas y las pega en la app, ve una vista previa con las filas correctas y las que tienen errores (con el motivo) y recién al confirmar se guardan. Columnas fijas, por ejemplo: número, sexo, fecha de nacimiento, estado, número de la madre.
  - No se suben archivos (se respeta el límite de "sin archivos"). La carga en serie con el bastón quedó descartada por ahora.
  - En esta etapa solo se cargan los datos básicos; la situación reproductiva actual de cada vaca (preñez, servicios) se carga en la Etapa 2.

### Eventos
- **Parición**: da de alta al ternero con sexo, número de caravana, madre y genética del semen usado.
- **Secado**.
- **Servicio / inseminación**: con el semen (toro) utilizado.
- **Tacto**: preñada sí/no, anomalías detectadas. Si está preñada, se calcula la fecha probable de parto (servicio + ~283 días); los tactos siguientes pueden ajustarla o anularla en caso de aborto.
- **Venta** y **muerte**.

### Lotes
- Totalmente personalizables por cada tambo.
- Cada tambo decide qué lote es destino para cada estado del animal (recién nacido, en ordeñe, seca, etc.).
- Asignación automática al cambiar de estado, con posibilidad de mover animales a mano.
- Los terneros van por ahora a un lote "Terneros" (destino final a definir).

### Búsqueda e historial
- Buscador rápido por número para ver el estado, el lote y el historial del animal.
- Historial de eventos ordenado por fecha.

### Producción e informes
- Registro de **litros por vaca en cada ordeño**.
- Análisis productivos avanzados.
- Informes más usados: **resultado de inseminación**, **natalidad** y **litros de leche**. Otros a definir.

## Condiciones de uso

- Uso en PC y en **tablet**.
- La conexión a internet en el tambo existe pero se cae seguido: la app debe poder **seguir funcionando sin conexión** y sincronizar al volver.

## Fuera de alcance

- Imágenes u otros archivos adjuntos.
- Seguimiento de la ubicación de los animales en tiempo real.
- Alertas automáticas por enfermedades o problemas reproductivos.

## Pendiente de definir

- Si los litros se cargan a mano o se importan desde el equipo de ordeñe.
- Destino final de los terneros.
- Otros informes.
