import express from 'express';

// Crea la aplicación Express sin levantar el servidor.
// Separarlo de index.ts permite testear la API sin abrir un puerto.
export function createApp() {
  const app = express();

  app.use(express.json());

  // Endpoint de salud: sirve para comprobar que la API está viva.
  app.get('/api/salud', (_req, res) => {
    res.json({ estado: 'ok', hora: new Date().toISOString() });
  });

  return app;
}
