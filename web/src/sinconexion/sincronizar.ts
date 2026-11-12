// Sincronización de los litros pendientes con el servidor (spec 009, RF-29 a RF-32, RF-34, RF-37 a RF-39).
// Lógica pura: el envío real (`enviar`), el reloj y el candado entre pestañas se inyectan, así se prueba
// con Vitest sin red ni navegador.
//
// Reglas principales:
//   - De a UNO y en el orden en que se cargaron.
//   - Un pendiente solo sale de la cola si el servidor lo acepta (pasa a "enviado reciente") o si el usuario
//     lo descarta. Nada se pierde solo.
//   - La clasificación de respuestas (qué es rechazo, qué espera) vive en clasificar.ts.

import type { Almacen, Pendiente } from './almacen';
import { clasificarRespuesta, enviarConLimite, type Respuesta } from './clasificar';
import { delPropietario, enviadosDe, pendientesDe, type Persona } from './cola';
import { ESPERA_ENVIO_MS, esperaTrasFallo } from './limites';

export type OpcionesRonda = {
  // Enviar aunque todavía no se haya cumplido la espera (al volver la señal o con "Reintentar ahora").
  ignorarEsperas?: boolean;
  // Solo este pendiente ("Reintentar ahora" de una fila).
  soloId?: string;
};

export type ResultadoRonda = {
  aceptados: number;
  rechazados: number;
  // Por qué se cortó la ronda antes de terminar: sesión inválida (401) o sin red.
  detenido: 'sesion' | 'red' | null;
  // Cuándo toca el próximo reintento automático (milisegundos), o null si no hay ninguno programado.
  siguienteIntento: number | null;
};

export type Dependencias = {
  almacen: Almacen;
  persona: Persona;
  // El envío real al servidor (en la app: POST /api/animales/:id/produccion con el id del pendiente).
  enviar: (p: Pendiente, senal: AbortSignal) => Promise<Respuesta> | Respuesta;
  ahora: () => number;
  tiempoMs?: number;
  // Corre `fn` solo si esta pestaña obtiene el candado; si otra pestaña ya está sincronizando, no la corre.
  bloqueo?: (fn: () => Promise<void>) => Promise<void>;
  // "Enviando 3 de 12" (null al terminar).
  alProgreso?: (progreso: { actual: number; total: number } | null) => void;
  // Algo cambió en el almacén (la pantalla se vuelve a leer).
  alCambiar?: () => void;
};

// Candado entre pestañas con navigator.locks. Si el navegador no lo tiene, se corre igual: el id del
// pendiente es idempotente, así que un envío doble desde dos pestañas no duplica el registro.
async function bloqueoDelNavegador(fn: () => Promise<void>): Promise<void> {
  const locks = (globalThis as { navigator?: { locks?: { request: (n: string, o: { ifAvailable: boolean }, cb: (l: unknown) => Promise<void>) => Promise<void> } } }).navigator?.locks;
  if (!locks) return fn();
  await locks.request('cowregister-sincronizar', { ifAvailable: true }, async (candado) => {
    if (candado) await fn();
  });
}

export function crearSincronizador(deps: Dependencias) {
  const { almacen, persona, enviar, ahora } = deps;
  const bloqueo = deps.bloqueo ?? bloqueoDelNavegador;
  const tiempoMs = deps.tiempoMs ?? ESPERA_ENVIO_MS;

  // Envíos en curso en esta pestaña, por id del pendiente: "Descartar" espera a que terminen (RF-39).
  const enVuelo = new Map<string, Promise<void>>();

  // Envía UN pendiente y guarda el resultado. Devuelve si hay que cortar la ronda.
  async function enviarUno(p: Pendiente, r: ResultadoRonda): Promise<void> {
    try {
      await almacen.guardarPendiente({ ...p, estado: 'enviando' });
    } catch {
      return; // no se pudo ni marcar: se deja como estaba y se sigue (se reintentará)
    }
    deps.alCambiar?.();

    const respuesta = await enviarConLimite(enviar, p, tiempoMs);
    const c = clasificarRespuesta(respuesta, p);
    try {
      if (c.tipo === 'aceptado') {
        // El pendiente se borra y se guarda como "enviado reciente" en UNA operación (RF-34).
        await almacen.aceptarPendiente(p.id, { id: p.id, usuarioId: p.usuarioId, establecimientoId: p.establecimientoId, animalId: p.animalId, numero: p.numero, registro: c.registro });
        r.aceptados++;
      } else if (c.tipo === 'rechazado') {
        // No se reintenta solo: queda con el motivo hasta que el usuario elija (RF-30).
        await almacen.guardarPendiente({ ...p, estado: 'rechazado', motivo: c.motivo, codigoRechazo: c.estado, proximoIntento: null });
        r.rechazados++;
      } else if (c.tipo === 'sesion') {
        // 401: vuelve a esperando tal cual estaba, y se corta la ronda (RF-31).
        await almacen.guardarPendiente({ ...p, estado: 'esperando' });
        r.detenido = 'sesion';
      } else {
        const intentos = p.intentos + 1;
        await almacen.guardarPendiente({ ...p, estado: 'esperando', intentos, motivo: c.motivo, proximoIntento: ahora() + esperaTrasFallo(intentos) });
        if (c.red) r.detenido = 'red'; // sin red, los que siguen fallarían igual: no se insiste
      }
    } catch {
      // No se pudo anotar el resultado (por ejemplo, el navegador sin espacio). El pendiente queda "enviando"
      // y al abrir la app vuelve a esperando: reenviarlo con el mismo id no duplica.
    }
    deps.alCambiar?.();
  }

  async function cuerpoDeLaRonda(opciones: OpcionesRonda, r: ResultadoRonda): Promise<void> {
    const ahoraMs = ahora();
    const debidos = (await pendientesDe(almacen, persona)).filter(
      (p) =>
        p.estado === 'esperando' &&
        (opciones.soloId === undefined || p.id === opciones.soloId) &&
        (opciones.ignorarEsperas || p.proximoIntento === null || p.proximoIntento <= ahoraMs),
    );
    for (const [i, listado] of debidos.entries()) {
      // Se vuelve a leer: pudo descartarse o cambiar mientras se enviaban los anteriores.
      const p = (await pendientesDe(almacen, persona)).find((x) => x.id === listado.id);
      if (!p || p.estado !== 'esperando') continue;
      deps.alProgreso?.({ actual: i + 1, total: debidos.length });
      const paso = enviarUno(p, r);
      enVuelo.set(p.id, paso);
      try {
        await paso;
      } finally {
        enVuelo.delete(p.id);
      }
      if (r.detenido) break;
    }
    deps.alProgreso?.(null);
  }

  async function proximoReintento(): Promise<number | null> {
    const esperas = (await pendientesDe(almacen, persona)).filter((p) => p.estado === 'esperando' && p.proximoIntento !== null);
    return esperas.length ? Math.min(...esperas.map((p) => p.proximoIntento!)) : null;
  }

  // Una sola ronda a la vez en esta pestaña. Si llega otro pedido mientras corre, se anota y se hace una
  // vuelta más al terminar (sin enviar nunca dos cosas en paralelo).
  let corriendo: Promise<ResultadoRonda> | null = null;
  let siguiente: OpcionesRonda | null = null;

  function sincronizar(opciones: OpcionesRonda = {}): Promise<ResultadoRonda> {
    if (corriendo) {
      siguiente = {
        ignorarEsperas: !!(siguiente?.ignorarEsperas || opciones.ignorarEsperas),
        soloId: siguiente && siguiente.soloId !== opciones.soloId ? undefined : opciones.soloId,
      };
      return corriendo;
    }
    corriendo = (async () => {
      const total: ResultadoRonda = { aceptados: 0, rechazados: 0, detenido: null, siguienteIntento: null };
      let actual: OpcionesRonda | null = opciones;
      try {
        while (actual) {
          siguiente = null;
          const op: OpcionesRonda = actual;
          const parcial: ResultadoRonda = { aceptados: 0, rechazados: 0, detenido: null, siguienteIntento: null };
          await bloqueo(() => cuerpoDeLaRonda(op, parcial));
          total.aceptados += parcial.aceptados;
          total.rechazados += parcial.rechazados;
          total.detenido = parcial.detenido ?? total.detenido;
          // Si se cortó por la sesión o la red no tiene sentido hacer otra vuelta ya.
          actual = parcial.detenido ? null : siguiente;
        }
        total.siguienteIntento = await proximoReintento();
        return total;
      } finally {
        corriendo = null;
        siguiente = null;
      }
    })();
    return corriendo;
  }

  // "Reintentar" de un pendiente rechazado: vuelve a esperar con el mismo id (RF-37).
  async function reintentar(id: string): Promise<void> {
    const p = (await pendientesDe(almacen, persona)).find((x) => x.id === id);
    if (!p || p.estado !== 'rechazado') return;
    await almacen.guardarPendiente({ ...p, estado: 'esperando', motivo: null, codigoRechazo: null, intentos: 0, proximoIntento: null });
    deps.alCambiar?.();
  }

  // "Descartar" (RF-38, RF-39): la confirmación la pide la pantalla antes de llamar a esto. Si el pendiente
  // se está enviando, espera el resultado: si el servidor lo aceptó no se borra (ya quedó guardado).
  async function descartar(id: string): Promise<'descartado' | 'ya-guardado' | 'no-existe'> {
    const enCurso = enVuelo.get(id);
    if (enCurso) await enCurso.catch(() => undefined);
    const p = (await pendientesDe(almacen, persona)).find((x) => x.id === id);
    if (!p) return (await enviadosDe(almacen, persona)).some((e) => e.id === id) ? 'ya-guardado' : 'no-existe';
    if (!delPropietario([p], persona).length) return 'no-existe';
    await almacen.borrarPendiente(id);
    deps.alCambiar?.();
    return 'descartado';
  }

  return { sincronizar, reintentar, descartar, enCurso: () => corriendo !== null };
}
