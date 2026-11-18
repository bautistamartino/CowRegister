// Convierte lo que devuelve `registrar` o `anularLocal` en los errores que muestra un formulario (spec 011,
// RF-10, RF-11 y RF-12). Lógica pura.
//
// Tiene la misma forma que `interpretar()` de reproduccionDatos.ts ({ campos, general }), así el formulario trata
// igual un rechazo del servidor y uno local. Las claves de campo son las de la API (por ejemplo `crias.0.numero`).

import type { ResultadoRegistro } from './registrar';

export type ErroresFormulario = { campos: Record<string, string>; general: string | null };

export const TEXTO_ANIMAL_FUERA_DE_COPIA = 'Este animal no está en los datos de la tablet: actualizá los datos cuando tengas señal';

const PREFIJO_SIN_LUGAR = 'No se pudo guardar en la tablet:';

/**
 * `camposDibujados` son los campos que el formulario muestra. Un mensaje de un campo que no se dibuja (por
 * ejemplo el de las crías "en bloque") no se pierde: va a la alerta general.
 */
export function aErroresFormulario(resultado: ResultadoRegistro, camposDibujados: string[]): ErroresFormulario {
  if (resultado.tipo === 'sinLugar') {
    // La 010 ya arma el texto completo; si llegara solo el motivo, se completa acá.
    const general = resultado.mensaje.startsWith(PREFIJO_SIN_LUGAR)
      ? resultado.mensaje
      : `${PREFIJO_SIN_LUGAR} ${resultado.mensaje}. Conectate para sincronizar los pendientes`;
    return { campos: {}, general };
  }
  if (resultado.tipo !== 'rechazado') return { campos: {}, general: null };

  // Animal fuera de la copia: lo dice solo la validación local (el servidor, con señal, sí lo encuentra).
  if (resultado.origen === 'local' && resultado.codigo === 404 && resultado.mensaje === 'Animal no encontrado') {
    return { campos: {}, general: TEXTO_ANIMAL_FUERA_DE_COPIA };
  }

  const campos: Record<string, string> = {};
  const sueltos: string[] = [];
  for (const [campo, mensaje] of Object.entries(resultado.campos)) {
    if (camposDibujados.includes(campo)) campos[campo] = mensaje;
    else sueltos.push(mensaje);
  }
  if (Object.keys(resultado.campos).length === 0) return { campos, general: resultado.mensaje };
  return { campos, general: sueltos.length > 0 ? sueltos.join('. ') : null };
}
