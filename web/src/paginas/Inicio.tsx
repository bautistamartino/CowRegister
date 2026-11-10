import { useAuth } from '../auth';
import type { Rol } from '../api';

const nombresRol: Record<Rol, string> = {
  DUENO: 'Dueño',
  ENCARGADO: 'Encargado',
  VETERINARIO: 'Veterinario',
};

export function Inicio() {
  const { usuario, logout } = useAuth();
  if (!usuario) return null;

  return (
    <>
      <header className="barra">
        <strong>{usuario.establecimiento.nombre}</strong>
        <div className="barra-usuario">
          <span>
            {usuario.nombre} · {nombresRol[usuario.rol]}
          </span>
          <button className="boton-secundario" onClick={logout}>
            Salir
          </button>
        </div>
      </header>
      <main className="contenido">
        <h1>¡Hola, {usuario.nombre}!</h1>
        <p>Acá van a aparecer los lotes, los animales y el buscador (próximos pasos de la Etapa 1).</p>
      </main>
    </>
  );
}
