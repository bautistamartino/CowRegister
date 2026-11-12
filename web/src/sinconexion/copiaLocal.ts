// Lecturas sin conexión (spec 009, RF-9 a RF-17): responde desde la copia local lo mismo que
// respondería la API. Es PURA: no usa React, ni el navegador, ni la red. Recibe la copia ya leída.
//
// Es una "lista cerrada" (RF-12): solo estas rutas de lectura se resuelven acá; todo lo demás
// devuelve `fuera` y `api()` lo trata como "Esto necesita conexión".
//
//   GET /animales[?estado=&loteId=]   listado, sin el recorte de 2.000 del servidor
//   GET /animales/buscar?numero=      buscador por número
//   GET /animales/:id                 ficha
//   GET /animales/:id/eventos         situación reproductiva y eventos
//   GET /animales/:id/historial       historial
//   GET /animales/:id/produccion      producción
//   GET /lotes                        lotes (para el filtro del listado)
//
// Los mensajes y códigos de error son los de la API (api/src/rutas/animales.ts).

import type { AnimalCopia, Lote } from '../compartido/api';
import { compararNumeros, normalizarNumero } from './numeros';
import { formatearFechaHora } from './fechaHora';

// La copia ya leída del almacén.
export type CopiaEnMemoria = {
  generadaEn: string;
  lotes: Lote[];
  animales: AnimalCopia[];
};

export type ResultadoLocal =
  | { tipo: 'ok'; datos: unknown }
  | { tipo: 'error'; status: number; mensaje: string } // lo que respondería la API con ese código
  | { tipo: 'fuera' }; // no es una lectura de la lista cerrada

const FUERA: ResultadoLocal = { tipo: 'fuera' };
const ESTADOS_ACTIVOS = ['RECIEN_NACIDO', 'VAQUILLONA', 'EN_ORDENE', 'SECA'];

const error = (status: number, mensaje: string): ResultadoLocal => ({ tipo: 'error', status, mensaje });
const ok = (datos: unknown): ResultadoLocal => ({ tipo: 'ok', datos });

// Mensaje de un animal ausente (RF-16): no se afirma que no exista, solo que no está en la tablet.
export function textoAnimalAusente(generadaEn: string): string {
  return `No encontrado en los datos de la tablet (al día de ${formatearFechaHora(generadaEn)})`;
}

export function resolverLocal(metodo: string, ruta: string, copia: CopiaEnMemoria): ResultadoLocal {
  if (metodo.toUpperCase() !== 'GET') return FUERA;

  const url = new URL(ruta, 'http://local');
  const tramos = url.pathname.split('/').filter((t) => t !== '');
  const [raiz, segundo, tercero] = tramos;

  if (raiz === 'lotes' && tramos.length === 1) return ok(copia.lotes);
  if (raiz !== 'animales') return FUERA;

  if (tramos.length === 1) return listado(url.searchParams, copia);
  if (tramos.length === 2) return segundo === 'buscar' ? buscar(url.searchParams, copia) : delAnimal(segundo!, copia, (a) => a.ficha);
  if (tramos.length === 3) {
    if (tercero === 'eventos') return delAnimal(segundo!, copia, (a) => a.eventos);
    if (tercero === 'historial') return delAnimal(segundo!, copia, (a) => a.historial);
    if (tercero === 'produccion') return delAnimal(segundo!, copia, (a) => a.produccion);
  }
  return FUERA;
}

// GET /animales: igual que el servidor, pero sin recorte (la copia es completa).
function listado(params: URLSearchParams, copia: CopiaEnMemoria): ResultadoLocal {
  // Estado: uno de los 4 activos. Cualquier otro valor (incluido BAJA o vacío) da 400.
  let estado: string | undefined;
  if (params.has('estado')) {
    const valores = params.getAll('estado');
    if (valores.length !== 1 || !ESTADOS_ACTIVOS.includes(valores[0]!)) {
      return error(400, 'El estado tiene que ser recién nacido, vaquillona, en ordeñe o seca');
    }
    estado = valores[0];
  }

  // Lote: el id de un lote de la copia o "sin-lote". Cualquier otra cosa, el mismo 404.
  let loteId: string | null | undefined;
  if (params.has('loteId')) {
    const valores = params.getAll('loteId');
    const valor = valores[0]!;
    if (valores.length === 1 && valor === 'sin-lote') loteId = null;
    else if (valores.length === 1 && copia.lotes.some((l) => l.id === valor)) loteId = valor;
    else return error(404, 'Lote no encontrado');
  }

  const filas = copia.animales
    .filter((a) => (estado === undefined || a.ficha.estado === estado) && (loteId === undefined || (a.ficha.lote?.id ?? null) === loteId))
    .map((a) => ({
      id: a.ficha.id,
      numero: a.ficha.numero,
      sexo: a.ficha.sexo,
      estado: a.ficha.estado,
      lote: a.ficha.lote ? { nombre: a.ficha.lote.nombre } : null,
    }))
    .sort((a, b) => compararNumeros(a.numero, b.numero));

  return ok({ total: filas.length, mostrados: filas.length, truncado: false, animales: filas });
}

// GET /animales/buscar?numero=: búsqueda exacta sobre la copia, con la misma normalización.
function buscar(params: URLSearchParams, copia: CopiaEnMemoria): ResultadoLocal {
  const valores = params.getAll('numero');
  if (valores.length !== 1 || valores[0]!.trim() === '') return error(400, 'Indicá el número a buscar');
  // Un número con caracteres no permitidos recibe la misma respuesta que uno inexistente.
  const numero = normalizarNumero(valores[0]!);
  const encontrado = numero ? copia.animales.find((a) => a.ficha.numero === numero) : undefined;
  if (!encontrado) return error(404, 'No hay un animal activo con ese número');
  return ok({ id: encontrado.ficha.id, numero: encontrado.ficha.numero });
}

// Lo que se pide de un animal (ficha, eventos, historial o producción). Si no está en la copia,
// RF-16: no decimos que no existe, decimos que no está en los datos de la tablet.
function delAnimal(idCodificado: string, copia: CopiaEnMemoria, extraer: (a: AnimalCopia) => unknown): ResultadoLocal {
  let id: string;
  try {
    id = decodeURIComponent(idCodificado);
  } catch {
    id = idCodificado; // texto mal codificado: no va a coincidir con ningún animal
  }
  const animal = copia.animales.find((a) => a.ficha.id === id);
  if (!animal) return error(404, textoAnimalAusente(copia.generadaEn));
  return ok(extraer(animal));
}
