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
