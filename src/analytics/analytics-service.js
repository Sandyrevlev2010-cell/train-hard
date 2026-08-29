/* =============================================================
 * Train Hard MVP — AnalyticsService
 * Минимальная анонимная аналитика БЕЗ внешних запросов.
 *
 * • События считаются локально (trainhard_analytics_v1);
 * • Никаких персональных данных, идентификаторов устройства,
 *   геолокации, платежных данных и иной чувствительной информации;
 * • Список событий — белый список (лишнее не запишется);
 * • Прочитанное из localStorage состояние валидируется
 *   (неожиданные структуры отбрасываются);
 * • Когда появится backend/сторонний провайдер — достаточно
 *   подменить transport() в одном месте.
 * ============================================================= */
(function () {
  'use strict';

  var Storage = window.TrainHardStorage;
  var KEY = 'trainhard_analytics_v1';
  var MAX_DAYS_KEPT = 90;          // ограничиваем рост локальных счётчиков

  var WHITELIST = [
    'app_open',            // открытие приложения
    'workout_open',        // открыли экран тренировки
    'workout_complete',    // завершили тренировку
    'premium_open',        // открыли экран Premium
    'buy_click',           // нажали кнопку покупки
    'purchase_success',    // Premium активирован (после подтверждения)
    'purchase_cancel',     // закрыли оплату без подтверждения
    'challenge_created',   // создан челлендж
    'challenge_shared',    // поделились челленджем/результатом
    'challenge_joined',    // присоединились к челленджу
    'challenge_completed'  // челлендж завершён
  ];

  function nowDay() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* Валидация прочитанного состояния: только ожидаемая структура,
     только числа-счётчики, только известные события. */
  function validateState(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    var out = { first: isFinite(Number(s.first)) ? Number(s.first) : Date.now(), last: isFinite(Number(s.last)) ? Number(s.last) : Date.now(), events: {}, days: {} };
    if (s.events && typeof s.events === 'object' && !Array.isArray(s.events)) {
      Object.keys(s.events).forEach(function (k) {
        if (WHITELIST.indexOf(k) !== -1 && isFinite(Number(s.events[k])) && s.events[k] >= 0) {
          out.events[k] = Math.min(1e9, Math.floor(Number(s.events[k])));
        }
      });
    }
    if (s.days && typeof s.days === 'object' && !Array.isArray(s.days)) {
      var days = Object.keys(s.days).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort().slice(-MAX_DAYS_KEPT);
      days.forEach(function (d) {
        var src = s.days[d] || {}, dst = {};
        Object.keys(src).forEach(function (k) {
          if (WHITELIST.indexOf(k) !== -1 && isFinite(Number(src[k])) && src[k] >= 0) {
            dst[k] = Math.min(1e9, Math.floor(Number(src[k])));
          }
        });
        out.days[d] = dst;
      });
    }
    return out;
  }

  var state = Storage
    ? Storage.getValidated(KEY, validateState, null) || { first: Date.now(), last: Date.now(), events: {}, days: {} }
    : { first: Date.now(), last: Date.now(), events: {}, days: {} };

  /** Точка подмены при появлении провайдера (backend/метрика).
   *  Запрещено передавать сюда чувствительные данные. */
  function transport(name, payload) {
    /* MVP: локально, сеть не используется. Пример будущего:
       fetch(Storage.backend.baseUrl + '/events', {...}) */
  }

  function track(name, extra) {
    if (WHITELIST.indexOf(name) === -1) return;      // собираем только необходимое
    try {
      state.events[name] = (state.events[name] || 0) + 1;
      state.last = Date.now();
      var day = nowDay();
      state.days[day] = state.days[day] || {};
      state.days[day][name] = (state.days[day][name] || 0) + 1;
      if (Storage) Storage.set(KEY, state);
      transport(name, extra || null);
    } catch (e) { /* аналитика не должна ломать приложение */ }
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  window.__THAnalytics = { track: track, snapshot: snapshot, events: WHITELIST };

  track('app_open');
})();
