import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../sesion/auth';
import { ApiError } from '../compartido/api';

// Marco de las pantallas del administrador (spec 014, RF-32): barra con su nombre y "Cerrar sesión".
// NO es el Layout del tambo: no tiene menú de animales, buscador ni avisos de copia local.
export function LayoutAdmin() {
  const { admin, logoutAdmin } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);

  if (!admin) return null;

  // Si no hay conexión el servidor no se entera: se muestra el error y la sesión queda abierta (RF-21).
  // Si sale bien, logoutAdmin deja admin = null y RutaAdmin lleva al login.
  async function cerrarSesion() {
    setError(null);
    setCerrando(true);
    try {
      await logoutAdmin();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cerrar la sesión');
      setCerrando(false);
    }
  }

  return (
    <>
      <header className="menu">
        <div className="menu-identidad">
          <Link to="/admin" className="admin-marca">
            CowRegister · Administración
          </Link>
          <span className="menu-usuario">
            <span className="recortado" title={admin.email}>
              {admin.nombre}
            </span>
            <span className="menu-rol"> · Administrador</span>
          </span>
        </div>
        <div className="menu-acciones">
          <button type="button" className="boton-secundario" onClick={() => void cerrarSesion()} disabled={cerrando}>
            {cerrando ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
        </div>
      </header>

      {error && (
        <div className="contenido">
          <div className="alerta" role="alert">
            {error}
          </div>
        </div>
      )}

      <Outlet />
    </>
  );
}
