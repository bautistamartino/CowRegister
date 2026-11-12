import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { alVencerSesion, api, ApiError, type Perfil } from '../compartido/api';
import { obtenerAlmacen } from '../sinconexion/almacenIndexedDb';
import { almacenMarcaLocalStorage, completarCierrePendiente, crearMarcaCierre } from '../sinconexion/marcaCierre';
import { cerrarSesionLocal, evaluarIngreso, perfilParaEntrarSinConexion } from '../sinconexion/propietario';

// Contexto de autenticación: guarda quién está logueado y lo comparte con toda la app.
//
// Spec 009 (modo sin conexión), reglas de sesión:
//  - Sin conexión se entra con el último perfil guardado (RF-43/48); al volver la señal se revalida.
//  - Un 401 (sesión vencida o revocada) NO borra nada local: se pide el ingreso otra vez (RF-31, RF-48).
//  - Al ingresar, si lo guardado en la tablet es de OTRO usuario o tambo, no se muestra nada hasta decidir:
//    sin pendientes se reemplaza solo; con pendientes se pide confirmación explícita (RF-46).
//  - Cerrar sesión borra TODO lo local, también sin conexión (RF-43, RF-45).

type DatosRegistro = { nombreEstablecimiento: string; nombre: string; email: string; password: string };

// Ingreso que espera la confirmación del usuario: hay datos de otro usuario o tambo con pendientes.
// Mientras exista, `usuario` sigue en null: no se muestra nada del tambo nuevo ni del anterior.
export type IngresoPendiente = { perfil: Perfil; pendientes: number };

type Auth = {
  usuario: Perfil | null;
  cargando: boolean;
  // Devuelven true si se entró; false si quedó esperando la confirmación de `ingresoPendiente`.
  login: (email: string, password: string) => Promise<boolean>;
  registro: (datos: DatosRegistro) => Promise<boolean>;
  // Cierra la sesión y borra lo local. Devuelve false si no se pudo cerrar la del servidor (sin conexión).
  logout: () => Promise<boolean>;
  ingresoPendiente: IngresoPendiente | null;
  confirmarIngreso: () => Promise<void>; // borra lo del anterior y entra
  cancelarIngreso: () => Promise<void>; // cierra la sesión recién abierta y vuelve al ingreso, sin borrar
  // Aviso para la pantalla de ingreso tras un cierre sin conexión.
  avisoCierre: string | null;
};

const AuthContext = createContext<Auth | null>(null);

const TEXTO_CIERRE_SIN_RED =
  'Se cerró la sesión en la tablet y se borraron sus datos, pero no se pudo cerrar la sesión en el servidor porque no hay conexión. Se va a cerrar sola en cuanto vuelva la señal.';

// Marca de cierre pendiente (ver marcaCierre.ts): se pone si el cierre no llegó al servidor y se limpia al ingresar.
const marcaCierre = crearMarcaCierre(almacenMarcaLocalStorage);

// Cierra la sesión del servidor. 'sin-red' si no se llegó a él; un 401 también cuenta como cerrada.
async function cerrarSesionServidor(): Promise<'cerrado' | 'sin-red'> {
  try {
    await api('/auth/logout', { method: 'POST' });
    return 'cerrado';
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) return 'sin-red';
    if (e instanceof ApiError && e.status === 401) return 'cerrado';
    throw e;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ingresoPendiente, setIngresoPendiente] = useState<IngresoPendiente | null>(null);
  const [avisoCierre, setAvisoCierre] = useState<string | null>(null);

  // Si cualquier pedido a la API responde 401 (sesión vencida o borrada), se olvida al
  // usuario: RutaPrivada lo detecta y lo lleva al login (RF-29). Los datos locales NO se tocan:
  // si vuelve a ingresar el mismo usuario, conserva su copia y sus pendientes (RF-47).
  useEffect(() => alVencerSesion(() => setUsuario(null)), []);

  // Decide qué hacer con lo guardado antes de mostrar nada del perfil que acaba de ingresar (RF-46, RF-47).
  const entrar = useCallback(async (perfil: Perfil): Promise<boolean> => {
    // Se ingresó con éxito: la cookie nueva reemplaza a la vieja, así que un cierre pendiente ya no corresponde.
    marcaCierre.limpiar();
    const almacen = obtenerAlmacen();
    // Si no se puede leer lo guardado, no hay nada que mostrar de otro: se sigue.
    const decision = await evaluarIngreso(almacen, { usuarioId: perfil.id, establecimientoId: perfil.establecimiento.id }).catch(
      () => ({ tipo: 'continuar' }) as const,
    );
    if (decision.tipo === 'confirmarBorrado') {
      setUsuario(null);
      setIngresoPendiente({ perfil, pendientes: decision.pendientes });
      return false;
    }
    // Sin pendientes de otro: se reemplaza sin preguntar (borra copia y enviados del anterior).
    if (decision.tipo === 'reemplazarSinPreguntar') await almacen.borrarTodo().catch(() => undefined);
    // El perfil se guarda para abrir la app sin conexión. Si falla (modo privado, sin espacio), la app sigue.
    await almacen.guardarPerfil(perfil).catch(() => undefined);
    setAvisoCierre(null);
    setUsuario(perfil);
    return true;
  }, []);

  // Al abrir la app, pregunta a la API si ya hay una sesión activa (cookie).
  useEffect(() => {
    (async () => {
      // Un cierre de sesión que quedó a medias (sin señal) se completa primero.
      await completarCierrePendiente(marcaCierre, cerrarSesionServidor);
      try {
        // Con timeout: un WiFi sin salida a internet no debe dejar colgada la apertura (se trata como sin red).
        await entrar(await api<Perfil>('/auth/yo', { timeoutMs: 4000 }));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return; // sin sesión: login (no se borra nada)
        // Sin conexión (no se llegó al servidor): se entra con el último perfil guardado si es del dueño de los
        // datos locales. La sesión se revalida al volver la señal; si ahí fue revocada, se pide el ingreso (RF-48).
        if (e instanceof ApiError && e.status === 0) {
          const guardado = await perfilParaEntrarSinConexion(obtenerAlmacen()).catch(() => null);
          if (guardado) setUsuario(guardado);
          return;
        }
        console.error(e);
      }
    })().finally(() => setCargando(false));
  }, [entrar]);

  const valor: Auth = {
    usuario,
    cargando,
    ingresoPendiente,
    avisoCierre,
    async login(email, password) {
      const perfil = await api<Perfil>('/auth/login', { method: 'POST', body: { email, password } });
      return entrar(perfil);
    },
    async registro(datos) {
      const perfil = await api<Perfil>('/auth/registro', { method: 'POST', body: datos });
      return entrar(perfil);
    },
    async logout() {
      const { servidorCerrado } = await cerrarSesionLocal({ almacen: obtenerAlmacen(), cerrarServidor: cerrarSesionServidor });
      if (servidorCerrado) marcaCierre.limpiar();
      else marcaCierre.poner();
      setAvisoCierre(servidorCerrado ? null : TEXTO_CIERRE_SIN_RED);
      setUsuario(null);
      return servidorCerrado;
    },
    async confirmarIngreso() {
      if (!ingresoPendiente) return;
      // Primero se borra TODO lo del anterior; solo después se muestra algo del nuevo.
      await obtenerAlmacen().borrarTodo();
      await obtenerAlmacen().guardarPerfil(ingresoPendiente.perfil).catch(() => undefined);
      const perfil = ingresoPendiente.perfil;
      setIngresoPendiente(null);
      setAvisoCierre(null);
      setUsuario(perfil);
    },
    async cancelarIngreso() {
      // Se cierra la sesión del servidor que se acababa de abrir y no se borra nada local (RF-46).
      const r = await cerrarSesionServidor().catch(() => 'sin-red' as const);
      if (r === 'sin-red') marcaCierre.poner();
      setIngresoPendiente(null);
      setUsuario(null);
    },
  };

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
