// Ayudas compartidas por los tests de la cola de pendientes (spec 009, T4). No es un test.

import type { AnimalCopia, RegistroProduccion } from '../src/compartido/api';
import type { DatosLitros, Enviado, Pendiente } from '../src/sinconexion/almacen';

export const persona = { usuarioId: 'u1', establecimientoId: 'e1' };

// Un pendiente de LITROS listo para usar; `cambios` pisa lo que haga falta. Por comodidad acepta `fecha`, `turno`
// y `litros` sueltos (como en la 009) y los guarda dentro de `datos`.
export function pendiente(cambios: Partial<Pendiente> & Partial<DatosLitros> = {}): Pendiente {
  const { fecha = '2026-11-12', turno = 'manana', litros = '12.5', ...resto } = cambios;
  return {
    id: '11111111-1111-4111-8111-111111111111',
    usuarioId: persona.usuarioId,
    establecimientoId: persona.establecimientoId,
    animalId: 'a1',
    numero: '12',
    tipo: 'LITROS',
    datos: { fecha, turno, litros },
    cargadoEnDispositivo: '2026-11-12T08:15:00-03:00',
    orden: 1,
    estado: 'esperando',
    motivo: null,
    codigoRechazo: null,
    intentos: 0,
    proximoIntento: null,
    ...resto,
  };
}

// El registro que devolvería la API al aceptar ese pendiente.
export function registroDe(p: Pendiente, cambios: Partial<RegistroProduccion> = {}): RegistroProduccion {
  const d = p.datos as DatosLitros;
  return {
    id: p.id,
    animalId: p.animalId,
    fecha: d.fecha,
    turno: d.turno,
    litros: Number(d.litros),
    loteNombre: 'Ordeñe',
    registradoPor: 'Dueño',
    registradoEn: '2026-11-12T11:20:00.000Z',
    anulado: null,
    ...cambios,
  };
}

export function enviado(p: Pendiente, cambios: Partial<RegistroProduccion> = {}): Enviado {
  const registro = registroDe(p, cambios);
  return {
    id: p.id,
    usuarioId: p.usuarioId,
    establecimientoId: p.establecimientoId,
    animalId: p.animalId,
    numero: p.numero,
    tipo: 'LITROS',
    datos: p.datos,
    aceptadoEn: Date.parse(registro.registradoEn),
    registro,
  };
}

// Una vaca de la copia con los registros de producción que se le indiquen.
export function vacaCopia(id: string, numero: string, registros: RegistroProduccion[] = []): AnimalCopia {
  return {
    ficha: { id, numero, sexo: 'HEMBRA', estado: 'EN_ORDENE', fechaNacimiento: null, lote: null, madre: null, crias: [], parto: null },
    eventos: { situacion: null, eventos: [] },
    historial: { total: 0, truncado: false, tope: 500, ultimoEventoNoAnuladoId: null, entradas: [] },
    produccion: { registros, total: registros.length, mostrados: registros.length, truncado: false, tope: 200, promedio30Dias: null, ultimoRegistro: null },
  };
}

// Respuesta "aceptado" del servidor para un pendiente.
export const aceptada = (p: Pendiente) => ({ estado: 201, cuerpo: registroDe(p) });

// ─── Spec 010 (T4): pendientes de eventos y respuestas del servidor por tipo ───

export const REGISTRADO_EN = '2026-11-12T11:20:00.000Z';
export const ANULADO_EN = '2026-11-12T11:30:00.000Z';

// Datos mínimos válidos por tipo (lo que se mandaría a la API).
export const DATOS_POR_TIPO: Record<string, Record<string, unknown>> = {
  SERVICIO: { fecha: '2026-11-01', tipo: 'INSEMINACION' },
  TACTO: { fecha: '2026-11-01', resultado: 'PRENADA' },
  PARTO: { fecha: '2026-11-01', crias: [{ sexo: 'HEMBRA', numero: '900' }] },
  SECADO: { fecha: '2026-11-01' },
  BAJA: { fecha: '2026-11-01', motivo: 'venta' },
  ANULACION: { eventoId: 'evento-1', tipoEvento: 'SERVICIO', motivo: 'Me equivoqué' },
};

// Un pendiente de cualquier tipo (los litros usan `pendiente`).
export function pendienteDe(tipo: Pendiente['tipo'], cambios: Partial<Pendiente> = {}): Pendiente {
  return {
    ...pendiente(),
    id: `id-${tipo.toLowerCase()}`,
    tipo,
    datos: DATOS_POR_TIPO[tipo] ?? {},
    ...cambios,
  };
}

// El evento tal como lo arma la lista de la API (lo mínimo que mira la web).
function eventoLista(p: Pendiente, id: string, anulado: boolean) {
  return {
    id,
    tipo: p.tipo === 'ANULACION' ? String(p.datos.tipoEvento) : p.tipo,
    fecha: String(p.datos.fecha ?? '2026-11-01'),
    registradoPor: 'Dueño',
    registradoEn: REGISTRADO_EN,
    cargadoEnDispositivo: null,
    anulacion: anulado ? { motivo: String(p.datos.motivo ?? ''), por: 'Dueño', en: ANULADO_EN } : null,
    servicio: null,
    tacto: null,
    parto: null,
    secado: null,
    baja: null,
  };
}

// La respuesta "aceptado" del servidor a un pendiente de cualquier tipo, con la forma real de cada ruta:
// 201 (o 200 en las anulaciones) la primera vez; 200 con `yaExistia` / `yaEstabaAnulado` en el reenvío.
export function aceptadaDe(p: Pendiente, opciones: { avisos?: { codigo: string; mensaje: string }[]; reenvio?: boolean } = {}): { estado: number; cuerpo: unknown } {
  const avisos = opciones.avisos ?? [];
  const reenvio = opciones.reenvio ?? false;
  if (p.tipo === 'LITROS') return { estado: reenvio ? 200 : 201, cuerpo: registroDe(p) };
  if (p.tipo === 'ANULACION') {
    const evento = eventoLista(p, String(p.datos.eventoId), true);
    const conCaja = p.datos.tipoEvento === 'PARTO' || p.datos.tipoEvento === 'SECADO';
    const base = conCaja ? { evento, avisos } : evento;
    return { estado: 200, cuerpo: reenvio ? { ...base, yaEstabaAnulado: true } : base };
  }
  if (p.tipo === 'BAJA') {
    const plano = { id: p.id, animalId: p.animalId, numero: p.numero, motivo: 'Venta', fecha: String(p.datos.fecha), observaciones: null, estadoAnterior: 'EN_ORDENE', registradoPor: 'Dueño', registradoEn: REGISTRADO_EN };
    return reenvio ? { estado: 200, cuerpo: { evento: plano, avisos, yaExistia: true } } : { estado: 201, cuerpo: plano };
  }
  const evento = eventoLista(p, p.id, false);
  if (reenvio) return { estado: 200, cuerpo: { evento, avisos, yaExistia: true } };
  return { estado: 201, cuerpo: p.tipo === 'PARTO' || p.tipo === 'SECADO' ? { evento, avisos } : evento };
}
