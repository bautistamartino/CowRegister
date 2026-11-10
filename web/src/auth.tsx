import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type Perfil } from './api';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);

  // Al abrir la app, pregunta a la API si ya hay una sesión activa (cookie).
  useEffect(() => {
    api<Perfil>('/auth/yo')
      .then(setUsuario)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      })
      .finally(() => setCargando(false));
  }, []);

  const valor: Auth = {
    usuario,
    cargando,
    async login(email, password) {
      setUsuario(await api<Perfil>('/auth/login', { method: 'POST', body: { email, password } }));
    },
    async registro(datos) {
      setUsuario(await api<Perfil>('/auth/registro', { method: 'POST', body: datos }));
    },
    async logout() {
      await api('/auth/logout', { method: 'POST' });
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
