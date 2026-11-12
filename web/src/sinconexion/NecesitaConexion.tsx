import { Link } from 'react-router';
import { TEXTO_NECESITA_CONEXION } from '../compartido/api';

// El texto único (RF-13 y RF-56) vive en api.ts, que también lo usa para el error de los pedidos;
// se vuelve a exportar acá para que las pantallas lo importen junto con la nota.
export { TEXTO_NECESITA_CONEXION };

// Pantalla completa para las rutas fuera de la lista cerrada (bajas, informes, semen, lotes,
// alta y planilla): no intenta nada ni guarda nada para después; ofrece volver al listado.
export function NecesitaConexion() {
  return (
    <main className="contenido">
      <h1>{TEXTO_NECESITA_CONEXION}</h1>
      <p>Esta pantalla no está disponible sin conexión. Cuando vuelva la señal vas a poder usarla.</p>
      <p>
        <Link to="/animales" className="boton enlace-boton">
          Volver al listado
        </Link>
      </p>
    </main>
  );
}

// Nota corta que se pone junto a botones que quedan deshabilitados sin conexión.
export function NotaNecesitaConexion() {
  return (
    <p className="campo-ayuda nota-conexion" role="note">
      {TEXTO_NECESITA_CONEXION}
    </p>
  );
}
