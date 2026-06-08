// Eviko service worker — uygulama kabuğunu önbelleğe alır (PWA / çevrimdışı destek).
const CACHE = "eviko-v26";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/ai.js",
  "/config.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API çağrıları önbelleğe alınmaz — her zaman ağdan.
  if (url.pathname.startsWith("/api/")) return;

  // Sayfa gezinmelerinde: ağ önce, çevrimdışıysa kabuk.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/index.html")));
    return;
  }

  // Diğer statik dosyalar: önbellek önce, yoksa ağdan getir ve sakla.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
    )
  );
});
