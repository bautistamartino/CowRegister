import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { alVencerSesion, api, ApiError, type Perfil } from '../compartido/api';
import { obtenerAlmacen } from '../sinconexion/almacenIndexedDb';

// Contexto de autenticación: guarda quién está logueado y lo comparte con toda la app.

type DatosRegistro = { nombreEstablecimiento: string; nombre: string; email: string; password: string };

type Auth = {
  usuario: Perfil | null;
  cargando: boolean;
  login: (email: string, password: string) => Promise<void>;
  registro: (datos: DatosRegistro) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

// Guarda el perfil en la tablet para poder abrir la app sin conexión (spec 009). Si falla
// (modo privado, sin espacio), la app sigue andando: solo que no abrirá sin conexión.
function recordarPerfil(perfil: Perfil) {
  obtenerAlmacen().guardarPerfil(perfil).catch(() => undefined);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);

  // Si cualquier pedido a la API responde 401 (sesión vencida o borrada), se olvida al
  // usuario: RutaPrivada lo detecta y lo lleva al login (RF-29).
  useEffect(() => alVencerSesion(() => setUsuario(null)), []);

  // Al abrir la app, pregunta a la API si ya hay una sesión activa (cookie).
  useEffect(() => {
    api<Perfil>('/auth/yo')
      .then((perfil) => {
        recordarPerfil(perfil);
        setUsuario(perfil);
      })
      .catch(async (e) => {
        if (e instanceof ApiError && e.status === 401) return;
        // Sin conexión (no se pudo llegar al servidor): se entra con el último perfil guardado,
        // si lo hay. Las reglas completas (sesión revocada, otro usuario) llegan en la T5.
        if (e instanceof ApiError && e.status === 0) {
          const guardado = await obtenerAlmacen().leerPerfil().catch(() => null);
          if (guardado) setUsuario(guardado);
          return;
        }
        console.error(e);
      })
      .finally(() => setCargando(false));
  }, []);

  const valor: Auth = {
    usuario,
    cargando,
    async login(email, password) {
      const perfil = await api<Perfil>('/auth/login', { method: 'POST', body: { email, password } });
      recordarPerfil(perfil);
      setUsuario(perfil);
    },
    async registro(datos) {
      const perfil = await api<Perfil>('/auth/registro', { method: 'POST', body: datos });
      recordarPerfil(perfil);
      setUsuario(perfil);
    },
    async logout() {
      await api('/auth/logout', { method: 'POST' });
      // Cerrar sesión borra lo guardado en la tablet (copia y perfil). Las confirmaciones y el
      // caso sin conexión se completan en la T5.
      await obtenerAlmacen().borrarTodo().catch(() => undefined);
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
