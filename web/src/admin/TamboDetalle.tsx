import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../compartido/api';
import { formatearAlta, NOMBRE_ROL, obtenerTambo, textoCantidad, type DetalleTambo, type UsuarioTambo } from './adminDatos';

// Detalle de un tambo como cuenta (spec 014, RF-18): los datos del listado y todos sus usuarios (activos o no),
// con los dueños destacados. No hay animales, eventos ni litros: el administrador no los ve (RF-19).
export function TamboDetalle() {
  const { id = '' } = useParams();
  const [tambo, setTambo] = useState<DetalleTambo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noExiste, setNoExiste] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    setNoExiste(false);
    try {
      setTambo(await obtenerTambo(id));
    } catch (err) {
      setTambo(null);
      if (err instanceof ApiError && err.status === 404) setNoExiste(true);
      else setError(err instanceof ApiError ? err.message : 'No se pudo cargar el tambo');
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const volver = (
    <Link to="/admin" className="admin-volver">
      ← Volver a los tambos
    </Link>
  );

  if (noExiste) {
    return (
      <main className="contenido pantalla-admin">
        {volver}
        <h1>Tambo no encontrado</h1>
        <p className="subtitulo">Ese tambo no existe o el enlace está mal escrito.</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="contenido pantalla-admin">
        {volver}
        <div className="alerta" role="alert">
          {error}{' '}
          <button type="button" className="boton-secundario" onClick={() => void cargar()}>
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  if (!tambo) {
    return (
      <main className="contenido pantalla-admin">
        {volver}
        <p className="subtitulo">Cargando…</p>
      </main>
    );
  }

  const duenos = tambo.usuarios.filter((u) => u.rol === 'DUENO');
  const otros = tambo.usuarios.filter((u) => u.rol !== 'DUENO');

  return (
    <main className="contenido pantalla-admin">
      {volver}
      <h1>{tambo.nombre}</h1>

      <dl className="admin-datos">
        <div>
          <dt>Alta</dt>
          <dd>{formatearAlta(tambo.creadoEn)}</dd>
        </div>
        <div>
          <dt>Usuarios activos</dt>
          <dd>{tambo.usuariosActivos}</dd>
        </div>
        <div>
          <dt>Animales activos</dt>
          <dd>{tambo.animalesActivos}</dd>
        </div>
      </dl>

      <section className="seccion">
        <h2>{duenos.length === 1 ? 'Dueño' : 'Dueños'}</h2>
        {duenos.length === 0 ? (
          <p className="subtitulo">Este tambo no tiene dueños.</p>
        ) : (
          <>
            {duenos.length > 1 && (
              <p className="subtitulo">
                {textoCantidad(duenos.length, 'dueño', 'dueños')}: cada uno ingresa de forma independiente.
              </p>
            )}
            <ul className="admin-usuarios">
              {duenos.map((u) => (
                <TarjetaUsuario key={u.email} usuario={u} destacado />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="seccion">
        <h2>Otros usuarios</h2>
        {otros.length === 0 ? (
          <p className="subtitulo">No hay otros usuarios.</p>
        ) : (
          <ul className="admin-usuarios">
            {otros.map((u) => (
              <TarjetaUsuario key={u.email} usuario={u} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function TarjetaUsuario({ usuario, destacado = false }: { usuario: UsuarioTambo; destacado?: boolean }) {
  return (
    <li className={destacado ? 'admin-usuario admin-usuario-dueno' : 'admin-usuario'}>
      <div className="admin-usuario-datos">
        <strong>{usuario.nombre}</strong>
        <span className="texto-suave">{usuario.email}</span>
      </div>
      <div className="admin-usuario-marcas">
        <span className="etiqueta-estado">{NOMBRE_ROL[usuario.rol]}</span>
        <span className={usuario.activo ? 'etiqueta-estado etiqueta-enviado' : 'etiqueta-estado etiqueta-rechazado'}>
          {usuario.activo ? 'Activo' : 'Inactivo'}
        </span>
      </div>
    </li>
  );
}
