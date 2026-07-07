// estate_tycoon PWA 서비스워커.
// repo 루트(playwithme/)에 두어 scope 를 playwithme/ 로 넓힌다 → 공유 폴더 ../assets 까지 캐시 가능.
// 단, estate_tycoon/ 와 assets/ 요청에만 관여하고 다른 폴더(iso_colony 등)는 건드리지 않는다.
const CACHE = "estate-pwa-v1";
const SHELL = [
  "estate_tycoon/", "estate_tycoon/index.html",
  "estate_tycoon/style.css", "estate_tycoon/edit_layout.css",
  "estate_tycoon/manifest.json", "estate_tycoon/icon-192.png", "estate_tycoon/icon-512.png",
  "estate_tycoon/js/data.js", "estate_tycoon/js/start.js", "estate_tycoon/js/assets.js",
  "estate_tycoon/js/engine/engine.js", "estate_tycoon/js/engine/render.js", "estate_tycoon/js/engine/gnome.js",
  "estate_tycoon/js/engine/input.js", "estate_tycoon/js/engine/economy.js", "estate_tycoon/js/engine/edit.js",
  "estate_tycoon/js/engine/npc.js", "estate_tycoon/js/engine/ui.js", "estate_tycoon/js/engine/save.js",
  "estate_tycoon/js/engine/tutorial.js",
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

// stale-while-revalidate: 캐시 우선 응답 + 뒤에서 네트워크로 캐시 갱신. 오프라인이면 캐시로 동작.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (!(p.includes("/estate_tycoon/") || p.includes("/assets/"))) return;  // 다른 폴더는 관여 안 함
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = await c.match(req);
    const net = fetch(req).then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    return cached || (await net) || new Response("", { status: 504 });
  })());
});
