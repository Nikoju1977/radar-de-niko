/* Radar de Niko — service worker.
 * Réseau d'abord pour la veille (toujours la plus fraîche en ligne),
 * cache en repli : hors ligne, la dernière veille reçue reste lisible. */
const CACHE = 'radar-v4';
const SHELL = ['./', 'index.html', 'quotidien.html', 'v3/index.html', 'v3/radar-v3.json', 'facebook.txt', 'radar.xml', 'radar.jsonl', 'manifest.webmanifest',
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
  const navKey = isPage
    ? (/\/v3\/?(?:index\.html)?$/.test(url.pathname) ? 'v3/index.html'
      : /\/quotidien\.html$/.test(url.pathname) ? 'quotidien.html'
      : './')
    : req;
  // Une requête de navigation ne peut pas être recopiée avec des options
  // (TypeError sur Chrome et Safari) : on en reconstruit une à partir de l'URL.
  const net = isPage
    ? fetch(new Request(url.href, { cache: 'no-store', credentials: 'same-origin' }))
    : fetch(req, { cache: 'no-store' });
  e.respondWith(
    net.then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(navKey, copy));
      }
      return res;
    }).catch(() => caches.match(navKey, { ignoreSearch: true })
      .then(hit => hit || (isPage ? caches.match('index.html') : Response.error())))
  );
});
