# 011 — Interfaz sin conexión (notas, sin redactar todavía)

Depende de la 010 (API idempotente y motor local). Estas ideas salen de la partición de la 010; la spec se redacta cuando la 010 esté cerrada.

## Formularios sin conexión (un RF por evento)
- Servicio (fecha, inseminación o monta natural, semen o toro activos de la copia más "No especificado"), tacto (preñada o vacía, fecha probable opcional, anomalías), parto (fecha y una o más crías: sexo, nacida muerta, número de las vivas, observaciones; **un solo pendiente**), secado, baja por venta o muerte.
- Anular el último evento de la ficha (servicio, tacto, parto o secado) con motivo; "Descartar" con confirmación cuando es un pendiente; revertir baja deshabilitado con "Esto necesita conexión".
- Confirmación "Guardado en la tablet: pendiente de sincronizar"; error "No se pudo guardar en la tablet: <motivo>. Conectate para sincronizar los pendientes".
- Sin conexión, lista cerrada de la 009 + estas acciones según el rol; todo lo demás "Esto necesita conexión" con opciones deshabilitadas.
- Cuando se descarta un pendiente y la vaca tiene otros cargados después: avisar cuáles son y que seguirán enviándose (la 010 devuelve la lista).

## Fichas locales y listado
- Marcas en el historial: "Pendiente de sincronizar", "Enviado: se confirma al actualizar", "Rechazado: <motivo>", "Anulación pendiente", "En espera del anterior".
- Parto pendiente: madre "en ordeñe", crías listadas dentro del parto, aviso "El lote se asigna al sincronizar"; las crías no aparecen en el listado ni el buscador.
- Secado pendiente: vaca "seca", sin litros. Baja pendiente: animal en el listado con "Baja pendiente de sincronizar", ficha en solo lectura sin eventos ni litros.
- Mostrar "Cargado sin conexión el <fecha y hora>" en el historial (la API de la 010 ya devuelve el dato) y definir la **zona horaria** en que se muestran fechas y horas.

## Pantalla "Pendientes de sincronizar"
- Todos los tipos: número de la vaca, tipo con resumen ("Tacto preñada", "Parto con 2 crías", "Baja por venta"), fecha del evento, cuándo se cargó, estado (esperando, enviando, en espera del anterior, rechazado con motivo), con "Reintentar", "Reintentar ahora" y "Descartar".
- Descartar uno "en espera del anterior": confirmación con vaca, tipo y fecha.
- Mostrar y poder cerrar los avisos que devolvió el servidor al aceptar.
- Ayuda en rechazo por vaca ya no activa: "Puede que el animal haya sido dado de baja: actualizá los datos y revisá su historial".
- Visible también para quien solo carga servicios y tactos (veterinario).
- Menú: conteo de no aceptados y rechazados destacados; confirmaciones de cierre de sesión y cambio de usuario con la cantidad total.

## Avisos
- Reloj de la tablet atrasado: si es anterior a la fecha y hora de la última copia por **más de 5 minutos** (misma tolerancia que la hora informativa), avisar "El reloj de la tablet parece atrasado: revisá que la fecha sea la correcta" y no proponer la fecha sino pedir que se elija.

## Interfaz (criterios medibles)
- Campos y botones de al menos 48 px de alto; sin desborde horizontal a 768 px y 375 px; modo claro y oscuro con las variables de `estilos.css` (no pedir "contraste" sin criterio medible).
- Textos exactos nuevos: "En espera del anterior", "Anulación pendiente", "Baja pendiente de sincronizar", "Cargado sin conexión el <fecha y hora>".

## Verificación
- Casi todo en el navegador con la red cortada (768 px y 375 px, claro y oscuro); la lógica ya está probada por los tests de la 010.
