import { useState, type FormEvent } from 'react';
import { api, type AnimalFicha, type Sexo } from '../api';
import { NOMBRE_SEXO, formatearFecha } from '../animales';
import { FECHA_MINIMA, hoyIso, interpretar } from '../reproduccion';
import { Campo } from './Campo';

type Props = {
  ficha: AnimalFicha;
  alCancelar: () => void;
  alGuardar: (ficha: AnimalFicha, avisos: string[]) => Promise<void>;
};

// Formulario de edición (spec 005): número, sexo, fecha de nacimiento y madre (por número).
// No ofrece el estado. En una cría de parto, sexo, fecha y madre vienen del parto: se muestran como
// texto con el motivo y solo se puede cambiar el número (RF-7).
export function FormEditarAnimal({ ficha, alCancelar, alGuardar }: Props) {
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const esCriaDeParto = ficha.parto !== null;

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setErrores({});
    setError(null);

    // Solo se mandan los campos que cambiaron (omitido = "no se toca"). Vaciar la fecha o la madre manda null.
    const cuerpo: Record<string, string | null> = {};
    const numero = String(d.get('numero') ?? '').trim();
    if (numero.toUpperCase() !== ficha.numero) cuerpo.numero = numero;
    if (!esCriaDeParto) {
      const sexo = String(d.get('sexo'));
      if (sexo !== ficha.sexo) cuerpo.sexo = sexo;
      const fecha = String(d.get('fechaNacimiento') ?? '');
      if (fecha !== (ficha.fechaNacimiento ?? '')) cuerpo.fechaNacimiento = fecha === '' ? null : fecha;
      const madre = String(d.get('madre') ?? '').trim();
      if (madre.toUpperCase() !== (ficha.madre?.numero ?? '')) cuerpo.madre = madre === '' ? null : madre;
    }
    if (Object.keys(cuerpo).length === 0) {
      setError('No hay cambios para guardar');
      return;
    }

    setEnviando(true);
    try {
      // La respuesta es la ficha más `avisos` (textos ya armados, p. ej. el número de un animal de baja).
      const { avisos, ...nueva } = await api<AnimalFicha & { avisos?: string[] }>(`/animales/${encodeURIComponent(ficha.id)}`, {
        method: 'PATCH',
        body: cuerpo,
      });
      await alGuardar(nueva, avisos ?? []);
    } catch (err) {
      const r = interpretar(err);
      setErrores(r.campos);
      setError(r.general);
      setEnviando(false);
    }
  }

  return (
    <form className="formulario-lote formulario-evento" onSubmit={enviar} noValidate>
      <h3>Editar animal</h3>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <Campo etiqueta="Número" name="numero" id="editar-numero" required defaultValue={ficha.numero} error={errores.numero} autoComplete="off" />

      {esCriaDeParto ? (
        <>
          <p className="campo-ayuda">Sexo, fecha de nacimiento y madre vienen del parto: acá solo se puede cambiar el número.</p>
          <dl className="ficha">
            <div>
              <dt>Sexo</dt>
              <dd>{NOMBRE_SEXO[ficha.sexo]}</dd>
            </div>
            <div>
              <dt>Fecha de nacimiento</dt>
              <dd>{formatearFecha(ficha.fechaNacimiento)}</dd>
            </div>
            <div>
              <dt>Madre</dt>
              <dd>{ficha.madre ? ficha.madre.numero : 'sin dato'}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <div className="campo">
            <label htmlFor="editar-sexo">Sexo</label>
            <select id="editar-sexo" name="sexo" defaultValue={ficha.sexo} aria-invalid={!!errores.sexo}>
              {(Object.keys(NOMBRE_SEXO) as Sexo[]).map((s) => (
                <option key={s} value={s}>
                  {NOMBRE_SEXO[s]}
                </option>
              ))}
            </select>
            {errores.sexo && <span className="campo-error">{errores.sexo}</span>}
          </div>
          <Campo
            etiqueta="Fecha de nacimiento"
            name="fechaNacimiento"
            id="editar-fecha"
            type="date"
            min={FECHA_MINIMA}
            max={hoyIso()}
            defaultValue={ficha.fechaNacimiento ?? ''}
            error={errores.fechaNacimiento}
            ayuda="Borrala para dejarla sin dato"
          />
          <Campo
            etiqueta="Madre (número)"
            name="madre"
            id="editar-madre"
            defaultValue={ficha.madre?.numero ?? ''}
            error={errores.madre}
            autoComplete="off"
            ayuda="Borralo para dejar al animal sin madre"
          />
        </>
      )}

      <div className="acciones">
        <button type="submit" className="boton" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button type="button" className="boton-secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
