import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../compartido/api';
import { formatearAlta, listarTambos, textoCantidad, textoDueno, type ItemTambo } from './adminDatos';

// Listado de todos los tambos COMO CUENTAS (spec 014, RF-16, RF-17): nombre, dueño, alta, usuarios y animales activos.
// Ordenado por nombre por la API y completo, sin paginación. Cada fila lleva al detalle.
export function ListadoTambos() {
  const [tambos, setTambos] = useState<ItemTambo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setTambos(await listarTambos());
    } catch (err) {
      // Sin conexión: "Esto necesita conexión" en vez de datos viejos (RF-21).
      setTambos(null);
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los tambos');
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <main className="contenido pantalla-admin">
      <div className="admin-titulo">
        <div>
          <h1>Tambos</h1>
          <p className="subtitulo">Todos los tambos de la plataforma, como cuentas.</p>
        </div>
        <Link to="/admin/tambos/nuevo" className="boton boton-enlace">
          Crear tambo
        </Link>
      </div>

      {error && (
        <div className="alerta" role="alert">
          {error}{' '}
          <button type="button" className="boton-secundario" onClick={() => void cargar()}>
            Reintentar
          </button>
        </div>
      )}

      {!error && tambos === null && <p className="subtitulo">Cargando…</p>}

      {tambos && tambos.length === 0 && <p className="subtitulo">Todavía no hay tambos. Creá el primero.</p>}

      {tambos && tambos.length > 0 && (
        <ul className="admin-lista" aria-label="Tambos">
          <li className="admin-cabecera" aria-hidden="true">
            <span>Tambo</span>
            <span>Dueño</span>
            <span>Alta</span>
            <span>Usuarios activos</span>
            <span>Animales activos</span>
          </li>
          {tambos.map((t) => (
            <li key={t.id}>
              <Link
                to={`/admin/tambos/${t.id}`}
                className="admin-fila"
                aria-label={`${t.nombre}: ${textoCantidad(t.usuariosActivos, 'usuario activo', 'usuarios activos')}, ${textoCantidad(t.animalesActivos, 'animal activo', 'animales activos')}`}
              >
                <span className="admin-nombre">{t.nombre}</span>
                <span className="admin-celda" data-etiqueta="Dueño" title={t.dueno?.email}>
                  {textoDueno(t.dueno, t.duenosAdicionales)}
                </span>
                <span className="admin-celda" data-etiqueta="Alta">
                  {formatearAlta(t.creadoEn)}
                </span>
                <span className="admin-celda" data-etiqueta="Usuarios activos">
                  {t.usuariosActivos}
                </span>
                <span className="admin-celda" data-etiqueta="Animales activos">
                  {t.animalesActivos}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
