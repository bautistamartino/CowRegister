import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Estampa el service worker compilado (dist/sw.js) con un sello único de build: así cada compilación usa una
// caché con nombre propio y el service worker borra las viejas. El sw.js de public/ queda con el marcador.
const sellarServiceWorker = () => ({
  name: 'sellar-service-worker',
  apply: 'build' as const,
  closeBundle() {
    const ruta = resolve(import.meta.dirname, 'dist/sw.js');
    const sello = Date.now().toString(36);
    writeFileSync(ruta, readFileSync(ruta, 'utf8').replaceAll('__BUILD__', sello));
  },
});

export default defineConfig({
  plugins: [react(), sellarServiceWorker()],
  server: {
    port: 5173,
    // En desarrollo, las llamadas a /api se reenvían a la API (puerto 3000).
    // Así el navegador ve un solo origen y las cookies de sesión funcionan sin CORS.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  // `vite preview` sirve la versión compilada (necesaria para probar el service worker, que
  // en desarrollo no se registra). Reenvía /api a la API igual que el servidor de desarrollo.
  preview: {
    port: 4173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  // Tests de la lógica pura de la web (sin navegador: entorno Node).
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
