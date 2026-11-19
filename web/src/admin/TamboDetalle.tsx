import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../compartido/api';
import { Campo } from '../compartido/Campo';
import { Confirmar } from '../sinconexion/Confirmar';
import {
  darDeBajaTambo,
  formatearAlta,
  formatearFechaHora,
  MAX_MOTIVO,
  NOMBRE_ROL,
  obtenerTambo,
  reactivarTambo,
  reactivarUsuario,
  restablecerContrasena,
  textoCantidad,
  textoUltimoIngreso,
  validarContrasenaNueva,
  validarMotivo,
  type DetalleTambo,
  type UsuarioTambo,
} from './adminDatos';

// Detalle de un tambo como cuenta (spec 014, RF-18): los datos del listado y todos sus usuarios (activos o no),
// con los dueños destacados. No hay animales, eventos ni litros: el administrador no los ve (RF-19).
// Spec 015: estado del tambo con la baja vigente, dar de baja / reactivar, último ingreso por usuario,
// restablecer contraseña y reactivar usuario.
export function TamboDetalle() {
  const { id = '' } = useParams();
  const [tambo, setTambo] = useState<DetalleTambo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noExiste, setNoExiste] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    setNoExiste(false);
    try {
      setTambo(await obtenerTambo(id));
    } catch (err) {
      setTambo(null);
      if (err instanceof ApiError && err.status === 404) setNoExiste(true);
      else setError(err instanceof ApiError ? err.message : 'No se pudo cargar el tambo');
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const volver = (
    <Link to="/admin" className="admin-volver">
      ← Volver a los tambos
    </Link>
  );

  if (noExiste) {
    return (
      <main className="contenido pantalla-admin">
        {volver}
        <h1>Tambo no encontrado</h1>
        <p className="subtitulo">Ese tambo no existe o el enlace está mal escrito.</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="contenido pantalla-admin">
        {volver}
        <div className="alerta" role="alert">
          {error}{' '}
          <button type="button" className="boton-secundario" onClick={() => void cargar()}>
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  if (!tambo) {
    return (
      <main className="contenido pantalla-admin">
        {volver}
        <p className="subtitulo">Cargando…</p>
      </main>
    );
  }

  const duenos = tambo.usuarios.filter((u) => u.rol === 'DUENO');
  const otros = tambo.usuarios.filter((u) => u.rol !== 'DUENO');

  return (
    <main className="contenido pantalla-admin">
      {volver}
      <h1>{tambo.nombre}</h1>

      <dl className="admin-datos">
        <div>
          <dt>Alta</dt>
          <dd>{formatearAlta(tambo.creadoEn)}</dd>
        </div>
        <div>
          <dt>Usuarios activos</dt>
          <dd>{tambo.usuariosActivos}</dd>
        </div>
        <div>
          <dt>Animales activos</dt>
          <dd>{tambo.animalesActivos}</dd>
        </div>
        <div>
          <dt>Último ingreso</dt>
          <dd className="admin-dato-texto">{textoUltimoIngreso(tambo.ultimoIngreso)}</dd>
        </div>
      </dl>

      <EstadoTambo tambo={tambo} alCambiar={setTambo} />

      <section className="seccion">
        <h2>{duenos.length === 1 ? 'Dueño' : 'Dueños'}</h2>
        {duenos.length === 0 ? (
          <p className="subtitulo">Este tambo no tiene dueños.</p>
        ) : (
          <>
            {duenos.length > 1 && (
              <p className="subtitulo">
                {textoCantidad(duenos.length, 'dueño', 'dueños')}: cada uno ingresa de forma independiente.
              </p>
            )}
            <ul className="admin-usuarios">
              {duenos.map((u) => (
                <TarjetaUsuario key={u.id} tambo={tambo} usuario={u} alCambiar={setTambo} destacado />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="seccion">
        <h2>Otros usuarios</h2>
        {otros.length === 0 ? (
          <p className="subtitulo">No hay otros usuarios.</p>
        ) : (
          <ul className="admin-usuarios">
            {otros.map((u) => (
              <TarjetaUsuario key={u.id} tambo={tambo} usuario={u} alCambiar={setTambo} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

// Texto de un error de la API (o genérico). Sin conexión llega "Esto necesita conexión".
const textoError = (err: unknown) => (err instanceof ApiError ? err.message : 'Error inesperado');

// Estado del tambo (spec 015, RF-2, RF-4 a RF-6, RF-14, RF-35). El motivo es texto libre: React lo escapa,
// nunca se usa dangerouslySetInnerHTML.
function EstadoTambo({ tambo, alCambiar }: { tambo: DetalleTambo; alCambiar: (t: DetalleTambo) => void }) {
  const [formulario, setFormulario] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | undefined>();
  const [confirmando, setConfirmando] = useState<string | null>(null); // motivo ya recortado, esperando "Confirmar"
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deBaja = tambo.estado === 'BAJA';
  const cambio = tambo.ultimoCambioEstado;

  function pedirConfirmacion(e: FormEvent) {
    e.preventDefault();
    const r = validarMotivo(motivo);
    setErrorMotivo(r.error ?? undefined);
    if (!r.error) setConfirmando(r.motivo);
  }

  async function ejecutar(accion: () => Promise<DetalleTambo>) {
    setOcupado(true);
    setError(null);
    try {
      alCambiar(await accion());
      setFormulario(false);
      setMotivo('');
      setConfirmando(null);
    } catch (err) {
      setError(textoError(err));
      setConfirmando(null);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="seccion" aria-labelledby="titulo-estado">
      <h2 id="titulo-estado">Estado</h2>
      <p className="admin-estado">
        <span className={deBaja ? 'etiqueta-estado etiqueta-rechazado' : 'etiqueta-estado etiqueta-enviado'}>{deBaja ? 'Dado de baja' : 'Activo'}</span>
      </p>
      {cambio && (
        <p className="texto-suave admin-cambio">
          {cambio.tipo === 'BAJA' ? 'Dado de baja' : 'Reactivado'} por {cambio.por} el {formatearFechaHora(cambio.en)}.
          {cambio.tipo === 'BAJA' && cambio.motivo !== null && (
            <>
              {' '}
              Motivo: <span className="admin-motivo">{cambio.motivo}</span>
            </>
          )}
        </p>
      )}

      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}

      {deBaja ? (
        <>
          <p className="subtitulo">Sus usuarios no pueden ingresar. Para restablecer contraseñas o reactivar usuarios, primero reactivá el tambo.</p>
          <div className="acciones">
            <button type="button" className="boton" disabled={ocupado} onClick={() => void ejecutar(() => reactivarTambo(tambo.id))}>
              {ocupado ? 'Reactivando…' : 'Reactivar tambo'}
            </button>
          </div>
        </>
      ) : confirmando !== null ? (
        <Confirmar
          titulo={`¿Dar de baja ${tambo.nombre}?`}
          confirmarTexto="Confirmar"
          alConfirmar={() => void ejecutar(() => darDeBajaTambo(tambo.id, confirmando))}
          alCancelar={() => setConfirmando(null)}
          ocupado={ocupado}
        >
          <p>Todos sus usuarios van a perder el acceso y se les cierran las sesiones. No se borra ningún dato y se puede reactivar.</p>
          <p className="texto-suave">
            Motivo: <span className="admin-motivo">{confirmando}</span>
          </p>
        </Confirmar>
      ) : formulario ? (
        <form className="admin-formulario" onSubmit={pedirConfirmacion} noValidate>
          <Campo
            etiqueta="Motivo de la baja"
            name="motivo"
            autoComplete="off"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            ayuda={`${Array.from(motivo.trim()).length}/${MAX_MOTIVO}`}
            error={errorMotivo}
            autoFocus
          />
          <div className="acciones">
            <button type="submit" className="boton boton-peligro-lleno">
              Dar de baja
            </button>
            <button
              type="button"
              className="boton-secundario"
              onClick={() => {
                setFormulario(false);
                setErrorMotivo(undefined);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="acciones">
          <button type="button" className="boton-secundario boton-peligro" onClick={() => setFormulario(true)}>
            Dar de baja
          </button>
        </div>
      )}
    </section>
  );
}

function TarjetaUsuario({
  tambo,
  usuario,
  alCambiar,
  destacado = false,
}: {
  tambo: DetalleTambo;
  usuario: UsuarioTambo;
  alCambiar: (t: DetalleTambo) => void;
  destacado?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [password, setPassword] = useState('');
  const [errorPassword, setErrorPassword] = useState<string | undefined>();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);
  const tamboActivo = tambo.estado === 'ACTIVO';

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const eP = validarContrasenaNueva(password);
    setErrorPassword(eP ?? undefined);
    if (eP) return;
    setOcupado(true);
    setError(null);
    try {
      await restablecerContrasena(tambo.id, usuario.id, password);
      // RF-36: el valor se limpia y la confirmación es fija: no repite la contraseña.
      setPassword('');
      setAbierto(false);
      setHecho(true);
    } catch (err) {
      setError(textoError(err));
    } finally {
      setOcupado(false);
    }
  }

  async function reactivar() {
    setOcupado(true);
    setError(null);
    setHecho(false);
    try {
      alCambiar(await reactivarUsuario(tambo.id, usuario.id));
    } catch (err) {
      setError(textoError(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className={destacado ? 'admin-usuario admin-usuario-dueno' : 'admin-usuario'}>
      <div className="admin-usuario-datos">
        <strong>{usuario.nombre}</strong>
        <span className="texto-suave">{usuario.email}</span>
        <span className="texto-suave">Último ingreso: {textoUltimoIngreso(usuario.ultimoIngreso)}</span>
      </div>
      <div className="admin-usuario-marcas">
        <span className="etiqueta-estado">{NOMBRE_ROL[usuario.rol]}</span>
        <span className={usuario.activo ? 'etiqueta-estado etiqueta-enviado' : 'etiqueta-estado etiqueta-rechazado'}>
          {usuario.activo ? 'Activo' : 'Inactivo'}
        </span>
      </div>

      {tamboActivo && (
        <div className="admin-usuario-acciones">
          {error && (
            <div className="alerta" role="alert">
              {error}
            </div>
          )}
          {hecho && (
            <p className="resultado-ok" role="status">
              Contraseña restablecida
            </p>
          )}
          {abierto ? (
            <form className="admin-formulario" onSubmit={guardar} noValidate>
              <Campo
                etiqueta={`Contraseña nueva de ${usuario.nombre}`}
                id={`pass-${usuario.id}`}
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                ayuda="Mínimo 10 caracteres. Pasásela al usuario por otro medio."
                error={errorPassword}
                autoFocus
              />
              <div className="acciones">
                <button type="submit" className="boton" disabled={ocupado}>
                  {ocupado ? 'Guardando…' : 'Guardar contraseña'}
                </button>
                <button
                  type="button"
                  className="boton-secundario"
                  onClick={() => {
                    setAbierto(false);
                    setPassword('');
                    setErrorPassword(undefined);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <div className="acciones">
              <button
                type="button"
                className="boton-secundario"
                onClick={() => {
                  setAbierto(true);
                  setHecho(false);
                }}
              >
                Restablecer contraseña
              </button>
              {!usuario.activo && (
                <button type="button" className="boton-secundario" disabled={ocupado} onClick={() => void reactivar()}>
                  Reactivar usuario
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
