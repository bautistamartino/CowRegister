import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { normalizarNumero, puedeCargar } from '../animales';

// Buscador por número (RF-31 a RF-36). Vive en la barra del Layout, así está en todas
// las pantallas con sesión. El bastón lector "tipea" el número y manda Enter, que es
// justo lo que envía este formulario: no se busca mientras se tipea (RF-33).
export function Buscador() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const campo = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState('');
  const [buscando, setBuscando] = useState(false);
  // Resultado negativo: el número buscado (ya normalizado, o el texto crudo si no era válido).
  const [noEncontrado, setNoEncontrado] = useState<{ texto: string; valido: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Foco automático solo en Inicio y en el listado (RF-32); nunca en formularios.
  useEffect(() => {
    if (pathname === '/' || pathname === '/animales') campo.current?.focus();
  }, [pathname]);

  // El aviso se borra al cambiar de pantalla (el enlace "Dar de alta" también cambia de ruta).
  useEffect(() => {
    setNoEncontrado(null);
    setError(null);
    setTexto(''); // el número viejo no tiene por qué quedar escrito en la pantalla nueva
  }, [pathname]);

  async function buscar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNoEncontrado(null);
    const numero = normalizarNumero(texto);
    const vacio = texto.trim() === '';
    if (vacio) {
      // RF-36: Enter vacío no busca; el foco queda en el campo.
      campo.current?.focus();
      return;
    }
    if (numero === null) {
      // Caracteres no permitidos: mismo resultado que un número inexistente (RF-34), sin llamar a la API.
      setNoEncontrado({ texto: texto.trim(), valido: false });
      campo.current?.select();
      return;
    }
    setBuscando(true);
    try {
      const r = await api<{ id: string; numero: string }>(`/animales/buscar?numero=${encodeURIComponent(numero)}`);
      setTexto('');
      navigate(`/animales/${r.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNoEncontrado({ texto: numero, valido: true });
        campo.current?.select(); // listo para leer la próxima vaca con el bastón
      } else if (!(err instanceof ApiError && err.status === 401)) {
        setError(err instanceof ApiError ? err.message : 'No se pudo buscar');
      }
    } finally {
      setBuscando(false);
    }
  }

  if (!usuario) return null;

  return (
    <div className="buscador">
      <form role="search" className="buscador-form" onSubmit={buscar}>
        <input
          ref={campo}
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label="Buscar animal por número"
          placeholder="Buscar animal por número"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <button type="submit" className="boton" disabled={buscando}>
          Buscar
        </button>
      </form>
      <div role="status" className="buscador-aviso">
        {noEncontrado && (
          <p>
            No hay un animal activo con el número {noEncontrado.texto}
            {noEncontrado.valido && puedeCargar(usuario.rol) && (
              <>
                {' '}
                <Link to={`/animales/nuevo?numero=${encodeURIComponent(noEncontrado.texto)}`}>Dar de alta</Link>
              </>
            )}
          </p>
        )}
        {error && <p className="buscador-error">{error}</p>}
      </div>
    </div>
  );
}
