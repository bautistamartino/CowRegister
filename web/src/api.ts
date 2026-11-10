// Cliente HTTP para hablar con la API. Todas las llamadas pasan por acá.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detalles: { campo: string; mensaje: string }[] = [],
  ) {
    super(message);
  }
}

export async function api<T>(ruta: string, opciones: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${ruta}`, {
      method: opciones.method ?? 'GET',
      headers: opciones.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
      credentials: 'same-origin', // envía la cookie de sesión
    });
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Revisá tu conexión.');
  }

  if (res.status === 204) return undefined as T;

  const datos = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, datos?.error ?? `Error ${res.status}`, datos?.detalles ?? []);
  }
  return datos as T;
}

// Tipos que devuelve la API
export type Rol = 'DUENO' | 'ENCARGADO' | 'VETERINARIO';

export type Perfil = {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  establecimiento: { id: string; nombre: string };
};
