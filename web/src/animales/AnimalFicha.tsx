import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError, type AnimalFicha as Ficha, type EstadoAnimal } from '../compartido/api';
import { Reproduccion } from '../reproduccion/Reproduccion';
import { FormEditarAnimal } from './FormEditarAnimal';
import { FormMoverLote } from '../lotes/FormMoverLote';
import { FormBaja } from '../bajas/FormBaja';
import { Historial } from '../historial/Historial';
import { Produccion } from '../produccion/Produccion';
import { useAuth } from '../sesion/auth';
import { NOMBRE_ESTADO, NOMBRE_SEXO, TEXTO_NO_DISPONIBLE, formatearFecha } from './animalesDatos';
import { textoGenetica } from '../reproduccion/reproduccionDatos';
import { useEnLinea } from '../sinconexion/useConexion';
import { AvisoDatosLocales } from '../sinconexion/AvisoConexion';
import { NotaNecesitaConexion, TEXTO_NECESITA_CONEXION } from '../sinconexion/NecesitaConexion';
import { useCola } from '../sinconexion/ColaProvider';
import { Confirmar } from '../sinconexion/Confirmar';
import { useVersionCola } from '../sinconexion/useVersionCola';

// Ficha de un animal (RF-28, RF-29). Dueño y encargado pueden editarlo y moverlo de lote (spec 005).
export function AnimalFicha() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  // Después de un alta, AnimalNuevo manda el aviso de "sin lote" por el estado de navegación.
  const avisoSinLote =
    (location.state as { avisoSinLote?: { estado: EstadoAnimal } | null } | null)?.avisoSinLote ?? null;
  // Tras revertir una baja (spec 006): "Baja revertida" y los avisos de lote (RF-9), una sola vez.
  const estadoNav = location.state as { mensaje?: string; avisos?: string[] } | null;
  const avisosReversion = estadoNav?.avisos ?? [];
  // Aviso de número de un animal de baja tras el alta (spec 006, RF-14): AnimalNuevo ya lo manda armado.
  const avisoNumeroInicial = (location.state as { avisoNumero?: string | null } | null)?.avisoNumero ?? null;
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { usuario } = useAuth();
  // Sin conexión la ficha sale de la copia local (api.ts) y las acciones quedan deshabilitadas (spec 009).
  const enLinea = useEnLinea();
  // Animal que no está en la copia de la tablet (RF-16): el mensaje trae "al día de…". No se dice que no existe.
  const [mensajeAusente, setMensajeAusente] = useState<string | null>(null);
  // Solo se esconden los botones; la API igual responde 403 al veterinario.
  const puedeEditar = !!usuario && usuario.rol !== 'VETERINARIO';
  const [panel, setPanel] = useState<'editar' | 'mover' | 'baja' | null>(null);
  const [confirmacion, setConfirmacion] = useState<string | null>(estadoNav?.mensaje ?? null);
  // 404 al dar de baja (RF-21): otra persona ya la dio; se avisa y se recarga la pantalla.
  const [avisoNoDisponible, setAvisoNoDisponible] = useState(false);
  // Sube cada vez que se guarda algo, para que el historial vuelva a leerse.
  const [versionCambios, setVersionCambios] = useState(0);
  // Avisos de la edición (spec 006, RF-14): se muestran una sola vez y no persisten.
  const [avisosEdicion, setAvisosEdicion] = useState<string[]>([]);
  // Aviso del alta: se reemplaza al editar (si no, quedaría uno viejo junto al nuevo).
  const [avisoNumeroAlta, setAvisoNumeroAlta] = useState<string | null>(avisoNumeroInicial);
  // Descartar una baja pendiente (spec 011, RF-23): confirmación, espera y resultado.
  const { descartar } = useCola();
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [avisoDescarte, setAvisoDescarte] = useState<string | null>(null);
  // Cambia cuando cambia la cola de pendientes o la copia: la ficha se relee sola, sin tocar paneles ni avisos (RF-25).
  const versionCola = useVersionCola();

  useEffect(() => {
    let vigente = true;
    setFicha(null);
    setNoEncontrado(false);
    setMensajeAusente(null);
    setError(null);
    setPanel(null);
    setConfirmacion(estadoNav?.mensaje ?? null);
    setAvisoNoDisponible(false);
    setAvisosEdicion([]);
    setAvisoNumeroAlta(avisoNumeroInicial);
    setAvisoDescarte(null);
    setConfirmandoDescarte(false);
    api<Ficha>(`/animales/${encodeURIComponent(id ?? '')}`)
      .then((f) => {
        if (vigente) setFicha(f);
      })
      .catch((err) => {
        if (!vigente) return;
        if (err instanceof ApiError && err.status === 404) {
          setNoEncontrado(true);
          // 404 desde la copia local: el texto propio de la tablet (RF-16).
          setMensajeAusente(err.message.startsWith('No encontrado en los datos de la tablet') ? err.message : null);
        } else setError(err instanceof ApiError ? err.message : 'No se pudo cargar el animal');
      });
    return () => {
      vigente = false;
    };
  }, [id]);

  // Cuando se corta o vuelve la conexión se relee la ficha (de la copia o del servidor) sin tocar
  // paneles ni avisos. La primera vez no hace falta: ya la leyó el efecto de arriba.
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    api<Ficha>(`/animales/${encodeURIComponent(id ?? '')}`)
      .then(setFicha)
      .catch(() => undefined); // si falla, queda lo que ya se veía
  }, [enLinea, versionCola]);

  // Tras un parto o secado cambian el estado, el lote y las crías de la madre: se vuelve a leer
  // la ficha sin vaciarla (si no, Reproduccion se desmontaría y perdería los avisos recién recibidos).
  async function recargarFicha() {
    setConfirmacion(null); // la caja de resultado de la reproducción reemplaza a la confirmación vieja
    try {
      setFicha(await api<Ficha>(`/animales/${encodeURIComponent(id ?? '')}`));
    } catch {
      // Si falla, queda la ficha anterior: no es grave y un refresco de la página la corrige.
    }
  }

  // Tras editar o mover: se usa la ficha que devolvió la API, se cierra el panel y se confirma.
  async function alGuardar(nueva: Ficha, mensaje: string, avisos: string[] = []) {
    setAvisosEdicion(avisos);
    setAvisoNumeroAlta(null);
    setFicha(nueva);
    setPanel(null);
    setConfirmacion(mensaje);
    setVersionCambios((v) => v + 1);
  }

  // Dar de baja dio 404: se muestra el mensaje y se relee la ficha. Si el animal ya está de baja,
  // la ficha activa da 404 y se muestra "Animal no encontrado" (con el mismo mensaje).
  async function alNoDisponible() {
    setAvisoNoDisponible(true);
    setPanel(null);
    setConfirmacion(null);
    try {
      setFicha(await api<Ficha>(`/animales/${encodeURIComponent(id ?? '')}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setFicha(null);
        setNoEncontrado(true);
      }
    }
  }

  const alertaNoDisponible = avisoNoDisponible && (
    <div className="alerta" role="alert">
      {TEXTO_NO_DISPONIBLE}
    </div>
  );

  // Descartar la baja pendiente: la confirmación ya se pidió en pantalla, por eso se llama con `confirmado`.
  async function descartarBaja(idBaja: string) {
    setDescartando(true);
    try {
      const r = await descartar(idBaja, { confirmado: true });
      setAvisoDescarte(r === 'ya-guardado' ? 'Ya estaba guardado en el servidor' : r === 'descartado' ? 'Baja descartada' : null);
    } catch {
      setAvisoDescarte('No se pudo descartar la baja. Probá de nuevo');
    } finally {
      setDescartando(false);
      setConfirmandoDescarte(false);
    }
  }

  if (noEncontrado) {
    return (
      <main className="contenido">
        <h1>{mensajeAusente ? 'Animal no disponible' : 'Animal no encontrado'}</h1>
        {mensajeAusente && <p role="status">{mensajeAusente}</p>}
        {alertaNoDisponible}
        <p>
          <Link to="/animales" className="enlace-fila">
            Ir al listado de animales
          </Link>
        </p>
      </main>
    );
  }
  if (error) {
    return (
      <main className="contenido">
        <div className="alerta" role="alert">
          {error}
        </div>
      </main>
    );
  }
  if (!ficha) {
    return (
      <main className="contenido">
        <p className="subtitulo">Cargando…</p>
      </main>
    );
  }

  // Lo que sabe la tablet y el servidor todavía no (solo existe cuando la ficha sale de la vista local).
  const locales = ficha.locales;
  const bajaPendiente = locales?.bajaPendiente;

  return (
    <main className="contenido pantalla-lotes">
      <h1>Animal {ficha.numero}</h1>

      <AvisoDatosLocales />

      {alertaNoDisponible}

      {/* Baja cargada en la tablet: la ficha queda en solo lectura (RF-23). */}
      {bajaPendiente && (
        <div className="resultado-registro" role="status">
          <p className="resultado-titulo">{bajaPendiente.estado === 'enviada' ? 'Baja enviada: se confirma al actualizar' : 'Baja pendiente de sincronizar'}</p>
          <p>{bajaPendiente.resumen}{bajaPendiente.fecha ? ` · ${formatearFecha(bajaPendiente.fecha)}` : ''}</p>
          {bajaPendiente.estado === 'enviada' ? null : confirmandoDescarte ? (
            <Confirmar
              titulo="¿Descartar esta baja?"
              confirmarTexto="Sí, descartar la baja"
              alConfirmar={() => void descartarBaja(bajaPendiente.id)}
              alCancelar={() => setConfirmandoDescarte(false)}
              ocupado={descartando}
            >
              <p>
                {bajaPendiente.resumen} del {formatearFecha(bajaPendiente.fecha)} del animal {ficha.numero}. El animal sigue activo y no se envía la baja.
              </p>
            </Confirmar>
          ) : (
            usuario?.rol !== 'VETERINARIO' && (
              <button type="button" className="boton-secundario boton-peligro" onClick={() => setConfirmandoDescarte(true)}>
                Descartar baja
              </button>
            )
          )}
        </div>
      )}

      {avisoDescarte && (
        <p className="aviso" role="status">
          {avisoDescarte}
        </p>
      )}

      {/* Rechazados o "en espera del anterior": no cuentan en la ficha pero hay que revisarlos (RF-24). */}
      {!bajaPendiente && locales && locales.sinAceptar > 0 && (
        <p className="aviso" role="status">
          Esta vaca tiene {locales.sinAceptar} {locales.sinAceptar === 1 ? 'pendiente sin aceptar' : 'pendientes sin aceptar'}:{' '}
          <Link to="/pendientes" className="enlace-fila">
            revisalos en Pendientes
          </Link>
        </p>
      )}

      {locales?.avisoLotePendiente && (
        <p className="aviso" role="status">
          El lote se asigna al sincronizar
        </p>
      )}

      {avisoSinLote && (
        <p className="aviso" role="status">
          Quedó sin lote porque {NOMBRE_ESTADO[avisoSinLote.estado]} no tiene lote destino
        </p>
      )}

      {/* Resultado de la última acción (editar, mover, revertir): arriba, para que se vea también en celular. */}
      {confirmacion && (
        <div className="resultado-registro" role="status">
          <p className="resultado-titulo">{confirmacion}</p>
          <button type="button" className="boton-secundario" onClick={() => setConfirmacion(null)}>
            Cerrar
          </button>
        </div>
      )}

      {avisoNumeroAlta && (
        <p className="aviso" role="status">
          {avisoNumeroAlta}
        </p>
      )}

      {avisosEdicion.map((a) => (
        <p key={a} className="aviso" role="status">
          {a}
        </p>
      ))}

      {avisosReversion.map((a) => (
        <p key={a} className="aviso" role="status">
          {a}
        </p>
      ))}

      <dl className="ficha">
        <div>
          <dt>Número</dt>
          <dd>{ficha.numero}</dd>
        </div>
        <div>
          <dt>Sexo</dt>
          <dd>{NOMBRE_SEXO[ficha.sexo]}</dd>
        </div>
        <div>
          <dt>Estado</dt>
          <dd>{NOMBRE_ESTADO[ficha.estado]}</dd>
        </div>
        <div>
          <dt>Lote</dt>
          <dd className={ficha.lote ? undefined : 'texto-suave'}>{ficha.lote ? ficha.lote.nombre : 'sin lote'}</dd>
        </div>
        <div>
          <dt>Fecha de nacimiento</dt>
          <dd className={ficha.fechaNacimiento ? undefined : 'texto-suave'}>{formatearFecha(ficha.fechaNacimiento)}</dd>
        </div>
        <div>
          <dt>Madre</dt>
          <dd>
            {!ficha.madre ? (
              <span className="texto-suave">sin dato</span>
            ) : ficha.madre.activa ? (
              <Link to={`/animales/${ficha.madre.id}`} className="enlace-fila">
                {ficha.madre.numero}
              </Link>
            ) : (
              // Madre de baja: con ficha de baja si fue venta o muerte; si no, solo el número.
              <span className="lista-enlaces">
                {ficha.madre.motivoBaja === 'venta' || ficha.madre.motivoBaja === 'muerte' ? (
                  <Link to={`/bajas/${ficha.madre.id}`} className="enlace-fila">
                    {ficha.madre.numero}
                  </Link>
                ) : (
                  ficha.madre.numero
                )}
                <span className="etiqueta-baja">dada de baja</span>
              </span>
            )}
          </dd>
        </div>
        {/* Cría nacida de un parto cargado (spec 004, RF-39): fecha del parto y su genética. */}
        {ficha.parto && (
          <>
            <div>
              <dt>Parto</dt>
              <dd>Nació en el parto del {formatearFecha(ficha.parto.fecha)}</dd>
            </div>
            <div>
              <dt>Genética</dt>
              <dd className={ficha.parto.genetica ? undefined : 'texto-suave'}>{textoGenetica(ficha.parto.genetica)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Crías</dt>
          <dd>
            {ficha.crias.length === 0 && !ficha.criasDeBaja?.length ? (
              <span className="texto-suave">sin dato</span>
            ) : (
              <span className="lista-enlaces">
                {ficha.crias.map((c) => (
                  <Link key={c.id} to={`/animales/${c.id}`} className="enlace-fila">
                    {c.numero}
                  </Link>
                ))}
                {(ficha.criasDeBaja ?? []).map((c) => (
                  <span key={c.id} className="cria-de-baja">
                    {c.motivo === 'venta' || c.motivo === 'muerte' ? (
                      <Link to={`/bajas/${c.id}`} className="enlace-fila">
                        {c.numero}
                      </Link>
                    ) : (
                      c.numero
                    )}
                    <span className="etiqueta-baja">dada de baja</span>
                  </span>
                ))}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {puedeEditar && !bajaPendiente && (
        <>
          <div className="acciones">
            <button type="button" className="boton necesita-conexion" disabled={!enLinea} title={enLinea ? undefined : TEXTO_NECESITA_CONEXION} onClick={() => setPanel(panel === 'editar' ? null : 'editar')}>
              Editar
            </button>
            <button type="button" className="boton necesita-conexion" disabled={!enLinea} title={enLinea ? undefined : TEXTO_NECESITA_CONEXION} onClick={() => setPanel(panel === 'mover' ? null : 'mover')}>
              Mover de lote
            </button>
            {/* Dar de baja ya no necesita conexión: se guarda con el punto único de registro (spec 011, RF-5). */}
            <button type="button" className="boton-secundario boton-peligro" onClick={() => setPanel(panel === 'baja' ? null : 'baja')}>
              Dar de baja
            </button>
          </div>
          {!enLinea && <NotaNecesitaConexion />}
          {panel === 'baja' && (
            <FormBaja
              key={ficha.id}
              animal={{ id: ficha.id, numero: ficha.numero }}
              alCancelar={() => setPanel(null)}
              alPendiente={(c) => {
                // Guardada en la tablet: la ficha se relee sola (cambia la cola) y pasa a solo lectura.
                setPanel(null);
                setConfirmacion(c.detalle ? `${c.titulo} · ${c.detalle}` : c.titulo);
                setVersionCambios((v) => v + 1);
              }}
              alRegistrar={(b) =>
                navigate(`/bajas/${b.animalId}`, {
                  state: { mensaje: `Baja registrada: ${b.numero}, ${b.motivo} del ${formatearFecha(b.fecha)}` },
                })
              }
              alNoDisponible={alNoDisponible}
            />
          )}
          {panel === 'editar' && (
            <FormEditarAnimal key={ficha.id} ficha={ficha} alCancelar={() => setPanel(null)} alGuardar={(f, avisos) => alGuardar(f, 'Cambios guardados', avisos)} />
          )}
          {panel === 'mover' && (
            <FormMoverLote key={ficha.id} ficha={ficha} alCancelar={() => setPanel(null)} alGuardar={(f) => alGuardar(f, 'Animal movido de lote')} />
          )}
        </>
      )}

      {/* Hembras: situación, formularios e historial (embebido). Machos: solo el historial. */}
      {ficha.sexo === 'HEMBRA' ? (
        <Reproduccion animalId={ficha.id} numero={ficha.numero} sexo={ficha.sexo} estado={ficha.estado} alCambiarAnimal={recargarFicha} versionExterna={versionCambios} soloLectura={!!bajaPendiente} />
      ) : (
        <Historial animalId={ficha.id} contexto="animales" version={versionCambios} />
      )}

      {/* Producción de leche (spec 008): solo hembras. Después del historial; este no cambia. */}
      {ficha.sexo === 'HEMBRA' && (
        <Produccion
          animalId={ficha.id}
          contexto="animales"
          numero={ficha.numero}
          loteNombre={ficha.lote?.nombre ?? null}
          enOrdene={ficha.estado === 'EN_ORDENE'}
          estadoTexto={NOMBRE_ESTADO[ficha.estado]}
        />
      )}

      <p>
        <Link to="/animales" className="enlace-fila">
          Volver a Animales
        </Link>
      </p>
    </main>
  );
}
