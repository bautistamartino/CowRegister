import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth';
import {
  api,
  ApiError,
  type ResultadoPlanilla,
  type SinLotePorEstado,
  type VistaPreviaPlanilla,
} from '../api';
import { NOMBRE_ESTADO, NOMBRE_SEXO, formatearFecha, puedeCargar, textoAnimales, textoAvisoNumeroDeBaja } from '../animales';

// "3 en estado recién nacido, 2 en estado seca" para el aviso de animales sin lote.
function textoSinLote(lista: SinLotePorEstado[]): string {
  return lista.map((s) => `${s.cantidad} en estado ${NOMBRE_ESTADO[s.estado].toLowerCase()}`).join(', ');
}

// Carga del rodeo pegando filas desde una planilla (RF-11 a RF-22).
// Flujo: pegar -> "Ver vista previa" (no guarda nada) -> corregir si hace falta -> "Confirmar".
// El texto vive solo acá, en la pantalla: nunca se guarda nada en el servidor hasta confirmar.
export function AnimalesPlanilla() {
  const { usuario } = useAuth();
  const [texto, setTexto] = useState('');
  const [vista, setVista] = useState<VistaPreviaPlanilla | null>(null);
  // El texto exacto con el que se pidió la vista previa: si el usuario lo edita después,
  // la vista queda desactualizada y no se puede confirmar hasta volver a previsualizar.
  const [textoVisto, setTextoVisto] = useState('');
  const [resultado, setResultado] = useState<ResultadoPlanilla | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  if (!usuario) return null;
  if (!puedeCargar(usuario.rol)) {
    return (
      <main className="contenido">
        <h1>Cargar desde planilla</h1>
        <p className="alerta" role="alert">
          No tenés permiso para cargar animales.
        </p>
        <Link to="/animales">Volver a Animales</Link>
      </main>
    );
  }

  // Maneja el error de un pedido: el 401 ya lo atiende api.ts (lleva al login).
  function mostrarError(err: unknown, porDefecto: string) {
    if (err instanceof ApiError && err.status === 401) return;
    setError(err instanceof ApiError ? err.message : porDefecto);
  }

  async function previsualizar() {
    setError(null);
    setTrabajando(true);
    try {
      const r = await api<VistaPreviaPlanilla>('/animales/planilla/vista-previa', { method: 'POST', body: { texto } });
      setVista(r);
      setTextoVisto(texto);
    } catch (err) {
      setVista(null);
      mostrarError(err, 'No se pudo generar la vista previa');
    } finally {
      setTrabajando(false);
    }
  }

  async function confirmar() {
    setError(null);
    setTrabajando(true);
    try {
      // Se manda el texto crudo: el servidor revalida todo con el estado actual de la base.
      const r = await api<ResultadoPlanilla>('/animales/planilla/confirmar', {
        method: 'POST',
        body: { texto: textoVisto },
      });
      setResultado(r);
      setVista(null);
      setTexto('');
      setTextoVisto('');
    } catch (err) {
      mostrarError(err, 'No se pudo guardar la carga');
    } finally {
      setTrabajando(false);
    }
  }

  function nuevaCarga() {
    setResultado(null);
    setError(null);
  }

  const desactualizada = vista !== null && texto !== textoVisto;
  const puedeConfirmar = vista !== null && vista.resumen.correctas > 0 && !desactualizada && !trabajando;

  return (
    <main className="contenido pantalla-lotes">
      <div className="encabezado-pantalla">
        <h1>Cargar desde planilla</h1>
        <Link to="/animales" className="boton-secundario enlace-boton">
          Volver a Animales
        </Link>
      </div>

      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}

      {resultado ? (
        <section className="seccion" aria-labelledby="titulo-resultado">
          <h2 id="titulo-resultado">Resultado de la carga</h2>
          <p role="status" className="resultado-ok">
            Se guardaron {textoAnimales(resultado.guardados)}.
          </p>
          {resultado.sinLotePorEstado.length > 0 && (
            <p className="aviso">
              Quedaron sin lote: {textoSinLote(resultado.sinLotePorEstado)}. Elegí el lote destino de ese estado en Lotes.
            </p>
          )}
          {(resultado.avisosDeNumero ?? []).length > 0 && (
            <div className="avisos">
              {(resultado.avisosDeNumero ?? []).map((a) => (
                <p key={a.fila} className="aviso">
                  Fila {a.fila}: {textoAvisoNumeroDeBaja(a.numero, a.avisoNumeroDeBaja)}
                </p>
              ))}
            </div>
          )}
          {resultado.quedaronAfuera.length > 0 && (
            <>
              <p className="aviso">
                {resultado.quedaronAfuera.length === 1
                  ? 'Quedó afuera 1 fila'
                  : `Quedaron afuera ${resultado.quedaronAfuera.length} filas`}
                : {resultado.quedaronAfuera.length === 1 ? 'corregila' : 'corregilas'} en tu planilla y volvé a {resultado.quedaronAfuera.length === 1 ? 'cargarla' : 'cargarlas'}.
              </p>
              <div className="tabla-contenedor">
                <table className="tabla tabla-motivos">
                  <thead>
                    <tr>
                      <th scope="col">Fila</th>
                      <th scope="col">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.quedaronAfuera.map((f) => (
                      <tr key={f.fila}>
                        <td>{f.fila}</td>
                        <td>{f.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="acciones">
            <Link to="/animales" className="boton enlace-boton">
              Ver animales
            </Link>
            <button type="button" className="boton-secundario" onClick={nuevaCarga}>
              Cargar otra planilla
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="seccion">
            <p className="subtitulo">
              Copiá las filas desde Excel o Google Sheets y pegalas acá. Columnas, en este orden: número, sexo, fecha de
              nacimiento, estado y número de la madre. La primera fila puede ser el encabezado. Hasta 500 filas por vez.
            </p>
            <div className="campo">
              <label htmlFor="planilla-texto">Filas de la planilla</label>
              <textarea
                id="planilla-texto"
                className="planilla-texto"
                rows={8}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <span className="campo-ayuda">
                Sexo: hembra o macho. Estado: recién nacido, vaquillona, en ordeñe o seca. Fecha: día/mes/año. La fecha y
                la madre son opcionales.
              </span>
            </div>
            <div className="acciones">
              <button type="button" className="boton" onClick={previsualizar} disabled={trabajando || texto.trim() === ''}>
                {trabajando && !vista ? 'Revisando…' : 'Ver vista previa'}
              </button>
            </div>
          </section>

          {vista && (
            <section className="seccion" aria-labelledby="titulo-vista">
              <h2 id="titulo-vista">Vista previa</h2>
              <p role="status">
                {vista.resumen.total === 1 ? '1 fila' : `${vista.resumen.total} filas`}: {vista.resumen.correctas}{' '}
                {vista.resumen.correctas === 1 ? 'correcta' : 'correctas'} y {vista.resumen.conError} con error. Todavía no
                se guardó nada.
              </p>
              {desactualizada && (
                <p className="aviso">Cambiaste el texto: volvé a pedir la vista previa antes de confirmar.</p>
              )}
              {vista.resumen.sinLotePorEstado.length > 0 && (
                <p className="aviso">
                  Si confirmás, quedarán sin lote: {textoSinLote(vista.resumen.sinLotePorEstado)} (ese estado no tiene lote
                  destino).
                </p>
              )}
              {vista.resumen.correctas === 0 && (
                <p className="aviso">No hay ninguna fila correcta: corregí el texto y volvé a revisar.</p>
              )}

              {/* La tabla se desplaza dentro de su contenedor; la página no. */}
              <div className="tabla-contenedor">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th scope="col">Fila</th>
                      <th scope="col">Resultado</th>
                      <th scope="col">Número</th>
                      <th scope="col">Sexo</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Nacimiento</th>
                      <th scope="col">Madre</th>
                      <th scope="col">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vista.filas.map((f) => (
                      <tr key={f.fila} className={f.ok ? undefined : 'fila-error'}>
                        <td>{f.fila}</td>
                        <td>
                          <span className={f.ok ? 'etiqueta-ok' : 'etiqueta-error'}>{f.ok ? 'Correcta' : 'Con error'}</span>
                        </td>
                        <td>{f.numero ?? '—'}</td>
                        <td>{f.sexo ? NOMBRE_SEXO[f.sexo] : '—'}</td>
                        <td>{f.estado ? NOMBRE_ESTADO[f.estado] : '—'}</td>
                        <td>{f.ok ? formatearFecha(f.fechaNacimiento) : (f.fechaNacimiento ?? '—')}</td>
                        <td>{f.madre ?? '—'}</td>
                        <td className="celda-motivo">
                          {f.motivo ?? ''}
                          {/* Aviso, no error: la fila se guarda igual (RF-14). */}
                          {f.ok && f.numero && f.avisoNumeroDeBaja && (
                            <span className="aviso-fila">{textoAvisoNumeroDeBaja(f.numero, f.avisoNumeroDeBaja)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="acciones">
                <button type="button" className="boton" onClick={confirmar} disabled={!puedeConfirmar}>
                  {trabajando
                    ? 'Guardando…'
                    : vista.resumen.correctas === 0
                      ? 'Confirmar y guardar'
                      : `Confirmar y guardar ${textoAnimales(vista.resumen.correctas)}`}
                </button>
              </div>
              {vista.resumen.conError > 0 && vista.resumen.correctas > 0 && (
                <p className="campo-ayuda">Las filas con error no se guardan.</p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
