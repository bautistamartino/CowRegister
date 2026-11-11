import { useEffect, useState } from 'react';
import { api, ApiError, type CambioManual, type CampoCambio, type RespuestaCambios } from '../api';
import { formatearFecha } from '../animales';

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

// Historial de cambios manuales de la ficha (spec 005, RF-15). Lo ven los tres roles.
// `version` cambia cuando hay que volver a leerlo (después de guardar una edición o un movimiento).
export function HistorialCambios({ animalId, version }: { animalId: string; version: number }) {
  const [datos, setDatos] = useState<RespuestaCambios | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    api<RespuestaCambios>(`/animales/${encodeURIComponent(animalId)}/cambios`)
      .then((r) => {
        if (vigente) {
          setDatos(r);
          setError(null);
        }
      })
      .catch((err) => {
        if (vigente) setError(err instanceof ApiError ? err.message : 'No se pudo cargar el historial de cambios');
      });
    return () => {
      vigente = false;
    };
  }, [animalId, version]);

  return (
    <section className="seccion">
      <h2>Cambios manuales</h2>
      <p className="campo-ayuda">
        Acá se ven los cambios hechos a mano; los cambios automáticos (estado y lote por partos y secados) están en los eventos.
      </p>
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      {!error && !datos && <p className="subtitulo">Cargando…</p>}
      {datos && datos.cambios.length === 0 && <p className="subtitulo">Todavía no hay cambios manuales</p>}
      {datos && datos.cambios.length > 0 && (
        <>
          <ul className="lista-eventos">
            {datos.cambios.map((c: CambioManual) => (
              <li key={c.id} className="evento">
                <p>
                  <strong>{NOMBRE_CAMPO[c.campo]}:</strong> {textoValor(c.campo, c.valorAnterior)} → {textoValor(c.campo, c.valorNuevo)}
                </p>
                <p className="texto-suave">
                  {c.usuarioNombre} · {textoMomento(c.creadoEn)}
                </p>
              </li>
            ))}
          </ul>
          {datos.total > datos.cambios.length && (
            <p className="campo-ayuda">
              Se muestran los últimos {datos.cambios.length} de {datos.total} cambios.
            </p>
          )}
        </>
      )}
    </section>
  );
}
