import { useMemo } from 'react';
import { useCola } from './ColaProvider';
import { useSinConexion } from './SinConexionProvider';

// Un texto que CAMBIA cuando cambian los pendientes (alta, baja o cambio de estado), los enviados o la copia
// ("al día de"). Las pantallas lo suman a las dependencias de sus efectos de lectura: así la ficha, la reproducción
// y el historial se vuelven a leer solos (spec 011, RF-25). Solo relee datos: no toca formularios ni paneles abiertos.
export function useVersionCola(): string {
  const { pendientes, enviados } = useCola();
  const { generadaEn } = useSinConexion();
  return useMemo(
    () => `${generadaEn ?? ''}|${pendientes.map((p) => `${p.id}:${p.estado}`).join(',')}|${enviados.map((e) => e.id).join(',')}`,
    [pendientes, enviados, generadaEn],
  );
}
