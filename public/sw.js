/* Radar de Niko — service worker.
 * Réseau d'abord pour la veille (toujours la plus fraîche en ligne),
 * cache en repli : hors ligne, la dernière veille reçue reste lisible. */
const CACHE = 'radar-v1';
const SHELL = ['./', 'index.html', 'radar.xml', 'radar.jsonl', 'manifest.webmanifest',
               'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    // Polices Google : cache d'abord, elles ne changent pas.
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
      e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
      })));
    }
    return;
  }
  const isPage = req.mode === 'navigate';
  e.respondWith(
    fetch(req, { cache: 'no-store' }).then(res => {
      if (res.ok) {
        const copy = res.clone();
        // Une seule entrée pour la page, quels que soient les paramètres (?f=new, ?source=pwa)
        caches.open(CACHE).then(c => c.put(isPage ? './' : req, copy));
      }
      return res;
    }).catch(() => caches.match(isPage ? './' : req, { ignoreSearch: true })
      .then(hit => hit || (isPage ? caches.match('index.html') : Response.error())))
  );
});
