import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { ApiError } from '../api';
import { Campo } from '../componentes/Campo';

export function Registro() {
  const { registro } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password'));

    setError(null);
    setErrores({});
    if (password !== form.get('confirmar')) {
      setErrores({ confirmar: 'Las contraseñas no coinciden' });
      return;
    }

    setEnviando(true);
    try {
      await registro({
        nombreEstablecimiento: String(form.get('nombreEstablecimiento')),
        nombre: String(form.get('nombre')),
        email: String(form.get('email')),
        password,
      });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.detalles.length) {
        // Errores de validación: se muestran debajo de cada campo.
        setErrores(Object.fromEntries(err.detalles.map((d) => [d.campo, d.mensaje])));
      } else {
        setError(err instanceof ApiError ? err.message : 'Error inesperado');
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="pantalla-auth">
      <form className="tarjeta" onSubmit={enviar}>
        <h1>Registrar tambo</h1>
        <p className="subtitulo">Creá la cuenta de tu establecimiento. Vas a ser el usuario dueño.</p>

        {error && <div className="alerta" role="alert">{error}</div>}

        <Campo etiqueta="Nombre del tambo" name="nombreEstablecimiento" required autoFocus error={errores.nombreEstablecimiento} />
        <Campo etiqueta="Tu nombre" name="nombre" autoComplete="name" required error={errores.nombre} />
        <Campo etiqueta="Email" name="email" type="email" autoComplete="email" required error={errores.email} />
        <Campo
          etiqueta="Contraseña"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          ayuda="Mínimo 10 caracteres"
          error={errores.password}
        />
        <Campo etiqueta="Repetí la contraseña" name="confirmar" type="password" autoComplete="new-password" required error={errores.confirmar} />

        <button type="submit" className="boton" disabled={enviando}>
          {enviando ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>

        <p className="pie">
          ¿Ya tenés cuenta? <Link to="/login">Ingresar</Link>
        </p>
      </form>
    </main>
  );
}
