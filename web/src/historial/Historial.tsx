import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type Aviso, type CampoCambio, type EventoReproductivo, type RespuestaHistorial } from '../compartido/api';
import { useAuth } from '../sesion/auth';
import { formatearFecha, NOMBRE_ESTADO, NOMBRE_SEXO } from '../animales/animalesDatos';
import { fechaArgentinaIso, interpretar, resumenEvento, textoGenetica, textoLoteAnterior } from '../reproduccion/reproduccionDatos';
import { Campo } from '../compartido/Campo';
import { useEnLinea } from '../sinconexion/useConexion';
import { NotaNecesitaConexion, TEXTO_NECESITA_CONEXION } from '../sinconexion/NecesitaConexion';

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
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

type Props = {
  animalId: string;
  // 'animales' = ficha de un animal activo; 'bajas' = ficha de baja (solo lectura, sin "Anular").
  contexto: 'animales' | 'bajas';
  // Sube cuando hay que volver a leer el historial (se registró, anuló, editó o movió algo).
  version: number;
  // Solo la ficha de una hembra activa anula: avisa a la pantalla para que relea situación y ficha.
  alAnular?: (tipo: EventoReproductivo['tipo'], avisos: Aviso[]) => Promise<void>;
  // Relee todo sin cartel de éxito (se usa cuando la anulación falla con 404 o 409).
  alRefrescar?: () => Promise<void>;
};

// Historial único de la ficha (spec 007): eventos y cambios manuales en una sola línea de tiempo,
// armada y ordenada por la API (más reciente primero). Lo ven los tres roles.
export function Historial({ animalId, contexto, version, alAnular, alRefrescar }: Props) {
  const [datos, setDatos] = useState<RespuestaHistorial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { usuario } = useAuth();
  // Sin conexión el historial sale de la copia local; al cambiar la conexión se relee (spec 009).
  const enLinea = useEnLinea();
  // El veterinario solo anula servicios y tactos (RF-43); la API igual responde 403.
  const puedeAnularTodo = !!usuario && usuario.rol !== 'VETERINARIO';

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
  }, [animalId, contexto, version, enLinea]);

  return (
    <section className="seccion">
      <h2>Historial</h2>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      {!error && !datos && <p className="subtitulo">Cargando…</p>}
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
              // "Anular" solo en el último evento no anulado (lo calcula la API, aunque quede fuera del tope),
              // nunca en la ficha de baja ni en una baja; el veterinario solo en servicio o tacto.
              const anulable =
                contexto === 'animales' &&
                !!alAnular &&
                e.id === datos.ultimoEventoNoAnuladoId &&
                (e.tipo === 'SERVICIO' || e.tipo === 'TACTO' || puedeAnularTodo);
              return (
                <FilaEvento
                  key={`evento-${e.id}`}
                  evento={e}
                  anulable={anulable}
                  alAnular={(avisos) => (alAnular ? alAnular(e.tipo, avisos) : Promise.resolve())}
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

// ─── Una fila de evento, con la anulación (se mueve acá desde Reproduccion, spec 007) ───

function FilaEvento({
  evento,
  anulable,
  alAnular,
  alRefrescar,
}: {
  evento: EventoReproductivo;
  anulable: boolean;
  alAnular: (avisos: Aviso[]) => Promise<void>;
  // Solo relee eventos y ficha, sin cartel de éxito (se usa cuando la anulación falla).
  alRefrescar: () => Promise<void>;
}) {
  const [anulando, setAnulando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorMotivo, setErrorMotivo] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);
  const enLinea = useEnLinea(); // anular necesita conexión (spec 009, RF-13)
  const anulado = evento.anulacion !== null;

  async function confirmar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setError(null);
    setErrorMotivo(undefined);
    setEnviando(true);
    try {
      if (evento.tipo === 'BAJA') return; // la baja no se anula (no hay botón), se revierte
      const ruta = { SERVICIO: 'servicios', TACTO: 'tactos', PARTO: 'partos', SECADO: 'secados' }[evento.tipo];
      // Parto y secado devuelven { evento, avisos }; servicio y tacto, el evento a secas.
      const r = await api<{ avisos?: Aviso[] }>(`/${ruta}/${evento.id}/anular`, { method: 'POST', body: { motivo: String(d.get('motivo')) } });
      await alAnular(r.avisos ?? []); // la fila se vuelve a dibujar con su marca de anulado
    } catch (err) {
      const r = interpretar(err);
      setErrorMotivo(r.campos.motivo);
      setError(r.general);
      setEnviando(false);
      // Si ya la anuló otro o cambió el último evento, se refresca para mostrar lo real.
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) await alRefrescar();
    }
  }

  return (
    <li id={`evento-${evento.id}`} className={anulado ? 'evento evento-anulado' : 'evento'}>
      <p className="evento-titulo">
        <strong>{formatearFecha(evento.fecha)}</strong> · {resumenEvento(evento)}
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
          <button
            type="button"
            className="boton-secundario boton-peligro necesita-conexion"
            disabled={!enLinea}
            title={enLinea ? undefined : TEXTO_NECESITA_CONEXION}
            onClick={() => setAnulando(true)}
          >
            Anular
          </button>
          {!enLinea && <NotaNecesitaConexion />}
        </div>
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
      {evento.parto && <DetalleParto parto={evento.parto} />}
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
function DetalleParto({ parto }: { parto: NonNullable<EventoReproductivo['parto']> }) {
  return (
    <>
      <ul className="lista-crias">
        {parto.crias.map((c) => (
          <li key={c.orden}>
            {c.nacidaMuerta || !c.animal ? (
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
      <p className="texto-suave">Genética: {textoGenetica(parto.genetica)}</p>
      <p className="texto-suave">
        Estaba {NOMBRE_ESTADO[parto.estadoAnterior].toLowerCase()} · {textoLoteAnterior(parto.loteAnterior)}
      </p>
    </>
  );
}
