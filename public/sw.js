/* SW Tick Lab service worker：讓網站可以安裝成 App，並在離線時仍能開啟。 */
const scope = self.registration.scope;
const version = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `swticklab-${version}`;
const INDEX = new URL("index.html", scope).href;
const API_PREFIX = new URL("api/", scope).pathname;
const PRECACHE = [scope, INDEX, new URL("manifest.webmanifest", scope).href];

/** 預先快取入口 HTML 與它引用的 JS / CSS，安裝後第一次離線就能開啟。 */
async function precache() {
  const cache = await caches.open(CACHE);
  const urls = new Set(PRECACHE);
  try {
    const response = await fetch(INDEX, { cache: "reload" });
    if (response.ok) {
      await cache.put(INDEX, response.clone());
      const html = await response.text();
      for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        const value = match[1];
        if (!value || value.startsWith("data:") || value.startsWith("#")) continue;
        try {
          const url = new URL(value, INDEX);
          if (url.origin === self.location.origin) urls.add(url.href);
        } catch {
          /* 忽略無法解析的 URL */
        }
      }
    }
  } catch {
    /* 離線或入口不存在時，至少保留下面的基本快取 */
  }
  await Promise.all([...urls].map((url) => cache.add(url).catch(() => undefined)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precache();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(INDEX)) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(API_PREFIX)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
