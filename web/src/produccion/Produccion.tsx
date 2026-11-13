import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError, type FichaProduccion, type RegistroProduccion, type TurnoOrdeno } from '../compartido/api';
import { datosLitros, type Pendiente } from '../sinconexion/almacen';
import { useAuth } from '../sesion/auth';
import { formatearFecha, puedeCargar } from '../animales/animalesDatos';
import { FECHA_MINIMA, fechaArgentinaIso, hoyIso, interpretar } from '../reproduccion/reproduccionDatos';
import { formatearLitros, litrosParaApi, NOMBRE_TURNO, textoMomento } from './produccionDatos';
import { Campo } from '../compartido/Campo';
import { useEnLinea } from '../sinconexion/useConexion';
import { useSinConexion } from '../sinconexion/SinConexionProvider';
import { useCola } from '../sinconexion/ColaProvider';
import { registrosParaFicha, ultimoRegistro, type FilaFicha, type Marca } from '../sinconexion/cola';
import { fechaYTurnoArgentina } from '../sinconexion/horaArgentina';
import { NotaNecesitaConexion, TEXTO_NECESITA_CONEXION } from '../sinconexion/NecesitaConexion';

// Textos de estado de una fila (RF-56).
const TEXTO_MARCA: Record<NonNullable<Marca>, string> = {
  pendiente: 'Pendiente de sincronizar',
  rechazado: 'Rechazado',
  enviado: 'Enviado: se confirma al actualizar',
};

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
  // Sin conexión la producción sale de la copia local; al cambiar la conexión se relee (spec 009).
  const enLinea = useEnLinea();
  const { generadaEn } = useSinConexion();
  // Litros pendientes y enviados que la copia todavía no trae (spec 009).
  const { pendientes, enviados } = useCola();
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
    // Se relee también al cambiar la copia o la cantidad de enviados: un litro recién aceptado ya viene del servidor.
  }, [animalId, contexto, enLinea, generadaEn, enviados.length]);

  // Solo la ficha de una vaca activa mezcla pendientes y enviados (la ficha de baja es de solo lectura).
  const filas = useMemo(
    () =>
      datos
        ? registrosParaFicha({
            animalId,
            registros: datos.registros,
            pendientes: contexto === 'animales' ? pendientes : [],
            enviados: contexto === 'animales' ? enviados : [],
          })
        : [],
    [datos, animalId, contexto, pendientes, enviados],
  );

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

          {/* Sin conexión la copia no trae la sugerencia: el formulario la calcula con la hora del dispositivo. */}
          {contexto === 'animales' && editable && enOrdene && (
            <FormCarga key={animalId} animalId={animalId} numero={numero} loteNombre={loteNombre} datos={datos} />
          )}
          {contexto === 'animales' && !enOrdene && (
            <p className="subtitulo">Solo se carga producción de vacas en ordeñe; esta vaca está {estadoTexto.toLowerCase()}.</p>
          )}

          {filas.length === 0 ? (
            <p className="subtitulo">Todavía no hay producción registrada</p>
          ) : (
            <>
              <ul className="lista-eventos">
                {filas.map((f) => (
                  <FilaRegistro key={f.id} fila={f} animalId={animalId} anulable={editable} alCambiar={recargar} />
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
  const enLinea = useEnLinea();
  const { cargar, pendientes, enviados } = useCola();
  // Fecha y turno propuestos por la API (hora de Argentina). Sin conexión la copia no trae la sugerencia y se
  // calcula con la hora del dispositivo convertida a Argentina (spec 009, RF-21). Se pueden cambiar antes de guardar.
  const [sugerencia] = useState(() => datos.sugerencia ?? fechaYTurnoArgentina(new Date()));
  const [turno, setTurno] = useState<TurnoOrdeno>(sugerencia.turno);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Último registro: el más reciente por fecha y turno entre la copia (o el servidor), los pendientes y los enviados (RF-23).
  const ultimo = ultimoRegistro({ animalId, ultimoServidor: datos.ultimoRegistro, pendientes, enviados });

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setErrores({});
    setError(null);
    setEnviando(true);
    const fecha = String(d.get('fecha'));
    const litros = litrosParaApi(String(d.get('litros')));
    try {
      // Con señal envía enseguida; sin señal (o con señal mala) queda pendiente en la tablet (spec 009).
      // La validación de formato y rango (mismos mensajes que la API) la hace cargar().
      const r = await cargar({ animalId, numero, fecha, turno, litros }, datos.registros);
      if (r.tipo === 'invalido') {
        // Validación local, duplicado local o rechazo del servidor (los 409 se muestran tal cual).
        setErrores(r.errores);
        setError(r.general);
        setEnviando(false);
        return;
      }
      if (r.tipo === 'sinLugar') {
        setError(r.mensaje);
        setEnviando(false);
        return;
      }
      const detalle = `vaca ${numero}, ${formatearLitros(Number(litros))} litros (${NOMBRE_TURNO[turno].toLowerCase()} del ${formatearFecha(fecha)})`;
      // Vuelta al buscador por número (RF-7, RF-23): la pantalla de Animales enfoca el campo para la vaca siguiente.
      navigate('/animales', {
        state: { mensaje: r.tipo === 'enviado' ? `Producción guardada: ${detalle}` : `Guardado en la tablet: pendiente de sincronizar. ${detalle}` },
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
            {ultimo?.marca && <span className={`etiqueta-estado etiqueta-${ultimo.marca}`}>{TEXTO_MARCA[ultimo.marca]}</span>}
          </dd>
        </div>
      </dl>
      {!enLinea && <p className="aviso">Sin conexión: se guarda en la tablet y se envía sola cuando vuelva la señal.</p>}
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
        defaultValue={sugerencia.fecha}
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

function FilaRegistro({ fila, animalId, anulable, alCambiar }: { fila: FilaFicha; animalId: string; anulable: boolean; alCambiar: () => Promise<void> }) {
  // Un pendiente (todavía sin registro del servidor) se dibuja aparte, con sus datos y su estado.
  if (fila.pendiente) return <FilaPendiente p={fila.pendiente} />;
  return <FilaDelServidor registro={fila.registro!} enviado={fila.marca === 'enviado'} animalId={animalId} anulable={anulable} alCambiar={alCambiar} />;
}

// Pendiente de la tablet en la ficha: "Pendiente de sincronizar" o "Rechazado: motivo" (RF-36, RF-56).
function FilaPendiente({ p }: { p: Pendiente }) {
  const d = datosLitros(p); // la lista de la ficha solo trae pendientes de litros
  return (
    <li className="evento pendiente">
      <p className="evento-titulo">
        <strong>{formatearFecha(d.fecha)}</strong> · {NOMBRE_TURNO[d.turno]} · {formatearLitros(Number(d.litros))} L
      </p>
      {p.estado === 'rechazado' ? (
        <p role="alert">
          <span className="etiqueta-estado etiqueta-rechazado">Rechazado:</span> {p.motivo} <Link to="/pendientes">Ver en Pendientes</Link>
        </p>
      ) : (
        <p>
          <span className="etiqueta-estado etiqueta-pendiente">{p.estado === 'enviando' ? 'Enviando…' : TEXTO_MARCA.pendiente}</span>
        </p>
      )}
      <p className="texto-suave">Cargado en la tablet · {textoMomento(p.cargadoEnDispositivo)}</p>
    </li>
  );
}

// Registro del servidor. Si es un "enviado" (aceptado pero todavía no en la copia) lleva su etiqueta y no se anula
// hasta que la copia lo incluya (anular necesita conexión y la copia al día).
function FilaDelServidor({
  registro,
  enviado,
  animalId,
  anulable,
  alCambiar,
}: {
  registro: RegistroProduccion;
  enviado: boolean;
  animalId: string;
  anulable: boolean;
  alCambiar: () => Promise<void>;
}) {
  const [anulando, setAnulando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorMotivo, setErrorMotivo] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);
  const enLinea = useEnLinea(); // anular necesita conexión (spec 009, RF-13)
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
      {enviado && (
        <p>
          <span className="etiqueta-estado etiqueta-enviado">{TEXTO_MARCA.enviado}</span>
        </p>
      )}
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
      {anulable && !anulado && !anulando && !enviado && (
        <div className="acciones">
          <button
            type="button"
            className="boton-secundario boton-peligro necesita-conexion"
            disabled={!enLinea}
            title={enLinea ? undefined : TEXTO_NECESITA_CONEXION}
            onClick={() => setAnulando(true)}
          >
            Anular
          </button>
          {!enLinea && <NotaNecesitaConexion />}
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
