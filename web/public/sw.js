// Service worker de CowRegister (spec 009). Escrito a mano, sin librerías.
//
// Qué hace: guarda el CÓDIGO de la app (la página, los archivos de /assets, el manifiesto y los
// íconos) para que la app abra y recargue sin conexión.
// Qué NO hace: nunca toca /api ni pedidos que no sean GET. Los datos del tambo no pasan por acá
// (viven en IndexedDB), así cerrar sesión puede borrarlos todos.

const CACHE = 'cowregister-app-v1';
const FIJOS = ['/manifest.webmanifest', '/icono-192.png', '/icono-512.png', '/icono-maskable-512.png'];

// Al instalar: descarga la página principal, lee de ahí los archivos /assets/... (llevan un hash
// en el nombre, cambian en cada compilación) y los guarda junto con los fijos.
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const respuesta = await fetch('/', { cache: 'reload' });
      if (!respuesta.ok) throw new Error('No se pudo descargar la página principal');
      const html = await respuesta.clone().text();
      await cache.put('/', respuesta);

      const assets = new Set(html.match(/\/assets\/[^"'\s)]+/g) ?? []);
      // Los archivos .js pueden cargar otros trozos (import dinámico): se leen y se suman.
      for (const ruta of [...assets]) {
        if (!ruta.endsWith('.js')) continue;
        const js = await (await fetch(ruta)).text();
        for (const hijo of js.match(/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g) ?? []) assets.add('/' + hijo);
      }
      await cache.addAll([...FIJOS, ...assets]);
    })(),
  );
  self.skipWaiting();
});

// Al activarse: borra los cachés de versiones anteriores y toma el control de las pestañas abiertas.
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      for (const nombre of await caches.keys()) if (nombre !== CACHE) await caches.delete(nombre);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return; // solo lectura: lo demás pasa directo a la red

  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return; // otros sitios, no
  if (url.pathname.startsWith('/api')) return; // los datos del tambo NUNCA se guardan acá

  // Navegación (abrir o recargar una pantalla): primero la red; si falla, la página guardada.
  // La app es una sola página (React Router), así que sirve para cualquier ruta.
  if (pedido.mode === 'navigate') {
    evento.respondWith(
      (async () => {
        try {
          const respuesta = await fetch(pedido);
          if (respuesta.ok) (await caches.open(CACHE)).put('/', respuesta.clone());
          return respuesta;
        } catch {
          const guardada = await caches.match('/');
          return guardada ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Archivos de la app (/assets con hash, manifiesto, íconos): primero lo guardado.
  if (url.pathname.startsWith('/assets/') || FIJOS.includes(url.pathname)) {
    evento.respondWith(
      (async () => {
        const guardada = await caches.match(pedido);
        if (guardada) return guardada;
        const respuesta = await fetch(pedido);
        if (respuesta.ok) (await caches.open(CACHE)).put(pedido, respuesta.clone());
        return respuesta;
      })(),
    );
  }
});
