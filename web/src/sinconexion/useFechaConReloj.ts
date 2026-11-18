import { useEffect, useRef, useState } from 'react';
import { fechaTrasCambioReloj } from './relojTablet';

// Estado de una fecha que arranca con la fecha por defecto del reloj y la sigue si el reloj cambia (se corrige),
// sin pisar lo que el usuario ya eligió.
export function useFechaConReloj(valorInicial: string) {
  const [fecha, setFecha] = useState(valorInicial);
  const anterior = useRef(valorInicial);
  useEffect(() => {
    if (anterior.current === valorInicial) return;
    const previo = anterior.current;
    anterior.current = valorInicial;
    setFecha((actual) => fechaTrasCambioReloj(actual, previo, valorInicial));
  }, [valorInicial]);
  return [fecha, setFecha] as const;
}
