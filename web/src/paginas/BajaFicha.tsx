import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, ApiError, type BajaRevertida, type FichaBaja } from '../api';
import { useAuth } from '../auth';
import { NOMBRE_ESTADO, NOMBRE_SEXO, TEXTO_NO_DISPONIBLE, formatearFecha, nombreMotivo, puedeCargar } from '../animales';
import { fechaArgentinaIso } from '../reproduccion';
import { Historial } from '../componentes/Historial';
import { FormRevertirBaja } from '../componentes/FormRevertirBaja';

// Ficha de baja (spec 006, RF-13): solo lectura. Los tres roles la ven; dueño y encargado
// pueden además "Revertir baja". El id de la ruta es el del animal.
export function BajaFicha() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const [ficha, setFicha] = useState<FichaBaja | null>(null);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mensaje "Baja registrada: …" que manda FormBaja por el estado de navegación.
  const [mensaje, setMensaje] = useState<string | null>((location.state as { mensaje?: string } | null)?.mensaje ?? null);
  const [revirtiendo, setRevirtiendo] = useState(false);
  // Aviso de 404 (RF-21): sobrevive a la recarga para que el usuario sepa qué pasó.
  const [avisoNoDisponible, setAvisoNoDisponible] = useState(false);

  useEffect(() => {
    let vigente = true;
    setFicha(null);
    setNoEncontrado(false);
    setError(null);
    setRevirtiendo(false);
    setAvisoNoDisponible(false);
    setMensaje((location.state as { mensaje?: string } | null)?.mensaje ?? null);
    api<FichaBaja>(`/bajas/${encodeURIComponent(id ?? '')}`)
      .then((f) => {
        if (vigente) setFicha(f);
      })
      .catch((err) => {
        if (!vigente) return;
        if (err instanceof ApiError && err.status === 404) setNoEncontrado(true);
        else setError(err instanceof ApiError ? err.message : 'No se pudo cargar la baja');
      });
    return () => {
      vigente = false;
    };
  }, [id]);

  // Revertir dio 404: otra persona ya lo hizo. Se muestra el mensaje y se vuelve a leer la ficha.
  async function alNoDisponible() {
    setAvisoNoDisponible(true);
    setRevirtiendo(false);
    setMensaje(null);
    try {
      setFicha(await api<FichaBaja>(`/bajas/${encodeURIComponent(id ?? '')}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setFicha(null);
        setNoEncontrado(true);
      }
    }
  }

  // Revertida: se vuelve a la ficha del animal activo con "Baja revertida" y los avisos de lote.
  function alRevertir(r: BajaRevertida) {
    navigate(`/animales/${r.id}`, { state: { mensaje: 'Baja revertida', avisos: r.avisos } });
  }

  const alertaNoDisponible = avisoNoDisponible && (
    <div className="alerta" role="alert">
      {TEXTO_NO_DISPONIBLE}
    </div>
  );

  if (noEncontrado) {
    return (
      <main className="contenido pantalla-lotes">
        <h1>Baja no encontrada</h1>
        {alertaNoDisponible}
        <p>
          <Link to="/bajas" className="enlace-fila">
            Ir al listado de bajas
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

  const { baja } = ficha;
  const puedeRevertir = !!usuario && puedeCargar(usuario.rol); // solo se esconde el botón; la API responde 403

  return (
    <main className="contenido pantalla-lotes">
      <h1>
        Animal {ficha.numero} <span className="etiqueta-baja">dada de baja</span>
      </h1>

      {alertaNoDisponible}

      {mensaje && (
        <div className="resultado-registro" role="status">
          <p className="resultado-titulo">{mensaje}</p>
          <button type="button" className="boton-secundario" onClick={() => setMensaje(null)}>
            Cerrar
          </button>
        </div>
      )}

      {/* Caja de la baja (RF-13): texto exacto "Baja por <venta|muerte> el <dd/mm/aaaa>". */}
      <section className="caja-baja" aria-label="Baja">
        <p className="caja-baja-titulo">
          Baja por {baja.motivo} el {formatearFecha(baja.fecha)}
        </p>
        <p>{baja.observaciones ?? <span className="texto-suave">sin observaciones</span>}</p>
        <p className="texto-suave">
          Registrada por {baja.registradoPor} el {formatearFecha(fechaArgentinaIso(new Date(baja.registradoEn)))}
        </p>
      </section>

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
          <dt>Fecha de nacimiento</dt>
          <dd className={ficha.fechaNacimiento ? undefined : 'texto-suave'}>{formatearFecha(ficha.fechaNacimiento)}</dd>
        </div>
        <div>
          <dt>Estado previo a la baja</dt>
          <dd>{NOMBRE_ESTADO[ficha.estadoAnterior]}</dd>
        </div>
        <div>
          <dt>Motivo</dt>
          <dd>{nombreMotivo(baja.motivo)}</dd>
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
              <span className="lista-enlaces">
                {/* De baja por venta o muerte: acceso a su ficha de baja. Por "parto anulado": solo el número. */}
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
        <div>
          <dt>Crías</dt>
          <dd>
            {ficha.crias.length === 0 && ficha.criasDeBaja.length === 0 ? (
              <span className="texto-suave">sin dato</span>
            ) : (
              <span className="lista-enlaces">
                {ficha.crias.map((c) => (
                  <Link key={c.id} to={`/animales/${c.id}`} className="enlace-fila">
                    {c.numero}
                  </Link>
                ))}
                {ficha.criasDeBaja.map((c) => (
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

      {puedeRevertir && (
        <>
          <div className="acciones">
            <button type="button" className="boton" onClick={() => setRevirtiendo(!revirtiendo)}>
              Revertir baja
            </button>
          </div>
          {revirtiendo && (
            <FormRevertirBaja
              key={ficha.id}
              animalId={ficha.id}
              alCancelar={() => setRevirtiendo(false)}
              alRevertir={alRevertir}
              alNoDisponible={alNoDisponible}
            />
          )}
        </>
      )}

      {/* Historial único en solo lectura: sin "Anular" (la baja se revierte con el botón de arriba). */}
      <Historial animalId={ficha.id} contexto="bajas" version={0} />

      <p>
        <Link to="/bajas" className="enlace-fila">
          Volver a Bajas
        </Link>
      </p>
    </main>
  );
}
