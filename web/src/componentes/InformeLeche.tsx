import type { InformeLeche as Informe } from '../api';
import { formatearFecha } from '../animales';
import { useInforme } from '../informes';
import { formatearLitros } from '../produccion';
import { Cifra, EnlaceAnimal, EstadoInforme } from './PiezasInforme';

// Promedios: "—" cuando no hay base (RF-21).
const promedio = (p: number | null) => (p === null ? '—' : formatearLitros(p));

// Informe de litros de leche (spec 008, RF-17 a RF-22): resumen, por lote, por vaca y por día.
export function InformeLeche({ desde, hasta }: { desde: string; hasta: string }) {
  const { datos, error, cargando } = useInforme<Informe>('/informes/leche', desde, hasta);

  return (
    <EstadoInforme cargando={cargando} error={error}>
      {datos && datos.resumen.ordenos === 0 && (
        <div className="seccion"><p className="subtitulo">No hay producción registrada en este período</p></div>
      )}
      {datos && datos.resumen.ordenos > 0 && (
        <>
          <section className="seccion" aria-labelledby="leche-resumen">
            <h2 id="leche-resumen">Resumen</h2>
            <div className="resumen-informe">
              <Cifra valor={formatearLitros(datos.resumen.totalLitros)} rotulo="Litros totales" />
              <Cifra valor={datos.resumen.ordenos} rotulo="Ordeños" />
              <Cifra valor={datos.resumen.vacas} rotulo="Vacas" />
              <Cifra valor={promedio(datos.resumen.promedioPorVacaDia)} rotulo="Litros por vaca por día" />
              <Cifra valor={promedio(datos.resumen.promedioPorOrdeno)} rotulo="Litros por ordeño" />
            </div>
          </section>

          <section className="seccion" aria-labelledby="leche-lote">
            <h2 id="leche-lote">Por lote</h2>
            <div className="tabla-contenedor">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Lote</th>
                    <th scope="col">Litros</th>
                    <th scope="col">Vacas</th>
                    <th scope="col">Litros por vaca por día</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.porLote.map((l) => (
                    <tr key={l.loteId ?? 'sin-lote'}>
                      <th scope="row">{l.nombre ?? 'Sin lote'}</th>
                      <td>{formatearLitros(l.litros)}</td>
                      <td>{l.vacas}</td>
                      <td>{promedio(l.promedioPorVacaDia)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="campo-ayuda">Cada registro cuenta en el lote que tenía la vaca cuando se cargó. Si una vaca cambió de lote en el período, aparece en más de uno y la suma de vacas puede superar el total.</p>
          </section>

          <section className="seccion" aria-labelledby="leche-vaca">
            <h2 id="leche-vaca">Por vaca</h2>
            {datos.truncado && <p className="aviso">Se muestran las primeras {datos.tope} de {datos.totalVacas} vacas, ordenadas por promedio. Los totales de arriba cuentan todas.</p>}
            <div className="tabla-contenedor">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Vaca</th>
                    <th scope="col">Litros</th>
                    <th scope="col">Días</th>
                    <th scope="col">Litros por día</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.porVaca.map((v) => (
                    <tr key={v.animal.id}>
                      <td>
                        <EnlaceAnimal animal={v.animal} />
                        {!v.animal.activo && <span className="etiqueta-baja"> baja</span>}
                      </td>
                      <td>{formatearLitros(v.litros)}</td>
                      <td>{v.dias}</td>
                      <td>{promedio(v.promedioPorVacaDia)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="seccion" aria-labelledby="leche-dia">
            <h2 id="leche-dia">Por día</h2>
            <div className="tabla-contenedor">
              <table className="tabla">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Litros</th>
                    <th scope="col">Vacas</th>
                    <th scope="col">Mañana</th>
                    <th scope="col">Tarde</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.porDia.map((d) => (
                    <tr key={d.fecha}>
                      <th scope="row">{formatearFecha(d.fecha)}</th>
                      <td>{formatearLitros(d.litros)}</td>
                      <td>{d.vacas}</td>
                      <td>{formatearLitros(d.litrosManana)}</td>
                      <td>{formatearLitros(d.litrosTarde)}</td>
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
