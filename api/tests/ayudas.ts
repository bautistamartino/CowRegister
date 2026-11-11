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
    'TRUNCATE TABLE "sesiones", "animales", "reglas_lote", "lotes", "usuarios", "establecimientos" CASCADE',
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
