import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../compartido/api';
import { formatearAlta, listarTambos, textoCantidad, textoDueno, textoUltimoIngreso, type FiltroEstado, type ItemTambo } from './adminDatos';

const FILTROS: { valor: FiltroEstado; texto: string }[] = [
  { valor: 'todos', texto: 'Todos' },
  { valor: 'activos', texto: 'Activos' },
  { valor: 'baja', texto: 'Dados de baja' },
];

// Listado de todos los tambos COMO CUENTAS (spec 014, RF-16, RF-17): nombre, dueño, alta, usuarios y animales activos.
// Ordenado por nombre por la API y completo, sin paginación. Cada fila lleva al detalle.
// Spec 015: filtro de estado (lo resuelve el servidor) y, en cada fila, el estado y el último ingreso (RF-35).
export function ListadoTambos() {
  const [tambos, setTambos] = useState<ItemTambo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroEstado>('todos');

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setTambos(await listarTambos(filtro));
    } catch (err) {
      // Sin conexión: "Esto necesita conexión" en vez de datos viejos (RF-21).
      setTambos(null);
      setError(err instanceof ApiError ? err.message : 'No se pudieron cargar los tambos');
    }
  }, [filtro]);

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

      <div className="admin-filtro" role="group" aria-label="Filtrar por estado">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            className={f.valor === filtro ? 'boton' : 'boton-secundario'}
            aria-pressed={f.valor === filtro}
            onClick={() => setFiltro(f.valor)}
          >
            {f.texto}
          </button>
        ))}
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

      {tambos && tambos.length === 0 && <p className="subtitulo">{filtro === 'todos' ? 'Todavía no hay tambos. Creá el primero.' : 'No hay tambos con ese estado.'}</p>}

      {tambos && tambos.length > 0 && (
        <ul className="admin-lista" aria-label="Tambos">
          <li className="admin-cabecera" aria-hidden="true">
            <span>Tambo</span>
            <span>Dueño</span>
            <span>Estado</span>
            <span>Alta</span>
            <span>Último ingreso</span>
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
                <span className="admin-celda" data-etiqueta="Estado">
                  <span className={t.estado === 'BAJA' ? 'etiqueta-estado etiqueta-rechazado' : 'etiqueta-estado etiqueta-enviado'}>
                    {t.estado === 'BAJA' ? 'De baja' : 'Activo'}
                  </span>
                </span>
                <span className="admin-celda" data-etiqueta="Alta">
                  {formatearAlta(t.creadoEn)}
                </span>
                <span className="admin-celda" data-etiqueta="Último ingreso">
                  {textoUltimoIngreso(t.ultimoIngreso)}
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
