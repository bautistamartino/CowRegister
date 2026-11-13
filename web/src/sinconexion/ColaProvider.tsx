import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RegistroProduccion } from '../compartido/api';
import { useAuth } from '../sesion/auth';
import type { Enviado, Pendiente } from './almacen';
import { obtenerAlmacen } from './almacenIndexedDb';
import { cargarLitros, type ResultadoCarga } from './cargarLitros';
import { contarPendientes, enviadosDe, limpiarEnviadosIncluidos, pendientesDe, restablecerEnviando, type DatosCarga, type Persona } from './cola';
import { obtenerConexion } from './conexion';
import { enviarPendiente, nuevoId } from './envio';
import { crearSincronizador, type OpcionesRonda } from './sincronizar';
import { useSinConexion } from './SinConexionProvider';
import { useEnLinea } from './useConexion';

// Estado de los litros pendientes para toda la app (spec 009, T4). Une la lógica pura (cola.ts,
// sincronizar.ts, cargarLitros.ts) con React: lee los pendientes, dispara los envíos solos y expone las
// acciones a las pantallas. Se monta dentro del SinConexionProvider.
//
// Cuándo se envía solo:
//   - al abrir la app con sesión y señal;
//   - cuando vuelve la señal (sin esperar las esperas crecientes: es un buen momento para intentar);
//   - cuando se cumple la espera de un pendiente que falló (un temporizador).

type Estado = {
  pendientes: Pendiente[]; // del usuario y tambo de la sesión, en orden de carga
  enviados: Enviado[]; // aceptados que la copia local todavía no trae
  total: number; // cantidad de pendientes (esperando, enviando y rechazados): el número del menú
  rechazados: number;
  progreso: { actual: number; total: number } | null; // "Enviando 3 de 12"
  // Carga los litros de una vaca: envía enseguida con señal o deja un pendiente (spec 009, RF-18, RF-24).
  cargar: (datos: DatosCarga, registrosCopia: RegistroProduccion[] | null) => Promise<ResultadoCarga>;
  sincronizarAhora: () => Promise<void>; // envía todos los que esperan, sin esperar el reintento automático
  reintentarAhora: (id: string) => Promise<void>; // "Reintentar ahora" de uno que espera
  reintentar: (id: string) => Promise<void>; // "Reintentar" de uno rechazado
  descartar: (id: string) => Promise<'descartado' | 'ya-guardado' | 'no-existe' | 'requiere-confirmacion'>; // la confirmación de un "en espera" la conecta la T5
};

const ColaContext = createContext<Estado | null>(null);

export function useCola(): Estado {
  const ctx = useContext(ColaContext);
  if (!ctx) throw new Error('useCola debe usarse dentro de <ColaProvider>');
  return ctx;
}

export function ColaProvider({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  const { generadaEn, actualizarAhora } = useSinConexion();
  const enLinea = useEnLinea();
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [enviados, setEnviados] = useState<Enviado[]>([]);
  const [progreso, setProgreso] = useState<{ actual: number; total: number } | null>(null);

  const rolRef = useRef(usuario?.rol ?? null);
  rolRef.current = usuario?.rol ?? null;
  const usuarioId = usuario?.id ?? null;
  const establecimientoId = usuario?.establecimiento.id ?? null;
  const persona: Persona | null = useMemo(() => (usuarioId && establecimientoId ? { usuarioId, establecimientoId } : null), [usuarioId, establecimientoId]);
  const personaRef = useRef(persona);
  personaRef.current = persona;
  // Siempre la última versión de la función (cambia en cada render del otro provider).
  const actualizarAhoraRef = useRef(actualizarAhora);
  actualizarAhoraRef.current = actualizarAhora;

  // Vuelve a leer del almacén lo que se muestra. Si mientras tanto cambió la sesión, se descarta.
  const recargar = useCallback(async () => {
    const p = personaRef.current;
    if (!p) return;
    const almacen = obtenerAlmacen();
    const [pend, env] = await Promise.all([pendientesDe(almacen, p), enviadosDe(almacen, p)]).catch(() => [null, null] as const);
    if (personaRef.current !== p || !pend || !env) return;
    setPendientes(pend);
    setEnviados(env);
  }, []);

  const sincronizador = useMemo(
    () =>
      persona
        ? crearSincronizador({ almacen: obtenerAlmacen(), persona, enviar: enviarPendiente, ahora: () => Date.now(), alProgreso: setProgreso, alCambiar: () => void recargar() })
        : null,
    [persona, recargar],
  );

  // Temporizador del próximo reintento automático.
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correrRef = useRef<(op?: OpcionesRonda) => Promise<void>>(async () => undefined);

  const programar = useCallback((cuando: number | null) => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = null;
    if (cuando === null) return;
    // Un margen chico para que, al despertar, la espera ya esté cumplida.
    temporizador.current = setTimeout(() => void correrRef.current(), Math.max(cuando - Date.now(), 0) + 50);
  }, []);

  // Una ronda de envío. Sin conexión no se intenta (salvo que lo pida el usuario: así se descubre si volvió la señal).
  const correr = useCallback(
    async (opciones: OpcionesRonda = {}, forzada = false) => {
      if (!sincronizador) return;
      if (!forzada && !obtenerConexion().enLinea()) return;
      const r = await sincronizador.sincronizar(opciones);
      await recargar();
      if (r.aceptados > 0) actualizarAhoraRef.current(); // RF-35: tras aceptar litros se actualiza la copia
      programar(r.siguienteIntento);
    },
    [sincronizador, recargar, programar],
  );
  correrRef.current = (op) => correr(op);

  // Al entrar con una sesión: lo que quedó "enviando" vuelve a esperando, se lee todo y se envía si hay señal.
  useEffect(() => {
    if (!persona) {
      setPendientes([]);
      setEnviados([]);
      setProgreso(null);
      return;
    }
    let cancelado = false;
    (async () => {
      await restablecerEnviando(obtenerAlmacen(), persona).catch(() => undefined);
      if (cancelado) return;
      await recargar();
      void correr();
    })();
    return () => {
      cancelado = true;
      if (temporizador.current) clearTimeout(temporizador.current);
    };
    // `correr` cambia con el sincronizador, que ya depende de `persona`.
  }, [persona, recargar, correr]);

  // Al volver la señal se intenta enviar enseguida, sin esperar las esperas crecientes.
  const estabaEnLinea = useRef(enLinea);
  useEffect(() => {
    if (enLinea && !estabaEnLinea.current) void correr({ ignorarEsperas: true });
    estabaEnLinea.current = enLinea;
  }, [enLinea, correr]);

  // Tras una copia nueva se quitan los "enviados" que ya trae (RF-34).
  useEffect(() => {
    if (!persona || !generadaEn) return;
    limpiarEnviadosIncluidos(obtenerAlmacen(), persona)
      .catch(() => undefined)
      .then(() => recargar());
  }, [persona, generadaEn, recargar]);

  const cargar = useCallback<Estado['cargar']>(
    async (datos, registrosCopia) => {
      const p = personaRef.current;
      if (!p) throw new Error('No hay sesión');
      const rol = rolRef.current;
      if (!rol) throw new Error('No hay sesión');
      const conSenal = obtenerConexion().enLinea();
      const r = await cargarLitros({ almacen: obtenerAlmacen(), persona: p, rol, datos, registrosCopia, enLinea: conSenal, enviar: enviarPendiente, ahora: new Date(), generarId: nuevoId });
      await recargar();
      // Con señal pero sin confirmación (señal mala): se reintenta solo en unos segundos.
      if (r.tipo === 'pendiente' && conSenal) programar(Date.now() + 5_000);
      return r;
    },
    [recargar, programar],
  );

  const valor = useMemo<Estado>(() => {
    const { total, rechazados } = contarPendientes(pendientes);
    return {
      pendientes,
      enviados,
      total,
      rechazados,
      progreso,
      cargar,
      sincronizarAhora: () => correr({ ignorarEsperas: true }, true),
      reintentarAhora: (id) => correr({ soloId: id, ignorarEsperas: true }, true),
      reintentar: async (id) => {
        await sincronizador?.reintentar(id);
        await correr({ soloId: id, ignorarEsperas: true }, true);
      },
      descartar: async (id) => (sincronizador ? sincronizador.descartar(id) : 'no-existe'),
    };
  }, [pendientes, enviados, progreso, cargar, correr, sincronizador]);

  return <ColaContext.Provider value={valor}>{children}</ColaContext.Provider>;
}
