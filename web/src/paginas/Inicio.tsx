import { useAuth } from '../auth';

// Pantalla de bienvenida. La barra con el menú y el buscador la pone el Layout.
export function Inicio() {
  const { usuario } = useAuth();
  if (!usuario) return null;

  return (
    <main className="contenido">
      <h1>¡Hola, {usuario.nombre}!</h1>
      <p>
        Para abrir la ficha de un animal, escribí su número en el buscador de arriba y apretá Enter (o leé la caravana
        con el bastón).
      </p>
      <p>Desde el menú podés ir a Animales para ver el rodeo o a Lotes para armar los lotes del tambo.</p>
    </main>
  );
}
