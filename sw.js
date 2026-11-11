/* KantinSim — çevrimdışı önbellek (service worker)
 * Oyun tamamen statik dosyalardan oluşur; ilk açılıştan sonra internet olmadan da oynanır.
 * Sürüm: yayın iş akışı bu satırı commit SHA'sı ile, paket betiği tarih damgasıyla değiştirir;
 * böylece her yayında eski önbellek atılır.
 */
const CACHE_VERSION = 'dev';
const CACHE = 'kantinsim-' + CACHE_VERSION;
// Geliştirme sürümü: ağ öncelikli çalışır ki düzenlenen dosyalar anında görünsün.
// Yayında CACHE_VERSION commit SHA'sına dönüşür ve önbellek öncelikli olur.
const DEV = CACHE_VERSION === 'dev';

const ASSETS = [
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './css/base.css',
  './css/ui.css',
  './js/data.js',
  './js/core.js',
  './js/recipes.js',
  './js/audio.js',
  './js/art.js',
  './js/depth.js',
  './js/stations_prep.js',
  './js/stations_cook.js',
  './js/customers.js',
  './js/meta.js',
  './js/ui.js',
  './js/assist.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(cacheFonts)
      .then(() => self.skipWaiting())
  );
});

// İlk açılışta yazı tiplerini de sakla: tek ziyaretten sonra tam çevrimdışı olsun.
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Nunito:wght@500;600;700;800&display=swap';
async function cacheFonts() {
  try {
    const res = await fetch(FONT_CSS);
    if (!res.ok) return;
    const css = await res.text();
    const cache = await caches.open(CACHE);
    await cache.put(FONT_CSS, new Response(css, { headers: { 'content-type': 'text/css; charset=utf-8' } }));
    const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
    await Promise.all(urls.map(async url => {
      try {
        const r = await fetch(url);
        if (r.ok) await cache.put(url, r);
      } catch (e) { /* tek dosya atlanır */ }
    }));
  } catch (e) { /* ağ yok: yazı tipleri sistemden gelir */ }
}

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Aynı kaynaktaki dosyalar: önce önbellek (hızlı açılış), yoksa ağdan al ve sakla.
function cacheFirst(req) {
  return caches.match(req).then(hit => {
    if (hit) return hit;
    return fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    });
  });
}

// Sayfa istekleri: önce ağ (yeni sürümü görmek için), çevrimdışıysa önbellekteki sayfa.
function networkFirstPage(req) {
  return fetch(req)
    .then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
      }
      return res;
    })
    .catch(() => caches.match('./index.html').then(hit => hit || caches.match('./')));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (DEV) {
    e.respondWith(fetch(req).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(networkFirstPage(req));
    return;
  }

  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(req));
    return;
  }

  // Google Fonts: ilk çevrimiçi açılışta sakla, sonra çevrimdışı da yazı tipleri çalışsın.
  if (/(^|\.)fonts\.googleapis\.com$/.test(url.hostname) || /(^|\.)fonts\.gstatic\.com$/.test(url.hostname)) {
    e.respondWith(cacheFirst(req));
  }
});
