(function () {
  'use strict';

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) return;

    navigator.serviceWorker.register('service-worker.js').catch(function (error) {
      console.warn('Service worker registration failed', error);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    registerServiceWorker();
    AppUI.updateMetaView();
  });
})();
