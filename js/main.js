/* KantinSim — başlatıcı (çekirdek) */
(function (KS) {
  'use strict';
  function start() { KS.boot(); }
  // Çevrimdışı/kurulabilir sürüm: yalnız http(s) üzerinde servis çalışanı kaydet
  // (dosyadan açıldığında file:// altında service worker çalışmaz).
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* çevrimdışı destek yok */ });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { start(); registerServiceWorker(); });
  else { start(); registerServiceWorker(); }
})(window.KS);
