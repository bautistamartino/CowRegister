import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type Aviso, type CampoCambio, type EventoReproductivo, type RespuestaHistorial } from '../compartido/api';
import { useAuth } from '../sesion/auth';
import { formatearFecha, NOMBRE_ESTADO, NOMBRE_SEXO } from '../animales/animalesDatos';
import { fechaArgentinaIso, resumenEvento, textoGenetica, textoLoteAnterior } from '../reproduccion/reproduccionDatos';
import { Campo } from '../compartido/Campo';
import { formatearFechaHoraArgentina } from '../sinconexion/horaArgentina';
import { useEnLinea } from '../sinconexion/useConexion';
import { useVersionCola } from '../sinconexion/useVersionCola';
import { useCola } from '../sinconexion/ColaProvider';
import { Confirmar } from '../sinconexion/Confirmar';
import { aErroresFormulario } from '../sinconexion/formularioRechazo';
import { resumenPendiente } from '../sinconexion/resumenPendiente';
import type { Pendiente } from '../sinconexion/almacen';

const NOMBRE_CAMPO: Record<CampoCambio, string> = {
  NUMERO: 'Número',
  SEXO: 'Sexo',
  FECHA_NACIMIENTO: 'Fecha de nacimiento',
  MADRE: 'Madre',
  LOTE: 'Lote',
};

// Texto de un valor guardado: null es "sin lote" para el lote y "sin dato" para el resto.
function textoValor(campo: CampoCambio, valor: string | null): string {
  if (valor === null) return campo === 'LOTE' ? 'sin lote' : 'sin dato';
  return campo === 'FECHA_NACIMIENTO' ? formatearFecha(valor) : valor;
}

// "11/11/2026 18:30" en hora de Argentina.
function textoMomento(iso: string): string {
  return formatearFechaHoraArgentina(new Date(iso));
}

type Props = {
  animalId: string;
  // 'animales' = ficha de un animal activo; 'bajas' = ficha de baja (solo lectura, sin "Anular").
  contexto: 'animales' | 'bajas';
  // Sube cuando hay que volver a leer el historial (se registró, anuló, editó o movió algo).
  version: number;
  // Número del animal: lo necesita la anulación para guardarla (con y sin conexión) con su número a la vista.
  numero?: string;
  // Solo la ficha de una hembra activa anula: avisa a la pantalla para que relea situación y ficha.
  // `pendiente` es true si la anulación quedó guardada en la tablet (el servidor todavía no la conoce).
  alAnular?: (tipo: EventoReproductivo['tipo'], avisos: Aviso[], pendiente: boolean) => Promise<void>;
  // Relee todo sin cartel de éxito (se usa cuando la anulación falla con 404 o 409).
  alRefrescar?: () => Promise<void>;
};

// Historial único de la ficha (spec 007): eventos y cambios manuales en una sola línea de tiempo,
// armada y ordenada por la API (más reciente primero). Lo ven los tres roles.
export function Historial({ animalId, numero, contexto, version, alAnular, alRefrescar }: Props) {
  const [datos, setDatos] = useState<RespuestaHistorial | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Texto de lo último que se descartó ("Se descartó: Servicio del 01/11/2026"): la fila ya no existe para decirlo.
  const [avisoDescarte, setAvisoDescarte] = useState<string | null>(null);
  const { usuario } = useAuth();
  // Sin conexión el historial sale de la copia local; al cambiar la conexión se relee (spec 009).
  const enLinea = useEnLinea();
  // El veterinario solo anula servicios y tactos (RF-43); la API igual responde 403.
  const puedeAnularTodo = !!usuario && usuario.rol !== 'VETERINARIO';
  // Cambia cuando cambia la cola de pendientes o la copia: el historial se relee solo (spec 011, RF-25).
  const versionCola = useVersionCola();

  // El aviso de lo descartado es de una sola vez: se va cuando la pantalla registra o anula otra cosa, o cambia de vaca.
  useEffect(() => setAvisoDescarte(null), [animalId, version]);

  useEffect(() => {
    let vigente = true; // descarta una respuesta vieja si cambió la ficha o la versión
    api<RespuestaHistorial>(`/${contexto}/${encodeURIComponent(animalId)}/historial`)
      .then((r) => {
        if (vigente) {
          setDatos(r);
          setError(null);
        }
      })
      .catch((err) => {
        if (vigente) setError(err instanceof ApiError ? err.message : 'No se pudo cargar el historial');
      });
    return () => {
      vigente = false;
    };
  }, [animalId, contexto, version, enLinea, versionCola]);

  return (
    <section className="seccion">
      <h2>Historial</h2>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      {!error && !datos && <p className="subtitulo">Cargando…</p>}
      {avisoDescarte && (
        <p className="aviso" role="status">
          {avisoDescarte}
        </p>
      )}
      {datos && datos.entradas.length === 0 && <p className="subtitulo">Todavía no hay historial registrado</p>}
      {datos && datos.entradas.length > 0 && (
        <>
          <ul className="lista-eventos">
            {datos.entradas.map((entrada) => {
              if (entrada.clase === 'CAMBIO') {
                const c = entrada.cambio;
                return (
                  <li key={`cambio-${c.id}`} className="evento">
                    <p className="evento-titulo">
                      <strong>{formatearFecha(entrada.fecha)}</strong> · {NOMBRE_CAMPO[c.campo]}: {textoValor(c.campo, c.valorAnterior)} →{' '}
                      {textoValor(c.campo, c.valorNuevo)}
                      <span className="etiqueta-cambio">Cambio manual</span>
                    </p>
                    <p className="texto-suave">
                      Registrado por {c.usuarioNombre} · {textoMomento(entrada.registradoEn)}
                    </p>
                  </li>
                );
              }
              const e = entrada.evento;
              // "Anular" solo en el último evento no anulado (lo calcula la API o la vista local, aunque quede fuera
              // del tope), nunca en la ficha de baja ni en una baja; el veterinario solo en servicio o tacto.
              // Un evento PENDIENTE no se anula: se descarta (lo decide la fila). Lo mismo una anulación pendiente.
              const puedeSobre = e.tipo === 'SERVICIO' || e.tipo === 'TACTO' || puedeAnularTodo;
              const habilitado = contexto === 'animales' && !!alAnular && !!numero && puedeSobre;
              const anulable = habilitado && !e.pendiente && e.id === datos.ultimoEventoNoAnuladoId;
              return (
                <FilaEvento
                  key={`evento-${e.id}`}
                  evento={e}
                  animal={numero ? { id: animalId, numero } : null}
                  anulable={anulable}
                  descartable={habilitado && (e.pendiente ? e.id === datos.ultimoEventoNoAnuladoId : true)}
                  alAnular={(avisos, pendiente) => (alAnular ? alAnular(e.tipo, avisos, pendiente) : Promise.resolve())}
                  alDescartado={setAvisoDescarte}
                  alRefrescar={alRefrescar ?? (() => Promise.resolve())}
                />
              );
            })}
          </ul>
          {datos.truncado && (
            <p className="campo-ayuda">
              Se muestran las {datos.tope} entradas más recientes de {datos.total}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ─── Una fila de evento, con la anulación y el descarte (spec 007; con y sin conexión desde la spec 011) ───

// "Servicio del 01/11/2026": lo que es un pendiente, para los textos de confirmación.
function textoDePendiente(p: Pendiente): string {
  const fecha = typeof p.datos.fecha === 'string' ? p.datos.fecha : null;
  return `${resumenPendiente(p.tipo, p.datos)}${fecha ? ` del ${formatearFecha(fecha)}` : ''}`;
}

function FilaEvento({
  evento,
  animal,
  anulable,
  descartable,
  alAnular,
  alDescartado,
  alRefrescar,
}: {
  evento: EventoReproductivo;
  animal: { id: string; numero: string } | null;
  anulable: boolean;
  // La fila admite "Descartar" si el evento es un pendiente o tiene una anulación pendiente.
  descartable: boolean;
  alAnular: (avisos: Aviso[], pendiente: boolean) => Promise<void>;
  alDescartado: (texto: string) => void;
  // Solo relee eventos y ficha, sin cartel de éxito (se usa cuando la anulación falla).
  alRefrescar: () => Promise<void>;
}) {
  const [anulando, setAnulando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorMotivo, setErrorMotivo] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);
  // Descartar: primero se pide confirmación y se listan los pendientes posteriores de la misma vaca.
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [posteriores, setPosteriores] = useState<Pendiente[]>([]);
  const cola = useCola();
  const anulado = evento.anulacion !== null;

  // Lo que se descartaría: el propio evento si es pendiente, o la anulación pendiente de un evento ya anulado.
  const aDescartar: Pendiente | undefined = !descartable
    ? undefined
    : evento.pendiente
      ? cola.pendientes.find((p) => p.id === evento.id)
      : anulado
        ? cola.pendientes.find((p) => p.tipo === 'ANULACION' && p.datos.eventoId === evento.id)
        : undefined;

  // Resultado de anular o descartar (el mismo para los dos): se reparte entre éxito, error de campo y error general.
  // Devuelve true si salió bien (el formulario se puede cerrar) y false si se rechazó (queda abierto con el error).
  async function resolver(r: Awaited<ReturnType<typeof cola.anularLocal>>, pendienteDescartado?: Pendiente): Promise<boolean> {
    if (r.tipo === 'descartado') {
      alDescartado(`Se descartó: ${pendienteDescartado ? textoDePendiente(pendienteDescartado) : 'un pendiente'}`);
      return true;
    }
    const res = r.resultado;
    if (res.tipo === 'enviado') {
      await alAnular(res.avisos, false); // la fila se vuelve a dibujar con su marca de anulado
      return true;
    }
    if (res.tipo === 'pendiente') {
      await alAnular([], true);
      return true;
    }
    const errores = aErroresFormulario(res, ['motivo']);
    setErrorMotivo(errores.campos.motivo);
    setError(errores.general);
    // Si ya la anuló otro o cambió el último evento, se refresca para mostrar lo real.
    if (res.tipo === 'rechazado' && res.origen === 'servidor' && (res.codigo === 404 || res.codigo === 409)) await alRefrescar();
    return false;
  }

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!animal || evento.tipo === 'BAJA') return; // la baja no se anula (no hay botón), se revierte
    const d = new FormData(e.currentTarget);
    setError(null);
    setErrorMotivo(undefined);
    setEnviando(true);
    try {
      // La fila sigue montada aunque la anulación haya salido bien: se cierra el formulario y se la deja lista.
      if (await resolver(await cola.anularLocal({ animal, motivo: String(d.get('motivo')), eventoId: evento.id }))) setAnulando(false);
    } catch {
      setError('No se pudo anular. Probá de nuevo');
    } finally {
      setEnviando(false);
    }
  }

  async function pedirDescarte() {
    if (!aDescartar) return;
    setError(null);
    setPosteriores(await cola.posteriores(aDescartar.id).catch(() => []));
    setConfirmandoDescarte(true);
  }

  async function descartar() {
    if (!aDescartar) return;
    setEnviando(true);
    try {
      // Descartar no lleva motivo: no se crea ninguna anulación, se quita el pendiente.
      await resolver(await cola.anularLocal({ animal: { id: aDescartar.animalId, numero: aDescartar.numero }, motivo: '', eventoId: aDescartar.id }), aDescartar);
    } catch {
      setError('No se pudo descartar. Probá de nuevo');
    } finally {
      setEnviando(false);
      setConfirmandoDescarte(false);
    }
  }

  return (
    <li id={`evento-${evento.id}`} className={anulado ? 'evento evento-anulado' : 'evento'}>
      <p className="evento-titulo">
        <strong>{formatearFecha(evento.fecha)}</strong> · {resumenEvento(evento)}
        {evento.pendiente && <span className="etiqueta-estado etiqueta-pendiente">Pendiente de sincronizar</span>}
        {anulado && <span className="etiqueta-anulado">{evento.tipo === 'BAJA' ? 'Revertida' : 'Anulado'}</span>}
      </p>
      <CuerpoEvento evento={evento} />
      {error && !(anulable && anulando) && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      {anulable && !anulando && (
        <div className="acciones">
          <button type="button" className="boton-secundario boton-peligro" onClick={() => setAnulando(true)}>
            Anular
          </button>
        </div>
      )}
      {aDescartar && !confirmandoDescarte && (
        <div className="acciones">
          <button type="button" className="boton-secundario boton-peligro" onClick={() => void pedirDescarte()}>
            {aDescartar.tipo === 'ANULACION' ? 'Descartar anulación' : 'Descartar'}
          </button>
        </div>
      )}
      {aDescartar && confirmandoDescarte && (
        <Confirmar
          titulo={aDescartar.tipo === 'ANULACION' ? '¿Descartar esta anulación?' : '¿Descartar este pendiente?'}
          confirmarTexto={aDescartar.tipo === 'ANULACION' ? 'Sí, descartar la anulación' : 'Sí, descartar'}
          alConfirmar={() => void descartar()}
          alCancelar={() => setConfirmandoDescarte(false)}
          ocupado={enviando}
        >
          <p>
            Vaca {aDescartar.numero}: {textoDePendiente(aDescartar)} (
            {aDescartar.tipo === 'ANULACION' ? `${resumenEvento(evento)} del ${formatearFecha(evento.fecha)}` : 'todavía no se envió'}).{' '}
            {aDescartar.tipo === 'ANULACION' ? 'El evento sigue vigente y no se envía la anulación.' : 'No se envía al servidor.'}
          </p>
          {posteriores.length > 0 && (
            <>
              <p>Estos pendientes de la misma vaca, cargados después, se van a seguir enviando:</p>
              <ul className="lista-crias">
                {posteriores.map((p) => (
                  <li key={p.id}>{textoDePendiente(p)}</li>
                ))}
              </ul>
            </>
          )}
        </Confirmar>
      )}
      {anulable && anulando && (
        <form className="formulario-lote" onSubmit={confirmar}>
          {error && (
            <div className="alerta" role="alert">
              {error}
            </div>
          )}
          <Campo
            etiqueta="Motivo de la anulación"
            name="motivo"
            id={`motivo-${evento.id}`}
            required
            autoFocus
            maxLength={200}
            ayuda="Obligatorio. El evento no se borra: queda marcado como anulado."
            error={errorMotivo}
          />
          <div className="acciones">
            <button type="submit" className="boton boton-peligro-lleno" disabled={enviando}>
              {enviando ? 'Anulando…' : 'Confirmar anulación'}
            </button>
            <button type="button" className="boton-secundario" onClick={() => setAnulando(false)} disabled={enviando}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

// Detalle de un evento (todo menos el título y los botones): sirve para la lista con "Anular"
// de la ficha y para la lista de solo lectura de la ficha de baja.
function CuerpoEvento({ evento }: { evento: EventoReproductivo }) {
  return (
    <>
      {evento.tacto?.anomalias && <p className="texto-suave">Anomalías: {evento.tacto.anomalias}</p>}
      {evento.parto && <DetalleParto parto={evento.parto} pendiente={!!evento.pendiente} />}
      {evento.secado && (
        <p className="texto-suave">
          Estaba {NOMBRE_ESTADO[evento.secado.estadoAnterior].toLowerCase()} · {textoLoteAnterior(evento.secado.loteAnterior)}
        </p>
      )}
      {evento.baja && (
        <>
          <p className="texto-suave">
            Observaciones: {evento.baja.observaciones ?? 'sin observaciones'}
          </p>
          <p className="texto-suave">
            Estaba {NOMBRE_ESTADO[evento.baja.estadoAnterior].toLowerCase()} · {textoLoteAnterior(evento.baja.loteAnterior)}
          </p>
        </>
      )}
      <p className="texto-suave">Registrado por {evento.registradoPor}</p>
      {evento.anulacion && (
        <p className="texto-suave">
          {evento.tipo === 'BAJA' ? 'Revertida' : 'Anulado'} por {evento.anulacion.por ?? 'sin dato'} el{' '}
          {formatearFecha(fechaArgentinaIso(new Date(evento.anulacion.en)))}. Motivo: {evento.anulacion.motivo}
        </p>
      )}
    </>
  );
}

// Detalle de un parto en la lista: crías, genética y lote previo (RF-38).
function DetalleParto({ parto, pendiente }: { parto: NonNullable<EventoReproductivo['parto']>; pendiente: boolean }) {
  return (
    <>
      <ul className="lista-crias">
        {parto.crias.map((c) => (
          <li key={c.orden}>
            {c.nacidaMuerta ? (
              <>Cría {NOMBRE_SEXO[c.sexo].toLowerCase()} · nacida muerta</>
            ) : !c.animal && pendiente ? (
              // Parto pendiente: la cría todavía no es un animal, así que se muestra el número sin enlace (spec 011, RF-21).
              <>
                Cría {NOMBRE_SEXO[c.sexo].toLowerCase()} · {c.numeroPendiente ?? 'sin número'}
              </>
            ) : !c.animal ? (
              <>Cría {NOMBRE_SEXO[c.sexo].toLowerCase()} · nacida muerta</>
            ) : c.animal.activo ? (
              <>
                Cría {NOMBRE_SEXO[c.sexo].toLowerCase()} ·{' '}
                <Link to={`/animales/${c.animal.id}`} className="enlace-fila">
                  {c.animal.numero}
                </Link>
              </>
            ) : (
              // Dada de baja: por venta o muerte tiene ficha de baja (enlace); por parto anulado, solo el número.
              <>
                Cría {NOMBRE_SEXO[c.sexo].toLowerCase()} ·{' '}
                {c.animal.motivoBaja === 'venta' || c.animal.motivoBaja === 'muerte' ? (
                  <Link to={`/bajas/${c.animal.id}`} className="enlace-fila">
                    {c.animal.numero}
                  </Link>
                ) : (
                  c.animal.numero
                )}{' '}
                · <span className="etiqueta-baja">dada de baja</span>
              </>
            )}
            {c.observaciones && <span className="texto-suave"> · {c.observaciones}</span>}
          </li>
        ))}
      </ul>
      <p className="texto-suave">Genética: {pendiente ? 'se completa al sincronizar' : textoGenetica(parto.genetica)}</p>      <p className="texto-suave">
        Estaba {NOMBRE_ESTADO[parto.estadoAnterior].toLowerCase()} · {textoLoteAnterior(parto.loteAnterior)}
      </p>
    </>
  );
}
