import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type Aviso, type EstadoAnimal, type EventoReproductivo, type RespuestaEventos, type RespuestaRegistro, type SemenToro, type Sexo } from '../compartido/api';
import { useAuth } from '../sesion/auth';
import { useEnLinea } from '../sinconexion/useConexion';
import { NotaNecesitaConexion, TEXTO_NECESITA_CONEXION } from '../sinconexion/NecesitaConexion';
import { formatearFecha, NOMBRE_ESTADO, NOMBRE_SEXO } from '../animales/animalesDatos';
import {
  fechaArgentinaIso,
  FECHA_MINIMA,
  hoyIso,
  interpretar,
  NOMBRE_ESTADO_REPRODUCTIVO,
  NOMBRE_TIPO_SERVICIO,
  resumenEvento,
  sumarDiasIso,
  textoDias,
  textoGenetica,
  textoLoteAnterior,
} from './reproduccionDatos';
import { Campo } from '../compartido/Campo';
import { FormParto } from './FormParto';
import { FormSecado } from './FormSecado';
import { Historial } from '../historial/Historial';

// alCambiarAnimal: la ficha debe releerse porque el parto o el secado cambian estado, lote y crías.
// versionExterna: sube cuando la ficha guarda algo (editar, mover) para que el historial se relea.
type Props = { animalId: string; sexo: Sexo; estado: EstadoAnimal; alCambiarAnimal: () => Promise<void>; versionExterna: number };
type Formulario = 'servicio' | 'tacto' | 'parto' | 'secado' | null;

// Resultado de un parto o secado recién registrado: avisos de la lista cerrada y accesos a las
// crías vivas. Vive solo en pantalla (no persiste al recargar la ficha).
type Resultado = { titulo: string; avisos: Aviso[]; crias: { id: string; numero: string }[] };

// Sección "Reproducción" de la ficha: situación y formularios; embebe el Historial único (RF-23 a RF-26, spec 007).
// Los tres roles (dueño, encargado y veterinario) pueden registrar y anular servicios y tactos,
// así que no se esconde nada por rol. Si una spec futura restringe algo, la API decide (403).
export function Reproduccion({ animalId, sexo, estado, alCambiarAnimal, versionExterna }: Props) {
  const [datos, setDatos] = useState<RespuestaEventos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<Formulario>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  // Sube cada vez que se relee la situación: el historial embebido se relee con ella.
  const [versionHistorial, setVersionHistorial] = useState(0);
  const { usuario } = useAuth();
  // Sin conexión la situación sale de la copia local y registrar necesita conexión (spec 009).
  const enLinea = useEnLinea();
  // El veterinario no registra partos ni secados (RF-43); la API igual responde 403.
  const puedeRegistrarPartos = !!usuario && usuario.rol !== 'VETERINARIO';

  const recargar = useCallback(async () => {
    try {
      setDatos(await api<RespuestaEventos>(`/animales/${encodeURIComponent(animalId)}/eventos`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la reproducción');
    }
    setVersionHistorial((v) => v + 1);
  }, [animalId]);

  useEffect(() => {
    if (sexo === 'HEMBRA') void recargar();
  }, [sexo, recargar, enLinea]);

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
  // La anulación la ofrece el Historial: solo en el último evento no anulado (RF-43: el veterinario, solo servicio o tacto).
  const partos = eventos.filter((e) => e.tipo === 'PARTO' && !e.anulacion);

  async function alRegistrar() {
    setFormulario(null);
    setResultado(null);
    await recargar();
  }

  // Parto o secado: se recarga la ficha y se muestran los avisos de la respuesta una sola vez.
  async function alRegistrarParto(r: RespuestaRegistro) {
    setFormulario(null);
    setResultado({
      titulo: r.evento.tipo === 'PARTO' ? 'Parto registrado' : 'Secado registrado',
      avisos: r.avisos,
      crias: (r.evento.parto?.crias ?? []).flatMap((c) => (c.animal ? [{ id: c.animal.id, numero: c.animal.numero }] : [])),
    });
    await Promise.all([recargar(), alCambiarAnimal()]);
  }

  // Si la anulación falla (404/409) se relee todo pero sin cartel de éxito ni avisos.
  async function refrescarTrasError() {
    setResultado(null);
    await Promise.all([recargar(), alCambiarAnimal()]);
  }

  // Anulación: tras anular un parto o secado cambian estado, lote y crías de la madre, así que
  // se relee la ficha. Los avisos 6 y 7 (lote previo) se muestran en la misma caja de resultado.
  async function alAnularEvento(tipo: EventoReproductivo['tipo'], avisos: Aviso[]) {
    const titulo = tipo === 'PARTO' ? 'Parto anulado' : tipo === 'SECADO' ? 'Secado anulado' : null;
    setResultado(titulo ? { titulo, avisos, crias: [] } : null);
    await Promise.all([recargar(), titulo ? alCambiarAnimal() : Promise.resolve()]);
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
            <dt>Último servicio{situacion.ultimoServicio?.cicloAnterior && <EtiquetaCiclo />}</dt>
            <dd className={situacion.ultimoServicio ? undefined : 'texto-suave'}>
              {situacion.ultimoServicio
                ? `${formatearFecha(situacion.ultimoServicio.fecha)} · ${
                    situacion.ultimoServicio.tipoServicio ? NOMBRE_TIPO_SERVICIO[situacion.ultimoServicio.tipoServicio] : 'sin dato'
                  } · ${situacion.ultimoServicio.semen ? situacion.ultimoServicio.semen.nombre : 'No especificado'}`
                : 'sin dato'}
            </dd>
          </div>
          <div>
            <dt>Último tacto{situacion.ultimoTacto?.cicloAnterior && <EtiquetaCiclo />}</dt>
            <dd className={situacion.ultimoTacto ? undefined : 'texto-suave'}>
              {situacion.ultimoTacto
                ? `${formatearFecha(situacion.ultimoTacto.fecha)} · ${
                    situacion.ultimoTacto.resultado === 'PRENADA' ? 'Preñada' : situacion.ultimoTacto.resultado === 'VACIA' ? 'Vacía' : 'sin dato'
                  }`
                : 'sin dato'}
            </dd>
          </div>
          {partos.length > 0 && (
            <div>
              <dt>Partos</dt>
              <dd>
                <span className="lista-enlaces">
                  {partos.map((p) => (
                    <a key={p.id} href={`#evento-${p.id}`} className="enlace-fila">
                      {formatearFecha(p.fecha)}
                    </a>
                  ))}
                </span>
              </dd>
            </div>
          )}
        </dl>

        {resultado && (
          <div className="resultado-registro" role="status">
            <p className="resultado-titulo">{resultado.titulo}</p>
            {resultado.avisos.length > 0 && (
              <div className="avisos">
                {resultado.avisos.map((a) => (
                  <p key={a.codigo + a.mensaje} className="aviso">
                    {a.mensaje}
                  </p>
                ))}
              </div>
            )}
            {resultado.crias.length > 0 && (
              <p className="lista-enlaces">
                {resultado.crias.map((c) => (
                  <Link key={c.id} to={`/animales/${c.id}`} className="enlace-fila">
                    Ver la ficha de la cría {c.numero}
                  </Link>
                ))}
              </p>
            )}
            <button type="button" className="boton-secundario" onClick={() => setResultado(null)}>
              Cerrar
            </button>
          </div>
        )}

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
                <button type="button" className="boton necesita-conexion" disabled={!enLinea} title={enLinea ? undefined : TEXTO_NECESITA_CONEXION} onClick={() => setFormulario(formulario === 'servicio' ? null : 'servicio')}>
                  Registrar servicio
                </button>
              )}
              <button type="button" className="boton necesita-conexion" disabled={!enLinea} title={enLinea ? undefined : TEXTO_NECESITA_CONEXION} onClick={() => setFormulario(formulario === 'tacto' ? null : 'tacto')}>
                Registrar tacto
              </button>
              {puedeRegistrarPartos && (
                <button type="button" className="boton necesita-conexion" disabled={!enLinea} title={enLinea ? undefined : TEXTO_NECESITA_CONEXION} onClick={() => setFormulario(formulario === 'parto' ? null : 'parto')}>
                  Registrar parto
                </button>
              )}
              {/* El secado solo tiene sentido en una vaca en ordeñe (RF-44). */}
              {puedeRegistrarPartos && estado === 'EN_ORDENE' && (
                <button type="button" className="boton necesita-conexion" disabled={!enLinea} title={enLinea ? undefined : TEXTO_NECESITA_CONEXION} onClick={() => setFormulario(formulario === 'secado' ? null : 'secado')}>
                  Registrar secado
                </button>
              )}
            </div>
            {!enLinea && <NotaNecesitaConexion />}
            {prenada && <p className="campo-ayuda">Para registrar un nuevo servicio, primero registrá un tacto &quot;vacía&quot;.</p>}
            {formulario === 'servicio' && (
              <FormServicio animalId={animalId} alCancelar={() => setFormulario(null)} alRegistrar={alRegistrar} />
            )}
            {formulario === 'parto' && puedeRegistrarPartos && (
              <FormParto animalId={animalId} alCancelar={() => setFormulario(null)} alRegistrar={alRegistrarParto} />
            )}
            {formulario === 'secado' && puedeRegistrarPartos && (
              <FormSecado animalId={animalId} alCancelar={() => setFormulario(null)} alRegistrar={alRegistrarParto} />
            )}
            {formulario === 'tacto' && (
              <FormTacto animalId={animalId} alCancelar={() => setFormulario(null)} alRegistrar={alRegistrar} />
            )}
          </>
        )}
      </section>

      <Historial
        animalId={animalId}
        contexto="animales"
        version={versionHistorial + versionExterna}
        alAnular={alAnularEvento}
        alRefrescar={refrescarTrasError}
      />
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

// Rótulo de lo que quedó en el ciclo anterior al último parto (RF-40).
function EtiquetaCiclo() {
  return <span className="etiqueta-ciclo">del ciclo anterior</span>;
}

