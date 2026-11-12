import { useState, type FormEvent } from 'react';
import { api, type RespuestaRegistro } from '../compartido/api';
import { FECHA_MINIMA, hoyIso, interpretar } from './reproduccionDatos';
import { Campo } from '../compartido/Campo';

type Props = {
  animalId: string;
  alCancelar: () => void;
  alRegistrar: (r: RespuestaRegistro) => Promise<void>;
};

// Formulario de secado: solo la fecha (RF-18). La API pasa la vaca a "seca" y a su lote destino.
export function FormSecado({ animalId, alCancelar, alRegistrar }: Props) {
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setErrores({});
    setError(null);
    setEnviando(true);
    try {
      const r = await api<RespuestaRegistro>(`/animales/${encodeURIComponent(animalId)}/secados`, {
        method: 'POST',
        body: { fecha: String(d.get('fecha')) },
      });
      await alRegistrar(r);
    } catch (err) {
      const r = interpretar(err);
      setErrores(r.campos);
      setError(r.general);
      setEnviando(false);
    }
  }

  return (
    <form className="formulario-lote formulario-evento" onSubmit={enviar}>
      <h3>Nuevo secado</h3>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <Campo etiqueta="Fecha" name="fecha" id="secado-fecha" type="date" required defaultValue={hoyIso()} min={FECHA_MINIMA} max={hoyIso()} error={errores.fecha} />
      <div className="acciones">
        <button type="submit" className="boton" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar secado'}
        </button>
        <button type="button" className="boton-secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
