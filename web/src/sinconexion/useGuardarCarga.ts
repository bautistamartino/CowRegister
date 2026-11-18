import { useCallback, useRef, useState } from 'react';
import type { TipoPendiente } from './almacen';
import { useCola } from './ColaProvider';
import { traducirGuardado, type SalidaGuardado } from './guardadoCarga';

// Guardado de una carga desde un formulario (spec 011, RF-8 a RF-12, RF-15). Envuelve el punto único de registro
// de la 010 (`useCola().registrar`), igual con y sin conexión:
//   - `guardando` es true mientras se espera (hasta 10 s con señal mala): el formulario muestra "Guardando…" y
//     deshabilita sus botones, pero conserva lo escrito.
//   - Un solo envío a la vez: un segundo toque mientras se guarda no hace nada (devuelve null).
//   - Devuelve el resultado ya traducido: confirmación (aceptada o pendiente) o errores por campo.
export type ArgsGuardar = {
  tipo: TipoPendiente;
  animal: { id: string; numero: string };
  datos: Record<string, unknown>;
  tituloAceptado: string; // "Servicio registrado", "Secado registrado"…
  camposDibujados: string[];
};

export function useGuardarCarga() {
  const { registrar } = useCola();
  const [guardando, setGuardando] = useState(false);
  // El estado se actualiza después del render; la referencia corta el doble toque en el mismo instante.
  const enCurso = useRef(false);

  const guardar = useCallback(
    async (args: ArgsGuardar): Promise<SalidaGuardado | null> => {
      if (enCurso.current) return null;
      enCurso.current = true;
      setGuardando(true);
      try {
        const r = await registrar({ tipo: args.tipo, animal: args.animal, datos: args.datos });
        return traducirGuardado(r, args);
      } catch {
        // Falla inesperada del almacén o de la sesión: nunca se confirma algo que no se guardó.
        return { tipo: 'error', errores: { campos: {}, general: 'No se pudo guardar. Probá de nuevo' }, rechazo: null };
      } finally {
        enCurso.current = false;
        setGuardando(false);
      }
    },
    [registrar],
  );

  return { guardar, guardando };
}
