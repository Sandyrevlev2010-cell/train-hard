/* =============================================================
 * Train Hard — ARENA: конфигурация (группы и лидерборды на backend)
 *
 * apiBase — базовый URL API ('' = тот же домен, /api/...).
 *   Для продакшена указать адрес backend, например:
 *   window.TRAINHARD_ARENA = { apiBase: 'https://trainhard-api.onrender.com' }
 * botAppLink — шаблон deep-link для инвайтов: Telegram startapp
 *   (§34). Пусто → показываем только код, без ссылки.
 *
 * БЕЗ initData от Telegram арена неактивна (нужна серверная
 * авторизация) — в обычном PWA-билде кнопка не показывается.
 * ============================================================= */
(function () {
  'use strict';
  window.TRAINHARD_ARENA = Object.assign({
    apiBase: '',                 // '' → fetch('/api/...') на том же домене
    botAppLink: '',              // 'https://t.me/<bot>/<app>?startapp='
    inviteTtlNote: 'код живёт 24 часа и одноразовый'
  }, window.TRAINHARD_ARENA || {});
})();
