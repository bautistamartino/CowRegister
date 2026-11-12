import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth';
import { api, ApiError, type AltaAnimal, type EstadoAnimal, type Sexo } from '../api';
import { Campo } from '../componentes/Campo';
import { ESTADOS_INICIALES, NOMBRE_ESTADO, NOMBRE_SEXO, puedeCargar, textoAvisoNumeroDeBaja } from '../animales';

// "Hoy" en formato AAAA-MM-DD (hora local) para el `max` del campo de fecha.
function hoy(): string {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

// Alta manual de un animal (RF-1 a RF-8). El número puede venir precargado desde
// el buscador (?numero=X). Al guardar se abre la ficha.
export function AnimalNuevo() {
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [numero, setNumero] = useState(params.get('numero') ?? '');
  const [sexo, setSexo] = useState<Sexo>('HEMBRA');
  const [estado, setEstado] = useState<EstadoAnimal>('VAQUILLONA');
  const [fecha, setFecha] = useState('');
  const [madre, setMadre] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  if (!usuario) return null;
  if (!puedeCargar(usuario.rol)) {
    return (
      <main className="contenido">
        <h1>Nuevo animal</h1>
        <p className="alerta" role="alert">
          No tenés permiso para dar de alta animales.
        </p>
        <Link to="/animales">Volver a Animales</Link>
      </main>
    );
  }

  // Un macho solo puede ser recién nacido (RF-5): al elegir macho se fija el estado.
  function cambiarSexo(nuevo: Sexo) {
    setSexo(nuevo);
    if (nuevo === 'MACHO') setEstado('RECIEN_NACIDO');
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setErrores({});
    setGeneral(null);
    setGuardando(true);
    try {
      const body: Record<string, unknown> = { numero, sexo, estado };
      if (fecha) body.fechaNacimiento = fecha;
      if (madre.trim()) body.madre = madre;
      const r = await api<AltaAnimal>('/animales', { method: 'POST', body });
      // El aviso de "sin lote" se muestra en la ficha, que es adonde se navega.
      // El aviso de número de un animal de baja (RF-14) también: se guarda igual y se avisa una sola vez.
      navigate(`/animales/${r.animal.id}`, {
        state: {
          avisoSinLote: r.avisoSinLote,
          avisoNumero: r.avisoNumeroDeBaja ? textoAvisoNumeroDeBaja(r.animal.numero, r.avisoNumeroDeBaja) : null,
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.detalles.length) {
        setErrores(Object.fromEntries(err.detalles.map((d) => [d.campo, d.mensaje])));
      } else if (!(err instanceof ApiError && err.status === 401)) {
        // 409 (número repetido entre los activos, o el lote destino ya no existe) y el resto.
        setGeneral(err instanceof ApiError ? err.message : 'No se pudo guardar el animal');
      }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <main className="contenido pantalla-lotes">
      <h1>Nuevo animal</h1>
      <form className="formulario-lote formulario-ancho" onSubmit={guardar} noValidate>
        {general && (
          <div className="alerta" role="alert">
            {general}
          </div>
        )}
        <Campo
          etiqueta="Número (caravana o botón)"
          name="numero"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          error={errores.numero}
          ayuda="Letras sin tildes, números, guion y punto. Hasta 20 caracteres."
          autoComplete="off"
          maxLength={40}
        />
        <div className="campo">
          <label htmlFor="sexo">Sexo</label>
          <select id="sexo" value={sexo} onChange={(e) => cambiarSexo(e.target.value as Sexo)}>
            {(Object.keys(NOMBRE_SEXO) as Sexo[]).map((s) => (
              <option key={s} value={s}>
                {NOMBRE_SEXO[s]}
              </option>
            ))}
          </select>
          {errores.sexo && <span className="campo-error">{errores.sexo}</span>}
        </div>
        <div className="campo">
          <label htmlFor="estado">Estado</label>
          <select id="estado" value={estado} onChange={(e) => setEstado(e.target.value as EstadoAnimal)}>
            {ESTADOS_INICIALES.map((s) => (
              <option key={s} value={s} disabled={sexo === 'MACHO' && s !== 'RECIEN_NACIDO'}>
                {NOMBRE_ESTADO[s]}
              </option>
            ))}
          </select>
          {errores.estado ? (
            <span className="campo-error">{errores.estado}</span>
          ) : (
            sexo === 'MACHO' && <span className="campo-ayuda">Un macho solo puede cargarse como recién nacido.</span>
          )}
        </div>
        <Campo
          etiqueta="Fecha de nacimiento (opcional)"
          name="fechaNacimiento"
          type="date"
          min="2000-01-01"
          max={hoy()}
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          error={errores.fechaNacimiento}
        />
        <Campo
          etiqueta="Número de la madre (opcional)"
          name="madre"
          value={madre}
          onChange={(e) => setMadre(e.target.value)}
          error={errores.madre}
          autoComplete="off"
          maxLength={40}
        />
        <div className="acciones">
          <button type="submit" className="boton" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar animal'}
          </button>
          <Link to="/animales" className="boton-secundario enlace-boton">
            Cancelar
          </Link>
        </div>
      </form>
    </main>
  );
}
