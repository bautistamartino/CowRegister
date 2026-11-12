import type { ReactNode } from 'react';
import { useRef } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../sesion/auth';
import { NecesitaConexion } from '../sinconexion/NecesitaConexion';
import { useEnLinea } from '../sinconexion/useConexion';

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

// Envuelve las pantallas que NO están disponibles sin conexión (spec 009, RF-13): bajas, informes,
// semen, lotes, alta y planilla. Si el usuario ENTRA sin conexión, ve "Esto necesita conexión" con
// un botón para volver al listado. Si ya estaba adentro y la señal se corta, la pantalla se queda
// (para no perder lo que estaba escribiendo): sus pedidos avisan solos que necesitan conexión.
export function RutaConConexion({ children }: { children: ReactNode }) {
  // La clave es la ruta: al pasar de una pantalla a otra se vuelve a decidir (si no, React reutilizaría esto).
  return <Guardia key={useLocation().pathname}>{children}</Guardia>;
}

function Guardia({ children }: { children: ReactNode }) {
  const enLinea = useEnLinea();
  const habiaConexion = useRef(enLinea); // cómo estaba la conexión al entrar a la pantalla
  if (enLinea) habiaConexion.current = true;
  return enLinea || habiaConexion.current ? children : <NecesitaConexion />;
}
