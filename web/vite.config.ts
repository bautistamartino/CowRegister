import { defineConfig } from 'vite';
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
});
