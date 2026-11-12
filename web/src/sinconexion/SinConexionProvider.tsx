import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type CopiaLocal } from '../compartido/api';
import { useAuth } from '../sesion/auth';
import { obtenerAlmacen } from './almacenIndexedDb';
import { actualizarCopia, formatearFechaHora, type MotivoFalla } from './copia';
import { fijarPropietarioLocal } from './lecturaLocal';
import { useEnLinea } from './useConexion';

// Estado de la copia local para toda la app (spec 009). Se monta dentro del AuthProvider.
//
// Qué hace:
//  - Con sesión y sin copia: bloquea el uso con "Descargando los datos del tambo…" (RF-4).
//  - Con copia: deja usar la app y la actualiza en segundo plano al abrir (RF-5).
//  - Una actualización fallida se reintenta sola cuando vuelve la señal (RF-10).

type FallaVisible = { motivo: MotivoFalla; mensaje: string };

type Estado = {
  generadaEn: string | null; // fecha de la copia guardada ("al día de")
  actualizando: boolean;
  falla: FallaVisible | null; // última actualización fallida (se limpia al salir bien)
  actualizarAhora: () => void;
};

const SinConexionContext = createContext<Estado | null>(null);

export function useSinConexion(): Estado {
  const ctx = useContext(SinConexionContext);
  if (!ctx) throw new Error('useSinConexion debe usarse dentro de <SinConexionProvider>');
  return ctx;
}

// 'revisando' = leyendo lo guardado; 'sinCopia' = no hay copia (pantalla bloqueante); 'lista' = hay copia.
type Fase = 'revisando' | 'sinCopia' | 'lista';

export function SinConexionProvider({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const [fase, setFase] = useState<Fase>('revisando');
  const [generadaEn, setGeneradaEn] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);
  const [falla, setFalla] = useState<FallaVisible | null>(null);
  const enLinea = useEnLinea();
  const enCurso = useRef(false); // evita dos descargas a la vez (por ejemplo, "online" + clic)

  const usuarioId = usuario?.id ?? null;
  const establecimientoId = usuario?.establecimiento.id ?? null;

  const actualizar = useCallback(async () => {
    if (enCurso.current || !usuarioId || !establecimientoId) return;
    enCurso.current = true;
    setActualizando(true);
    try {
      const resultado = await actualizarCopia({
        almacen: obtenerAlmacen(),
        propietario: { usuarioId, establecimientoId },
        descargar: () => api<CopiaLocal>('/copia-local'),
      });
      if (resultado.ok) {
        setGeneradaEn(resultado.generadaEn);
        setFalla(null);
        setFase('lista');
      } else {
        setGeneradaEn(resultado.generadaEn);
        setFalla({ motivo: resultado.motivo, mensaje: resultado.mensaje });
        setFase(resultado.conservada ? 'lista' : 'sinCopia');
      }
    } finally {
      enCurso.current = false;
      setActualizando(false);
    }
  }, [usuarioId, establecimientoId]);

  // Al entrar con una sesión (o al cambiar de usuario): ver qué hay guardado y actualizar.
  useEffect(() => {
    if (!usuarioId || !establecimientoId) {
      fijarPropietarioLocal(null);
      setFase('revisando');
      setGeneradaEn(null);
      setFalla(null);
      return;
    }
    // Las lecturas sin conexión (api.ts) solo usan una copia de ESTE usuario y tambo (RF-17).
    fijarPropietarioLocal({ usuarioId, establecimientoId });
    let cancelado = false;
    (async () => {
      const almacen = obtenerAlmacen();
      let meta = await almacen.leerMeta().catch(() => null);
      // La copia es de OTRO usuario o tambo: nunca se muestra (RF-17). Se descarta y se descarga
      // la propia como "primera vez". (La confirmación con aviso de pendientes llega en la T5.)
      if (meta && (meta.propietario.usuarioId !== usuarioId || meta.propietario.establecimientoId !== establecimientoId)) {
        await almacen.borrarCopia().catch(() => undefined);
        meta = null;
      }
      if (cancelado) return;
      setGeneradaEn(meta?.generadaEn ?? null);
      setFase(meta ? 'lista' : 'sinCopia');
      void actualizar();
    })();
    return () => {
      cancelado = true;
    };
  }, [usuarioId, establecimientoId, actualizar]);

  // Al volver la señal, si la última actualización falló, se reintenta sola (RF-10). Se usa el estado
  // de conexión de la app (que confirma con la sonda), no solo el evento del navegador.
  // Solo al PASAR de sin conexión a con conexión (si no, una falla del servidor se reintentaría sin fin).
  const estabaEnLinea = useRef(enLinea);
  useEffect(() => {
    if (enLinea && !estabaEnLinea.current && falla) void actualizar();
    estabaEnLinea.current = enLinea;
  }, [enLinea, falla, actualizar]);

  const valor: Estado = { generadaEn, actualizando, falla, actualizarAhora: () => void actualizar() };

  // Sin sesión (login, registro) no hay copia que mostrar.
  if (!usuario) return <SinConexionContext.Provider value={valor}>{children}</SinConexionContext.Provider>;

  if (fase === 'revisando') return <div className="centrado">Cargando…</div>;

  // Primera descarga: bloquea el uso hasta terminar (RF-4) o explica por qué no se pudo (RF-11).
  if (fase === 'sinCopia') {
    const sinRed = falla?.motivo === 'red';
    return (
      <div className="pantalla-auth">
        <div className="tarjeta pantalla-descarga" role="status" aria-live="polite">
          <h1>CowRegister</h1>
          {actualizando && <p>Descargando los datos del tambo…</p>}
          {!actualizando && falla && (
            <>
              <p className="alerta" role="alert">
                {sinRed ? 'Necesitás conexión para descargar los datos del tambo la primera vez' : falla.mensaje}
              </p>
              <button type="button" className="boton" onClick={() => void actualizar()}>
                Reintentar
              </button>
            </>
          )}
          <button type="button" className="boton-secundario" onClick={() => void logout().catch(() => undefined)} disabled={actualizando}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  return <SinConexionContext.Provider value={valor}>{children}</SinConexionContext.Provider>;
}

// Texto del cartel según el estado (lo usa CartelCopia).
export function textoDatosAlDia(generadaEn: string | null): string {
  return generadaEn ? `Datos al día de ${formatearFechaHora(generadaEn)}` : '';
}
