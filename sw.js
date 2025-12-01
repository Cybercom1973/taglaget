const CACHE_NAME = 'taglage-v7-safe';

// VIKTIGT: Använd relativa sökvägar './' så det funkar i undermappar (t.ex. /taglage/)
const urlsToCache = [
  './',
  './index.html',
  './train.html',
  './css/style.css',
  './js/app.js',
  './js/train.js',
  './js/api.js'
  // Tog bort favicon.ico för att undvika krasch
];

self.addEventListener('install', function(event) {
  self.skipWaiting(); // Tvinga ny version direkt
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // Försök cacha filer, men krascha inte om en misslyckas
      return Promise.all(
        urlsToCache.map(url => {
            return cache.add(url).catch(err => {
                console.warn('Kunde inte cacha fil:', url, err);
            });
        })
      );
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim()); // Ta kontroll direkt
  
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', function(event) {
  // Ignorera API-anrop
  if (event.request.url.includes('api.trafikinfo.trafikverket.se')) return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
