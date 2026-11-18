// Una sola condición para el enlace "Pendientes" del menú y para la pantalla (spec 012, RF-12). Lógica pura.
//
// Dueño y encargado cargan litros, así que siempre la ven. El veterinario la ve solo si tiene pendientes sin aceptar
// o avisos del servidor sin cerrar; sin nada, ni enlace ni pantalla vacía.

import type { Rol } from '../compartido/api';

export function mostrarPendientes(args: { rol: Rol; total: number; avisos: number }): boolean {
  return args.rol !== 'VETERINARIO' || args.total > 0 || args.avisos > 0;
}
