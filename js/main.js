/* KantinSim — başlatıcı (çekirdek) */
(function (KS) {
  'use strict';
  function start() { KS.boot(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window.KS);
