import { useState, type FormEvent } from 'react';
import { api, ApiError, type BajaRevertida } from '../compartido/api';
import { interpretar } from '../reproduccion/reproduccionDatos';
import { Campo } from '../compartido/Campo';

type Props = {
  animalId: string;
  alCancelar: () => void;
  alRevertir: (r: BajaRevertida) => void;
  // 404: otra persona ya la revirtió o el animal cambió (RF-21).
  alNoDisponible: () => void;
};

// Revertir una baja (RF-19): pide el motivo de la reversión. Un 409 (el número ya lo usa otro animal
// activo) se muestra acá mismo, sin salir de la ficha de baja; un 400 conserva lo escrito.
export function FormRevertirBaja({ animalId, alCancelar, alRevertir, alNoDisponible }: Props) {
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrores({});
    setError(null);
    setEnviando(true);
    try {
      const r = await api<BajaRevertida>(`/animales/${encodeURIComponent(animalId)}/revertir-baja`, {
        method: 'POST',
        body: { motivoReversion: motivo },
      });
      alRevertir(r);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        alNoDisponible();
        return;
      }
      const r = interpretar(err);
      // El campo de la API es motivoReversion; el mensaje va junto al campo.
      setErrores(r.campos);
      setError(r.general);
      setEnviando(false);
    }
  }

  return (
    <form className="formulario-lote formulario-evento" onSubmit={enviar} noValidate>
      <h3>Revertir baja</h3>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <Campo
        etiqueta="Motivo de la reversión"
        name="motivoReversion"
        id="revertir-motivo"
        required
        autoFocus
        maxLength={200}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        ayuda="Obligatorio. La baja no se borra: queda anulada en el historial."
        error={errores.motivoReversion}
      />
      <div className="acciones">
        <button type="submit" className="boton boton-peligro-lleno" disabled={enviando}>
          {enviando ? 'Revirtiendo…' : 'Confirmar reversión'}
        </button>
        <button type="button" className="boton-secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
