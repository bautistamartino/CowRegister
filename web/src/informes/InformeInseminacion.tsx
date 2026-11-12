import type { InformeInseminacion as Informe, ResultadoServicio, ResumenServicios } from '../compartido/api';
import { formatearFecha } from '../animales/animalesDatos';
import { NOMBRE_TIPO_SERVICIO } from '../reproduccion/reproduccionDatos';
import { textoPorcentaje, useInforme } from './informesDatos';
import { AvisoTope, Cifra, EnlaceAnimal, EstadoInforme } from './PiezasInforme';

const NOMBRE_RESULTADO: Record<ResultadoServicio, string> = {
  PRENADA_TACTO: 'Preñada por tacto',
  PRENADA_PARTO: 'Preñada por parto (sin tacto)',
  VACIA: 'Vacía',
  SIN_TACTO: 'Sin tacto',
};

// "X de Y" con la base del porcentaje, o nada si no hay base.
const baseTexto = (r: ResumenServicios) => (r.base > 0 ? `${r.prenadas} de ${r.base}` : null);

// Resultado de inseminación (spec 007, RF-7 a RF-10): resumen, desglose por semen y detalle.
export function InformeInseminacion({ desde, hasta }: { desde: string; hasta: string }) {
  const { datos, error, cargando } = useInforme<Informe>('/informes/inseminacion', desde, hasta);

  return (
    <EstadoInforme cargando={cargando} error={error}>
      {datos && datos.resumen.total === 0 && (
        <div className="seccion"><p className="subtitulo">No hay servicios en este período</p></div>
      )}
      {datos && datos.resumen.total > 0 && (
        <>
          <section className="seccion" aria-labelledby="inf-resumen">
            <h2 id="inf-resumen">Resumen</h2>
            <div className="resumen-informe">
              <Cifra valor={datos.resumen.total} rotulo="Servicios" />
              <Cifra valor={datos.resumen.prenadas} rotulo="Preñadas" />
              <Cifra valor={datos.resumen.vacias} rotulo="Vacías" />
              <Cifra valor={datos.resumen.sinTacto} rotulo="Sin tacto" destacada />
              <Cifra valor={textoPorcentaje(datos.resumen.porcentajePrenez)} rotulo="Preñez" detalle={baseTexto(datos.resumen)} />
            </div>
            <p className="campo-ayuda">No incluye servicios sin tacto</p>
          </section>

          <section className="seccion" aria-labelledby="inf-semen">
            <h2 id="inf-semen">Por semen o toro</h2>
            <div className="tabla-contenedor">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Semen o toro</th>
                    <th scope="col">Servicios</th>
                    <th scope="col">Preñadas</th>
                    <th scope="col">Vacías</th>
                    <th scope="col">Sin tacto</th>
                    <th scope="col">Preñez</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.porSemen.map((s) => (
                    <tr key={s.semen?.id ?? 'sin-semen'}>
                      <th scope="row">{s.semen?.nombre ?? 'No especificado'}</th>
                      <td>{s.total}</td>
                      <td>{s.prenadas}</td>
                      <td>{s.vacias}</td>
                      <td className={s.sinTacto > 0 ? 'celda-sin-tacto' : undefined}>{s.sinTacto}</td>
                      <td>
                        {textoPorcentaje(s.porcentajePrenez)}
                        {baseTexto(s) && <span className="texto-suave"> ({baseTexto(s)})</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="seccion" aria-labelledby="inf-detalle">
            <h2 id="inf-detalle">Detalle de servicios</h2>
            <AvisoTope truncado={datos.truncado} tope={datos.tope} total={datos.totalDetalle} />
            <div className="tabla-contenedor">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Vaca</th>
                    <th scope="col">Servicio</th>
                    <th scope="col">Semen o toro</th>
                    <th scope="col">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.detalle.map((d) => (
                    <tr key={d.servicioId}>
                      <td>{formatearFecha(d.fecha)}</td>
                      <td>
                        <EnlaceAnimal animal={d.animal} />
                        {!d.animal.activo && <span className="etiqueta-baja"> baja</span>}
                      </td>
                      <td>{NOMBRE_TIPO_SERVICIO[d.tipoServicio]}</td>
                      <td>{d.semen?.nombre ?? 'No especificado'}</td>
                      <td className={d.resultado === 'SIN_TACTO' ? 'celda-sin-tacto' : undefined}>{NOMBRE_RESULTADO[d.resultado]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </EstadoInforme>
  );
}
