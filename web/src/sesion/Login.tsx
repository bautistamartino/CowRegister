import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from './auth';
import { ConfirmarIngreso } from './ConfirmarIngreso';
import { ApiError } from '../compartido/api';
import { Campo } from '../compartido/Campo';

export function Login() {
  const { login, ingresoPendiente, avisoCierre } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    setEnviando(true);
    try {
      // false = quedó esperando la confirmación de ConfirmarIngreso (no se entra todavía).
      const entro = await login(String(form.get('email')), String(form.get('password')));
      if (entro) {
        const desde = (location.state as { desde?: string } | null)?.desde ?? '/';
        navigate(desde, { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error inesperado');
    } finally {
      setEnviando(false);
    }
  }

  // Hay datos de otro usuario con pendientes: solo se muestra el aviso, sin formulario ni ningún dato (RF-46).
  if (ingresoPendiente) {
    return (
      <main className="pantalla-auth">
        <div className="tarjeta">
          <h1>CowRegister</h1>
          <ConfirmarIngreso />
        </div>
      </main>
    );
  }

  return (
    <main className="pantalla-auth">
      <form className="tarjeta" onSubmit={enviar}>
        <h1>CowRegister</h1>
        <p className="subtitulo">Ingresá a tu tambo</p>

        {avisoCierre && <div className="aviso" role="status">{avisoCierre}</div>}
        {error && <div className="alerta" role="alert">{error}</div>}

        <Campo etiqueta="Email" name="email" type="email" autoComplete="email" required autoFocus />
        <Campo etiqueta="Contraseña" name="password" type="password" autoComplete="current-password" required />

        <button type="submit" className="boton" disabled={enviando}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>

        <p className="pie">
          ¿Tu tambo todavía no tiene cuenta? <Link to="/registro">Registrar tambo</Link>
        </p>
      </form>
    </main>
  );
}
