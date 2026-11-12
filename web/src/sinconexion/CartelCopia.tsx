import { textoDatosAlDia, useSinConexion } from './SinConexionProvider';
import { useEnLinea } from './useConexion';

// Cartel fino bajo el menú con el estado de la copia local (spec 009):
//   "Actualizando…" mientras descarga, "Datos al día de <fecha y hora>" cuando terminó,
//   y el motivo si la actualización falló (conservando la copia anterior).
// "Actualizar ahora" fuerza la descarga (RF-10).
export function CartelCopia() {
  const { generadaEn, actualizando, falla, actualizarAhora } = useSinConexion();
  const enLinea = useEnLinea();
  // Sin conexión lo reemplaza el cartel "Sin conexión: datos al día de…" (AvisoConexion).
  if (!enLinea || (!generadaEn && !actualizando)) return null;

  return (
    <div className="cartel-copia" role="status">
      <div className="cartel-copia-texto">
        {actualizando ? <span>Actualizando…</span> : <span>{textoDatosAlDia(generadaEn)}</span>}
        {/* Con actualización en curso se sigue mostrando la fecha vieja: usamos la copia anterior. */}
        {actualizando && generadaEn && <span className="texto-suave"> · {textoDatosAlDia(generadaEn)}</span>}
        {!actualizando && falla && (
          <span className="cartel-copia-falla">
            {' '}
            · No se pudo actualizar: {falla.mensaje.replace(/\.$/, '')}. Se conservan los datos anteriores.
          </span>
        )}
      </div>
      <button type="button" className="boton-secundario" onClick={actualizarAhora} disabled={actualizando}>
        Actualizar ahora
      </button>
    </div>
  );
}
