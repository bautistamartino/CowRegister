import { hoyArgentina } from '../animales/reglas.js';
import { armarEvento, armarRespuesta, type FilaEvento } from '../reproduccion/eventos.js';
import { ultimoNoAnulado } from '../reproduccion/situacion.js';

// Historial único de un animal (spec 007): eventos y cambios manuales en una sola línea de tiempo.
// Es una función PURA (sin base ni Express): recibe lo ya leído y arma la respuesta.

// Un cambio manual leído de la base (solo lo que se muestra: nunca el id del usuario).
export type FilaCambio = {
  id: string;
  campo: string;
  valorAnterior: string | null;
  valorNuevo: string | null;
  usuarioNombre: string;
  creadoEn: Date;
};

export type EntradaHistorial =
  | { clase: 'EVENTO'; fecha: string; registradoEn: Date; evento: ReturnType<typeof armarEvento> }
  | {
      clase: 'CAMBIO';
      fecha: string;
      registradoEn: Date;
      cambio: { id: string; campo: string; valorAnterior: string | null; valorNuevo: string | null; usuarioNombre: string };
    };

/**
 * @param filas        todos los eventos del animal (anulados incluidos)
 * @param cambios      los cambios manuales más nuevos ya leídos (al menos los `tope` más recientes)
 * @param totalCambios cantidad total de cambios manuales del animal (puede ser mayor que `cambios.length`)
 * @param hoy          "hoy" argentino (AAAA-MM-DD), para armar los eventos igual que `/eventos`
 * @param tope         máximo de entradas a devolver
 */
export function armarHistorial(filas: FilaEvento[], cambios: FilaCambio[], totalCambios: number, hoy: string, tope: number) {
  // Los eventos salen armados por el mismo código que usa `/eventos` (fecha probable, genética, anulación).
  const eventos = armarRespuesta(filas, hoy).eventos;
  const entradas: EntradaHistorial[] = [
    ...eventos.map((evento): EntradaHistorial => ({ clase: 'EVENTO', fecha: evento.fecha, registradoEn: evento.registradoEn, evento })),
    ...cambios.map(
      (c): EntradaHistorial => ({
        clase: 'CAMBIO',
        // La fecha de un cambio manual es el DÍA ARGENTINO en que se guardó (a las 22:00 ART ya es otro día en UTC).
        fecha: hoyArgentina(c.creadoEn),
        registradoEn: c.creadoEn,
        cambio: { id: c.id, campo: c.campo, valorAnterior: c.valorAnterior, valorNuevo: c.valorNuevo, usuarioNombre: c.usuarioNombre },
      }),
    ),
  ];

  // Más reciente primero: fecha y, a igual fecha, momento de registro. Los cambios de un mismo guardado
  // comparten momento: se desempatan por dato (campo) y por id para que el orden sea siempre el mismo.
  entradas.sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    const dt = b.registradoEn.getTime() - a.registradoEn.getTime();
    if (dt !== 0) return dt;
    if (a.clase !== b.clase) return a.clase === 'EVENTO' ? -1 : 1;
    if (a.clase === 'CAMBIO' && b.clase === 'CAMBIO') {
      if (a.cambio.campo !== b.cambio.campo) return a.cambio.campo < b.cambio.campo ? -1 : 1;
      return a.cambio.id < b.cambio.id ? -1 : a.cambio.id > b.cambio.id ? 1 : 0;
    }
    return 0;
  });

  const total = filas.length + totalCambios;
  return {
    total,
    truncado: total > tope,
    tope,
    // El único evento que se puede anular, calculado con TODOS los eventos (antes de cortar por el tope):
    // si queda fuera de las entradas igual sigue identificado.
    ultimoEventoNoAnuladoId: ultimoNoAnulado(filas)?.id ?? null,
    entradas: entradas.slice(0, tope),
  };
}
