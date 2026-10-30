// 오프라인 동작 + "공유"로 받은 파일 전달
const VERSION = 'v1.000';
const APP_CACHE = `app-${VERSION}`;
const FONT_CACHE = 'fonts-v1';
const APP_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'lib/rhwp.js', 'lib/rhwp_bg.wasm',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('app-') && k !== APP_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const file = form.getAll('file').find((f) => f && f.name);
    if (file) {
      const cache = await caches.open('share-inbox');
      await cache.put('shared-file', new Response(file, {
        headers: { 'x-file-name': encodeURIComponent(file.name) },
      }));
    }
  } catch (err) {
    console.error(err);
  }
  return Response.redirect('./?shared=1', 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;

  // 글꼴: 한 번 받으면 계속 재사용
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  // 앱 파일: 네트워크 우선(최신 버전 반영), 안 되면 캐시
  e.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && !url.search) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return cache.match('index.html');
      throw new Error('offline');
    }
  })());
});
