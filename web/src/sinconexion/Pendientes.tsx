import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '../sesion/auth';
import { formatearFecha, puedeCargar } from '../animales/animalesDatos';
import { formatearLitros, NOMBRE_TURNO, textoMomento } from '../produccion/produccionDatos';
import type { Pendiente } from './almacen';
import { Confirmar } from './Confirmar';
import { useCola } from './ColaProvider';
import { INICIO_MENSAJE_DUPLICADO } from './cola';

// "Pendientes de sincronizar" (spec 009, RF-36 a RF-40): los litros cargados que el servidor todavía no
// aceptó, con su estado. Rechazados: se pueden reintentar o descartar. Funciona también sin conexión.

function resumen(p: Pendiente): string {
  return `Vaca ${p.numero} · ${formatearFecha(p.fecha)} · ${NOMBRE_TURNO[p.turno]} · ${formatearLitros(Number(p.litros))} L`;
}

// El rechazo por duplicado (409 "Ya hay una carga…", texto de la API): gana el que llegó primero al servidor (spec 009).
const esDuplicado = (p: Pendiente) => p.codigoRechazo === 409 && (p.motivo ?? '').startsWith(INICIO_MENSAJE_DUPLICADO);

export function Pendientes() {
  const { usuario } = useAuth();
  const { pendientes, progreso, sincronizarAhora, reintentar, reintentarAhora, descartar } = useCola();
  const [confirmando, setConfirmando] = useState<string | null>(null); // id del pendiente que se está por descartar
  const [descartando, setDescartando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // El veterinario no carga litros: no tiene pendientes ni esta pantalla (RF-25).
  if (!usuario) return null;
  if (!puedeCargar(usuario.rol)) return <Navigate to="/" replace />;

  const hayEsperando = pendientes.some((p) => p.estado === 'esperando');

  async function confirmarDescarte(id: string) {
    setDescartando(true);
    try {
      // Si el pendiente se estaba enviando, esto espera el resultado (RF-39).
      const r = await descartar(id);
      setAviso(r === 'ya-guardado' ? 'Ya estaba guardado en el servidor' : r === 'descartado' ? 'Litro descartado' : null);
    } finally {
      setDescartando(false);
      setConfirmando(null);
    }
  }

  return (
    <main className="contenido pantalla-lotes">
      <div className="encabezado-pantalla">
        <h1>Pendientes de sincronizar</h1>
        {hayEsperando && !progreso && (
          <button type="button" className="boton" onClick={() => void sincronizarAhora()}>
            Enviar ahora
          </button>
        )}
      </div>

      {progreso && (
        <p className="progreso-envio" role="status">
          Enviando {progreso.actual} de {progreso.total}
        </p>
      )}

      {aviso && (
        <div className="resultado-registro" role="status">
          <p className="resultado-titulo">{aviso}</p>
          <button type="button" className="boton-secundario" onClick={() => setAviso(null)}>
            Cerrar
          </button>
        </div>
      )}

      {pendientes.length === 0 ? (
        <p className="subtitulo" role="status">
          No hay nada pendiente de sincronizar
        </p>
      ) : (
        <ul className="lista-eventos">
          {pendientes.map((p) => (
            <li key={p.id} className={`evento pendiente pendiente-${p.estado}`}>
              <p className="evento-titulo">
                <strong>{resumen(p)}</strong>
              </p>
              <p className="texto-suave">Cargado el {textoMomento(p.cargadoEnDispositivo)}</p>

              {p.estado === 'esperando' && (
                <>
                  <p>
                    <span className="etiqueta-estado">Pendiente de sincronizar</span>
                  </p>
                  {p.motivo && <p className="texto-suave">Último intento: {p.motivo}. Se reintenta solo.</p>}
                </>
              )}
              {p.estado === 'enviando' && (
                <p>
                  <span className="etiqueta-estado">Enviando…</span>
                </p>
              )}
              {p.estado === 'rechazado' && (
                <>
                  <p className="pendiente-rechazo" role="alert">
                    <span className="etiqueta-estado etiqueta-rechazado">Rechazado:</span> {p.motivo}
                  </p>
                  {esDuplicado(p) && (
                    <p className="texto-suave">
                      Gana el que llegó primero al servidor. Podés descartar este litro, o anular el otro registro con conexión y después tocar "Reintentar".
                    </p>
                  )}
                </>
              )}

              {confirmando === p.id ? (
                <Confirmar titulo="¿Descartar este litro?" confirmarTexto="Sí, descartar" alConfirmar={() => void confirmarDescarte(p.id)} alCancelar={() => setConfirmando(null)} ocupado={descartando}>
                  <p>
                    {resumen(p)}. Se borra de la tablet y no se envía al servidor. No se puede deshacer.
                    {p.estado === 'enviando' && ' Se está enviando: se espera el resultado antes de decidir.'}
                  </p>
                </Confirmar>
              ) : (
                <div className="acciones">
                  {p.estado === 'esperando' && (
                    <button type="button" className="boton-secundario" onClick={() => void reintentarAhora(p.id)}>
                      Reintentar ahora
                    </button>
                  )}
                  {p.estado === 'rechazado' && (
                    <button type="button" className="boton-secundario" onClick={() => void reintentar(p.id)}>
                      Reintentar
                    </button>
                  )}
                  <button type="button" className="boton-secundario boton-peligro" onClick={() => setConfirmando(p.id)}>
                    Descartar
                  </button>
                  <Link to={`/animales/${encodeURIComponent(p.animalId)}`} className="boton-secundario enlace-boton">
                    Ver vaca
                  </Link>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p>
        <Link to="/animales" className="enlace-fila">
          Volver a Animales
        </Link>
      </p>
    </main>
  );
}
