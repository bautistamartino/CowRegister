// Ayudas compartidas por los tests de la cola de pendientes (spec 009, T4). No es un test.

import type { AnimalCopia, RegistroProduccion } from '../src/compartido/api';
import type { Enviado, Pendiente } from '../src/sinconexion/almacen';

export const persona = { usuarioId: 'u1', establecimientoId: 'e1' };

// Un pendiente listo para usar; `cambios` pisa lo que haga falta.
export function pendiente(cambios: Partial<Pendiente> = {}): Pendiente {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    usuarioId: persona.usuarioId,
    establecimientoId: persona.establecimientoId,
    animalId: 'a1',
    numero: '12',
    fecha: '2026-11-12',
    turno: 'manana',
    litros: '12.5',
    cargadoEnDispositivo: '2026-11-12T08:15:00-03:00',
    orden: 1,
    estado: 'esperando',
    motivo: null,
    codigoRechazo: null,
    intentos: 0,
    proximoIntento: null,
    ...cambios,
  };
}

// El registro que devolvería la API al aceptar ese pendiente.
export function registroDe(p: Pendiente, cambios: Partial<RegistroProduccion> = {}): RegistroProduccion {
  return {
    id: p.id,
    animalId: p.animalId,
    fecha: p.fecha,
    turno: p.turno,
    litros: Number(p.litros),
    loteNombre: 'Ordeñe',
    registradoPor: 'Dueño',
    registradoEn: '2026-11-12T11:20:00.000Z',
    anulado: null,
    ...cambios,
  };
}

export function enviado(p: Pendiente, cambios: Partial<RegistroProduccion> = {}): Enviado {
  return { id: p.id, usuarioId: p.usuarioId, establecimientoId: p.establecimientoId, animalId: p.animalId, numero: p.numero, registro: registroDe(p, cambios) };
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
