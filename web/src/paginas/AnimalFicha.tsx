import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError, type AnimalFicha as Ficha, type EstadoAnimal } from '../api';
import { Reproduccion } from '../componentes/Reproduccion';
import { FormEditarAnimal } from '../componentes/FormEditarAnimal';
import { FormMoverLote } from '../componentes/FormMoverLote';
import { FormBaja } from '../componentes/FormBaja';
import { HistorialCambios } from '../componentes/HistorialCambios';
import { useAuth } from '../auth';
import { NOMBRE_ESTADO, NOMBRE_SEXO, TEXTO_NO_DISPONIBLE, formatearFecha } from '../animales';
import { textoGenetica } from '../reproduccion';

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
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { usuario } = useAuth();
  // Solo se esconden los botones; la API igual responde 403 al veterinario.
  const puedeEditar = !!usuario && usuario.rol !== 'VETERINARIO';
  const [panel, setPanel] = useState<'editar' | 'mover' | 'baja' | null>(null);
  const [confirmacion, setConfirmacion] = useState<string | null>(estadoNav?.mensaje ?? null);
  // 404 al dar de baja (RF-21): otra persona ya la dio; se avisa y se recarga la pantalla.
  const [avisoNoDisponible, setAvisoNoDisponible] = useState(false);
  // Sube cada vez que se guarda algo, para que el historial vuelva a leerse.
  const [versionCambios, setVersionCambios] = useState(0);

  useEffect(() => {
    let vigente = true;
    setFicha(null);
    setNoEncontrado(false);
    setError(null);
    setPanel(null);
    setConfirmacion(estadoNav?.mensaje ?? null);
    setAvisoNoDisponible(false);
    api<Ficha>(`/animales/${encodeURIComponent(id ?? '')}`)
      .then((f) => {
        if (vigente) setFicha(f);
      })
      .catch((err) => {
        if (!vigente) return;
        if (err instanceof ApiError && err.status === 404) setNoEncontrado(true);
        else setError(err instanceof ApiError ? err.message : 'No se pudo cargar el animal');
      });
    return () => {
      vigente = false;
    };
  }, [id]);

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
  async function alGuardar(nueva: Ficha, mensaje: string) {
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

  if (noEncontrado) {
    return (
      <main className="contenido">
        <h1>Animal no encontrado</h1>
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

  return (
    <main className="contenido pantalla-lotes">
      <h1>Animal {ficha.numero}</h1>

      {alertaNoDisponible}

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
              // Una madre dada de baja no tiene ficha accesible: solo se muestra el número.
              ficha.madre.numero
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
            {ficha.crias.length === 0 ? (
              <span className="texto-suave">sin dato</span>
            ) : (
              <span className="lista-enlaces">
                {ficha.crias.map((c) => (
                  <Link key={c.id} to={`/animales/${c.id}`} className="enlace-fila">
                    {c.numero}
                  </Link>
                ))}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {puedeEditar && (
        <>
          <div className="acciones">
            <button type="button" className="boton" onClick={() => setPanel(panel === 'editar' ? null : 'editar')}>
              Editar
            </button>
            <button type="button" className="boton" onClick={() => setPanel(panel === 'mover' ? null : 'mover')}>
              Mover de lote
            </button>
            <button type="button" className="boton-secundario boton-peligro" onClick={() => setPanel(panel === 'baja' ? null : 'baja')}>
              Dar de baja
            </button>
          </div>
          {panel === 'baja' && (
            <FormBaja
              key={ficha.id}
              animalId={ficha.id}
              numero={ficha.numero}
              alCancelar={() => setPanel(null)}
              alRegistrar={(b) =>
                navigate(`/bajas/${b.animalId}`, {
                  state: { mensaje: `Baja registrada: ${b.numero}, ${b.motivo} del ${formatearFecha(b.fecha)}` },
                })
              }
              alNoDisponible={alNoDisponible}
            />
          )}
          {panel === 'editar' && (
            <FormEditarAnimal key={ficha.id} ficha={ficha} alCancelar={() => setPanel(null)} alGuardar={(f) => alGuardar(f, 'Cambios guardados')} />
          )}
          {panel === 'mover' && (
            <FormMoverLote key={ficha.id} ficha={ficha} alCancelar={() => setPanel(null)} alGuardar={(f) => alGuardar(f, 'Animal movido de lote')} />
          )}
        </>
      )}

      {/* Hembras: situación reproductiva, formularios e historial. Machos: sin acciones reproductivas. */}
      {ficha.sexo === 'HEMBRA' ? (
        <Reproduccion animalId={ficha.id} sexo={ficha.sexo} estado={ficha.estado} alCambiarAnimal={recargarFicha} />
      ) : (
        <section className="seccion">
          <h2>Historial</h2>
          <p className="subtitulo">Todavía no hay eventos registrados</p>
        </section>
      )}

      <HistorialCambios animalId={ficha.id} version={versionCambios} />

      <p>
        <Link to="/animales" className="enlace-fila">
          Volver a Animales
        </Link>
      </p>
    </main>
  );
}
