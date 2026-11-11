import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { api, ApiError, type AnimalFicha as Ficha, type EstadoAnimal } from '../api';
import { Reproduccion } from '../componentes/Reproduccion';
import { NOMBRE_ESTADO, NOMBRE_SEXO, formatearFecha } from '../animales';
import { textoGenetica } from '../reproduccion';

// Ficha de un animal, solo lectura (RF-28, RF-29).
export function AnimalFicha() {
  const { id } = useParams();
  const location = useLocation();
  // Después de un alta, AnimalNuevo manda el aviso de "sin lote" por el estado de navegación.
  const avisoSinLote =
    (location.state as { avisoSinLote?: { estado: EstadoAnimal } | null } | null)?.avisoSinLote ?? null;
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setFicha(null);
    setNoEncontrado(false);
    setError(null);
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
    try {
      setFicha(await api<Ficha>(`/animales/${encodeURIComponent(id ?? '')}`));
    } catch {
      // Si falla, queda la ficha anterior: no es grave y un refresco de la página la corrige.
    }
  }

  if (noEncontrado) {
    return (
      <main className="contenido">
        <h1>Animal no encontrado</h1>
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

      {avisoSinLote && (
        <p className="aviso" role="status">
          Quedó sin lote porque {NOMBRE_ESTADO[avisoSinLote.estado]} no tiene lote destino
        </p>
      )}

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

      {/* Hembras: situación reproductiva, formularios e historial. Machos: sin acciones reproductivas. */}
      {ficha.sexo === 'HEMBRA' ? (
        <Reproduccion animalId={ficha.id} sexo={ficha.sexo} estado={ficha.estado} alCambiarAnimal={recargarFicha} />
      ) : (
        <section className="seccion">
          <h2>Historial</h2>
          <p className="subtitulo">Todavía no hay eventos registrados</p>
        </section>
      )}

      <p>
        <Link to="/animales" className="enlace-fila">
          Volver a Animales
        </Link>
      </p>
    </main>
  );
}
