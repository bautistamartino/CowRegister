// Sesión del administrador de la plataforma (spec 014, RF-13, RF-14).
//
// REGLA: este archivo NO importa nada de `sinconexion/`. El administrador no tiene copia local, ni cola de
// pendientes, ni "propietario" de los datos de la tablet: ingresar o salir no debe leer, guardar ni BORRAR
// nada del almacén. Así, una tablet con datos de un tambo no se pierde porque alguien entre como administrador.
// (Un test lee este archivo y falla si aparece esa importación.)

export type PerfilAdmin = { id: string; nombre: string; email: string };

// Lo que devuelve POST /api/auth/login cuando quien ingresa es el administrador.
export function esPerfilAdmin(x: unknown): x is PerfilAdmin & { rol: 'ADMIN' } {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return o.rol === 'ADMIN' && typeof o.id === 'string' && typeof o.nombre === 'string' && typeof o.email === 'string';
}

// Arma el perfil del administrador a partir de la respuesta del ingreso (null si no lo es). No hace nada más.
export function ingresarAdmin(respuesta: unknown): PerfilAdmin | null {
  if (!esPerfilAdmin(respuesta)) return null;
  return { id: respuesta.id, nombre: respuesta.nombre, email: respuesta.email };
}

// Cierra la sesión del administrador en el servidor. NO borra nada local (no hay nada local suyo).
// Si el servidor no responde el error sube y la sesión queda abierta: no se finge un cierre que no ocurrió.
export async function cerrarSesionAdmin(args: { cerrarServidor: () => Promise<void> }): Promise<void> {
  await args.cerrarServidor();
}
