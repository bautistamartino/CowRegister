import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../sesion/auth';
import { api, ApiError, type SemenToro } from '../compartido/api';
import { Campo } from '../compartido/Campo';

type ErroresCampo = Record<string, string>;

// 400 con detalles: cada mensaje va bajo su campo. 409 (nombre repetido): bajo "nombre".
// Cualquier otro error: mensaje general. Los mensajes vienen de la API, en español.
function interpretarError(err: unknown): { campos: ErroresCampo; general: string | null } {
  if (err instanceof ApiError && err.detalles.length) {
    return { campos: Object.fromEntries(err.detalles.map((d) => [d.campo, d.mensaje])), general: null };
  }
  if (err instanceof ApiError && err.status === 409) return { campos: { nombre: err.message }, general: null };
  return { campos: {}, general: err instanceof ApiError ? err.message : 'Error inesperado' };
}

// Pantalla "Semen y toros": catálogo del tambo. Dueño y encargado lo modifican;
// el veterinario lo ve en modo lectura (RF-28).
export function SemenToros() {
  const { usuario } = useAuth();
  const [entradas, setEntradas] = useState<SemenToro[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    try {
      setEntradas(await api<SemenToro[]>('/semen'));
      setErrorCarga(null);
    } catch (err) {
      setErrorCarga(err instanceof ApiError ? err.message : 'No se pudo cargar el catálogo');
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
        <h1>Semen y toros</h1>
        <p className="subtitulo">Cargando…</p>
      </main>
    );
  }

  return (
    <main className="contenido pantalla-lotes">
      <h1>Semen y toros</h1>
      <p className="subtitulo">Catálogo para elegir en los servicios. Lo desactivado no se ofrece, pero se conserva en el historial.</p>

      {errorCarga && (
        <div className="alerta" role="alert">
          {errorCarga}
        </div>
      )}

      {puedeEditar && <NuevoSemen alCrear={recargar} />}

      <section className="seccion">
        <h2>Catálogo del tambo</h2>
        {entradas.length === 0 ? (
          <p className="subtitulo">Todavía no hay semen ni toros cargados.</p>
        ) : (
          <ul className="lista-lotes">
            {entradas.map((e) => (
              <TarjetaSemen key={e.id} entrada={e} puedeEditar={puedeEditar} alCambiar={recargar} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function NuevoSemen({ alCrear }: { alCrear: () => Promise<void> }) {
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formulario = e.currentTarget;
    const datos = new FormData(formulario);
    setErrores({});
    setError(null);
    setEnviando(true);
    try {
      // La normalización y los límites los aplica la API; una raza vacía es "sin raza".
      await api<SemenToro>('/semen', { method: 'POST', body: { nombre: String(datos.get('nombre')), raza: String(datos.get('raza')) } });
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
      <h2>Nuevo semen o toro</h2>
      <form className="formulario-lote" onSubmit={enviar}>
        {error && (
          <div className="alerta" role="alert">
            {error}
          </div>
        )}
        <Campo etiqueta="Nombre" name="nombre" id="semen-nuevo-nombre" required ayuda="Hasta 50 caracteres" error={errores.nombre} />
        <Campo etiqueta="Raza (opcional)" name="raza" id="semen-nuevo-raza" error={errores.raza} />
        <div className="acciones">
          <button type="submit" className="boton" disabled={enviando}>
            {enviando ? 'Creando…' : 'Agregar al catálogo'}
          </button>
        </div>
      </form>
    </section>
  );
}

function TarjetaSemen({ entrada, puedeEditar, alCambiar }: { entrada: SemenToro; puedeEditar: boolean; alCambiar: () => Promise<void> }) {
  const [editando, setEditando] = useState(false);
  const [errores, setErrores] = useState<ErroresCampo>({});
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // PATCH común a guardar, desactivar y reactivar.
  async function modificar(cuerpo: Record<string, unknown>, alTerminar?: () => void) {
    setErrores({});
    setError(null);
    setOcupado(true);
    try {
      await api<SemenToro>(`/semen/${entrada.id}`, { method: 'PATCH', body: cuerpo });
      alTerminar?.();
      await alCambiar();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        await alCambiar();
        return;
      }
      const { campos, general } = interpretarError(err);
      setErrores(campos);
      setError(general);
    } finally {
      setOcupado(false);
    }
  }

  function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    void modificar({ nombre: String(datos.get('nombre')), raza: String(datos.get('raza')) }, () => setEditando(false));
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
          <Campo etiqueta="Nombre" name="nombre" id={`semen-nombre-${entrada.id}`} defaultValue={entrada.nombre} required autoFocus error={errores.nombre} />
          <Campo etiqueta="Raza (opcional)" name="raza" id={`semen-raza-${entrada.id}`} defaultValue={entrada.raza ?? ''} error={errores.raza} />
          <div className="acciones">
            <button type="submit" className="boton" disabled={ocupado}>
              {ocupado ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              className="boton-secundario"
              disabled={ocupado}
              onClick={() => {
                setEditando(false);
                setErrores({});
                setError(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="tarjeta-lote">
      <h3>{entrada.nombre}</h3>
      <p className={entrada.raza ? undefined : 'texto-suave'}>{entrada.raza ?? 'Sin raza'}</p>
      {/* El estado se dice con texto, no solo con color. */}
      <p className={entrada.activo ? undefined : 'texto-suave'}>{entrada.activo ? 'Activo' : 'Desactivado'}</p>
      {alerta}
      {puedeEditar && (
        <div className="acciones">
          <button type="button" className="boton-secundario" onClick={() => setEditando(true)} disabled={ocupado}>
            Editar
          </button>
          <button type="button" className="boton-secundario" onClick={() => void modificar({ activo: !entrada.activo })} disabled={ocupado}>
            {entrada.activo ? 'Desactivar' : 'Reactivar'}
          </button>
        </div>
      )}
    </li>
  );
}
