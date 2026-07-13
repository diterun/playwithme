// "달려" (runlog) PWA 서비스워커.
// runlog/ 폴더 안에 두고 index.html 에서 register("sw.js") → scope 가 runlog/ 로 한정된다.
// 그래서 같은 repo 의 estate_tycoon / iso_colony 요청은 절대 건드리지 않는다.
const CACHE = "dalyeo-v2";
const SHELL = [
  "./", "./index.html",
  "./css/style.css",
  "./js/core.js", "./js/data.js", "./js/records.js", "./js/health.js", "./js/app.js",
  "./pwa/manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));  // 하나 실패해도 설치는 진행
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// stale-while-revalidate: 캐시 우선 응답 + 뒤에서 네트워크로 갱신. 오프라인이면 캐시로 동작.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = await c.match(req);
    const net = fetch(req).then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    return cached || (await net) || new Response("", { status: 504 });
  })());
});
