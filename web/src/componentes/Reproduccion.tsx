import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type EstadoAnimal, type EventoReproductivo, type RespuestaEventos, type SemenToro, type Sexo } from '../api';
import { formatearFecha } from '../animales';
import {
  fechaArgentinaIso,
  FECHA_MINIMA,
  hoyIso,
  NOMBRE_ESTADO_REPRODUCTIVO,
  NOMBRE_TIPO_SERVICIO,
  resumenEvento,
  sumarDiasIso,
  textoDias,
} from '../reproduccion';
import { Campo } from './Campo';

type Props = { animalId: string; sexo: Sexo; estado: EstadoAnimal };
type Formulario = 'servicio' | 'tacto' | null;

// Un error de la API como mensaje general (los 409 y 400 ya vienen en español) y por campo.
function interpretar(err: unknown): { campos: Record<string, string>; general: string | null } {
  if (err instanceof ApiError && err.detalles.length) {
    return { campos: Object.fromEntries(err.detalles.map((d) => [d.campo, d.mensaje])), general: null };
  }
  return { campos: {}, general: err instanceof ApiError ? err.message : 'Error inesperado' };
}

// Sección "Reproducción" de la ficha: situación, formularios y lista de eventos (RF-23 a RF-26).
// Los tres roles (dueño, encargado y veterinario) pueden registrar y anular servicios y tactos,
// así que no se esconde nada por rol. Si una spec futura restringe algo, la API decide (403).
export function Reproduccion({ animalId, sexo, estado }: Props) {
  const [datos, setDatos] = useState<RespuestaEventos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<Formulario>(null);

  const recargar = useCallback(async () => {
    try {
      setDatos(await api<RespuestaEventos>(`/animales/${encodeURIComponent(animalId)}/eventos`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la reproducción');
    }
  }, [animalId]);

  useEffect(() => {
    if (sexo === 'HEMBRA') void recargar();
  }, [sexo, recargar]);

  // Los machos no tienen nada reproductivo (RF-25).
  if (sexo === 'MACHO') return null;

  if (error) {
    return (
      <section className="seccion">
        <h2>Reproducción</h2>
        <div className="alerta" role="alert">
          {error}
        </div>
      </section>
    );
  }
  if (!datos || !datos.situacion) {
    return (
      <section className="seccion">
        <h2>Reproducción</h2>
        <p className="subtitulo">Cargando…</p>
      </section>
    );
  }

  const { situacion, eventos } = datos;
  // Solo vaquillona, en ordeñe o seca admiten servicios y tactos (la API lo vuelve a controlar).
  const admiteEventos = estado === 'VAQUILLONA' || estado === 'EN_ORDENE' || estado === 'SECA';
  const prenada = situacion.estado === 'PRENADA';
  // Solo se puede anular el último evento no anulado (el más nuevo de la lista sin anulación).
  const ultimoAnulable = eventos.find((e) => !e.anulacion)?.id ?? null;

  async function alRegistrar() {
    setFormulario(null);
    await recargar();
  }

  return (
    <>
      <section className="seccion">
        <h2>Reproducción</h2>
        <dl className="ficha">
          <div>
            <dt>Situación</dt>
            <dd>{NOMBRE_ESTADO_REPRODUCTIVO[situacion.estado]}</dd>
          </div>
          <div>
            <dt>Parto probable</dt>
            <dd className={situacion.fechaProbableParto ? undefined : 'texto-suave'}>
              {situacion.fechaProbableParto
                ? `${formatearFecha(situacion.fechaProbableParto.fecha)} · ${textoDias(situacion.fechaProbableParto.dias)}`
                : 'sin dato'}
            </dd>
          </div>
          {situacion.fechaReferencia && (
            <div>
              <dt>Fecha de referencia (servicio + 283 días)</dt>
              <dd>
                {formatearFecha(situacion.fechaReferencia.fecha)} · {textoDias(situacion.fechaReferencia.dias)}
              </dd>
            </div>
          )}
          <div>
            <dt>Último servicio</dt>
            <dd className={situacion.ultimoServicio ? undefined : 'texto-suave'}>
              {situacion.ultimoServicio
                ? `${formatearFecha(situacion.ultimoServicio.fecha)} · ${
                    situacion.ultimoServicio.tipoServicio ? NOMBRE_TIPO_SERVICIO[situacion.ultimoServicio.tipoServicio] : 'sin dato'
                  } · ${situacion.ultimoServicio.semen ? situacion.ultimoServicio.semen.nombre : 'No especificado'}`
                : 'sin dato'}
            </dd>
          </div>
          <div>
            <dt>Último tacto</dt>
            <dd className={situacion.ultimoTacto ? undefined : 'texto-suave'}>
              {situacion.ultimoTacto
                ? `${formatearFecha(situacion.ultimoTacto.fecha)} · ${
                    situacion.ultimoTacto.resultado === 'PRENADA' ? 'Preñada' : situacion.ultimoTacto.resultado === 'VACIA' ? 'Vacía' : 'sin dato'
                  }`
                : 'sin dato'}
            </dd>
          </div>
        </dl>

        {situacion.fechaProbableParto?.vencida && (
          <p className="aviso" role="status">
            La fecha probable de parto ya pasó: revisá si la vaca parió.
          </p>
        )}

        {!admiteEventos && (
          <p className="subtitulo">Todavía no admite servicios ni tactos (solo vaquillonas, vacas en ordeñe y secas).</p>
        )}

        {admiteEventos && (
          <>
            <div className="acciones">
              {/* Con una preñez vigente no se ofrece el servicio: primero hay que registrar un tacto vacía. */}
              {!prenada && (
                <button type="button" className="boton" onClick={() => setFormulario(formulario === 'servicio' ? null : 'servicio')}>
                  Registrar servicio
                </button>
              )}
              <button type="button" className="boton" onClick={() => setFormulario(formulario === 'tacto' ? null : 'tacto')}>
                Registrar tacto
              </button>
            </div>
            {prenada && <p className="campo-ayuda">Para registrar un nuevo servicio, primero registrá un tacto &quot;vacía&quot;.</p>}
            {formulario === 'servicio' && (
              <FormServicio animalId={animalId} alCancelar={() => setFormulario(null)} alRegistrar={alRegistrar} />
            )}
            {formulario === 'tacto' && (
              <FormTacto animalId={animalId} alCancelar={() => setFormulario(null)} alRegistrar={alRegistrar} />
            )}
          </>
        )}
      </section>

      <section className="seccion">
        <h2>Historial</h2>
        {eventos.length === 0 ? (
          <p className="subtitulo">Todavía no hay eventos registrados</p>
        ) : (
          <ul className="lista-eventos">
            {eventos.map((e) => (
              <FilaEvento key={e.id} evento={e} anulable={e.id === ultimoAnulable} alAnular={recargar} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// ─── Servicio ───

function FormServicio({ animalId, alCancelar, alRegistrar }: { animalId: string; alCancelar: () => void; alRegistrar: () => Promise<void> }) {
  const [semen, setSemen] = useState<SemenToro[]>([]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // El select ofrece solo lo activo (RF-9).
  useEffect(() => {
    api<SemenToro[]>('/semen')
      .then((lista) => setSemen(lista.filter((s) => s.activo)))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'No se pudo cargar el catálogo de semen'));
  }, []);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setErrores({});
    setError(null);
    setEnviando(true);
    try {
      // "" en semenId = "No especificado": la API lo guarda como null.
      await api(`/animales/${encodeURIComponent(animalId)}/servicios`, {
        method: 'POST',
        body: { fecha: String(d.get('fecha')), tipo: String(d.get('tipo')), semenId: String(d.get('semenId')) },
      });
      await alRegistrar();
    } catch (err) {
      const r = interpretar(err);
      setErrores(r.campos);
      setError(r.general);
      setEnviando(false);
    }
  }

  return (
    <form className="formulario-lote formulario-evento" onSubmit={enviar}>
      <h3>Nuevo servicio</h3>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <Campo etiqueta="Fecha" name="fecha" id="servicio-fecha" type="date" required defaultValue={hoyIso()} min={FECHA_MINIMA} max={hoyIso()} error={errores.fecha} />
      <div className="campo">
        <label htmlFor="servicio-tipo">Tipo</label>
        <select id="servicio-tipo" name="tipo" defaultValue="INSEMINACION" aria-invalid={!!errores.tipo}>
          <option value="INSEMINACION">Inseminación</option>
          <option value="MONTA_NATURAL">Monta natural</option>
        </select>
        {errores.tipo && <span className="campo-error">{errores.tipo}</span>}
      </div>
      <div className="campo">
        <label htmlFor="servicio-semen">Semen o toro</label>
        <select id="servicio-semen" name="semenId" defaultValue="" aria-invalid={!!errores.semenId}>
          <option value="">No especificado</option>
          {semen.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
              {s.raza ? ` (${s.raza})` : ''}
            </option>
          ))}
        </select>
        {errores.semenId && <span className="campo-error">{errores.semenId}</span>}
      </div>
      <div className="acciones">
        <button type="submit" className="boton" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar servicio'}
        </button>
        <button type="button" className="boton-secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ─── Tacto ───

function FormTacto({ animalId, alCancelar, alRegistrar }: { animalId: string; alCancelar: () => void; alRegistrar: () => Promise<void> }) {
  const [resultado, setResultado] = useState<'PRENADA' | 'VACIA'>('PRENADA');
  // Fecha del tacto elegida: acota la fecha probable (RF-14: posterior al tacto, hasta 283 días después).
  const [fechaTacto, setFechaTacto] = useState(hoyIso());
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
      await api(`/animales/${encodeURIComponent(animalId)}/tactos`, {
        method: 'POST',
        body: {
          fecha: String(d.get('fecha')),
          resultado,
          // Vacía no lleva fecha probable; en preñada, vacío = que la API la calcule del servicio.
          fechaProbableParto: resultado === 'PRENADA' ? String(d.get('fechaProbableParto') ?? '') : '',
          anomalias: String(d.get('anomalias')),
        },
      });
      await alRegistrar();
    } catch (err) {
      const r = interpretar(err);
      setErrores(r.campos);
      setError(r.general);
      setEnviando(false);
    }
  }

  return (
    <form className="formulario-lote formulario-evento" onSubmit={enviar}>
      <h3>Nuevo tacto</h3>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <Campo
        etiqueta="Fecha"
        name="fecha"
        id="tacto-fecha"
        type="date"
        required
        defaultValue={hoyIso()}
        min={FECHA_MINIMA}
        max={hoyIso()}
        onChange={(e) => setFechaTacto(e.target.value)}
        error={errores.fecha}
      />
      <div className="campo">
        <label htmlFor="tacto-resultado">Resultado</label>
        <select id="tacto-resultado" value={resultado} onChange={(e) => setResultado(e.target.value as 'PRENADA' | 'VACIA')}>
          <option value="PRENADA">Preñada</option>
          <option value="VACIA">Vacía</option>
        </select>
        {errores.resultado && <span className="campo-error">{errores.resultado}</span>}
      </div>
      {resultado === 'PRENADA' && (
        <Campo
          etiqueta="Fecha probable de parto (opcional)"
          name="fechaProbableParto"
          id="tacto-probable"
          type="date"
          min={fechaTacto ? sumarDiasIso(fechaTacto, 1) : undefined}
          max={fechaTacto ? sumarDiasIso(fechaTacto, 283) : undefined}
          ayuda="Si la dejás vacía se calcula desde el último servicio (283 días). Si no hay servicio, es obligatoria."
          error={errores.fechaProbableParto}
        />
      )}
      <Campo etiqueta="Anomalías (opcional)" name="anomalias" id="tacto-anomalias" ayuda="Hasta 200 caracteres" error={errores.anomalias} />
      <div className="acciones">
        <button type="submit" className="boton" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar tacto'}
        </button>
        <button type="button" className="boton-secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ─── Una fila de la lista, con la anulación ───

function FilaEvento({ evento, anulable, alAnular }: { evento: EventoReproductivo; anulable: boolean; alAnular: () => Promise<void> }) {
  const [anulando, setAnulando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorMotivo, setErrorMotivo] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);
  const anulado = evento.anulacion !== null;

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setError(null);
    setErrorMotivo(undefined);
    setEnviando(true);
    try {
      const ruta = evento.tipo === 'SERVICIO' ? 'servicios' : 'tactos';
      await api(`/${ruta}/${evento.id}/anular`, { method: 'POST', body: { motivo: String(d.get('motivo')) } });
      await alAnular(); // la fila se vuelve a dibujar con su marca de anulado
    } catch (err) {
      const r = interpretar(err);
      setErrorMotivo(r.campos.motivo);
      setError(r.general);
      setEnviando(false);
      // Si ya la anuló otro o cambió el último evento, se refresca para mostrar lo real.
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) await alAnular();
    }
  }

  return (
    <li className={anulado ? 'evento evento-anulado' : 'evento'}>
      <p className="evento-titulo">
        <strong>{formatearFecha(evento.fecha)}</strong> · {resumenEvento(evento)}
        {anulado && <span className="etiqueta-anulado">Anulado</span>}
      </p>
      {evento.tacto?.anomalias && <p className="texto-suave">Anomalías: {evento.tacto.anomalias}</p>}
      <p className="texto-suave">Registrado por {evento.registradoPor}</p>
      {evento.anulacion && (
        <p className="texto-suave">
          Anulado por {evento.anulacion.por ?? 'sin dato'} el {formatearFecha(fechaArgentinaIso(new Date(evento.anulacion.en)))}. Motivo: {evento.anulacion.motivo}
        </p>
      )}
      {error && !anulando && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      {anulable && !anulando && (
        <div className="acciones">
          <button type="button" className="boton-secundario boton-peligro" onClick={() => setAnulando(true)}>
            Anular
          </button>
        </div>
      )}
      {anulable && anulando && (
        <form className="formulario-lote" onSubmit={confirmar}>
          {error && (
            <div className="alerta" role="alert">
              {error}
            </div>
          )}
          <Campo
            etiqueta="Motivo de la anulación"
            name="motivo"
            id={`motivo-${evento.id}`}
            required
            autoFocus
            maxLength={200}
            ayuda="Obligatorio. El evento no se borra: queda marcado como anulado."
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
