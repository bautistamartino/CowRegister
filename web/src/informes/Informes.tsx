import { useState } from 'react';
import { InformeInseminacion } from './InformeInseminacion';
import { InformeLeche } from './InformeLeche';
import { InformeNatalidad } from './InformeNatalidad';
import { PeriodoInforme } from './PeriodoInforme';
import { periodoPorDefecto, periodoPorDefectoLeche, validarPeriodo } from './informesDatos';

type Informe = 'inseminacion' | 'natalidad' | 'leche';

// Pantalla de informes (spec 007, RF-14 y RF-20; spec 008, RF-17): elige el informe y el período.
// Solo lectura, los tres roles. Consulta únicamente con un período válido; si no, muestra el motivo.
export function Informes() {
  const [informe, setInforme] = useState<Informe>('inseminacion');
  // El período vive acá: fallar una consulta no lo pierde.
  const [periodo, setPeriodo] = useState(() => periodoPorDefecto());
  const errorPeriodo = validarPeriodo(periodo.desde, periodo.hasta);

  // "Litros de leche" arranca en el mes en curso; los otros informes, en el último año.
  function elegir(nuevo: Informe) {
    if (nuevo === informe) return;
    setInforme(nuevo);
    setPeriodo(nuevo === 'leche' ? periodoPorDefectoLeche() : periodoPorDefecto());
  }

  return (
    <main className="contenido pantalla-lotes">
      <div className="encabezado-pantalla">
        <h1>Informes</h1>
      </div>

      {/* Selector del informe: botones de 48 px; el activo lleva aria-pressed. */}
      <div className="selector-informe" role="group" aria-label="Informe">
        <button type="button" className={informe === 'inseminacion' ? 'boton' : 'boton-secundario'} aria-pressed={informe === 'inseminacion'} onClick={() => elegir('inseminacion')}>
          Resultado de inseminación
        </button>
        <button type="button" className={informe === 'natalidad' ? 'boton' : 'boton-secundario'} aria-pressed={informe === 'natalidad'} onClick={() => elegir('natalidad')}>
          Natalidad
        </button>
        <button type="button" className={informe === 'leche' ? 'boton' : 'boton-secundario'} aria-pressed={informe === 'leche'} onClick={() => elegir('leche')}>
          Litros de leche
        </button>
      </div>

      <PeriodoInforme desde={periodo.desde} hasta={periodo.hasta} error={errorPeriodo} alCambiar={(desde, hasta) => setPeriodo({ desde, hasta })} />

      {!errorPeriodo && informe === 'inseminacion' && <InformeInseminacion desde={periodo.desde} hasta={periodo.hasta} />}
      {!errorPeriodo && informe === 'natalidad' && <InformeNatalidad desde={periodo.desde} hasta={periodo.hasta} />}
      {!errorPeriodo && informe === 'leche' && <InformeLeche desde={periodo.desde} hasta={periodo.hasta} />}
    </main>
  );
}
