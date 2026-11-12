import { formatearFechaHora } from './fechaHora';
import { useSinConexion } from './SinConexionProvider';
import { useEnLinea } from './useConexion';

// Cartel fijo de toda la interfaz mientras no hay conexión (spec 009, RF-41):
// "Sin conexión: datos al día de <fecha y hora>". Desaparece solo cuando vuelve la señal.
export function AvisoConexion() {
  const enLinea = useEnLinea();
  const { generadaEn } = useSinConexion();
  if (enLinea) return null;
  return (
    <div className="aviso-conexion" role="status">
      {generadaEn ? `Sin conexión: datos al día de ${formatearFechaHora(generadaEn)}` : 'Sin conexión'}
    </div>
  );
}

// Leyenda para las pantallas que muestran datos de la copia (listado y fichas, RF-15): aclara que
// lo que se ve es local y de cuándo es. Solo aparece sin conexión.
export function AvisoDatosLocales() {
  const enLinea = useEnLinea();
  const { generadaEn } = useSinConexion();
  if (enLinea) return null;
  return (
    <p className="aviso" role="note">
      Datos locales de la tablet{generadaEn ? `, al día de ${formatearFechaHora(generadaEn)}` : ''}. Pueden haber cambiado en el servidor.
    </p>
  );
}
