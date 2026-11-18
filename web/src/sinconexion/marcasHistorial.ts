// Marcas del historial de la ficha (spec 012, RF-1, RF-2 y RF-4). Lógica pura.
//
// Un evento que la tablet conoce y el servidor todavía no confirmó lleva una marca con su texto (así se distingue sin
// depender del color). Las marcas las calcula el adaptador de la ficha; la pantalla solo las dibuja.

import type { MarcaEvento } from '../compartido/api';
import type { Pendiente } from './almacen';
import { estadoVisible } from './dependencias';
import { formatearFechaHoraArgentina } from './horaArgentina';

export const TEXTO_ANULACION_PENDIENTE = 'Anulación pendiente';

// Un evento aceptado por el servidor que la copia todavía no trae.
export const MARCA_ENVIADO: MarcaEvento = { estado: 'enviado' };

// Marca de un pendiente según su estado visible (la 010): esperando o enviando -> pendiente; rechazado (con su
// motivo); "en espera del anterior" -> enEspera. `pendientes` son los del usuario y tambo de la sesión.
export function marcaDePendiente(p: Pendiente, pendientes: Pendiente[]): MarcaEvento {
  const visible = estadoVisible(p, pendientes);
  if (visible === 'rechazado') return p.motivo ? { estado: 'rechazado', motivo: p.motivo } : { estado: 'rechazado' };
  if (visible === 'enEspera') return { estado: 'enEspera' };
  return { estado: 'pendiente' };
}

// Texto exacto de cada marca.
export function textoMarca(marca: MarcaEvento): string {
  switch (marca.estado) {
    case 'pendiente':
      return 'Pendiente de sincronizar';
    case 'enviado':
      return 'Enviado: se confirma al actualizar';
    case 'enEspera':
      return 'En espera del anterior';
    case 'rechazado':
      return marca.motivo ? `Rechazado: ${marca.motivo}` : 'Rechazado';
  }
}

// Margen para decir que un evento se cargó sin conexión: más de 5 minutos entre la hora de la tablet y el registro
// en el servidor (RF-4). Exactamente 5 no cuenta.
const MARGEN_CARGA_MS = 5 * 60 * 1000;

// "Cargado sin conexión el 12/11/2026 08:15" (hora de Argentina) o null. `registradoEn` es la hora del servidor;
// `cargadoEnDispositivo`, la de la tablet al cargar. Sin alguno de los dos (o ilegible) no se muestra nada.
export function textoCargadoSinConexion(registradoEn: string | null | undefined, cargadoEnDispositivo: string | null | undefined): string | null {
  if (!registradoEn || !cargadoEnDispositivo) return null;
  const registro = Date.parse(registradoEn);
  const carga = Date.parse(cargadoEnDispositivo);
  if (Number.isNaN(registro) || Number.isNaN(carga)) return null;
  if (registro - carga <= MARGEN_CARGA_MS) return null;
  return `Cargado sin conexión el ${formatearFechaHoraArgentina(new Date(carga))}`;
}
