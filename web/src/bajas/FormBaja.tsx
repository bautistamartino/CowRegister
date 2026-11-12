import { useState, type FormEvent } from 'react';
import { api, ApiError, type BajaRegistrada, type MotivoBaja } from '../compartido/api';
import { formatearFecha } from '../animales/animalesDatos';
import { FECHA_MINIMA, hoyIso, interpretar } from '../reproduccion/reproduccionDatos';
import { Campo } from '../compartido/Campo';

type Props = {
  animalId: string;
  numero: string;
  alCancelar: () => void;
  alRegistrar: (baja: BajaRegistrada) => void;
  // 404: otra persona ya dio de baja al animal o cambió (RF-21). La ficha muestra el mensaje y se recarga.
  alNoDisponible: () => void;
};

// Dar de baja (RF-19): primero se completan motivo, fecha y observaciones; después un paso de
// confirmación con el texto exacto de la spec. Los valores viven en estado (no en el DOM) para que
// "Volver" y un error 400 no borren lo que el usuario escribió.
export function FormBaja({ animalId, numero, alCancelar, alRegistrar, alNoDisponible }: Props) {
  // Sin valor por defecto en el motivo (el usuario tiene que elegirlo); la fecha arranca en hoy.
  const [motivo, setMotivo] = useState<MotivoBaja | ''>('');
  const [fecha, setFecha] = useState(hoyIso());
  const [observaciones, setObservaciones] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Paso 1: no se manda nada todavía; solo se pasa a la confirmación (si el motivo está elegido).
  function continuar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (motivo === '') {
      setErrores({ motivo: 'Elegí el motivo de la baja: venta o muerte' });
      return;
    }
    setErrores({});
    setConfirmando(true);
  }

  // Paso 2: recién acá se guarda.
  async function confirmar() {
    setError(null);
    setEnviando(true);
    try {
      const baja = await api<BajaRegistrada>(`/animales/${encodeURIComponent(animalId)}/baja`, {
        method: 'POST',
        body: { motivo, fecha, observaciones },
      });
      alRegistrar(baja);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        alNoDisponible();
        return;
      }
      // 400: se vuelve al formulario con lo cargado y el mensaje junto al campo (o arriba si es general).
      const r = interpretar(err);
      setErrores(r.campos);
      setError(r.general);
      setConfirmando(false);
      setEnviando(false);
    }
  }

  if (confirmando) {
    return (
      <div className="formulario-lote formulario-evento" role="group" aria-label="Confirmar la baja">
        <h3>Confirmar la baja</h3>
        {error && (
          <div className="alerta" role="alert">
            {error}
          </div>
        )}
        <p className="aviso">
          Vas a dar de baja a «{numero}». Sale de los lotes y de los listados activos, pero conserva su historial. ¿Confirmás?
        </p>
        <p className="texto-suave">
          {motivo === 'venta' ? 'Venta' : 'Muerte'} · {formatearFecha(fecha)}
          {observaciones.trim() ? ` · ${observaciones.trim()}` : ''}
        </p>
        <div className="acciones">
          <button type="button" className="boton boton-peligro-lleno" onClick={confirmar} disabled={enviando}>
            {enviando ? 'Guardando…' : 'Confirmar baja'}
          </button>
          <button type="button" className="boton-secundario" onClick={() => setConfirmando(false)} disabled={enviando}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="formulario-lote formulario-evento" onSubmit={continuar} noValidate>
      <h3>Dar de baja</h3>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <div className="campo">
        <label htmlFor="baja-motivo">Motivo</label>
        <select
          id="baja-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value as MotivoBaja | '')}
          aria-invalid={!!errores.motivo}
        >
          <option value="">Elegí un motivo</option>
          <option value="venta">Venta</option>
          <option value="muerte">Muerte</option>
        </select>
        {errores.motivo && <span className="campo-error">{errores.motivo}</span>}
      </div>
      <Campo
        etiqueta="Fecha de la baja"
        name="fecha"
        id="baja-fecha"
        type="date"
        value={fecha}
        onChange={(e) => setFecha(e.target.value)}
        min={FECHA_MINIMA}
        max={hoyIso()}
        error={errores.fecha}
      />
      <Campo
        etiqueta="Observaciones (opcional)"
        name="observaciones"
        id="baja-observaciones"
        value={observaciones}
        onChange={(e) => setObservaciones(e.target.value)}
        ayuda="Hasta 200 caracteres: comprador, precio, causa de la muerte, etc."
        error={errores.observaciones}
      />
      <div className="acciones">
        <button type="submit" className="boton">
          Continuar
        </button>
        <button type="button" className="boton-secundario" onClick={alCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
