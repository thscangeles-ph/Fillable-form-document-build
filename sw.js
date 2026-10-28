// Offline support for the installed app.
// Network first (so updates arrive as soon as the tablet is online), cache as fallback.
// Bump VERSION when APP_FILES changes; file contents refresh on their own.
const VERSION = 'v4';
const APP_CACHE = `app-${VERSION}`;
const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'css/fonts.css',
  'assets/fonts/fraunces-latin-600-normal.woff2',
  'assets/fonts/fraunces-latin-700-normal.woff2',
  'assets/fonts/lexend-latin-400-normal.woff2',
  'assets/fonts/lexend-latin-500-normal.woff2',
  'assets/fonts/lexend-latin-600-normal.woff2',
  'assets/fonts/lexend-latin-700-normal.woff2',
  'js/app.js',
  'js/dashboard.js',
  'js/dom.js',
  'js/forms.js',
  'js/install.js',
  'js/native.js',
  'js/signature.js',
  'js/store.js',
  'js/template.js',
  'vendor/jszip.min.js',
  'template/THSC_Cardiac_Rehab_Forms_BLANK.dotx',
  'panels/heart-shield.html',
  'assets/logo.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    try {
      // On slow clinic Wi-Fi, fall back to the cached copy instead of waiting.
      const res = await Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' && await cache.match('index.html'));
      if (hit) return hit;
      throw err;
    }
  })());
});
