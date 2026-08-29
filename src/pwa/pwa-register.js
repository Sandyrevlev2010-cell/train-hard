/* =============================================================
 * Train Hard MVP — PWA
 * manifest + иконки лежат рядом с index.html; кэширует оболочку
 * для офлайн-запуска при установке «на главный экран».
 * В sandbox/предпросмотре и file:// просто тихо пропускается.
 * ============================================================= */
(function () {
  'use strict';
  try {
    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function () { /* офлайн-режим не критичен: всё и так в одном файле */ });
      });
    }
  } catch (e) { /* предпросмотр/старые браузеры — просто без SW */ }
})();
