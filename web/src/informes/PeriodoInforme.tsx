import { FECHA_MINIMA, hoyIso } from '../reproduccion/reproduccionDatos';
import { Campo } from '../compartido/Campo';

type Props = {
  desde: string;
  hasta: string;
  error: string | null; // mensaje de la validación local (null si el período está bien)
  alCambiar: (desde: string, hasta: string) => void;
};

// Campos "Desde" y "Hasta" de los informes (RF-14) con el mensaje de error debajo.
export function PeriodoInforme({ desde, hasta, error, alCambiar }: Props) {
  return (
    <div className="seccion">
      <div className="filtros">
        <Campo etiqueta="Desde" id="informe-desde" type="date" value={desde} min={FECHA_MINIMA} max={hoyIso()} onChange={(e) => alCambiar(e.target.value, hasta)} />
        <Campo etiqueta="Hasta" id="informe-hasta" type="date" value={hasta} min={FECHA_MINIMA} max={hoyIso()} onChange={(e) => alCambiar(desde, e.target.value)} />
      </div>
      {error && <div className="alerta" role="alert">{error}</div>}
    </div>
  );
}
