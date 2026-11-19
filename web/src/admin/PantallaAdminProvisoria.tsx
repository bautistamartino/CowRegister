import { useAuth } from '../sesion/auth';

// PROVISORIO (spec 014, T4): lo reemplazan las pantallas reales del administrador en la T5.
// Sirve para probar el ingreso, las guardas de ruta y el cierre de sesión.
export function PantallaAdminProvisoria({ titulo }: { titulo: string }) {
  const { admin, logoutAdmin } = useAuth();
  return (
    <main className="pantalla-auth">
      <div className="tarjeta">
        <h1>{titulo}</h1>
        <p className="subtitulo">{admin?.nombre}</p>
        <button type="button" className="boton" onClick={() => void logoutAdmin().catch(() => undefined)}>
          Cerrar sesión
        </button>
      </div>
    </main>
  );
}
