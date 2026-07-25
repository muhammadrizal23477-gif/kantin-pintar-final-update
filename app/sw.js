// Service worker minimal - supaya aplikasi bisa "diinstall" sebagai PWA.
// Tidak melakukan caching data (data selalu ambil dari server, real-time).
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Selalu ambil langsung dari jaringan (bukan dari cache),
  // supaya data menu/pesanan selalu yang terbaru.
  e.respondWith(fetch(e.request));
});
