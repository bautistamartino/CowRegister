import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { HttpError, manejarErrores } from './errores.js';
import { rutasAuth } from './rutas/auth.js';
import { rutasUsuarios } from './rutas/usuarios.js';
import { rutasLotes } from './rutas/lotes.js';
import { rutasReglasLote } from './rutas/reglas-lote.js';
import { rutasAnimales } from './rutas/animales.js';
import { requiereRol, requiereSesion } from './auth/middleware.js';

// Crea la aplicación Express sin levantar el servidor.
// Separarlo de index.ts permite testear la API sin abrir un puerto.
export function createApp() {
  const app = express();

  app.use(helmet()); // cabeceras HTTP de seguridad
  // El orden de controles de la API es 401 (sin sesión) → 403 (sin permiso) → 400 (datos inválidos).
  // Los parsers de JSON responden 400/413 si el cuerpo viene roto o es enorme, así que las rutas de
  // carga de animales (solo dueño y encargado, RF-40) controlan sesión y rol ANTES de ellos.
  // Para eso cookieParser (necesario para leer la sesión) también va antes que los parsers.
  app.use(cookieParser());
  app.post(
    ['/api/animales', '/api/animales/planilla/vista-previa', '/api/animales/planilla/confirmar'],
    requiereSesion,
    requiereRol('DUENO', 'ENCARGADO'),
  );
  // La carga desde planilla recibe un texto de hasta 100.000 caracteres: con las tabulaciones y los
  // saltos de línea escapados en el JSON puede pasar los 100 kb. Este parser de 1 MB va ANTES del
  // global y solo para esas dos rutas (Express no vuelve a leer un cuerpo ya leído); el límite de
  // la spec (100.000 caracteres) lo aplica el código con su mensaje en español.
  app.use('/api/animales/planilla', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));

  // Endpoint de salud: sirve para comprobar que la API está viva.
  app.get('/api/salud', (_req, res) => {
    res.json({ estado: 'ok', hora: new Date().toISOString() });
  });

  app.use('/api/auth', rutasAuth);
  app.use('/api/usuarios', rutasUsuarios);
  app.use('/api/lotes', rutasLotes);
  app.use('/api/reglas-lote', rutasReglasLote);
  app.use('/api/animales', rutasAnimales);

  // Cualquier otra ruta de la API no existe.
  app.use('/api', () => {
    throw new HttpError(404, 'Ruta no encontrada');
  });

  app.use(manejarErrores); // siempre al final
  return app;
}
