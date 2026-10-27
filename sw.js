// Offline support for the installed app.
// App files: network first (so updates arrive as soon as the tablet is online), cache as fallback.
// Google Fonts: cache first.
// Bump VERSION when APP_FILES changes; file contents refresh on their own.
const VERSION = 'v1';
const APP_CACHE = `app-${VERSION}`;
const FONT_CACHE = 'fonts';
const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/dom.js',
  'js/forms.js',
  'js/install.js',
  'js/signature.js',
  'js/store.js',
  'js/template.js',
  'vendor/jszip.min.js',
  'template/THSC_Cardiac_Rehab_Forms_BLANK.dotx',
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

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(FONT_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }));
    return;
  }

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
