import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { FECHA_MINIMA, fechaArgentinaIso, hoyIso, sumarDiasIso } from './reproduccion';

// Período de los informes (spec 007, RF-14). La API vuelve a validar todo: esto solo evita
// consultar con fechas que sabemos inválidas y explica el motivo en pantalla.

// Existe en el calendario (el 31/02 "desborda" a marzo, así que se compara de vuelta).
function existe(texto: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d;
}

// Período por defecto: hasta = hoy (hora de Argentina) y desde = mismo día del año anterior + 1 día.
// El 29/02 cuenta como 28/02 del año anterior.
export function periodoPorDefecto(ahora: Date = new Date()): { desde: string; hasta: string } {
  const hasta = fechaArgentinaIso(ahora);
  const [a, m, d] = hasta.split('-');
  const aniversario = `${Number(a) - 1}-${m}-${m === '02' && d === '29' ? '28' : d}`;
  return { desde: sumarDiasIso(aniversario, 1), hasta };
}

// Último día de un período que empieza en `desde`: el día anterior al quinto aniversario.
function hastaMaximo(desde: string): string {
  const [a, m, d] = desde.split('-');
  return sumarDiasIso(`${Number(a) + 5}-${m}-${m === '02' && d === '29' ? '28' : d}`, -1);
}

// Mismas reglas, orden y mensajes que la API. Devuelve el mensaje o null si el período es válido.
export function validarPeriodo(desde: string, hasta: string, hoy: string = hoyIso()): string | null {
  // El <input type="date"> entrega '' si la fecha está incompleta o es imposible (31/02).
  if (desde === '' || hasta === '') return 'Completá "Desde" y "Hasta" con fechas válidas para ver el informe';
  if (!existe(desde)) return 'La fecha "Desde" no es válida: usá el formato AAAA-MM-DD con un día que exista';
  if (!existe(hasta)) return 'La fecha "Hasta" no es válida: usá el formato AAAA-MM-DD con un día que exista';
  if (desde > hasta) return '"Desde" no puede ser posterior a "Hasta"';
  if (hasta > hoy) return '"Hasta" no puede ser una fecha futura';
  if (desde < FECHA_MINIMA) return '"Desde" no puede ser anterior al 01/01/2000';
  if (hasta > hastaMaximo(desde)) return 'El período no puede abarcar más de 5 años';
  return null;
}

// Porcentaje para mostrar: "—" cuando no hay base.
export const textoPorcentaje = (p: number | null) => (p === null ? '—' : `${p} %`);

// Pide un informe a la API cada vez que cambia el período (RF-14). `vigente` descarta la respuesta
// de una consulta vieja si el período cambió mientras tanto. Con un error se conserva el período
// (vive en la pantalla, no acá) y se muestra el mensaje.
export function useInforme<T>(ruta: string, desde: string, hasta: string) {
  const [estado, setEstado] = useState<{ datos: T | null; error: string | null; cargando: boolean }>({
    datos: null,
    error: null,
    cargando: true,
  });

  useEffect(() => {
    let vigente = true;
    setEstado((e) => ({ ...e, cargando: true, error: null }));
    api<T>(`${ruta}?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`)
      .then((datos) => {
        if (vigente) setEstado({ datos, error: null, cargando: false });
      })
      .catch((err) => {
        if (vigente) setEstado({ datos: null, error: err instanceof ApiError ? err.message : 'No se pudo calcular el informe', cargando: false });
      });
    return () => {
      vigente = false;
    };
  }, [ruta, desde, hasta]);

  return estado;
}
