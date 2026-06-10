// Eviko service worker — AĞ ÖNCELİKLİ (çevrimiçiyken her zaman en güncel sürüm).
// Önceki sürüm önbellek-öncelikliydi ve güncellemeler geç geliyordu; düzeltildi.
const CACHE = "eviko-v42";
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
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Sayfanın isteğiyle bekleyen yeni sürümü hemen devreye al.
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API çağrıları asla önbelleğe alınmaz — her zaman ağdan.
  if (url.pathname.startsWith("/api/")) return;

  // AĞ ÖNCE: çevrimiçiyken daima taze içerik; çevrimdışıysa önbellekten.
  event.respondWith(
    fetch(request)
      .then((res) => {
        // Başarılı yanıtın bir kopyasını önbelleğe yaz (çevrimdışı için).
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // Gezinmelerde çevrimdışı yedek olarak uygulama kabuğu.
          if (request.mode === "navigate") return caches.match("/index.html");
          return Response.error();
        })
      )
  );
});
