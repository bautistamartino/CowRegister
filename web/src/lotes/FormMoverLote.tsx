import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type AnimalFicha, type Lote } from '../compartido/api';

type Props = {
  ficha: AnimalFicha;
  alCancelar: () => void;
  alGuardar: (ficha: AnimalFicha) => Promise<void>;
};

// Mover de lote a mano (spec 005): a cualquier lote del tambo o a "sin lote". No cambia el estado.
export function FormMoverLote({ ficha, alCancelar, alGuardar }: Props) {
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // '' = "Sin lote". Arranca en el lote actual.
  const [elegido, setElegido] = useState(ficha.lote?.id ?? '');

  useEffect(() => {
    api<Lote[]>('/lotes')
      .then(setLotes)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los lotes'));
  }, []);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const nueva = await api<AnimalFicha>(`/animales/${encodeURIComponent(ficha.id)}/lote`, {
        method: 'PATCH',
        body: { loteId: elegido === '' ? null : elegido },
      });
      await alGuardar(nueva);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error inesperado');
      setEnviando(false);
    }
  }

  return (
    <form className="formulario-lote formulario-evento" onSubmit={enviar}>
      <h3>Mover de lote</h3>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <div className="campo">
        <label htmlFor="mover-lote">Lote nuevo</label>
        <select id="mover-lote" value={elegido} onChange={(e) => setElegido(e.target.value)} disabled={!lotes}>
          <option value="">Sin lote</option>
          {(lotes ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.nombre}
            </option>
          ))}
        </select>
        <span className="campo-ayuda">El estado del animal no cambia. Hoy está en: {ficha.lote ? ficha.lote.nombre : 'sin lote'}.</span>
      </div>
      <div className="acciones">
        <button type="submit" className="boton" disabled={enviando || !lotes}>
          {enviando ? 'Guardando…' : 'Mover'}
        </button>
        <button type="button" className="boton-secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
