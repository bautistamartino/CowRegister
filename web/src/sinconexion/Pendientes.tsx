import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '../sesion/auth';
import { formatearFecha, puedeCargar } from '../animales/animalesDatos';
import { formatearLitros, NOMBRE_TURNO, textoMomento } from '../produccion/produccionDatos';
import { datosLitros, type Pendiente } from './almacen';
import { Confirmar } from './Confirmar';
import { useCola } from './ColaProvider';
import { INICIO_MENSAJE_DUPLICADO } from './cola';
import { estadoVisible, posterioresDe } from './dependencias';

// "Pendientes de sincronizar" (spec 009, RF-36 a RF-40; spec 010, RF-31): lo cargado en la tablet (litros y, desde
// la spec 010, servicios, tactos, partos, secados, bajas y anulaciones) que el servidor todavía no aceptó, con su estado. Rechazados: se pueden reintentar o descartar. Funciona también sin conexión.

// Textos mínimos por tipo; los resúmenes completos ("Parto con 2 crías") son de la spec 011.
const TEXTO_TIPO: Record<Pendiente['tipo'], string> = {
  LITROS: 'Litros',
  SERVICIO: 'Servicio',
  TACTO: 'Tacto',
  PARTO: 'Parto',
  SECADO: 'Secado',
  BAJA: 'Baja',
  ANULACION: 'Anulación',
};

const TEXTO_EVENTO_ANULADO: Record<string, string> = { SERVICIO: 'servicio', TACTO: 'tacto', PARTO: 'parto', SECADO: 'secado' };

function textoTipo(p: Pendiente): string {
  if (p.tipo !== 'ANULACION') return TEXTO_TIPO[p.tipo];
  const anulado = TEXTO_EVENTO_ANULADO[String(p.datos.tipoEvento)];
  return anulado ? `Anulación de ${anulado}` : 'Anulación';
}

function resumen(p: Pendiente): string {
  if (p.tipo !== 'LITROS') return `Vaca ${p.numero} · ${textoTipo(p)}`;
  const d = datosLitros(p);
  return `Vaca ${p.numero} · ${formatearFecha(d.fecha)} · ${NOMBRE_TURNO[d.turno]} · ${formatearLitros(Number(d.litros))} L`;
}

// El rechazo por duplicado (409 "Ya hay una carga…", texto de la API): gana el que llegó primero al servidor (spec 009).
const esDuplicado = (p: Pendiente) => p.codigoRechazo === 409 && (p.motivo ?? '').startsWith(INICIO_MENSAJE_DUPLICADO);

export function Pendientes() {
  const { usuario } = useAuth();
  const { pendientes, avisos, progreso, sincronizarAhora, reintentar, reintentarAhora, descartar, cerrarAvisos } = useCola();
  const [confirmando, setConfirmando] = useState<string | null>(null); // id del pendiente que se está por descartar
  const [descartando, setDescartando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // El veterinario no carga litros: sin pendientes ni avisos no tiene esta pantalla (spec 009 RF-25). Si le quedó algo
  // sin enviar (por ejemplo un servicio o un tacto), la ve igual.
  if (!usuario) return null;
  if (!puedeCargar(usuario.rol) && pendientes.length === 0 && avisos.length === 0) return <Navigate to="/" replace />;

  const hayEsperando = pendientes.some((p) => p.estado === 'esperando');

  async function confirmarDescarte(id: string) {
    setDescartando(true);
    try {
      // Si el pendiente se estaba enviando, esto espera el resultado (RF-39). Si estaba "en espera del anterior"
      // el usuario ya lo confirmó en el cartel (RF-27), así que se descarta con la confirmación.
      const r = await descartar(id, { confirmado: true });
      setAviso(r === 'ya-guardado' ? 'Ya estaba guardado en el servidor' : r === 'descartado' ? 'Pendiente descartado' : null);
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

      {avisos.length > 0 && (
        <section aria-label="Avisos del servidor">
          <h2>Avisos del servidor</h2>
          <ul className="lista-eventos">
            {avisos.map((a) => (
              <li key={a.id} className="evento">
                <p className="evento-titulo">
                  <strong>
                    Vaca {a.numero} · {TEXTO_TIPO[a.tipo]}
                  </strong>
                </p>
                {a.avisos.map((x, i) => (
                  <p key={i} className="texto-suave">
                    {x.mensaje}
                  </p>
                ))}
                <div className="acciones">
                  <button type="button" className="boton-secundario" onClick={() => void cerrarAvisos([a.id])}>
                    Cerrar aviso
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendientes.length === 0 ? (
        <p className="subtitulo" role="status">
          No hay nada pendiente de sincronizar
        </p>
      ) : (
        <ul className="lista-eventos">
          {pendientes.map((p) => {
            const visible = estadoVisible(p, pendientes);
            const posteriores = posterioresDe(p, pendientes);
            return (
            <li key={p.id} className={`evento pendiente pendiente-${p.estado}`}>
              <p className="evento-titulo">
                <strong>{resumen(p)}</strong>
              </p>
              <p className="texto-suave">Cargado el {textoMomento(p.cargadoEnDispositivo)}</p>

              {visible === 'enEspera' && (
                <p>
                  <span className="etiqueta-estado">En espera del anterior</span> <span className="texto-suave">Sale cuando se resuelva el registro anterior de esta vaca.</span>
                </p>
              )}
              {visible === 'esperando' && (
                <>
                  <p>
                    <span className="etiqueta-estado">Pendiente de sincronizar</span>
                  </p>
                  {p.motivo && <p className="texto-suave">Último intento: {p.motivo}. Se reintenta solo.</p>}
                </>
              )}
              {visible === 'enviando' && (
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
                <Confirmar titulo="¿Descartar este pendiente?" confirmarTexto="Sí, descartar" alConfirmar={() => void confirmarDescarte(p.id)} alCancelar={() => setConfirmando(null)} ocupado={descartando}>
                  <p>
                    {resumen(p)}. Se borra de la tablet y no se envía al servidor. No se puede deshacer.
                    {p.estado === 'enviando' && ' Se está enviando: se espera el resultado antes de decidir.'}
                  </p>
                  {visible === 'enEspera' && <p>Este registro está en espera de uno anterior que se rechazó.</p>}
                  {posteriores.length > 0 && (
                    <p>
                      Después de este hay {posteriores.length} {posteriores.length === 1 ? 'registro más' : 'registros más'} de la misma vaca que {posteriores.length === 1 ? 'queda' : 'quedan'} en la lista:
                      no se descartan solos y puede que el servidor los rechace.
                    </p>
                  )}
                </Confirmar>
              ) : (
                <div className="acciones">
                  {visible === 'esperando' && (
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
            );
          })}
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
