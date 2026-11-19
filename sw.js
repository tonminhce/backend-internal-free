/* Backend Internal offline cache. Classic script, no dependencies.
   Sits at the app root so its default scope covers the whole site — a worker under
   assets/ could not control the pages, and GitHub Pages cannot send Service-Worker-Allowed. */

const SHELL = 'bi-shell-v1';
const DATA = 'bi-data-v1';
const IMG = 'bi-img-v1';
const KEEP = [SHELL, DATA, IMG];
const ROOT = new URL('./', self.location);
const href = (path) => new URL(path, ROOT).href;
const isStorable = (response) => response.ok && response.type === 'basic';

const SHELL_URLS = [
  './', 'index.html', 'assets/app.css', 'assets/app.js',
  'assets/lib/text.js', 'assets/lib/lang.js', 'assets/lib/syntax.js',
  'assets/lib/search.js', 'assets/lib/router.js', 'assets/fonts/fonts.css',
  'content/curriculum.json', 'site.webmanifest', 'assets/favicon.svg',
];

self.addEventListener('install', (event) => event.waitUntil(precache()));
self.addEventListener('activate', (event) => event.waitUntil(activate()));
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.get('range')) return;
  const path = appPath(new URL(request.url));
  if (path === null || path === 'sw.js') return;
  if (path.startsWith('assets/img/')) event.respondWith(cacheFirst(request, IMG));
  else if (path.startsWith('data/')) event.respondWith(staleWhileRevalidate(event, request, DATA));
  else if (path.startsWith('assets/') || path.startsWith('content/')) event.respondWith(staleWhileRevalidate(event, request, SHELL));
  else if (request.mode === 'navigate') event.respondWith(navigate(request));
});

function appPath(url) {
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return null;
  return url.pathname.slice(ROOT.pathname.length);
}

async function precache() {
  const cache = await caches.open(SHELL);
  const skipped = [];
  for (const path of SHELL_URLS) {
    try {
      const response = await fetch(href(path));
      if (isStorable(response)) await cache.put(href(path), response);
      else skipped.push(path);
    } catch {
      skipped.push(path);
    }
  }
  if (skipped.length) console.warn('[sw] not precached:', skipped.join(', '));
  await self.skipWaiting();
}

async function activate() {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => !KEEP.includes(name)).map((name) => caches.delete(name)));
  await self.clients.claim();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request).catch(() => null);
  if (response && isStorable(response)) await cache.put(request, response.clone());
  return response || unavailable(request);
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refreshed = fetch(request)
    .then((response) => (isStorable(response) ? cache.put(request, response.clone()).then(() => response) : response))
    .catch(() => null);
  if (!cached) return (await refreshed) || unavailable(request);
  event.waitUntil(refreshed);
  return cached;
}

async function navigate(request) {
  const response = await fetch(request).catch(() => null);
  return response || shellHtml();
}

function shellHtml() {
  return caches.match(href('index.html'), { cacheName: SHELL });
}

async function unavailable(request) {
  if (request.mode === 'navigate') {
    const shell = await shellHtml();
    if (shell) return shell;
  }
  return new Response('Không có nội dung offline cho tài nguyên này.', { status: 503, statusText: 'Offline', headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
