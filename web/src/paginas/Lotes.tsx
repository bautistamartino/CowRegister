import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { api, ApiError, type EstadoConDestino, type Lote, type ReglaLote } from '../api';
import { Campo } from '../componentes/Campo';

// Orden y nombres en español de los estados que tienen destino (RF-11).
// Es el mismo orden en que la API devuelve los destinos.
const ESTADOS: EstadoConDestino[] = ['RECIEN_NACIDO', 'VAQUILLONA', 'EN_ORDENE', 'SECA'];
const NOMBRE_ESTADO: Record<EstadoConDestino, string> = {
  RECIEN_NACIDO: 'Recién nacido',
  VAQUILLONA: 'Vaquillona',
  EN_ORDENE: 'En ordeñe',
  SECA: 'Seca',
};

// Errores por campo de un formulario de lote: { nombre?: "...", descripcion?: "..." }.
type ErroresCampo = Record<string, string>;

// Traduce un error de la API a errores por campo o a un mensaje general.
// - 400 con `detalles`: cada mensaje va debajo de su campo.
// - 409 "Ya existe un lote con ese nombre": es un problema del nombre, va debajo de ese campo.
// - Cualquier otro: mensaje general.
function interpretarError(err: unknown): { campos: ErroresCampo; general: string | null } {
  if (err instanceof ApiError && err.detalles.length) {
    return { campos: Object.fromEntries(err.detalles.map((d) => [d.campo, d.mensaje])), general: null };
  }
  if (err instanceof ApiError && err.status === 409) {
    return { campos: { nombre: err.message }, general: null };
  }
  return { campos: {}, general: err instanceof ApiError ? err.message : 'Error inesperado' };
}

// "1 animal" / "3 animales".
function textoAnimales(cantidad: number) {
  return `${cantidad} ${cantidad === 1 ? 'animal' : 'animales'}`;
}

// Pantalla Lotes, de arriba hacia abajo: avisos de estados sin destino, destino de cada
// estado, formulario de alta y lista de lotes. El veterinario la ve en modo lectura (RF-21).
export function Lotes() {
  const { usuario } = useAuth();
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [reglas, setReglas] = useState<ReglaLote[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  // Trae lotes y destinos juntos. Se llama al abrir la pantalla y después de cada
  // cambio, porque un cambio en uno afecta al otro (por ejemplo, "Destino de: …" en
  // la tarjeta depende de los destinos, y el select de destinos lista los lotes).
  const recargar = useCallback(async () => {
    try {
      const [nuevosLotes, nuevasReglas] = await Promise.all([
        api<Lote[]>('/lotes'),
        api<ReglaLote[]>('/reglas-lote'),
      ]);
      setLotes(nuevosLotes);
      setReglas(nuevasReglas);
      setErrorCarga(null);
    } catch (err) {
      setErrorCarga(err instanceof ApiError ? err.message : 'No se pudieron cargar los lotes');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (!usuario) return null;
  // El permiso real lo controla la API (403); acá solo se esconden los controles.
  const puedeEditar = usuario.rol !== 'VETERINARIO';

  if (cargando) {
    return (
      <main className="contenido">
        <h1>Lotes</h1>
        <p className="subtitulo">Cargando…</p>
      </main>
    );
  }

  const sinDestino = reglas.filter((r) => r.lote === null);

  return (
    <main className="contenido pantalla-lotes">
      <h1>Lotes</h1>

      {errorCarga && (
        <div className="alerta" role="alert">
          {errorCarga}
        </div>
      )}

      {/* Avisos (RF-14). El contenedor con role="status" está siempre, aunque esté vacío,
          para que el lector de pantalla anuncie los avisos que aparecen después de un cambio. */}
      <div role="status" className="avisos">
        {sinDestino.map((r) => (
          <p key={r.estado} className="aviso">
            {NOMBRE_ESTADO[r.estado]} no tiene lote destino
          </p>
        ))}
      </div>

      <Destinos reglas={reglas} lotes={lotes} puedeEditar={puedeEditar} alCambiar={recargar} />

      {puedeEditar && <NuevoLote alCrear={recargar} />}

      <section className="seccion">
        <h2>Lotes del tambo</h2>
        {lotes.length === 0 ? (
          <p className="subtitulo">Todavía no hay lotes.</p>
        ) : (
          <ul className="lista-lotes">
            {lotes.map((lote) => (
              <TarjetaLote key={lote.id} lote={lote} puedeEditar={puedeEditar} alCambiar={recargar} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

// ─── Destino de cada estado (RF-11 a RF-13, RF-15) ───

function Destinos({
  reglas,
  lotes,
  puedeEditar,
  alCambiar,
}: {
  reglas: ReglaLote[];
  lotes: Lote[];
  puedeEditar: boolean;
  alCambiar: () => Promise<void>;
}) {
  const [guardando, setGuardando] = useState<EstadoConDestino | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Elegir un lote hace PUT; elegir "Sin destino" (valor "") hace DELETE.
  async function cambiar(estado: EstadoConDestino, loteId: string) {
    setError(null);
    setGuardando(estado);
    try {
      if (loteId) {
        await api(`/reglas-lote/${estado}`, { method: 'PUT', body: { loteId } });
      } else {
        await api(`/reglas-lote/${estado}`, { method: 'DELETE' });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el destino');
    } finally {
      // Se recarga también si falló (por ejemplo, el lote lo eliminó otro usuario),
      // así el select vuelve a mostrar lo que realmente está guardado.
      await alCambiar();
      setGuardando(null);
    }
  }

  return (
    <section className="seccion">
      <h2>Destino de cada estado</h2>
      <p className="subtitulo">A qué lote va un animal cuando pasa a cada estado.</p>

      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}

      <div className="destinos">
        {ESTADOS.map((estado) => {
          const lote = reglas.find((r) => r.estado === estado)?.lote ?? null;
          const id = `destino-${estado}`;

          // Veterinario: el destino como texto, sin select (RF-21).
          if (!puedeEditar) {
            return (
              <div key={estado} className="destino-lectura">
                <span className="destino-estado">{NOMBRE_ESTADO[estado]}</span>
                <span className={lote ? undefined : 'texto-suave'}>{lote ? lote.nombre : 'Sin destino'}</span>
              </div>
            );
          }

          return (
            <div key={estado} className="campo">
              <label htmlFor={id}>{NOMBRE_ESTADO[estado]}</label>
              <select
                id={id}
                value={lote?.id ?? ''}
                disabled={guardando !== null}
                onChange={(e) => void cambiar(estado, e.target.value)}
              >
                <option value="">Sin destino</option>
                {lotes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nombre}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Alta de lote (RF-2, RF-4 a RF-6, RF-27) ───

function NuevoLote({ alCrear }: { alCrear: () => Promise<void> }) {
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formulario = e.currentTarget; // se guarda antes del await para poder vaciarlo después
    const datos = new FormData(formulario);

    setErrores({});
    setError(null);
    setEnviando(true);
    try {
      // La normalización (espacios, NFC) y los límites los aplica la API.
      await api<Lote>('/lotes', {
        method: 'POST',
        body: { nombre: String(datos.get('nombre')), descripcion: String(datos.get('descripcion')) },
      });
      formulario.reset();
      await alCrear();
    } catch (err) {
      const { campos, general } = interpretarError(err);
      setErrores(campos);
      setError(general);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="seccion">
      <h2>Nuevo lote</h2>
      <form className="formulario-lote" onSubmit={enviar}>
        {error && (
          <div className="alerta" role="alert">
            {error}
          </div>
        )}
        <Campo etiqueta="Nombre" name="nombre" id="nuevo-nombre" required ayuda="Hasta 50 caracteres" error={errores.nombre} />
        <CampoDescripcion id="nuevo-descripcion" error={errores.descripcion} />
        <div className="acciones">
          <button type="submit" className="boton" disabled={enviando}>
            {enviando ? 'Creando…' : 'Crear lote'}
          </button>
        </div>
      </form>
    </section>
  );
}

// Campo de descripción (textarea). Campo.tsx solo dibuja <input>, así que este arma
// la misma estructura (.campo, etiqueta, error o ayuda) con un <textarea>.
function CampoDescripcion({ id, error, valorInicial }: { id: string; error?: string; valorInicial?: string }) {
  return (
    <div className="campo">
      <label htmlFor={id}>Descripción (opcional)</label>
      <textarea id={id} name="descripcion" rows={2} defaultValue={valorInicial} aria-invalid={!!error} />
      {error ? <span className="campo-error">{error}</span> : <span className="campo-ayuda">Hasta 200 caracteres</span>}
    </div>
  );
}

// ─── Tarjeta de un lote: ver, editar y eliminar (RF-1, RF-3, RF-7 a RF-10) ───

function TarjetaLote({
  lote,
  puedeEditar,
  alCambiar,
}: {
  lote: Lote;
  puedeEditar: boolean;
  alCambiar: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);

    setErrores({});
    setError(null);
    setOcupado(true);
    try {
      // Una descripción vacía la borra: la API la guarda como "sin descripción" (RF-27).
      await api<Lote>(`/lotes/${lote.id}`, {
        method: 'PATCH',
        body: { nombre: String(datos.get('nombre')), descripcion: String(datos.get('descripcion')) },
      });
      setEditando(false);
      await alCambiar();
    } catch (err) {
      const { campos, general } = interpretarError(err);
      setErrores(campos);
      setError(general);
    } finally {
      setOcupado(false);
    }
  }

  async function eliminar() {
    // Confirmación antes de eliminar (RF-10). Ver Decisiones del plan: window.confirm.
    if (!window.confirm(`¿Eliminar el lote "${lote.nombre}"?`)) return;

    setError(null);
    setOcupado(true);
    try {
      await api(`/lotes/${lote.id}`, { method: 'DELETE' });
      await alCambiar(); // la tarjeta desaparece al recargar la lista
    } catch (err) {
      // 409: la API explica el motivo ("El lote tiene 3 animales y es destino de En ordeñe").
      setError(err instanceof ApiError ? err.message : 'No se pudo eliminar el lote');
      setOcupado(false);
    }
  }

  function cancelar() {
    setEditando(false);
    setErrores({});
    setError(null);
  }

  const alerta = error && (
    <div className="alerta" role="alert">
      {error}
    </div>
  );

  if (editando) {
    return (
      <li className="tarjeta-lote">
        <form className="formulario-lote" onSubmit={guardar}>
          {alerta}
          <Campo
            etiqueta="Nombre"
            name="nombre"
            id={`nombre-${lote.id}`}
            defaultValue={lote.nombre}
            required
            autoFocus
            error={errores.nombre}
          />
          <CampoDescripcion id={`descripcion-${lote.id}`} valorInicial={lote.descripcion ?? ''} error={errores.descripcion} />
          <div className="acciones">
            <button type="submit" className="boton" disabled={ocupado}>
              {ocupado ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="boton-secundario" onClick={cancelar} disabled={ocupado}>
              Cancelar
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="tarjeta-lote">
      <h3>{lote.nombre}</h3>
      <p className={lote.descripcion ? undefined : 'texto-suave'}>{lote.descripcion ?? 'Sin descripción'}</p>
      <p className="texto-suave">
        {textoAnimales(lote.cantidadAnimales)}
        {lote.destinoDe.length > 0 && <> · Destino de: {lote.destinoDe.map((e) => NOMBRE_ESTADO[e]).join(', ')}</>}
      </p>
      {alerta}
      {puedeEditar && (
        <div className="acciones">
          <button type="button" className="boton-secundario" onClick={() => setEditando(true)} disabled={ocupado}>
            Editar
          </button>
          <button type="button" className="boton-secundario boton-peligro" onClick={() => void eliminar()} disabled={ocupado}>
            Eliminar
          </button>
        </div>
      )}
    </li>
  );
}
