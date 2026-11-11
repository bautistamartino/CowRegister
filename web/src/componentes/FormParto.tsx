import { useState, type FormEvent } from 'react';
import { api, type RespuestaRegistro, type Sexo } from '../api';
import { NOMBRE_SEXO } from '../animales';
import { FECHA_MINIMA, hoyIso, interpretar } from '../reproduccion';
import { Campo } from './Campo';

type Props = {
  animalId: string;
  alCancelar: () => void;
  alRegistrar: (r: RespuestaRegistro) => Promise<void>;
};

// Lo que se carga de una cría en pantalla (todo texto, la API valida de verdad).
type CriaForm = { sexo: Sexo; nacidaMuerta: boolean; numero: string; observaciones: string };
const criaVacia = (): CriaForm => ({ sexo: 'HEMBRA', nacidaMuerta: false, numero: '', observaciones: '' });

// Formulario de parto: fecha y una o dos crías (RF-45). "Nacida muerta" oculta el número
// porque esa cría no se da de alta. Todo se guarda junto o no se guarda nada (RF-4).
export function FormParto({ animalId, alCancelar, alRegistrar }: Props) {
  const [crias, setCrias] = useState<CriaForm[]>([criaVacia()]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function cambiar(i: number, cambio: Partial<CriaForm>) {
    setCrias((actual) => actual.map((c, j) => (j === i ? { ...c, ...cambio } : c)));
  }

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setErrores({});
    setError(null);
    setEnviando(true);
    try {
      const r = await api<RespuestaRegistro>(`/animales/${encodeURIComponent(animalId)}/partos`, {
        method: 'POST',
        body: {
          fecha: String(d.get('fecha')),
          crias: crias.map((c) =>
            c.nacidaMuerta
              ? { sexo: c.sexo, nacidaMuerta: true, observaciones: c.observaciones }
              : { sexo: c.sexo, nacidaMuerta: false, numero: c.numero, observaciones: c.observaciones },
          ),
        },
      });
      await alRegistrar(r);
    } catch (err) {
      const r = interpretar(err);
      setErrores(r.campos);
      // Los errores de campos que el formulario no dibuja (por ejemplo "crias") van en la alerta.
      const dibujados = new Set(['fecha', ...crias.flatMap((_, i) => [`crias.${i}.sexo`, `crias.${i}.numero`, `crias.${i}.observaciones`])]);
      const sueltos = Object.entries(r.campos)
        .filter(([k]) => !dibujados.has(k))
        .map(([, m]) => m);
      setError(r.general ?? (sueltos.length ? sueltos.join(' ') : null));
      setEnviando(false);
    }
  }

  return (
    <form className="formulario-lote formulario-evento" onSubmit={enviar} noValidate>
      <h3>Nuevo parto</h3>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <Campo etiqueta="Fecha del parto" name="fecha" id="parto-fecha" type="date" required defaultValue={hoyIso()} min={FECHA_MINIMA} max={hoyIso()} error={errores.fecha} />

      {crias.map((c, i) => (
        <fieldset key={i} className="cria-form">
          <legend>{crias.length === 1 ? 'Cría' : `Cría ${i + 1}`}</legend>
          <div className="campo">
            <label htmlFor={`cria-${i}-sexo`}>Sexo</label>
            <select id={`cria-${i}-sexo`} value={c.sexo} onChange={(e) => cambiar(i, { sexo: e.target.value as Sexo })}>
              {(Object.keys(NOMBRE_SEXO) as Sexo[]).map((s) => (
                <option key={s} value={s}>
                  {NOMBRE_SEXO[s]}
                </option>
              ))}
            </select>
            {errores[`crias.${i}.sexo`] && <span className="campo-error">{errores[`crias.${i}.sexo`]}</span>}
          </div>
          <label className="casilla">
            <input type="checkbox" checked={c.nacidaMuerta} onChange={(e) => cambiar(i, { nacidaMuerta: e.target.checked })} />
            Nacida muerta
          </label>
          {!c.nacidaMuerta && (
            <Campo
              etiqueta="Número (caravana o botón)"
              id={`cria-${i}-numero`}
              value={c.numero}
              onChange={(e) => cambiar(i, { numero: e.target.value })}
              error={errores[`crias.${i}.numero`]}
              ayuda="Letras sin tildes, números, guion y punto. Hasta 20 caracteres."
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={40}
            />
          )}
          <Campo
            etiqueta="Observaciones (opcional)"
            id={`cria-${i}-obs`}
            value={c.observaciones}
            onChange={(e) => cambiar(i, { observaciones: e.target.value })}
            error={errores[`crias.${i}.observaciones`]}
            ayuda="Hasta 200 caracteres"
          />
          {i === 1 && (
            <button type="button" className="boton-secundario" onClick={() => setCrias([crias[0]])} disabled={enviando}>
              Quitar segunda cría
            </button>
          )}
        </fieldset>
      ))}
      {crias.length === 1 && (
        <button type="button" className="boton-secundario" onClick={() => setCrias([...crias, criaVacia()])} disabled={enviando}>
          Agregar segunda cría
        </button>
      )}

      <div className="acciones">
        <button type="submit" className="boton" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar parto'}
        </button>
        <button type="button" className="boton-secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
