import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RegistroProduccion } from '../compartido/api';
import { useAuth } from '../sesion/auth';
import type { AvisoGuardado, Enviado, Pendiente, TipoPendiente } from './almacen';
import { anularLocal as anularLocalPuro, type ResultadoAnulacion } from './anularLocal';
import { obtenerAlmacen } from './almacenIndexedDb';
import { cargarLitros, type ResultadoCarga } from './cargarLitros';
import { avisosDe, contarPendientes, enviadosDe, pendientesDe, restablecerEnviando, type DatosCarga, type Persona } from './cola';
import { limpiarEnviadosReflejados } from './reflejo';
import { registrar as registrarPuro, type ResultadoRegistro } from './registrar';
import { obtenerConexion } from './conexion';
import { enviarPendiente, nuevoId } from './envio';
import { descartarYReanudar, reintentarYReanudar } from './reanudar';
import { crearSincronizador, type OpcionesRonda } from './sincronizar';
import { useSinConexion } from './SinConexionProvider';
import { useEnLinea } from './useConexion';

// Estado de los pendientes de cualquier tipo para toda la app (spec 009, T4; generalizado en la spec 010, T5). Une la lógica pura (cola.ts,
// sincronizar.ts, cargarLitros.ts) con React: lee los pendientes, dispara los envíos solos y expone las
// acciones a las pantallas. Se monta dentro del SinConexionProvider.
//
// Cuándo se envía solo:
//   - al abrir la app con sesión y señal;
//   - cuando vuelve la señal (sin esperar las esperas crecientes: es un buen momento para intentar);
//   - cuando se cumple la espera de un pendiente que falló (un temporizador).

type Estado = {
  avisos: AvisoGuardado[]; // avisos del servidor que el usuario todavía no cerró (spec 010, RF-28)
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
  // Descartar un pendiente. Uno "en espera del anterior" devuelve 'requiere-confirmacion' hasta que se llame con `confirmado` (RF-27).
  descartar: (id: string, opciones?: { confirmado?: boolean }) => Promise<'descartado' | 'ya-guardado' | 'no-existe' | 'requiere-confirmacion'>;
  posteriores: (id: string) => Promise<Pendiente[]>; // los de la misma vaca cargados después (RF-17), para avisar antes de descartar
  cerrarAvisos: (ids: string[]) => Promise<void>; // el usuario cierra avisos del servidor (RF-28)
  // Punto único de registro de cualquier tipo de evento (spec 010, RF-15). Las pantallas de la spec 011 lo usan.
  registrar: (args: { tipo: TipoPendiente; animal: { id: string; numero: string }; datos: Record<string, unknown> }) => Promise<ResultadoRegistro>;
  // Anula el último evento no anulado de la vaca, o lo descarta si todavía es un pendiente (RF-16, RF-17).
  anularLocal: (args: { animal: { id: string; numero: string }; motivo: string; eventoId?: string }) => Promise<ResultadoAnulacion>;
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
  const [avisos, setAvisos] = useState<AvisoGuardado[]>([]);
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
    const [pend, env, avi] = await Promise.all([pendientesDe(almacen, p), enviadosDe(almacen, p), avisosDe(almacen, p)]).catch(() => [null, null, null] as const);
    if (personaRef.current !== p || !pend || !env || !avi) return;
    setPendientes(pend);
    setEnviados(env);
    setAvisos(avi);
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
      setAvisos([]);
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

  // Tras una copia nueva se quitan los "enviados" de todos los tipos que ya trae (spec 009 RF-34, spec 010 RF-19).
  useEffect(() => {
    if (!persona || !generadaEn) return;
    limpiarEnviadosReflejados(obtenerAlmacen(), persona)
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

  // Punto único de registro: arma lo que necesita registrar.ts con la sesión, la señal y el reloj de la tablet.
  const registrar = useCallback<Estado['registrar']>(
    async ({ tipo, animal, datos }) => {
      const p = personaRef.current;
      const rol = rolRef.current;
      if (!p || !rol) throw new Error('No hay sesión');
      const conSenal = obtenerConexion().enLinea();
      const r = await registrarPuro({ almacen: obtenerAlmacen(), persona: p, rol, tipo, animal, datos, enLinea: conSenal, enviar: enviarPendiente, ahora: new Date(), generarId: nuevoId });
      await recargar();
      if (r.tipo === 'pendiente' && conSenal) programar(Date.now() + 5_000);
      if (r.tipo === 'enviado') actualizarAhoraRef.current();
      return r;
    },
    [recargar, programar],
  );

  const anularLocal = useCallback<Estado['anularLocal']>(
    async ({ animal, motivo, eventoId }) => {
      const p = personaRef.current;
      const rol = rolRef.current;
      if (!p || !rol) throw new Error('No hay sesión');
      const conSenal = obtenerConexion().enLinea();
      const r = await anularLocalPuro({
        almacen: obtenerAlmacen(),
        persona: p,
        rol,
        animal,
        motivo,
        eventoId,
        enLinea: conSenal,
        enviar: enviarPendiente,
        ahora: new Date(),
        generarId: nuevoId,
        // Descartar pasa por el sincronizador: espera si se está enviando y responde 'ya-guardado' si el servidor lo aceptó.
        descartar: (id) => (sincronizador ? sincronizador.descartar(id) : Promise.resolve('no-existe' as const)),
      });
      await recargar();
      if (r.tipo === 'registro' && r.resultado.tipo === 'pendiente' && conSenal) programar(Date.now() + 5_000);
      if (r.tipo === 'registro' && r.resultado.tipo === 'enviado') actualizarAhoraRef.current();
      return r;
    },
    [recargar, programar, sincronizador],
  );

  const valor = useMemo<Estado>(() => {
    const { total, rechazados } = contarPendientes(pendientes);
    return {
      pendientes,
      enviados,
      avisos,
      total,
      rechazados,
      progreso,
      cargar,
      sincronizarAhora: () => correr({ ignorarEsperas: true }, true),
      reintentarAhora: (id) => correr({ soloId: id, ignorarEsperas: true }, true),
      // Tras reintentar o descartar se corre una ronda completa (sin soloId) para reanudar a los de la misma vaca (RF-27).
      reintentar: async (id) => {
        if (sincronizador) await reintentarYReanudar(sincronizador, id, () => correr({ ignorarEsperas: true }, true));
      },
      descartar: async (id, opciones) => (sincronizador ? descartarYReanudar(sincronizador, id, opciones, () => correr({ ignorarEsperas: true }, true)) : 'no-existe'),
      posteriores: async (id) => (sincronizador ? sincronizador.posteriores(id) : []),
      cerrarAvisos: async (ids) => {
        await sincronizador?.cerrarAvisos(ids);
      },
      registrar,
      anularLocal,
    };
  }, [pendientes, enviados, avisos, progreso, cargar, correr, sincronizador, registrar, anularLocal]);

  return <ColaContext.Provider value={valor}>{children}</ColaContext.Provider>;
}
