import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../sesion/auth';
import { api, ApiError, type ListadoAnimales, type Lote } from '../compartido/api';
import { ESTADOS_INICIALES, NOMBRE_ESTADO, NOMBRE_SEXO, puedeCargar, textoAnimales } from './animalesDatos';

// Listado de animales activos con filtros por estado y lote (RF-23 a RF-27).
export function Animales() {
  const { usuario } = useAuth();
  // Confirmación de una carga de producción (spec 008): llega por el estado de navegación y se cierra a mano.
  const [confirmacion, setConfirmacion] = useState<string | null>((useLocation().state as { mensaje?: string } | null)?.mensaje ?? null);
  const [estado, setEstado] = useState('');
  const [loteId, setLoteId] = useState(''); // '' = todos, 'sin-lote' = sin lote
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [listado, setListado] = useState<ListadoAnimales | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Los lotes se piden una vez, para el select de filtro.
  useEffect(() => {
    api<Lote[]>('/lotes')
      .then(setLotes)
      .catch(() => setLotes([])); // si falla, el filtro queda solo con "Todos" y "Sin lote"
  }, []);

  // Cada vez que cambia un filtro se vuelve a pedir el listado. `vigente` descarta la
  // respuesta de un pedido viejo si el usuario ya cambió el filtro de nuevo.
  useEffect(() => {
    let vigente = true;
    const params = new URLSearchParams();
    if (estado) params.set('estado', estado);
    if (loteId) params.set('loteId', loteId);
    const consulta = params.toString();
    api<ListadoAnimales>(`/animales${consulta ? `?${consulta}` : ''}`)
      .then((r) => {
        if (!vigente) return;
        setListado(r);
        setError(null);
      })
      .catch((err) => {
        if (!vigente) return;
        setError(err instanceof ApiError ? err.message : 'No se pudo cargar el listado');
      });
    return () => {
      vigente = false;
    };
  }, [estado, loteId]);

  if (!usuario) return null;
  const puedeAgregar = puedeCargar(usuario.rol);
  const hayFiltro = estado !== '' || loteId !== '';

  // Accesos de carga: solo para dueño y encargado (RF-27, RF-39).
  const accesos = puedeAgregar && (
    <div className="acciones">
      <Link to="/animales/nuevo" className="boton enlace-boton">
        Nuevo animal
      </Link>
      <Link to="/animales/planilla" className="boton-secundario enlace-boton">
        Cargar desde planilla
      </Link>
    </div>
  );

  return (
    <main className="contenido pantalla-lotes">
      <div className="encabezado-pantalla">
        <h1>Animales</h1>
        {listado && listado.animales.length > 0 && accesos}
      </div>

      {confirmacion && (
        <div className="resultado-registro" role="status">
          <p className="resultado-titulo">{confirmacion}</p>
          <button type="button" className="boton-secundario" onClick={() => setConfirmacion(null)}>
            Cerrar
          </button>
        </div>
      )}

      <div className="filtros">
        <div className="campo">
          <label htmlFor="filtro-estado">Estado</label>
          <select id="filtro-estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS_INICIALES.map((e) => (
              <option key={e} value={e}>
                {NOMBRE_ESTADO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="filtro-lote">Lote</label>
          <select id="filtro-lote" value={loteId} onChange={(e) => setLoteId(e.target.value)}>
            <option value="">Todos</option>
            <option value="sin-lote">Sin lote</option>
            {lotes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}

      {!listado && !error && <p className="subtitulo">Cargando…</p>}

      {listado && (
        <>
          <p className="subtitulo" role="status">
            {textoAnimales(listado.total)}
          </p>
          {listado.truncado && (
            <p className="aviso">
              Mostrando {listado.mostrados} de {listado.total} animales: usá los filtros para acotar
            </p>
          )}

          {listado.animales.length === 0 ? (
            <div className="seccion">
              <p className="subtitulo">
                {hayFiltro ? 'Ningún animal cumple con los filtros.' : 'Todavía no hay animales cargados.'}
              </p>
              {accesos}
            </div>
          ) : (
            // El contenedor tiene su propio scroll horizontal: la página nunca se desborda (RF-41).
            <div className="tabla-contenedor">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Número</th>
                    <th scope="col">Sexo</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Lote</th>
                  </tr>
                </thead>
                <tbody>
                  {listado.animales.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/animales/${a.id}`} className="enlace-fila">
                          {a.numero}
                        </Link>
                      </td>
                      <td>{NOMBRE_SEXO[a.sexo]}</td>
                      <td>{NOMBRE_ESTADO[a.estado]}</td>
                      <td className={a.lote ? undefined : 'texto-suave'}>{a.lote ? a.lote.nombre : 'sin lote'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
