// Service Worker — v34
// Estrategia:
// - HTML/JS/CSS de la app → NETWORK-FIRST: pide al servidor primero, así SIEMPRE
//   ves la última versión al recargar; si estás offline, cae al caché.
// - Recursos estáticos (íconos, librerías CDN) → CACHE-FIRST: son inmutables,
//   ahorra red y funciona offline.
// - Nunca cachea Google Apps Script ni Google OAuth (respuestas dinámicas).
const CACHE = 'itcontrol-v51';
const ASSETS_PRECARGA = [
  '/ITControl/',
  '/ITControl/index.html',
  '/ITControl/manifest.json',
  '/ITControl/icon-192.png',
  '/ITControl/icon-512.png',
  '/ITControl/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS_PRECARGA)).catch(()=>{})
  );
  // Activar el nuevo SW enseguida (sin esperar a que se cierren las pestañas)
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
      .then(() => {
        // Avisar a todas las pestañas que hay versión nueva activa
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(c => c.postMessage({ type: 'SW_ACTIVADO', version: CACHE }));
        });
      })
  );
});

// Regla: ¿debe ir a red primero? Sí para el HTML/JS del propio dominio (para
// que los cambios se vean al recargar). Para recursos externos → cache-first.
function esRecursoDinamico(url) {
  try {
    const u = new URL(url);
    if (u.origin !== self.location.origin) return false;
    return /\.(html?|js|css|json)(\?|$)/i.test(u.pathname) || u.pathname.endsWith('/');
  } catch { return false; }
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  // Nunca interferir con llamadas al backend/auth
  if (url.includes('script.google.com')) return;
  if (url.includes('accounts.google.com')) return;
  if (url.includes('googleapis.com')) return;

  if (esRecursoDinamico(url)) {
    // NETWORK-FIRST: siempre intenta el servidor. Si funciona, actualiza el
    // caché para la próxima vez. Si falla (offline), cae al caché.
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copia)).catch(()=>{});
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
  } else {
    // CACHE-FIRST: para imágenes, librerías CDN, íconos.
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copia)).catch(()=>{});
        }
        return res;
      }))
    );
  }
});
