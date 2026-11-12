import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../sesion/auth';
import { ApiError, type Rol } from './api';
import { Buscador } from '../animales/Buscador';
import { Confirmar } from '../sinconexion/Confirmar';
import { CartelCopia } from '../sinconexion/CartelCopia';
import { AvisoConexion } from '../sinconexion/AvisoConexion';
import { TEXTO_NECESITA_CONEXION } from '../sinconexion/NecesitaConexion';
import { useEnLinea } from '../sinconexion/useConexion';
import { useCola } from '../sinconexion/ColaProvider';
import { puedeCargar } from '../animales/animalesDatos';

const nombresRol: Record<Rol, string> = {
  DUENO: 'Dueño',
  ENCARGADO: 'Encargado',
  VETERINARIO: 'Veterinario',
};

// Secciones del menú. `sinConexion` = se puede usar sin conexión (lista cerrada, spec 009 RF-12);
// las otras quedan deshabilitadas con "Esto necesita conexión" (RF-13).
const SECCIONES: { a: string; texto: string; end?: boolean; sinConexion: boolean }[] = [
  { a: '/', texto: 'Inicio', end: true, sinConexion: true },
  { a: '/lotes', texto: 'Lotes', sinConexion: false },
  { a: '/animales', texto: 'Animales', sinConexion: true },
  { a: '/bajas', texto: 'Bajas', sinConexion: false },
  { a: '/informes', texto: 'Informes', sinConexion: false },
  { a: '/semen', texto: 'Semen y toros', sinConexion: false },
];

// Marco común de las pantallas privadas (RF-23): barra con el tambo, el usuario,
// el menú y "Cerrar sesión". La pantalla actual se dibuja donde está <Outlet />.
// Como es hija de RutaPrivada, el menú nunca aparece sin sesión (RF-25).
export function Layout() {
  const { usuario, logout } = useAuth();
  const enLinea = useEnLinea();
  const { total: pendientes, rechazados } = useCola(); // litros pendientes de sincronizar (RF-42)
  const { pathname } = useLocation();
  const [error, setError] = useState<string | null>(null);
  // Se muestra al tocar una opción deshabilitada del menú (en una tablet no hay "tooltip").
  const [avisoMenu, setAvisoMenu] = useState(false);
  // Confirmación de cierre de sesión cuando quedan litros pendientes (spec 009, RF-44).
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const [cerrando, setCerrando] = useState(false);

  // El aviso se va al cambiar de pantalla o al volver la conexión.
  useEffect(() => setAvisoMenu(false), [pathname, enLinea]);

  if (!usuario) return null;

  // Cierra la sesión: borra TODO lo guardado en la tablet (RF-43). Si quedan litros pendientes (esperando o
  // rechazados) primero pide confirmación con la cantidad (RF-44); si cancela, no se cierra nada.
  // Sin conexión igual se cierra y se borra; el aviso de que el servidor no se cerró lo muestra el ingreso (RF-45).
  // No hace falta navegar a mano: logout() deja usuario = null y RutaPrivada redirige al login.
  async function ejecutarCierre() {
    setError(null);
    setCerrando(true);
    try {
      await logout();
    } catch (err) {
      setConfirmandoCierre(false);
      setError(err instanceof ApiError ? err.message : 'No se pudo cerrar la sesión');
    } finally {
      setCerrando(false);
    }
  }

  function cerrarSesion() {
    if (pendientes > 0) setConfirmandoCierre(true);
    else void ejecutarCierre();
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
              `end` hace que Inicio ("/") no quede marcado también dentro de /lotes.
              Sin conexión, las secciones que la necesitan se dibujan como botones deshabilitados. */}
          <nav aria-label="Principal" className="menu-nav">
            {SECCIONES.map((s) =>
              enLinea || s.sinConexion ? (
                <NavLink key={s.a} to={s.a} end={s.end} className="menu-enlace">
                  {s.texto}
                </NavLink>
              ) : (
                <button
                  key={s.a}
                  type="button"
                  className="menu-enlace menu-enlace-inactivo"
                  aria-disabled="true"
                  title={TEXTO_NECESITA_CONEXION}
                  onClick={() => setAvisoMenu(true)}
                >
                  {s.texto}
                </button>
              ),
            )}
            {/* Pendientes de sincronizar (spec 009): solo dueño y encargado cargan litros. Se puede abrir sin
                conexión. El número se ve también con conexión; con rechazados se destaca (color y "!"). */}
            {puedeCargar(usuario.rol) && (
              <NavLink
                to="/pendientes"
                className="menu-enlace"
                aria-label={pendientes > 0 ? `Pendientes de sincronizar: ${pendientes}${rechazados > 0 ? `, ${rechazados} rechazados` : ''}` : undefined}
              >
                Pendientes
                {pendientes > 0 && (
                  <span className={rechazados > 0 ? 'contador contador-alerta' : 'contador'} aria-hidden="true">
                    {pendientes}
                    {rechazados > 0 && ' !'}
                  </span>
                )}
              </NavLink>
            )}
          </nav>
          <button type="button" className="boton-secundario" onClick={cerrarSesion}>
            Cerrar sesión
          </button>
        </div>

        {/* Buscador por número: en todas las pantallas con sesión (RF-31). */}
        <Buscador />
      </header>

      {/* Sin conexión: "Sin conexión: datos al día de…" en toda la interfaz (RF-41). */}
      <AvisoConexion />
      {/* Con conexión: "Actualizando…" / "Datos al día de…" (spec 009). */}
      <CartelCopia />

      {avisoMenu && !enLinea && (
        <div className="contenido">
          <p className="aviso" role="status">
            {TEXTO_NECESITA_CONEXION}
          </p>
        </div>
      )}

      {confirmandoCierre && (
        <div className="contenido">
          <Confirmar
            titulo="¿Cerrar sesión con litros sin enviar?"
            confirmarTexto="Cerrar sesión y borrar"
            alConfirmar={() => void ejecutarCierre()}
            alCancelar={() => setConfirmandoCierre(false)}
            ocupado={cerrando}
          >
            <p>
              Se van a perder {pendientes} {pendientes === 1 ? 'litro cargado' : 'litros cargados'} que todavía no se{' '}
              {pendientes === 1 ? 'envió' : 'enviaron'} al servidor
              {rechazados > 0 ? ` (${rechazados} ${rechazados === 1 ? 'rechazado' : 'rechazados'})` : ''}. Al cerrar sesión se borran todos los datos
              guardados en la tablet.
            </p>
          </Confirmar>
        </div>
      )}

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
