// Migración PURA de los registros guardados por la spec 009 al formato de la spec 010 (RF-13).
//
// En la 009 solo había litros, con los datos "sueltos" en el pendiente (`fecha`, `turno`, `litros`).
// En la 010 cada pendiente tiene un `tipo` y sus datos van juntos en `datos`. Estas funciones reciben el
// registro viejo y devuelven el nuevo; no tocan IndexedDB (eso lo hace almacenIndexedDb.ts dentro de la
// transacción de actualización). Son idempotentes: si el registro ya tiene `tipo`, se devuelve igual.

type Registro = Record<string, unknown>;

const esObjeto = (x: unknown): x is Registro => typeof x === 'object' && x !== null && !Array.isArray(x);

// Pendiente de la 009 -> formato 010: conserva todo lo demás (id, dueño, orden, estado, motivo, intentos...).
export function migrarPendiente009(viejo: unknown): unknown {
  if (!esObjeto(viejo) || 'tipo' in viejo) return viejo;
  const { fecha, turno, litros, ...resto } = viejo;
  return { ...resto, tipo: 'LITROS', datos: { fecha, turno, litros } };
}

// Enviado de la 009 -> formato 010: agrega el tipo, los datos y `aceptadoEn` (de `registro.registradoEn`,
// que es hora del servidor). Conserva `registro`.
export function migrarEnviado009(viejo: unknown): unknown {
  if (!esObjeto(viejo) || 'tipo' in viejo) return viejo;
  const registro = esObjeto(viejo.registro) ? viejo.registro : null;
  const aceptado = registro ? Date.parse(String(registro.registradoEn)) : NaN;
  return {
    ...viejo,
    tipo: 'LITROS',
    datos: { fecha: registro?.fecha, turno: registro?.turno, litros: registro ? String(registro.litros) : undefined },
    // Si la fecha no se puede leer queda en 0 ("muy antigua"): no se inventa una hora del servidor.
    aceptadoEn: Number.isNaN(aceptado) ? 0 : aceptado,
  };
}
