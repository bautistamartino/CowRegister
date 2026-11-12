import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
