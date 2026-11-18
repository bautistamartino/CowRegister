import { useState, type FormEvent } from 'react';
import { FECHA_MINIMA } from './reproduccionDatos';
import { AvisoReloj } from '../sinconexion/AvisoReloj';
import { useRelojTablet } from '../sinconexion/useRelojTablet';
import { Campo } from '../compartido/Campo';
import { useGuardarCarga } from '../sinconexion/useGuardarCarga';
import type { ConfirmacionCarga } from '../sinconexion/guardadoCarga';

type Props = {
  animal: { id: string; numero: string };
  alCancelar: () => void;
  // Se llama cuando el secado quedó guardado: aceptado en el momento o pendiente de sincronizar.
  alGuardado: (c: ConfirmacionCarga) => Promise<void>;
};

// Formulario de secado: solo la fecha (RF-18). Con señal la API pasa la vaca a "seca" y a su lote destino; sin señal
// (o con pendientes delante) queda pendiente y la ficha la muestra "seca" desde la vista local (spec 011).
export function FormSecado({ animal, alCancelar, alGuardado }: Props) {
  const reloj = useRelojTablet();
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { guardar, guardando: enviando } = useGuardarCarga();

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setErrores({});
    setError(null);
    const salida = await guardar({
      tipo: 'SECADO',
      animal,
      datos: { fecha: String(d.get('fecha')) },
      tituloAceptado: 'Secado registrado',
      camposDibujados: ['fecha'],
    });
    if (!salida) return;
    if (salida.tipo === 'error') {
      // El formulario sigue abierto con lo escrito.
      setErrores(salida.errores.campos);
      setError(salida.errores.general);
      return;
    }
    await alGuardado(salida.confirmacion);
  }

  return (
    <form className="formulario-lote formulario-evento" onSubmit={enviar}>
      <h3>Nuevo secado</h3>
      <AvisoReloj atrasado={reloj.atrasado} />
      {error && (
        <div className="alerta" role="alert">
          {error}
        </div>
      )}
      <Campo key={`f-${reloj.atrasado}`} etiqueta="Fecha" name="fecha" id="secado-fecha" type="date" required defaultValue={reloj.valorInicial} min={FECHA_MINIMA} max={reloj.max} ayuda={reloj.ayuda ?? undefined} error={errores.fecha} />
      <div className="acciones">
        <button type="submit" className="boton" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar secado'}
        </button>
        <button type="button" className="boton-secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
