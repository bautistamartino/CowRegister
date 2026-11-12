import { useSyncExternalStore } from 'react';
import { obtenerConexion } from './conexion';

// true si hay conexión con el servidor; la pantalla se vuelve a dibujar sola cuando cambia (spec 009).
// useSyncExternalStore es la forma de React de leer un dato que vive fuera de React.
export function useEnLinea(): boolean {
  const conexion = obtenerConexion();
  return useSyncExternalStore(
    (avisar) => conexion.suscribir(() => avisar()),
    () => conexion.enLinea(),
  );
}
