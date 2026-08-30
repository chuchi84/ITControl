// Service Worker — GitHub Pages (ruta /ITControl/) — v57
// FIX login Supabase: el SW NO debe interceptar Supabase ni los OAuth
// (Google/Microsoft), porque son navegaciones con redirect y romperían el login.
// v57: agrega WEB PUSH (avisos de tickets/tareas/mantenciones).
const CACHE = 'itcontrol-v57';
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
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS_PRECARGA)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({ type: 'SW_ACTIVADO', version: CACHE }));
      }))
  );
});

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

  // ⬇️ CLAVE: dejar pasar directo (sin tocar) Supabase y los OAuth.
  if (url.includes('supabase.co')) return;
  if (url.includes('supabase.in')) return;
  if (url.includes('accounts.google.com')) return;
  if (url.includes('login.microsoftonline.com')) return;
  if (url.includes('login.live.com')) return;
  if (url.includes('googleapis.com')) return;
  // Nunca interceptar navegaciones cross-origin (redirects de login).
  if (e.request.mode === 'navigate' && new URL(url).origin !== self.location.origin) return;

  if (esRecursoDinamico(url)) {
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

// ──────────────────────────────────────────────────────────────────────
// WEB PUSH: mostrar la notificación cuando el servidor la envía.
// ─────────────────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'ITControl';
  const opts = {
    body: d.body || '',
    icon: '/ITControl/icon-192.png',
    badge: '/ITControl/icon-192.png',
    data: { url: d.url || '/ITControl/' },
    tag: d.tag || 'itcontrol',
    renotify: true,
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// Al tocar la notificación: enfocar una pestaña abierta de la app o abrir una.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = (e.notification.data && e.notification.data.url) || '/ITControl/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes('/ITControl') && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(destino);
    })
  );
});
