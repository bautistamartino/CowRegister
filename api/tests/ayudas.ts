import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';

// Herramientas compartidas por todos los tests.

export const app = createApp();

// Borra todos los datos de la base de tests (no toca la estructura).
export async function limpiarBase() {
  if (!process.env.DATABASE_URL?.includes('cowregister_test')) {
    throw new Error('limpiarBase() solo puede usarse con la base de tests');
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "servicios", "tactos", "eventos", "semen_toros", "sesiones", "animales", "reglas_lote", "lotes", "usuarios", "establecimientos" CASCADE',
  );
}

export const PASSWORD = 'clave-de-prueba-123';

// Registra un tambo nuevo y devuelve un "agente" de supertest que guarda la cookie
// de sesión, como si fuera un navegador con el dueño logueado.
export async function registrarTambo(nombre = 'Tambo de prueba', email = 'dueno@prueba.test') {
  const agente = request.agent(app);
  const res = await agente
    .post('/api/auth/registro')
    .send({ nombreEstablecimiento: nombre, nombre: 'Dueño', email, password: PASSWORD })
    .expect(201);
  return { agente, perfil: res.body as { id: string; establecimiento: { id: string } } };
}

// Inicia sesión con un usuario existente y devuelve su agente.
export async function iniciarSesion(email: string, password = PASSWORD) {
  const agente = request.agent(app);
  await agente.post('/api/auth/login').send({ email, password }).expect(200);
  return agente;
}

// El dueño (agenteDueño) crea un usuario de su tambo con POST /api/usuarios y
// devuelve el agente de ese usuario ya logueado. Sirve para probar los permisos
// de encargado y veterinario.
export async function crearUsuario(
  agenteDueño: ReturnType<typeof request.agent>,
  rol: 'DUENO' | 'ENCARGADO' | 'VETERINARIO',
  email: string,
) {
  await agenteDueño
    .post('/api/usuarios')
    .send({ nombre: `Usuario ${rol}`, email, password: PASSWORD, rol })
    .expect(201);
  return iniciarSesion(email);
}

// Crea un animal directo con Prisma (sin pasar por la API), para preparar datos de
// los tests. Por defecto: hembra en ordeñe, sin lote ni madre. La base exige que un
// animal en BAJA tenga fechaBaja (y que solo él la tenga), así que se completa sola.
export function crearAnimalDirecto(
  establecimientoId: string,
  numero: string,
  opciones: {
    sexo?: 'HEMBRA' | 'MACHO';
    estado?: 'RECIEN_NACIDO' | 'VAQUILLONA' | 'EN_ORDENE' | 'SECA' | 'BAJA';
    loteId?: string | null;
    madreId?: string | null;
    fechaNacimiento?: string | null; // AAAA-MM-DD
  } = {},
) {
  const estado = opciones.estado ?? 'EN_ORDENE';
  return prisma.animal.create({
    data: {
      establecimientoId,
      numero,
      sexo: opciones.sexo ?? 'HEMBRA',
      estado,
      loteId: opciones.loteId ?? null,
      madreId: opciones.madreId ?? null,
      fechaNacimiento: opciones.fechaNacimiento ? new Date(`${opciones.fechaNacimiento}T00:00:00.000Z`) : null,
      fechaBaja: estado === 'BAJA' ? new Date('2026-11-01T00:00:00.000Z') : null,
    },
  });
}

// ─── Reproducción (spec 003) ────────────────────────────────────────
// Helpers que insertan directo con Prisma (sin pasar por la API), para armar los
// datos de partida de los tests.

const aFecha = (texto: string) => new Date(`${texto}T00:00:00.000Z`);

// Crea una entrada del catálogo de semen y toros.
export function crearSemenDirecto(
  establecimientoId: string,
  nombre: string,
  opciones: { raza?: string | null; activo?: boolean } = {},
) {
  return prisma.semenToro.create({
    data: { establecimientoId, nombre, raza: opciones.raza ?? null, activo: opciones.activo ?? true },
  });
}

// Momento de registro estrictamente creciente: cada evento creado con estos helpers queda
// 1 segundo después del anterior (partiendo de hace un día), así el orden de registro es el
// orden en que se llaman y nunca hay empates.
let relojHelpers = Date.now() - 24 * 60 * 60 * 1000;
function siguienteCreadoEn(): Date {
  relojHelpers += 1000;
  return new Date(relojHelpers);
}

type DatosEvento = {
  establecimientoId: string;
  animalId: string;
  registradoPorId: string;
  fecha: string; // AAAA-MM-DD
  anulacion?: { porId: string; motivo: string; en?: Date };
  creadoEn?: Date;
};

// Columnas comunes del evento (con la anulación si la hay).
function datosComunes(datos: DatosEvento, id: string, tipo: 'SERVICIO' | 'TACTO') {
  return {
    id,
    establecimientoId: datos.establecimientoId,
    animalId: datos.animalId,
    tipo,
    fecha: aFecha(datos.fecha),
    registradoPorId: datos.registradoPorId,
    creadoEn: datos.creadoEn ?? siguienteCreadoEn(),
    ...(datos.anulacion && {
      anuladoEn: datos.anulacion.en ?? new Date(),
      anuladoPorId: datos.anulacion.porId,
      motivoAnulacion: datos.anulacion.motivo,
    }),
  };
}

// Inserta un servicio: el evento común y su detalle, en una transacción.
export async function crearServicioDirecto(
  datos: DatosEvento & { tipoServicio?: 'INSEMINACION' | 'MONTA_NATURAL'; semenId?: string | null },
) {
  const id = crypto.randomUUID();
  return prisma.$transaction(async (tx) => {
    const evento = await tx.evento.create({ data: datosComunes(datos, id, 'SERVICIO') });
    await tx.servicio.create({
      data: {
        eventoId: id,
        establecimientoId: datos.establecimientoId,
        tipo: 'SERVICIO',
        tipoServicio: datos.tipoServicio ?? 'INSEMINACION',
        semenId: datos.semenId ?? null,
      },
    });
    return evento;
  });
}

// Inserta un tacto: el evento común y su detalle, en una transacción.
export async function crearTactoDirecto(
  datos: DatosEvento & {
    resultado?: 'PRENADA' | 'VACIA';
    fechaProbableIndicada?: string | null;
    anomalias?: string | null;
  },
) {
  const id = crypto.randomUUID();
  return prisma.$transaction(async (tx) => {
    const evento = await tx.evento.create({ data: datosComunes(datos, id, 'TACTO') });
    await tx.tacto.create({
      data: {
        eventoId: id,
        establecimientoId: datos.establecimientoId,
        tipo: 'TACTO',
        resultado: datos.resultado ?? 'PRENADA',
        fechaProbableIndicada: datos.fechaProbableIndicada ? aFecha(datos.fechaProbableIndicada) : null,
        anomalias: datos.anomalias ?? null,
      },
    });
    return evento;
  });
}

// Registra un tambo con su dueño y le crea un animal (por defecto una vaca en ordeñe "101").
// Devuelve el agente del dueño, el id del tambo, el id del usuario y el animal.
export async function prepararVaca(
  opciones: Parameters<typeof crearAnimalDirecto>[2] & { numero?: string; nombreTambo?: string; email?: string } = {},
) {
  const { numero, nombreTambo, email, ...resto } = opciones;
  const { agente, perfil } = await registrarTambo(nombreTambo, email);
  const tambo = perfil.establecimiento.id;
  const vaca = await crearAnimalDirecto(tambo, numero ?? '101', resto);
  return { agente, tambo, usuarioId: perfil.id, vaca };
}
