import { useMemo } from 'react';
import { hoyIso } from '../reproduccion/reproduccionDatos';
import { opcionesFecha, relojAtrasado, type OpcionesFecha } from './relojTablet';
import { useSinConexion } from './SinConexionProvider';

// Spec 012 (RF-14, RF-15): compara el reloj de la tablet con la hora de la última copia y devuelve qué
// debe recibir el campo fecha de un formulario de carga. Se calcula al montar el formulario y cada vez
// que llega una copia nueva (cambia `generadaEn`): si el reloj ya está bien, el aviso se va y vuelve "hoy".
export function useRelojTablet(): OpcionesFecha & { atrasado: boolean } {
  const { generadaEn } = useSinConexion();
  return useMemo(() => {
    const atrasado = relojAtrasado(new Date(), generadaEn);
    return { atrasado, ...opcionesFecha(atrasado, hoyIso()) };
  }, [generadaEn]);
}
