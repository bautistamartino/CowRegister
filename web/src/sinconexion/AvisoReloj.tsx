import { TEXTO_RELOJ_ATRASADO } from './relojTablet';

// Aviso arriba de cada formulario de carga cuando el reloj de la tablet parece atrasado (spec 012, RF-14).
// Lo dibuja el formulario solo si `atrasado` es verdadero (viene de `useRelojTablet`).
export function AvisoReloj({ atrasado }: { atrasado: boolean }) {
  if (!atrasado) return null;
  return (
    <p className="aviso" role="status">
      {TEXTO_RELOJ_ATRASADO}
    </p>
  );
}
