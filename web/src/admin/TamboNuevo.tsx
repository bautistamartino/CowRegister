import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../compartido/api';
import { Campo } from '../compartido/Campo';
import { crearTambo, validarTamboNuevo, type ErroresTamboNuevo } from './adminDatos';

// Crear un tambo con su dueño (spec 014, RF-22 a RF-27). No inicia sesión como el dueño: al terminar se vuelve
// al listado. La contraseña inicial la define el administrador y se la pasa al dueño por fuera de la aplicación.
export function TamboNuevo() {
  const navigate = useNavigate();
  const [errores, setErrores] = useState<ErroresTamboNuevo>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const texto = (campo: string) => String(f.get(campo) ?? '');
    setError(null);

    // Mismas reglas que la API: si algo falla se marca el campo y no se envía nada.
    const { errores: locales, datos } = validarTamboNuevo({
      nombreEstablecimiento: texto('nombreEstablecimiento'),
      nombre: texto('nombre'),
      email: texto('email'),
      password: texto('password'),
      confirmar: texto('confirmar'),
    });
    setErrores(locales);
    if (!datos) return;

    setEnviando(true);
    try {
      await crearTambo(datos);
      navigate('/admin', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.detalles.length) {
        setErrores(Object.fromEntries(err.detalles.map((d) => [d.campo, d.mensaje])));
      } else if (err instanceof ApiError && err.status === 409) {
        // Un 409 es nombre del tambo repetido o email repetido: se marca el campo que corresponde.
        // Cualquier otro 409 (mensaje genérico) se muestra como aviso general, sin adivinar el campo.
        if (/tambo/i.test(err.message)) setErrores({ nombreEstablecimiento: err.message });
        else if (/email/i.test(err.message)) setErrores({ email: err.message });
        else setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Error inesperado');
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="contenido pantalla-admin">
      <Link to="/admin" className="admin-volver">
        ← Volver a los tambos
      </Link>
      <h1>Crear tambo</h1>
      <p className="subtitulo">Se crea el tambo con su usuario dueño. Después pasale la contraseña inicial por otro medio.</p>

      <form className="admin-formulario" onSubmit={enviar} noValidate>
        {error && (
          <div className="alerta" role="alert">
            {error}
          </div>
        )}

        <Campo etiqueta="Nombre del tambo" name="nombreEstablecimiento" required autoFocus error={errores.nombreEstablecimiento} />
        <Campo etiqueta="Nombre del dueño" name="nombre" autoComplete="off" required error={errores.nombre} />
        <Campo etiqueta="Email del dueño" name="email" type="email" autoComplete="off" required error={errores.email} />
        <Campo
          etiqueta="Contraseña inicial"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          ayuda="Mínimo 10 caracteres"
          error={errores.password}
        />
        <Campo etiqueta="Repetí la contraseña" name="confirmar" type="password" autoComplete="new-password" required error={errores.confirmar} />

        <div className="acciones">
          <button type="submit" className="boton" disabled={enviando}>
            {enviando ? 'Creando…' : 'Crear tambo'}
          </button>
          <Link to="/admin" className="boton-secundario boton-enlace">
            Cancelar
          </Link>
        </div>
      </form>
    </main>
  );
}
