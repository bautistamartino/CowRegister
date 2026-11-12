import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { AnimalDeInforme } from '../api';

// Número de un animal como enlace a su ficha: activa en /animales/:id, de baja (venta o muerte)
// en /bajas/:id. Una baja por parto anulado no tiene ficha de baja: se muestra solo el número.
export function EnlaceAnimal({ animal }: { animal: AnimalDeInforme }) {
  if (animal.activo) return <Link to={`/animales/${animal.id}`} className="enlace-fila">{animal.numero}</Link>;
  if (animal.motivoBaja === 'venta' || animal.motivoBaja === 'muerte') {
    return <Link to={`/bajas/${animal.id}`} className="enlace-fila">{animal.numero}</Link>;
  }
  return <span>{animal.numero}</span>;
}

// Estado común de un informe: "Calculando…", el error o el contenido.
export function EstadoInforme({ cargando, error, children }: { cargando: boolean; error: string | null; children: ReactNode }) {
  return (
    <>
      {cargando && <p className="subtitulo" role="status">Calculando…</p>}
      {error && <div className="alerta" role="alert">{error}</div>}
      {!cargando && !error && children}
    </>
  );
}

// Aviso de tope del detalle: los totales de arriba siguen contando todo.
export function AvisoTope({ truncado, tope, total }: { truncado: boolean; tope: number; total: number }) {
  if (!truncado) return null;
  return <p className="aviso">Se muestran los {tope} más recientes de {total}. Los totales de arriba cuentan todos.</p>;
}

// Un número con su rótulo dentro de la caja de resumen.
export function Cifra({ valor, rotulo, destacada, detalle }: { valor: string | number; rotulo: string; destacada?: boolean; detalle?: ReactNode }) {
  return (
    <div className={destacada ? 'cifra cifra-destacada' : 'cifra'}>
      <span className="cifra-valor">{valor}</span>
      <span className="cifra-rotulo">{rotulo}</span>
      {detalle && <span className="cifra-detalle">{detalle}</span>}
    </div>
  );
}
