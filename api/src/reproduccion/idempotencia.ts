import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { HttpError, esErrorPrisma } from '../errores.js';
import { hoyArgentina } from '../animales/reglas.js';
import { ahora } from '../reloj.js';
import type { Prisma } from '../generated/prisma/client.js';
import { motivoABase, motivoATexto, type MotivoBajaApi } from '../bajas/validacion.js';
import type { Aviso } from './avisos.js';
import { bloquearAnimal, type AnimalBloqueado } from './bloqueo.js';
import { eventoPorId, leerEventos } from './eventos.js';

// Idempotencia de las cinco cargas de eventos (spec 010, RF-4 a RF-6): servicio, tacto, parto, secado y baja.
//
// La tablet manda cada evento con un `id` propio y, si la respuesta se corta, lo reenvía con el MISMO
// `id`. La llave de idempotencia es la clave primaria de `eventos` (es global, de todos los tambos):
//   1. Con el animal bloqueado (`FOR UPDATE`) se RELEE el evento por `id`. Se hace después de bloquear
//      para ver lo que un envío simultáneo ya confirmó, y también cuando el animal ya no está activo
//      (una baja reenviada no puede dar 404).
//   2. Si existe y es "el mismo" (mismo tambo, animal, usuario, tipo y datos): 200 "ya estaba guardado".
//      Si existe y es otra cosa: 409 genérico, sin decir cuál de los casos es.
//   3. Si la base protesta por la clave primaria al insertar (dos pedidos con el mismo `id` sobre
//      animales distintos, que no comparten bloqueo), el `catch` de afuera relee y responde 200 o 409.
//      Nunca 500.

export const MENSAJE_ID_USADO = 'Ese identificador de registro ya se usó con otros datos';
const NO_ENCONTRADO = 'Animal no encontrado';

// ─── Comparación de "mismos datos" (puras, sin base de datos) ─────────────────────────────────

type Texto = string | null | undefined;
// Vacío, solo espacios, null y ausente son lo mismo.
const limpio = (t: Texto): string | null => {
  const l = (t ?? '').trim();
  return l === '' ? null : l;
};

/**
 * Las anomalías de un tacto son texto libre: se comparan "como conjunto". Se parten por coma o punto y
 * coma, se recortan, se descartan los vacíos y se ignora el orden. (Es la única lectura posible de
 * "conjunto" en un texto libre; el reenvío legítimo manda el mismo texto, así que solo evita falsos 409.)
 */
export function mismasAnomalias(a: Texto, b: Texto): boolean {
  const partir = (t: Texto) => new Set((t ?? '').split(/[,;]/).map((x) => x.trim()).filter((x) => x !== ''));
  const A = partir(a);
  const B = partir(b);
  return A.size === B.size && [...A].every((x) => B.has(x));
}

// Lo que quedó guardado de un evento (lo que se compara con el reenvío).
export type EventoGuardado = {
  tipo: 'SERVICIO' | 'TACTO' | 'PARTO' | 'SECADO' | 'BAJA';
  animalId: string;
  registradoPorId: string;
  fecha: string; // AAAA-MM-DD
  servicio?: { tipoServicio: string; semenId: string | null } | null;
  tacto?: { resultado: string; fechaProbableIndicada: string | null; anomalias: string | null } | null;
  // `numero` es el de la cría viva (el del animal dado de alta) y null si nació muerta.
  parto?: { crias: { sexo: string; nacidaMuerta: boolean; numero: string | null; observaciones: string | null }[] } | null;
  baja?: { motivo: string; observaciones: string | null } | null; // motivo como en la base: VENTA o MUERTE
};

// Lo que pide el reenvío (el cuerpo ya validado + el animal de la ruta + el usuario de la sesión).
type Comun = { animalId: string; usuarioId: string; fecha: string };
export type PedidoEvento =
  | (Comun & { tipo: 'SERVICIO'; tipoServicio: 'INSEMINACION' | 'MONTA_NATURAL'; semenId?: string | null })
  | (Comun & { tipo: 'TACTO'; resultado: 'PRENADA' | 'VACIA'; fechaProbableParto?: string | null; anomalias?: string | null })
  | (Comun & { tipo: 'PARTO'; crias: { sexo: string; nacidaMuerta?: boolean; numero?: string | null; observaciones?: string | null }[] })
  | (Comun & { tipo: 'SECADO' })
  | (Comun & { tipo: 'BAJA'; motivo: MotivoBajaApi; observaciones?: string | null });

const mismoServicio = (g: NonNullable<EventoGuardado['servicio']>, p: Extract<PedidoEvento, { tipo: 'SERVICIO' }>) =>
  g.tipoServicio === p.tipoServicio && (limpio(g.semenId)?.toLowerCase() ?? null) === (limpio(p.semenId)?.toLowerCase() ?? null);

const mismoTacto = (g: NonNullable<EventoGuardado['tacto']>, p: Extract<PedidoEvento, { tipo: 'TACTO' }>) =>
  g.resultado === p.resultado &&
  limpio(g.fechaProbableIndicada) === limpio(p.fechaProbableParto) &&
  mismasAnomalias(g.anomalias, p.anomalias);

// Las crías se comparan EN EL ORDEN ENVIADO: otro orden es otro parto.
const mismoParto = (g: NonNullable<EventoGuardado['parto']>, p: Extract<PedidoEvento, { tipo: 'PARTO' }>) =>
  g.crias.length === p.crias.length &&
  g.crias.every((c, i) => {
    const q = p.crias[i]!;
    return (
      c.sexo === q.sexo &&
      c.nacidaMuerta === (q.nacidaMuerta ?? false) &&
      limpio(c.numero) === limpio(q.numero) &&
      limpio(c.observaciones) === limpio(q.observaciones)
    );
  });

const mismaBaja = (g: NonNullable<EventoGuardado['baja']>, p: Extract<PedidoEvento, { tipo: 'BAJA' }>) =>
  g.motivo === motivoABase(p.motivo) && limpio(g.observaciones) === limpio(p.observaciones);

/**
 * ¿El reenvío pide lo mismo que ya se guardó? Siempre: mismo animal, usuario, tipo y fecha. Según el
 * tipo, además los datos propios. La hora informativa de la tablet NO cuenta.
 */
export function esMismoEvento(g: EventoGuardado, p: PedidoEvento): boolean {
  if (g.tipo !== p.tipo || g.animalId !== p.animalId || g.registradoPorId !== p.usuarioId || g.fecha !== p.fecha) return false;
  switch (p.tipo) {
    case 'SERVICIO':
      return !!g.servicio && mismoServicio(g.servicio, p);
    case 'TACTO':
      return !!g.tacto && mismoTacto(g.tacto, p);
    case 'PARTO':
      return !!g.parto && mismoParto(g.parto, p);
    case 'SECADO':
      return true;
    case 'BAJA':
      return !!g.baja && mismaBaja(g.baja, p);
  }
}

// ─── Lectura por id y respuesta "ya estaba guardado" ──────────────────────────────────────────

type Db = Prisma.TransactionClient;

const aTexto = (fecha: Date) => fecha.toISOString().slice(0, 10);

// Un evento cualquiera por id, SIN filtrar por tambo (el id es una clave primaria global): después
// se decide si es "el mismo". Con lo mínimo para comparar y para armar la respuesta.
async function leerPorId(db: Db, id: string) {
  const f = await db.evento.findUnique({
    where: { id },
    select: {
      id: true,
      establecimientoId: true,
      animalId: true,
      tipo: true,
      fecha: true,
      registradoPorId: true,
      avisosAlAceptar: true,
      servicio: { select: { tipoServicio: true, semenId: true } },
      tacto: { select: { resultado: true, fechaProbableIndicada: true, anomalias: true } },
      parto: {
        select: {
          crias: { orderBy: { orden: 'asc' }, select: { sexo: true, nacidaMuerta: true, observaciones: true, animal: { select: { numero: true } } } },
        },
      },
      baja: { select: { motivo: true, observaciones: true } },
    },
  });
  if (!f) return null;
  const guardado: EventoGuardado = {
    tipo: f.tipo,
    animalId: f.animalId,
    registradoPorId: f.registradoPorId,
    fecha: aTexto(f.fecha),
    servicio: f.servicio,
    tacto: f.tacto ? { ...f.tacto, fechaProbableIndicada: f.tacto.fechaProbableIndicada ? aTexto(f.tacto.fechaProbableIndicada) : null } : null,
    parto: f.parto
      ? { crias: f.parto.crias.map((c) => ({ sexo: c.sexo, nacidaMuerta: c.nacidaMuerta, numero: c.animal?.numero ?? null, observaciones: c.observaciones })) }
      : null,
    baja: f.baja,
  };
  return { id: f.id, establecimientoId: f.establecimientoId, animalId: f.animalId, tipo: f.tipo, avisos: f.avisosAlAceptar, guardado };
}

// Respuesta 200 de los cinco tipos: { evento, avisos, yaExistia: true }.
export type Reenvio = { evento: unknown; avisos: Aviso[]; yaExistia: true };
export type RespuestaCarga<T> = { status: 201; cuerpo: T } | { status: 200; cuerpo: Reenvio };

// El evento tal como está guardado (con la forma de la lista) y los avisos del primer envío.
async function armarReenvio(db: Db, e: NonNullable<Awaited<ReturnType<typeof leerPorId>>>, hoy: string): Promise<Reenvio> {
  const avisos = (Array.isArray(e.avisos) ? e.avisos : []) as Aviso[];
  if (e.tipo === 'BAJA') {
    // La baja devuelve su objeto plano (el mismo del 201), no el de la lista de eventos.
    const b = await db.evento.findUniqueOrThrow({
      where: { id: e.id },
      select: {
        id: true,
        fecha: true,
        creadoEn: true,
        animal: { select: { id: true, numero: true } },
        registradoPor: { select: { nombre: true } },
        baja: { select: { motivo: true, observaciones: true, estadoAnterior: true } },
      },
    });
    return {
      evento: {
        id: b.id,
        animalId: b.animal.id,
        numero: b.animal.numero,
        motivo: motivoATexto(b.baja!.motivo),
        fecha: aTexto(b.fecha),
        observaciones: b.baja!.observaciones,
        estadoAnterior: b.baja!.estadoAnterior,
        registradoPor: b.registradoPor.nombre,
        registradoEn: b.creadoEn,
      },
      avisos,
      yaExistia: true,
    };
  }
  const evento = eventoPorId(await leerEventos(db, e.animalId, e.establecimientoId), e.id, hoy);
  return { evento, avisos, yaExistia: true };
}

type Parametros = { idPropio?: string | undefined; establecimientoId: string; pedido: PedidoEvento; hoy: string };

// Relee el evento por `id`: 'NUEVO' si no existe, el reenvío si es el mismo, o lanza el 409 genérico.
async function resolverId(db: Db, p: Parametros): Promise<'NUEVO' | Reenvio> {
  if (!p.idPropio) return 'NUEVO';
  const existente = await leerPorId(db, p.idPropio);
  if (!existente) return 'NUEVO';
  // Otro tambo, otro animal, otro usuario, otro tipo u otros datos: el mismo 409 para todos.
  if (existente.establecimientoId !== p.establecimientoId || !esMismoEvento(existente.guardado, p.pedido)) {
    throw new HttpError(409, MENSAJE_ID_USADO);
  }
  return armarReenvio(db, existente, p.hoy);
}

/**
 * Corre una carga idempotente (spec 010). Abre la transacción, bloquea al animal (`bloquear`), relee por
 * `id` y recién entonces llama a `crear` con el `id` definitivo. Orden de respuestas:
 *   - el evento ya existe y es el mismo: 200 con la forma común (aunque el animal ya no esté activo);
 *   - existe y es otra cosa: 409 genérico (salvo que el animal de la ruta no sea accesible: ahí gana el
 *     404 de siempre, para no confirmar nunca que existe algo ajeno);
 *   - no existe: 404 si el animal no es accesible, y si lo es sigue el flujo normal (`crear` devuelve el 201).
 * Un choque de la clave primaria al insertar (carrera entre animales distintos) se traduce afuera.
 */
export async function ejecutarCarga<T>(p: {
  idPropio?: string | undefined;
  establecimientoId: string;
  animalId: string;
  pedido: PedidoEvento;
  // Por defecto bloquea al animal activo del tambo; la baja lo hace en su propio orden de bloqueos.
  bloquear?: (tx: Db) => Promise<AnimalBloqueado | null>;
  crear: (tx: Db, contexto: { id: string; animal: AnimalBloqueado; hoy: string }) => Promise<T>;
}): Promise<RespuestaCarga<T>> {
  const hoy = hoyArgentina(ahora());
  const parametros: Parametros = { idPropio: p.idPropio, establecimientoId: p.establecimientoId, pedido: p.pedido, hoy };
  try {
    return await prisma.$transaction(
      async (tx): Promise<RespuestaCarga<T>> => {
        const animal = p.bloquear ? await p.bloquear(tx) : await bloquearAnimal(tx, p.animalId, p.establecimientoId);

        let reenvio: 'NUEVO' | Reenvio;
        try {
          reenvio = await resolverId(tx, parametros);
        } catch (err) {
          // Animal inaccesible + id de otro: el 404 de siempre (no se confirma que el id existe).
          if (!animal && err instanceof HttpError && err.status === 409) throw new HttpError(404, NO_ENCONTRADO);
          throw err;
        }
        if (reenvio !== 'NUEVO') return { status: 200, cuerpo: reenvio };
        if (!animal) throw new HttpError(404, NO_ENCONTRADO);

        const id = p.idPropio ?? randomUUID();
        return { status: 201, cuerpo: await p.crear(tx, { id, animal, hoy }) };
      },
      { timeout: 15_000 },
    );
  } catch (err) {
    // La clave primaria de `eventos` protestó al insertar: el evento ya existe (lo confirmó otro pedido
    // simultáneo). La transacción ya terminó: se relee con una lectura nueva y se responde 200 o 409.
    if (p.idPropio && esErrorPrisma(err, 'P2002') && (await leerPorId(prisma, p.idPropio))) {
      const reenvio = await resolverId(prisma, parametros);
      if (reenvio !== 'NUEVO') return { status: 200, cuerpo: reenvio };
    }
    throw err;
  }
}
