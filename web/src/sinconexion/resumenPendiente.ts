// Texto corto de lo que es un pendiente (spec 011, RF-16). Lógica pura.
// Lo usan la confirmación "Guardado en la tablet: pendiente de sincronizar", el "Descartar" y, más adelante,
// la pantalla "Pendientes" (spec 012).

import { formatearFecha } from '../animales/animalesDatos';
import { formatearLitros, NOMBRE_TURNO } from '../produccion/produccionDatos';
import { datosLitros, type Enviado, type Pendiente, type TipoPendiente } from './almacen';

type DatosCria = { nacidaMuerta?: unknown };

// "Parto con 2 crías (1 nacida muerta)", "Parto con 1 cría (nacida muerta)", "Parto con 1 cría".
function resumenParto(datos: Record<string, unknown>): string {
  const crias = Array.isArray(datos.crias) ? (datos.crias as DatosCria[]) : [];
  if (crias.length === 0) return 'Parto';
  const muertas = crias.filter((c) => c?.nacidaMuerta === true).length;
  const base = `Parto con ${crias.length} ${crias.length === 1 ? 'cría' : 'crías'}`;
  if (muertas === 0) return base;
  // Con una sola cría muerta no hace falta contar: "(nacida muerta)".
  if (crias.length === 1) return `${base} (nacida muerta)`;
  return `${base} (${muertas} ${muertas === 1 ? 'nacida muerta' : 'nacidas muertas'})`;
}

export function resumenPendiente(tipo: TipoPendiente, datos: Record<string, unknown>): string {
  switch (tipo) {
    case 'SERVICIO':
      return 'Servicio';
    case 'TACTO':
      return datos.resultado === 'PRENADA' ? 'Tacto preñada' : 'Tacto vacía';
    case 'PARTO':
      return resumenParto(datos);
    case 'SECADO':
      return 'Secado';
    case 'BAJA':
      return datos.motivo === 'muerte' ? 'Baja por muerte' : 'Baja por venta';
    case 'ANULACION':
      // `tipoEvento` es el del evento que se anula (SERVICIO, TACTO, PARTO o SECADO).
      return `Anulación de ${String(datos.tipoEvento ?? 'evento').toLowerCase()}`;
    case 'LITROS':
      return 'Litros';
  }
}

// ─── Spec 012: resúmenes completos para la pantalla "Pendientes" y ayuda ante el rechazo ───

// Texto del tipo cuando no se tienen los datos (por ejemplo un aviso cuyo pendiente ya salió de la cola).
const TEXTO_TIPO: Record<TipoPendiente, string> = {
  LITROS: 'Litros',
  SERVICIO: 'Servicio',
  TACTO: 'Tacto',
  PARTO: 'Parto',
  SECADO: 'Secado',
  BAJA: 'Baja',
  ANULACION: 'Anulación',
};

// "Vaca 214 · Parto con 2 crías (1 nacida muerta)". Los litros: "Vaca 214 · 12/11/2026 · Mañana · 12,5 L".
export function resumenCompleto(x: { tipo: TipoPendiente; numero: string; datos: Record<string, unknown> }): string {
  if (x.tipo !== 'LITROS') return `Vaca ${x.numero} · ${resumenPendiente(x.tipo, x.datos)}`;
  const d = datosLitros(x);
  return `Vaca ${x.numero} · ${formatearFecha(d.fecha)} · ${NOMBRE_TURNO[d.turno]} · ${formatearLitros(Number(d.litros))} L`;
}

// Resumen de un aviso del servidor (RF-10). `AvisoGuardado` no guarda los datos del pendiente, así que se busca el
// enviado con el mismo id (sigue ahí hasta que la copia lo refleja); si ya no está, el texto del tipo.
export function resumenAviso(aviso: { id: string; numero: string; tipo: TipoPendiente }, enviados: Enviado[]): string {
  const e = enviados.find((x) => x.id === aviso.id);
  if (e) return resumenCompleto(e);
  return `Vaca ${aviso.numero} · ${TEXTO_TIPO[aviso.tipo]}`;
}

// Ayuda cuando el servidor rechazó por "no encontrado" (404): casi siempre es que la vaca ya no está activa. Puede
// ser también otro recurso (un semen eliminado): por eso el texto dice "puede que".
export function ayudaRechazo(p: Pendiente): string | null {
  if (p.estado === 'rechazado' && p.codigoRechazo === 404) return 'Puede que el animal haya sido dado de baja: actualizá los datos y revisá su historial';
  return null;
}
