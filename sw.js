// Service Worker — mismo código sirve para GitHub Pages (/ITControl/) y para
// un dominio propio (ej. itcontrol.kendal.cl, en la raíz) — v59
// FIX login Supabase: el SW NO debe interceptar Supabase ni los OAuth
// (Google/Microsoft), porque son navegaciones con redirect y romperían el login.
// v57: agrega WEB PUSH (avisos de tickets/tareas/mantenciones).
// v58: número en el ícono (App Badge) + notificación fija (requireInteraction).
// v59: sistema de control de versiones — version.json nunca se cachea, los
// recursos dinámicos (html/js/css/json) se piden siempre con cache:'no-store'
// para no depender de la caché HTTP del navegador, y el registro en index.html
// usa updateViaCache:'none' para que el propio sw.js tampoco quede cacheado.
// Además: las rutas ya NO están fijas a "/ITControl/" — se calculan desde el
// scope real del Service Worker (self.registration.scope), así el mismo
// sw.js funciona igual en https://chuchi84.github.io/ITControl/ que en
// https://itcontrol.kendal.cl/ sin tener que mantener dos versiones.
const CACHE = 'itcontrol-v59';
const BASE = self.registration.scope; // termina siempre en "/"
const ASSETS_PRECARGA = [
    BASE,
    BASE + 'index.html',
    BASE + 'manifest.json',
    BASE + 'icon-192.png',
    BASE + 'icon-512.png',
    BASE + 'apple-touch-icon.png',
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

                        // version.json: SIEMPRE a la red, nunca a caché. Es la fuente de verdad
                        // que usa index.html para saber si hay una versión nueva publicada.
                        if (url.includes('/version.json')) {
                              e.respondWith(fetch(e.request, { cache: 'no-store' }));
                              return;
                        }

                        if (esRecursoDinamico(url)) {
                              e.respondWith(
                                      // cache:'no-store' evita que la caché HTTP del navegador (no la del SW)
                                      // sirva una copia vieja de index.html/js/css mientras decide si hay red.
                                      fetch(e.request, { cache: 'no-store' }).then(res => {
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

// ─────────────────────────────────────────────────────────────────────
// WEB PUSH: mostrar la notificación cuando el servidor la envía.
// ────────────────────────────────────────────────────────────────────
self.addEventListener('push', e => {
    let d = {};
    try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
    const title = d.title || 'ITControl';
    const opts = {
          body: d.body || '',
          icon: BASE + 'icon-192.png',
          badge: BASE + 'icon-192.png',
          data: { url: d.url || BASE },
          tag: d.tag || ('itcontrol-' + Date.now()),  // único: se acumulan varias
          renotify: true,
          requireInteraction: true,                    // queda fija arriba hasta tocarla
    };
    e.waitUntil((async () => {
          await self.registration.showNotification(title, opts);
          // Número en el ícono (App Badge): usa el count que manda el servidor.
                     try {
                             if (self.navigator && self.navigator.setAppBadge) {
                                       if (typeof d.count === 'number') await self.navigator.setAppBadge(d.count);
                                       else await self.navigator.setAppBadge();
                             }
                     } catch (err) {}
    })());
});

// Al tocar la notificación: enfocar una pestaña abierta de la app o abrir una.
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const destino = (e.notification.data && e.notification.data.url) || BASE;
    e.waitUntil(
          self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
                  for (const c of clients) {
                            if (c.url.startsWith(BASE) && 'focus' in c) return c.focus();
                  }
                  if (self.clients.openWindow) return self.clients.openWindow(destino);
          })
        );
});
