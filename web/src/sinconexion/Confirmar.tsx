import { useEffect, useId, useRef, type ReactNode } from 'react';

// Panel de confirmación para acciones que no se pueden deshacer (spec 009: descartar un pendiente, y en
// la T5 cerrar sesión con pendientes). Se dibuja en el lugar donde se usa, sin ventana flotante: en una
// tablet es más fácil de tocar y no tapa nada.
//
// El foco arranca en "Cancelar", la opción segura: un Enter apurado no destruye nada (RF-38: ningún
// pendiente se descarta sin una acción explícita).
export function Confirmar({
  titulo,
  children,
  confirmarTexto,
  cancelarTexto = 'Cancelar',
  alConfirmar,
  alCancelar,
  ocupado = false,
}: {
  titulo: string;
  children: ReactNode;
  confirmarTexto: string;
  cancelarTexto?: string;
  alConfirmar: () => void;
  alCancelar: () => void;
  ocupado?: boolean;
}) {
  const idTitulo = useId();
  const idTexto = useId();
  const cancelar = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelar.current?.focus(), []);

  return (
    <div className="confirmar" role="alertdialog" aria-labelledby={idTitulo} aria-describedby={idTexto}>
      <p className="confirmar-titulo" id={idTitulo}>
        {titulo}
      </p>
      <div id={idTexto}>{children}</div>
      <div className="acciones">
        <button type="button" className="boton boton-peligro-lleno" onClick={alConfirmar} disabled={ocupado}>
          {ocupado ? 'Esperando…' : confirmarTexto}
        </button>
        <button type="button" className="boton-secundario" ref={cancelar} onClick={alCancelar} disabled={ocupado}>
          {cancelarTexto}
        </button>
      </div>
    </div>
  );
}
