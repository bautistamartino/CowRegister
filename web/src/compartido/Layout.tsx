import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../sesion/auth';
import { ApiError, type Rol } from './api';
import { Buscador } from '../animales/Buscador';

const nombresRol: Record<Rol, string> = {
  DUENO: 'Dueño',
  ENCARGADO: 'Encargado',
  VETERINARIO: 'Veterinario',
};

// Marco común de las pantallas privadas (RF-23): barra con el tambo, el usuario,
// el menú y "Cerrar sesión". La pantalla actual se dibuja donde está <Outlet />.
// Como es hija de RutaPrivada, el menú nunca aparece sin sesión (RF-25).
export function Layout() {
  const { usuario, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);

  if (!usuario) return null;

  // Cierra la sesión sin pedir confirmación (RF-28). No hace falta navegar a mano:
  // logout() deja usuario = null y RutaPrivada (que envuelve a este Layout) redirige al login.
  async function cerrarSesion() {
    setError(null);
    try {
      await logout();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cerrar la sesión');
    }
  }

  return (
    <>
      <header className="menu">
        {/* Nombres largos se recortan con "…" por CSS (RF-30); el title muestra el nombre completo. */}
        <div className="menu-identidad">
          <strong className="recortado" title={usuario.establecimiento.nombre}>
            {usuario.establecimiento.nombre}
          </strong>
          <span className="menu-usuario">
            <span className="recortado" title={usuario.nombre}>
              {usuario.nombre}
            </span>
            <span className="menu-rol"> · {nombresRol[usuario.rol]}</span>
          </span>
        </div>

        <div className="menu-acciones">
          {/* NavLink agrega aria-current="page" al enlace de la sección actual (RF-24).
              `end` hace que Inicio ("/") no quede marcado también dentro de /lotes. */}
          <nav aria-label="Principal" className="menu-nav">
            <NavLink to="/" end className="menu-enlace">
              Inicio
            </NavLink>
            <NavLink to="/lotes" className="menu-enlace">
              Lotes
            </NavLink>
            <NavLink to="/animales" className="menu-enlace">
              Animales
            </NavLink>
            <NavLink to="/bajas" className="menu-enlace">
              Bajas
            </NavLink>
            <NavLink to="/informes" className="menu-enlace">
              Informes
            </NavLink>
            <NavLink to="/semen" className="menu-enlace">
              Semen y toros
            </NavLink>
          </nav>
          <button type="button" className="boton-secundario" onClick={cerrarSesion}>
            Cerrar sesión
          </button>
        </div>

        {/* Buscador por número: en todas las pantallas con sesión (RF-31). */}
        <Buscador />
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
