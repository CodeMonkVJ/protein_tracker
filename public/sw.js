const CACHE_PREFIX = 'protein-club-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v2';
const SHELL = [
  '/', '/style.css', '/app.js', '/pwa.js', '/app.webmanifest', '/catalog.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/images/hero-plate.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' })));
    const catalog = await (await cache.match('/catalog.json')).json();
    const sprites = [...new Set(catalog.map(({ asset }) => `/images/${asset}.webp`))];
    await cache.addAll(sprites);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  const navigation = request.mode === 'navigate';
  const staticAsset = SHELL.includes(url.pathname) || url.pathname.startsWith('/images/');
  if (!navigation && !staticAsset) return;

  event.respondWith((async () => {
    try {
      return await fetch(request);
    } catch {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(navigation ? '/' : url.pathname) || Response.error();
    }
  })());
});
