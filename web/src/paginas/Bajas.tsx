import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type ListadoBajas } from '../api';
import { NOMBRE_SEXO, formatearFecha, nombreMotivo, textoAnimales } from '../animales';

// Listado de animales dados de baja por venta o muerte (spec 006, RF-12). Lo ven los tres roles.
// Filtros por motivo y por número; la API ordena (fecha de baja, del más reciente al más antiguo).
export function Bajas() {
  const [motivo, setMotivo] = useState(''); // '' = todos
  const [numero, setNumero] = useState('');
  const [listado, setListado] = useState<ListadoBajas | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cada cambio de filtro vuelve a pedir el listado; `vigente` descarta respuestas viejas.
  useEffect(() => {
    let vigente = true;
    const params = new URLSearchParams();
    if (motivo) params.set('motivo', motivo);
    if (numero.trim()) params.set('numero', numero.trim());
    const consulta = params.toString();
    api<ListadoBajas>(`/bajas${consulta ? `?${consulta}` : ''}`)
      .then((r) => {
        if (!vigente) return;
        setListado(r);
        setError(null);
      })
      .catch((err) => {
        if (vigente) setError(err instanceof ApiError ? err.message : 'No se pudo cargar el listado de bajas');
      });
    return () => {
      vigente = false;
    };
  }, [motivo, numero]);

  const hayNumero = numero.trim() !== '';

  return (
    <main className="contenido pantalla-lotes">
      <div className="encabezado-pantalla">
        <h1>Bajas</h1>
      </div>

      <div className="filtros">
        <div className="campo">
          <label htmlFor="filtro-motivo">Motivo</label>
          <select id="filtro-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            <option value="">Todos</option>
            <option value="venta">Venta</option>
            <option value="muerte">Muerte</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="filtro-numero">Número</label>
          <input
            id="filtro-numero"
            type="search"
            value={numero}
            maxLength={20}
            autoComplete="off"
            placeholder="Buscar por número"
            onChange={(e) => setNumero(e.target.value)}
          />
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
              Mostrando {listado.mostrados} de {listado.total} bajas: usá los filtros para acotar
            </p>
          )}

          {listado.bajas.length === 0 ? (
            <div className="seccion">
              <p className="subtitulo">{hayNumero ? 'No hay bajas con ese número' : 'No hay animales dados de baja'}</p>
            </div>
          ) : (
            // La tabla se desplaza dentro de su contenedor; la página nunca se desborda.
            <div className="tabla-contenedor">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Número</th>
                    <th scope="col">Sexo</th>
                    <th scope="col">Fecha de baja</th>
                    <th scope="col">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {listado.bajas.map((b) => (
                    // El id es el del animal (a lo sumo una baja vigente por animal).
                    <tr key={b.id}>
                      <td>
                        <Link to={`/bajas/${b.id}`} className="enlace-fila">
                          {b.numero}
                        </Link>
                      </td>
                      <td>{NOMBRE_SEXO[b.sexo]}</td>
                      <td>{formatearFecha(b.fecha)}</td>
                      <td>{nombreMotivo(b.motivo)}</td>
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
