import { useState } from 'react';
import { InformeInseminacion } from '../componentes/InformeInseminacion';
import { InformeNatalidad } from '../componentes/InformeNatalidad';
import { PeriodoInforme } from '../componentes/PeriodoInforme';
import { periodoPorDefecto, validarPeriodo } from '../informes';

type Informe = 'inseminacion' | 'natalidad';

// Pantalla de informes (spec 007, RF-14 y RF-20): elige el informe y el período. Solo lectura,
// los tres roles. Consulta únicamente con un período válido; si no, muestra el motivo.
export function Informes() {
  const [informe, setInforme] = useState<Informe>('inseminacion');
  // El período vive acá: cambiar de informe o fallar una consulta no lo pierde.
  const [periodo, setPeriodo] = useState(() => periodoPorDefecto());
  const errorPeriodo = validarPeriodo(periodo.desde, periodo.hasta);

  return (
    <main className="contenido pantalla-lotes">
      <div className="encabezado-pantalla">
        <h1>Informes</h1>
      </div>

      {/* Selector del informe: botones de 48 px; el activo lleva aria-pressed. */}
      <div className="selector-informe" role="group" aria-label="Informe">
        <button type="button" className={informe === 'inseminacion' ? 'boton' : 'boton-secundario'} aria-pressed={informe === 'inseminacion'} onClick={() => setInforme('inseminacion')}>
          Resultado de inseminación
        </button>
        <button type="button" className={informe === 'natalidad' ? 'boton' : 'boton-secundario'} aria-pressed={informe === 'natalidad'} onClick={() => setInforme('natalidad')}>
          Natalidad
        </button>
      </div>

      <PeriodoInforme desde={periodo.desde} hasta={periodo.hasta} error={errorPeriodo} alCambiar={(desde, hasta) => setPeriodo({ desde, hasta })} />

      {!errorPeriodo && informe === 'inseminacion' && <InformeInseminacion desde={periodo.desde} hasta={periodo.hasta} />}
      {!errorPeriodo && informe === 'natalidad' && <InformeNatalidad desde={periodo.desde} hasta={periodo.hasta} />}
    </main>
  );
}
