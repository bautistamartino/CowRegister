import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../sesion/auth';

function Cargando() {
  return <div className="centrado">Cargando…</div>;
}

// Solo deja pasar si hay sesión; si no, manda al login.
export function RutaPrivada({ children }: { children: ReactNode }) {
  const { usuario, cargando } = useAuth();
  const location = useLocation();
  if (cargando) return <Cargando />;
  if (!usuario) return <Navigate to="/login" replace state={{ desde: location.pathname }} />;
  return children;
}

// Para login y registro: si ya hay sesión, manda al inicio.
export function RutaPublica({ children }: { children: ReactNode }) {
  const { usuario, cargando } = useAuth();
  if (cargando) return <Cargando />;
  if (usuario) return <Navigate to="/" replace />;
  return children;
}
