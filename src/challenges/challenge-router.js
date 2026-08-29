/* =============================================================
 * Train Hard Challenges — ChallengeRouter
 *
 * 1) читает URL (?challenge= или #challenge=);
 * 2) передаёт payload в ChallengeCodec.decode (все данные из URL
 *    недоверены и валидируются кодеком);
 * 3) очищает адресную строку (history.replaceState, в пределах
 *    документа);
 * 4) открывает Preview. Смешивания с React UI нет — оверлей
 *    самостоятельный. Join НЕ автоматический.
 * Ошибки (мусор/версия/размер/упражнение) — свой экран ошибки,
 *    приложение не падает.
 * ============================================================= */
(function () {
  'use strict';

  var PARAM = 'challenge';
  var HARD_URL_CAP = 100000;   // абсолютная защита от патологических URL;
                               // реальный лимит payload проверяет кодек (600) и
                               // слишком длинный покажет экран INVALID CHALLENGE

  function readAndClean() {
    var payload = null;
    try {
      var q = new URLSearchParams(location.search);
      var v = q.get(PARAM);
      if (v !== null && v.length <= HARD_URL_CAP) {
        payload = v;
        q.delete(PARAM);
        var clean = location.pathname + (q.toString() ? '?' + q : '') + location.hash;
        history.replaceState(null, '', clean);
        return payload;
      }
    } catch (e) { /* нет search — пробуем hash */ }

    try {
      var h = location.hash || '';
      var m = h.match(new RegExp('#' + PARAM + '=([A-Za-z0-9_-]+)'));
      if (m && m[1].length <= HARD_URL_CAP) {
        payload = m[1];
        var rest = h.replace(new RegExp('#' + PARAM + '=[A-Za-z0-9_-]+'), '');
        history.replaceState(null, '', location.pathname + location.search + rest);
      }
    } catch (e) {}
    return payload;
  }

  function boot() {
    var payload = readAndClean();
    if (!payload) return false;
    /* небольшая задержка: приложение дорисовывает свой boot-экран */
    setTimeout(function () {
      try {
        window.__THChallenges && window.__THChallenges.openPreview(payload);
      } catch (e) { /* preview не должен ломать приложение */ }
    }, 500);
    return true;
  }

  window.__THChallengeRouter = { boot: boot };

  /* автозапуск при загрузке (PWA cold launch и обычное открытие ссылки) */
  boot();
})();
