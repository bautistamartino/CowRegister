import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { HttpError, manejarErrores } from './errores.js';
import { rutasAuth } from './rutas/auth.js';
import { rutasUsuarios } from './rutas/usuarios.js';
import { rutasLotes } from './rutas/lotes.js';
import { rutasReglasLote } from './rutas/reglas-lote.js';
import { rutasAnimales } from './rutas/animales.js';
import { rutasAnimalesEdicion } from './rutas/animales-edicion.js';
import { rutasBajas, rutasBajasAnimal } from './rutas/bajas.js';
import { rutasHistorialAnimal, rutasHistorialBaja } from './rutas/historial.js';
import { rutasInformes } from './rutas/informes.js';
import { rutasCopiaLocal } from './rutas/copia-local.js';
import { rutasProduccion, rutasProduccionBaja } from './rutas/produccion.js';
import { rutasSemen } from './rutas/semen.js';
import { rutasReproduccion } from './rutas/reproduccion.js';
import { rutasPartos } from './rutas/partos.js';
import { rutasAnulacionServicios, rutasAnulacionTactos } from './rutas/anulaciones.js';
import { rutasAnulacionPartos, rutasAnulacionSecados } from './rutas/anulaciones-partos.js';
import { requiereDuenoOEncargado, requiereRol, requiereSesion } from './auth/middleware.js';

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
  // Catálogo de semen y toros (spec 003, RF-28): sin sesión 401 y sin permiso 403, también con
  // JSON roto, así que sesión y rol van antes de los parsers. El GET lo ven los tres roles.
  app.use('/api/semen', requiereSesion);
  app.post('/api/semen', requiereRol('DUENO', 'ENCARGADO'));
  app.patch('/api/semen/:id', requiereRol('DUENO', 'ENCARGADO'));
  // Servicios, tactos y anulaciones (spec 003, RF-28): todos los roles pueden, pero sin sesión es 401
  // aunque el JSON venga roto, así que la sesión también va antes de los parsers.
  app.use(['/api/servicios', '/api/tactos'], requiereSesion);
  app.post(['/api/animales/:id/servicios', '/api/animales/:id/tactos'], requiereSesion);
  app.get('/api/animales/:id/eventos', requiereSesion);
  // Historial único (spec 007, RF-19): lectura para los tres roles; sin sesión es 401 antes que nada.
  app.get('/api/animales/:id/historial', requiereSesion);
  // Partos y secados (spec 004, RF-42): solo dueño y encargado. El veterinario recibe 403 y un pedido
  // sin sesión 401 aunque el JSON venga roto, así que sesión y rol van antes de los parsers.
  app.post(['/api/animales/:id/partos', '/api/animales/:id/secados'], requiereSesion, requiereRol('DUENO', 'ENCARGADO'));
  // Lo mismo para anular partos y secados (RF-42): el permiso va antes de buscar el evento.
  app.post(['/api/partos/:id/anular', '/api/secados/:id/anular'], requiereSesion, requiereRol('DUENO', 'ENCARGADO'));
  // Editar un animal (spec 005, RF-19): solo dueño y encargado; el veterinario recibe 403 y sin sesión 401
  // aunque el JSON venga roto. Leer el historial (GET) lo hacen los tres roles y no tiene cuerpo.
  app.patch(['/api/animales/:id', '/api/animales/:id/lote'], requiereSesion, requiereRol('DUENO', 'ENCARGADO'));
  // Bajas por venta o muerte (spec 006, RF-17): dar de baja y revertir solo dueño y encargado, con
  // 403 y 401 aunque el JSON venga roto. El listado y la ficha de bajas (GET) los ven los tres roles.
  app.post(['/api/animales/:id/baja', '/api/animales/:id/revertir-baja'], requiereSesion, requiereRol('DUENO', 'ENCARGADO'));
  app.use('/api/bajas', requiereSesion);
  // Producción: litros por vaca (spec 008, RF-27): cargar y anular solo dueño y encargado (403 con su
  // mensaje) y sin sesión 401, también con JSON roto. Leer la ficha (GET) lo hacen los tres roles.
  app.get('/api/animales/:id/produccion', requiereSesion);
  app.post(
    ['/api/animales/:id/produccion', '/api/animales/:id/produccion/:registroId/anular'],
    requiereSesion,
    requiereDuenoOEncargado,
  );
  // Informes (spec 007, RF-19): lectura para los tres roles; sin sesión es 401 antes que un 400 de período.
  app.use('/api/informes', requiereSesion);
  // Copia local para el modo sin conexión (spec 009, RF-52): lectura para los tres roles; sin sesión es 401.
  app.use('/api/copia-local', requiereSesion);
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
  app.use('/api/animales', rutasProduccion); // /:id/produccion (spec 008)
  app.use('/api/bajas', rutasProduccionBaja); // GET /:id/produccion de una baja (spec 008)
  app.use('/api/animales', rutasHistorialAnimal); // GET /:id/historial (spec 007)
  app.use('/api/bajas', rutasHistorialBaja); // GET /:id/historial de una baja (spec 007)
  app.use('/api/animales', rutasReproduccion); // /:id/eventos, /:id/servicios, /:id/tactos
  app.use('/api/animales', rutasPartos); // /:id/partos, /:id/secados
  app.use('/api/animales', rutasBajasAnimal); // POST /:id/baja, /:id/revertir-baja
  app.use('/api/bajas', rutasBajas); // GET /, GET /:id
  app.use('/api/animales', rutasAnimalesEdicion); // PATCH /:id, GET /:id/cambios
  app.use('/api/animales', rutasAnimales);
  app.use('/api/servicios', rutasAnulacionServicios);
  app.use('/api/tactos', rutasAnulacionTactos);
  app.use('/api/partos', rutasAnulacionPartos);
  app.use('/api/secados', rutasAnulacionSecados);
  app.use('/api/semen', rutasSemen);
  app.use('/api/copia-local', rutasCopiaLocal); // GET / (spec 009)
  app.use('/api/informes', rutasInformes); // GET /inseminacion y /natalidad (spec 007)

  // Cualquier otra ruta de la API no existe.
  app.use('/api', () => {
    throw new HttpError(404, 'Ruta no encontrada');
  });

  app.use(manejarErrores); // siempre al final
  return app;
}
