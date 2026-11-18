import { useState, type FormEvent } from 'react';
import type { Sexo } from '../compartido/api';
import { NOMBRE_SEXO } from '../animales/animalesDatos';
import { FECHA_MINIMA } from './reproduccionDatos';
import { AvisoReloj } from '../sinconexion/AvisoReloj';
import { useRelojTablet } from '../sinconexion/useRelojTablet';
import { Campo } from '../compartido/Campo';
import { useGuardarCarga } from '../sinconexion/useGuardarCarga';
import type { ConfirmacionCarga } from '../sinconexion/guardadoCarga';

type Props = {
  animal: { id: string; numero: string };
  alCancelar: () => void;
  // Se llama cuando el parto quedó guardado. `evento` solo viene si el servidor lo aceptó en el momento
  // (de ahí salen los enlaces "Ver la ficha de la cría"); si quedó pendiente es null.
  alGuardado: (c: ConfirmacionCarga, evento: Record<string, unknown> | null) => Promise<void>;
};

// Lo que se carga de una cría en pantalla (todo texto, la validación de verdad la hace el punto de registro).
type CriaForm = { sexo: Sexo; nacidaMuerta: boolean; numero: string; observaciones: string };
const criaVacia = (): CriaForm => ({ sexo: 'HEMBRA', nacidaMuerta: false, numero: '', observaciones: '' });

// Formulario de parto: fecha y una o dos crías (RF-45). "Nacida muerta" oculta el número
// porque esa cría no se da de alta. Todo se guarda junto como UN solo pendiente o no se guarda nada (RF-4, spec 011).
export function FormParto({ animal, alCancelar, alGuardado }: Props) {
  const reloj = useRelojTablet();
  const [crias, setCrias] = useState<CriaForm[]>([criaVacia()]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { guardar, guardando: enviando } = useGuardarCarga();

  function cambiar(i: number, cambio: Partial<CriaForm>) {
    setCrias((actual) => actual.map((c, j) => (j === i ? { ...c, ...cambio } : c)));
  }

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setErrores({});
    setError(null);
    const salida = await guardar({
      tipo: 'PARTO',
      animal,
      datos: {
        fecha: String(d.get('fecha')),
        crias: crias.map((c) =>
          c.nacidaMuerta
            ? { sexo: c.sexo, nacidaMuerta: true, observaciones: c.observaciones }
            : { sexo: c.sexo, nacidaMuerta: false, numero: c.numero, observaciones: c.observaciones },
        ),
      },
      tituloAceptado: 'Parto registrado',
      // Los errores de campos que el formulario no dibuja (por ejemplo "crias") van en la alerta de arriba.
      camposDibujados: ['fecha', ...crias.flatMap((c, i) => [`crias.${i}.sexo`, ...(c.nacidaMuerta ? [] : [`crias.${i}.numero`]), `crias.${i}.observaciones`])],
    });
    if (!salida) return;
    if (salida.tipo === 'error') {
      // El formulario sigue abierto con todo lo escrito.
      setErrores(salida.errores.campos);
      setError(salida.errores.general);
      return;
    }
    await alGuardado(salida.confirmacion, salida.evento);
  }

  return (
    <form className="formulario-lote formulario-evento" onSubmit={enviar} noValidate>
      <h3>Nuevo parto</h3>
      <AvisoReloj atrasado={reloj.atrasado} />
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <Campo key={`f-${reloj.atrasado}`} etiqueta="Fecha del parto" name="fecha" id="parto-fecha" type="date" required defaultValue={reloj.valorInicial} min={FECHA_MINIMA} max={reloj.max} ayuda={reloj.ayuda ?? undefined} error={errores.fecha} />

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
            <button type="button" className="boton-secundario" onClick={() => setCrias([crias[0]!])} disabled={enviando}>
              Quitar segunda cría
            </button>
          )}
        </fieldset>
      ))}
      {crias.length === 1 ? (
        <button type="button" className="boton-secundario" onClick={() => setCrias([...crias, criaVacia()])} disabled={enviando}>
          Agregar segunda cría
        </button>
      ) : (
        // Con dos crías ya no se ofrece agregar otra: se explica el tope.
        <p className="campo-ayuda">Un parto admite hasta 2 crías</p>
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
