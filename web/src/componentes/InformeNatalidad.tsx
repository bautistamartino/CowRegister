import type { InformeNatalidad as Informe } from '../api';
import { formatearFecha, NOMBRE_SEXO } from '../animales';
import { textoPorcentaje, useInforme } from '../informes';
import { AvisoTope, Cifra, EnlaceAnimal, EstadoInforme } from './PiezasInforme';

// Natalidad (spec 007, RF-11 a RF-13): resumen de partos y crías, y detalle por parto.
export function InformeNatalidad({ desde, hasta }: { desde: string; hasta: string }) {
  const { datos, error, cargando } = useInforme<Informe>('/informes/natalidad', desde, hasta);

  return (
    <EstadoInforme cargando={cargando} error={error}>
      {datos && datos.resumen.partos === 0 && (
        <div className="seccion"><p className="subtitulo">No hay partos en este período</p></div>
      )}
      {datos && datos.resumen.partos > 0 && (
        <>
          <section className="seccion" aria-labelledby="nat-resumen">
            <h2 id="nat-resumen">Resumen</h2>
            <div className="resumen-informe">
              <Cifra valor={datos.resumen.partos} rotulo="Partos" />
              <Cifra
                valor={datos.resumen.criasVivas.total}
                rotulo="Crías vivas"
                detalle={`${datos.resumen.criasVivas.hembras} hembras · ${datos.resumen.criasVivas.machos} machos`}
              />
              <Cifra
                valor={datos.resumen.criasMuertas.total}
                rotulo="Nacidas muertas"
                detalle={`${datos.resumen.criasMuertas.hembras} hembras · ${datos.resumen.criasMuertas.machos} machos`}
              />
              <Cifra valor={datos.resumen.mellizos} rotulo="Partos de dos crías" />
              <Cifra valor={textoPorcentaje(datos.resumen.porcentajeNacidasMuertas)} rotulo="Nacidas muertas (% de las crías)" />
            </div>
          </section>

          <section className="seccion" aria-labelledby="nat-detalle">
            <h2 id="nat-detalle">Detalle de partos</h2>
            <AvisoTope truncado={datos.truncado} tope={datos.tope} total={datos.totalDetalle} />
            <div className="tabla-contenedor">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Vaca</th>
                    <th scope="col">Crías</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.detalle.map((p) => (
                    <tr key={p.partoId}>
                      <td>{formatearFecha(p.fecha)}</td>
                      <td>
                        <EnlaceAnimal animal={p.vaca} />
                        {!p.vaca.activo && <span className="etiqueta-baja"> baja</span>}
                      </td>
                      <td className="lista-crias-informe">
                        {p.crias.map((c) => (
                          <span key={c.orden} className="cria-informe">
                            {NOMBRE_SEXO[c.sexo]} · {c.nacidaMuerta ? 'nació muerta' : 'viva'}
                            {c.animal && (
                              <>
                                {' · '}
                                <EnlaceAnimal animal={c.animal} />
                                {!c.animal.activo && <span className="etiqueta-baja"> baja</span>}
                              </>
                            )}
                          </span>
                        ))}
                      </td>
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
