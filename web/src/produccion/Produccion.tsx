import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, type FichaProduccion, type RegistroProduccion, type TurnoOrdeno } from '../compartido/api';
import { useAuth } from '../sesion/auth';
import { formatearFecha, puedeCargar } from '../animales/animalesDatos';
import { FECHA_MINIMA, fechaArgentinaIso, hoyIso, interpretar } from '../reproduccion/reproduccionDatos';
import { formatearLitros, litrosParaApi, NOMBRE_TURNO, textoMomento } from './produccionDatos';
import { Campo } from '../compartido/Campo';

type Props = {
  animalId: string;
  // 'animales' = ficha de una vaca activa; 'bajas' = ficha de baja (solo lectura, RF-33).
  contexto: 'animales' | 'bajas';
  numero: string;
  // Lote actual de la vaca (solo se muestra al cargar, RF-7).
  loteNombre: string | null;
  // La carga solo se ofrece a una hembra activa en ordeñe (RF-15); si no, se explica por qué no.
  enOrdene: boolean;
  estadoTexto: string;
};

// Sección "Producción" de la ficha (spec 008, RF-7, RF-12 a RF-15, RF-30, RF-33). Los tres roles la ven;
// solo dueño y encargado cargan y anulan (la API igual responde 403 al veterinario).
export function Produccion({ animalId, contexto, numero, loteNombre, enOrdene, estadoTexto }: Props) {
  const { usuario } = useAuth();
  const [datos, setDatos] = useState<FichaProduccion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = contexto === 'animales' && !!usuario && puedeCargar(usuario.rol);

  const recargar = useCallback(async () => {
    try {
      setDatos(await api<FichaProduccion>(`/${contexto}/${encodeURIComponent(animalId)}/produccion`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la producción');
    }
  }, [animalId, contexto]);

  useEffect(() => {
    let vigente = true; // descarta la respuesta de una ficha vieja si se cambió de vaca
    api<FichaProduccion>(`/${contexto}/${encodeURIComponent(animalId)}/produccion`)
      .then((r) => {
        if (vigente) {
          setDatos(r);
          setError(null);
        }
      })
      .catch((err) => {
        if (vigente) setError(err instanceof ApiError ? err.message : 'No se pudo cargar la producción');
      });
    return () => {
      vigente = false;
    };
  }, [animalId, contexto]);

  return (
    <section className="seccion">
      <h2>Producción</h2>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      {!error && !datos && <p className="subtitulo">Cargando…</p>}
      {datos && (
        <>
          <dl className="ficha">
            <div>
              <dt>Promedio de los últimos 30 días</dt>
              <dd className={datos.promedio30Dias === null ? 'texto-suave' : undefined}>
                {datos.promedio30Dias === null ? '—' : `${formatearLitros(datos.promedio30Dias)} litros por día`}
              </dd>
            </div>
          </dl>

          {contexto === 'animales' && editable && enOrdene && datos.sugerencia && (
            <FormCarga key={animalId} animalId={animalId} numero={numero} loteNombre={loteNombre} datos={datos} />
          )}
          {contexto === 'animales' && !enOrdene && (
            <p className="subtitulo">Solo se carga producción de vacas en ordeñe; esta vaca está {estadoTexto.toLowerCase()}.</p>
          )}

          {datos.registros.length === 0 ? (
            <p className="subtitulo">Todavía no hay producción registrada</p>
          ) : (
            <>
              <ul className="lista-eventos">
                {datos.registros.map((r) => (
                  <FilaRegistro key={r.id} registro={r} animalId={animalId} anulable={editable} alCambiar={recargar} />
                ))}
              </ul>
              {datos.truncado && (
                <p className="campo-ayuda">
                  Se muestran los {datos.tope} registros más recientes de {datos.total}.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

// ─── Formulario de carga (RF-1, RF-7, RF-30) ───

function FormCarga({ animalId, numero, loteNombre, datos }: { animalId: string; numero: string; loteNombre: string | null; datos: FichaProduccion }) {
  const navigate = useNavigate();
  // Fecha y turno propuestos por la API (hora de Argentina): el turno se puede cambiar antes de guardar.
  const [turno, setTurno] = useState<TurnoOrdeno>(datos.sugerencia?.turno ?? 'manana');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const ultimo = datos.ultimoRegistro;

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setErrores({});
    setError(null);
    setEnviando(true);
    const fecha = String(d.get('fecha'));
    const litros = litrosParaApi(String(d.get('litros')));
    try {
      await api(`/animales/${encodeURIComponent(animalId)}/produccion`, { method: 'POST', body: { fecha, turno, litros } });
      // Vuelta al buscador por número (RF-7): la pantalla de Animales enfoca el campo para la vaca siguiente.
      navigate('/animales', {
        state: { mensaje: `Producción guardada: vaca ${numero}, ${formatearLitros(Number(litros))} litros (${NOMBRE_TURNO[turno].toLowerCase()} del ${formatearFecha(fecha)})` },
      });
    } catch (err) {
      const r = interpretar(err);
      setErrores(r.campos);
      setError(r.general); // los 409 (duplicado, estado) se muestran tal cual
      setEnviando(false);
    }
  }

  return (
    <form className="formulario-lote formulario-evento" onSubmit={guardar}>
      <h3>Cargar litros</h3>
      <dl className="ficha">
        <div>
          <dt>Vaca</dt>
          <dd>{numero}</dd>
        </div>
        <div>
          <dt>Lote</dt>
          <dd className={loteNombre ? undefined : 'texto-suave'}>{loteNombre ?? 'sin lote'}</dd>
        </div>
        <div>
          <dt>Último registro</dt>
          <dd className={ultimo ? undefined : 'texto-suave'}>
            {ultimo ? `${formatearFecha(ultimo.fecha)} · ${NOMBRE_TURNO[ultimo.turno]} · ${formatearLitros(ultimo.litros)} L` : '—'}
          </dd>
        </div>
      </dl>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <Campo
        etiqueta="Fecha del ordeño"
        name="fecha"
        id="produccion-fecha"
        type="date"
        required
        defaultValue={datos.sugerencia?.fecha ?? hoyIso()}
        min={FECHA_MINIMA}
        max={hoyIso()}
        error={errores.fecha}
      />
      <div className="campo">
        <span className="rotulo-campo" id="produccion-turno-rotulo">
          Turno
        </span>
        <div className="acciones" role="group" aria-labelledby="produccion-turno-rotulo">
          {(['manana', 'tarde'] as const).map((t) => (
            <button key={t} type="button" className={turno === t ? 'boton' : 'boton-secundario'} aria-pressed={turno === t} onClick={() => setTurno(t)}>
              {NOMBRE_TURNO[t]}
            </button>
          ))}
        </div>
        {errores.turno && <span className="campo-error">{errores.turno}</span>}
      </div>
      <Campo
        etiqueta="Litros"
        name="litros"
        id="produccion-litros"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        required
        placeholder="Ej.: 12,5"
        ayuda="De 0 a 99,9, con un decimal como máximo. Podés usar coma o punto."
        error={errores.litros}
      />
      <div className="acciones">
        <button type="submit" className="boton" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar litros'}
        </button>
      </div>
    </form>
  );
}

// ─── Una fila de registro, con "Anular" (RF-9, RF-15, RF-30) ───

function FilaRegistro({ registro, animalId, anulable, alCambiar }: { registro: RegistroProduccion; animalId: string; anulable: boolean; alCambiar: () => Promise<void> }) {
  const [anulando, setAnulando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorMotivo, setErrorMotivo] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);
  const anulado = registro.anulado !== null;

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setError(null);
    setErrorMotivo(undefined);
    setEnviando(true);
    try {
      await api(`/animales/${encodeURIComponent(animalId)}/produccion/${encodeURIComponent(registro.id)}/anular`, {
        method: 'POST',
        body: { motivo: String(d.get('motivo')) },
      });
      await alCambiar(); // la fila se vuelve a dibujar con su marca de anulado
    } catch (err) {
      const r = interpretar(err);
      setErrorMotivo(r.campos.motivo);
      setError(r.general);
      setEnviando(false);
      // Si ya la anuló otra persona (409) o cambió algo (404), se relee para mostrar lo real.
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) await alCambiar();
    }
  }

  return (
    <li className={anulado ? 'evento evento-anulado' : 'evento'}>
      <p className="evento-titulo">
        <strong>{formatearFecha(registro.fecha)}</strong> · {NOMBRE_TURNO[registro.turno]} · {formatearLitros(registro.litros)} L
        {anulado && <span className="etiqueta-anulado">Anulado</span>}
      </p>
      <p className="texto-suave">
        Cargado por {registro.registradoPor} · {textoMomento(registro.registradoEn)}
      </p>
      {registro.anulado && (
        <p className="texto-suave">
          Anulado por {registro.anulado.por ?? 'sin dato'} el {formatearFecha(fechaArgentinaIso(new Date(registro.anulado.en)))}. Motivo:{' '}
          {registro.anulado.motivo}
        </p>
      )}
      {error && !anulando && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      {anulable && !anulado && !anulando && (
        <div className="acciones">
          <button type="button" className="boton-secundario boton-peligro" onClick={() => setAnulando(true)}>
            Anular
          </button>
        </div>
      )}
      {anulable && !anulado && anulando && (
        <form className="formulario-lote" onSubmit={confirmar}>
          {error && (
            <div className="alerta" role="alert">
              {error}
            </div>
          )}
          <Campo
            etiqueta="Motivo de la anulación"
            name="motivo"
            id={`motivo-prod-${registro.id}`}
            required
            autoFocus
            maxLength={200}
            ayuda="Obligatorio. El registro no se borra: queda marcado como anulado."
            error={errorMotivo}
          />
          <div className="acciones">
            <button type="submit" className="boton boton-peligro-lleno" disabled={enviando}>
              {enviando ? 'Anulando…' : 'Confirmar anulación'}
            </button>
            <button type="button" className="boton-secundario" onClick={() => setAnulando(false)} disabled={enviando}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
