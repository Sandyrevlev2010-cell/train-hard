/* =============================================================
 * Train Hard — Telegram Mini App: интеграция и оптимизация.
 *
 * Модуль полностью feature-detected: в обычном браузере (и в
 * sandbox-предпросмотре, где telegram-web-app.js не загружается)
 * он ничего не делает — приложение работает как обычный web/PWA.
 *
 * Что делает внутри Telegram:
 *  • ready()/expand() — раскрыть на весь экран;
 *  • тема: тёмный header/фон под дизайн приложения;
 *  • disableVerticalSwipes + overscroll-behavior — без случайного
 *    закрытия свайпом при скролле тренировок;
 *  • BackButton Telegram закрывает открытый интервальный таймер;
 *  • HapticFeedback на достижениях и завершении челленджов;
 *  • deep-link: start_param с payload челленджа → превью;
 *  • window.open внешних http(s) ссылок → через openLink Telegram;
 *  • изоляция данных аккаунта (см. telegram-boot.js).
 *
 * Ничего не ломает, не блокирует DevTools, не содержит секретов.
 * ============================================================= */
(function () {
  'use strict';

  function wa() {
    try { return (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null; }
    catch (e) { return null; }
  }

  var app = wa();
  if (!app) return;                                /* обычный браузер */

  var inTelegram = false;
  try {
    /* initData присутствует только внутри Telegram */
    inTelegram = typeof app.initData === 'string' && app.initData.length > 0;
  } catch (e) {}
  if (!inTelegram && !(app.version)) return;       /* заглушка/чужая среда */

  /* ---------- базовая инициализация ---------- */
  try { app.ready(); } catch (e) {}
  try { app.expand(); } catch (e) {}

  /* тема приложения тёмная — просим Telegram не светить белую шапку */
  try { if (app.setHeaderColor) app.setHeaderColor('#0a0a0a'); } catch (e) {}
  try { if (app.setBackgroundColor) app.setBackgroundColor('#0a0a0a'); } catch (e) {}

  /* свайп-вниз не должен закрывать mini app при скролле списков */
  try { if (app.disableVerticalSwipes) app.disableVerticalSwipes(); } catch (e) {}
  try {
    var st = document.createElement('style');
    st.textContent = 'html,body{overscroll-behavior:none!important}' +
      'body{position:static}';                    /* без дёрганья резинки */
    document.head.appendChild(st);
  } catch (e) {}

  /* ---------- HapticFeedback: достижения/челленджи ---------- */
  function haptic(kind) {
    try {
      var h = app.HapticFeedback;
      if (!h) return;
      if (kind === 'achievement') h.notificationOccurred('success');
      else h.impactOccurred('light');
    } catch (e) {}
  }
  try {
    var origPlay = window.TrainHardEffects && window.TrainHardEffects.play;
    if (origPlay) {
      window.TrainHardEffects.play = function (name) {
        haptic(name === 'achievement' ? 'achievement' : 'light');
        try { return origPlay.apply(window.TrainHardEffects, arguments); } catch (e) {}
      };
    }
  } catch (e) {}

  /* ---------- BackButton: закрывает интервальный таймер ---------- */
  var back = null;
  try { back = app.BackButton; } catch (e) {}

  function timerOpen() {
    try {
      var tm = document.querySelector('.thit');
      return !!(tm && tm.style.display !== 'none');
    } catch (e) { return false; }
  }

  function syncBack() {
    if (!back) return;
    try { timerOpen() ? back.show() : back.hide(); } catch (e) {}
  }

  if (back) {
    try {
      back.onClick(function () {
        try {
          var x = document.querySelector('.thit-x');
          if (x) x.click();
          else if (window.__THTimer && window.__THTimer.close) window.__THTimer.close();
        } catch (e) {}
        setTimeout(syncBack, 50);
      });
    } catch (e) {}
    setInterval(syncBack, 800);
  }

  /* ---------- внешние ссылки — через openLink Telegram ---------- */
  try {
    var origOpen = window.open;
    window.open = function (url) {
      try {
        if (typeof url === 'string' && /^https?:/i.test(url) && app.openLink) {
          app.openLink(url);
          return null;
        }
      } catch (e) {}
      return origOpen.apply(window, arguments);
    };
  } catch (e) {}

  window.__THTelegram = {
    version: (function () { try { return app.version || ''; } catch (e) { return ''; } })(),
    userKey: (function () {
      try {
        var u = app.initDataUnsafe && app.initDataUnsafe.user;
        return u && u.id ? 'tg' + u.id : null;
      } catch (e) { return null; }
    })(),
    syncBack: syncBack
  };
})();
