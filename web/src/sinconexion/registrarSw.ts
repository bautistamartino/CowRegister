// Registra el service worker (public/sw.js), que guarda el código de la app para que abra sin
// conexión (spec 009, RF-2 y RF-3). Solo en la versión compilada: en desarrollo (npm run dev)
// no se registra, para que los cambios del código se vean al instante.
// El navegador solo lo permite en HTTPS o en localhost.
export function registrarSw(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      // Si falla, la app sigue andando igual, solo que sin abrir sin conexión.
      console.error('No se pudo registrar el service worker', e);
    });
  });
}
