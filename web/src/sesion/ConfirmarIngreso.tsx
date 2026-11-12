import { useState } from 'react';
import { Confirmar } from '../sinconexion/Confirmar';
import { useAuth } from './auth';

// Aviso del ingreso de otro usuario o tambo (spec 009, RF-46). En la tablet quedaron litros pendientes de
// otra persona: para ingresar hay que borrarlos, y eso solo pasa con confirmación explícita. Mientras se
// decide no se muestra ningún dato (ni del anterior ni del nuevo). Si cancela, se vuelve al ingreso.
export function ConfirmarIngreso() {
  const { ingresoPendiente, confirmarIngreso, cancelarIngreso } = useAuth();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ingresoPendiente) return null;
  const n = ingresoPendiente.pendientes;

  async function accion(fn: () => Promise<void>) {
    setOcupado(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError('No se pudo borrar lo guardado en la tablet. Probá de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <Confirmar
        titulo="Hay datos de otro usuario en esta tablet"
        confirmarTexto="Borrar y entrar"
        cancelarTexto="Cancelar y volver al ingreso"
        alConfirmar={() => void accion(confirmarIngreso)}
        alCancelar={() => void accion(cancelarIngreso)}
        ocupado={ocupado}
      >
        <p>
          En esta tablet quedaron los datos de otro usuario o de otro tambo. Si seguís, se van a perder {n} {n === 1 ? 'litro cargado' : 'litros cargados'} que todavía no{' '}
          {n === 1 ? 'se envió' : 'se enviaron'} al servidor. Se borra todo lo del anterior antes de mostrar nada del nuevo.
        </p>
      </Confirmar>
    </>
  );
}
