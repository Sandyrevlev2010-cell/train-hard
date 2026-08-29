/* Train Hard — Telegram Mini App: boot-скрипт.
 * Выполняется ДО React-бандла (инлайн в <head>, сразу после telegram-web-app.js).
 * Задача: изолировать данные разных Telegram-аккаунтов на одном устройстве.
 *
 * Безопасность: initData без серверной проверки НЕ является доказательством
 * личности (см. docs/TELEGRAM-MINIAPP.md) — id используется только как
 * локальный суффикс ключа хранилища. В обычном браузере скрипт ничего не делает. */
(function () {
  'use strict';
  try {
    var wa = window.Telegram && window.Telegram.WebApp;
    var user = wa && wa.initDataUnsafe && wa.initDataUnsafe.user;
    if (!user || !user.id) return;
    var key = 'tg' + user.id;
    var SESSION = 'trainhard_react_session';
    var cur = null;
    try { cur = localStorage.getItem(SESSION); } catch (e) {}
    if (cur === key) return;                       /* уже в этом аккаунте */
    /* первый заход под этим Telegram-аккаунтом: унаследовать гостевые
       прогресс/настройки, чтобы пользователь ничего не потерял */
    try {
      var guest = localStorage.getItem('trainhard_react_data_guest');
      if (guest && !localStorage.getItem('trainhard_react_data_' + key)) {
        localStorage.setItem('trainhard_react_data_' + key, guest);
      }
    } catch (e) {}
    try { localStorage.setItem(SESSION, key); } catch (e) {}
  } catch (e) { /* обычный браузер или приватный режим — работаем как есть */ }
})();
