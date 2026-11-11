import { useAuth } from '../auth';

// Pantalla de bienvenida. La barra con el menú la pone el Layout.
export function Inicio() {
  const { usuario } = useAuth();
  if (!usuario) return null;

  return (
    <main className="contenido">
      <h1>¡Hola, {usuario.nombre}!</h1>
      <p>Desde el menú podés ir a Lotes para armar los lotes del tambo y elegir a cuál va cada animal según su estado.</p>
      <p>Los animales y el buscador llegan en los próximos pasos de la Etapa 1.</p>
    </main>
  );
}
