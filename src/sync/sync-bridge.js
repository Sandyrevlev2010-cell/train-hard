/* =============================================================
 * Train Hard — Sync Bridge (очередь офлайн-операций, §29/§30)
 *
 * Локальные тренировки (state.records в trainhard_react_data_<login>)
 * остаются офлайн-источником для UI, но дельта изменений уходит на
 * сервер: Backend API → PostgreSQL. Так серверные лидерборды ARENA
 * считаются из настоящей истории.
 *
 * Как работает:
 *  • обёртка над StorageService.set: запись в records → «грязные» даты;
 *  • flush(): новые даты → POST /api/sync (идемпотентно по дате),
 *      новые подходы → POST /api/workouts/:id/sets (идемпотентный ключ
 *      date:set:exercise), удалённые подходы/даты → DELETE;
 *  • состояние {date:{hash,wid,sets}} в localStorage — повторный flush
 *      без изменений не делает НИ ОДНОГО запроса; двойной flush не
 *      создаёт дублей (сервер + ключи идемпотентности).
 *
 * Без Telegram initData мост неактивен (нет серверной сессии) —
 * приложение продолжает работать офлайн, данные не теряются.
 * ============================================================= */
(function () {
  'use strict';

  var API = window.__THAPI;
  var Storage = window.TrainHardStorage;

  var STATE_KEY = 'trainhard_sync_state';
  var EXE = ['squat', 'bench', 'deadlift'];
  var timer = null;
  var flushing = false;

  function login() {
    var s = Storage ? Storage.get('trainhard_react_session', null) : null;
    return (typeof s === 'string' && s) ? s : 'guest';
  }
  function dataKey() { return 'trainhard_react_data_' + login(); }
  function records() {
    var st = Storage ? Storage.get(dataKey(), null) : null;
    return (st && st.records && typeof st.records === 'object' && !Array.isArray(st.records)) ? st.records : {};
  }
  function loadState() {
    var v = Storage ? Storage.get(STATE_KEY, null) : null;
    return (v && v.dates && typeof v.dates === 'object') ? v : { dates: {} };
  }
  function saveState(st) { if (Storage) Storage.set(STATE_KEY, st); }

  /* Стабильный хэш дня: только валидные веса (число > 0), сортировка ключей */
  function hashDay(day) {
    var parts = [];
    Object.keys(day).sort().forEach(function (sn) {
      var sets = day[sn];
      if (!sets || typeof sets !== 'object') return;
      EXE.forEach(function (ex) {
        var w = Number(sets[ex]);
        if (isFinite(w) && w > 0) parts.push(sn + '.' + ex + '=' + w);
      });
    });
    return parts.join('|');
  }
  /* Валидные подходы дня: [{sn, exercise, weight}] */
  function daySets(day) {
    var out = [];
    Object.keys(day).forEach(function (sn) {
      var n = parseInt(sn, 10);
      var sets = day[sn];
      if (!sets || typeof sets !== 'object' || !isFinite(n) || n < 1 || n > 50) return;
      EXE.forEach(function (ex) {
        var w = Number(sets[ex]);
        if (isFinite(w) && w > 0 && w <= 1000) out.push({ sn: n, exercise: ex, weight: Math.round(w * 100) / 100 });
      });
    });
    return out;
  }

  /* Обёртка StorageService.set — планирование flush при записи данных приложения */
  if (Storage && typeof Storage.set === 'function' && !Storage.__syncWrapped) {
    var origSet = Storage.set.bind(Storage);
    Storage.set = function (key, value) {
      var r = origSet(key, value);
      if (key === dataKey() && value && value.records) schedule();
      return r;
    };
    Storage.__syncWrapped = true;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 3000);       /* дебаунс: бурные записи → один flush */
  }

  async function flush() {
    if (flushing) return { ok: true, skipped: true };      /* двойной flush не дублирует */
    if (!API || !API.available()) return { ok: false, reason: 'telegram-required' };
    flushing = true;
    try {
      var st = loadState();
      var recs = records();
      var touched = false;

      /* 1. Новые даты → POST /api/sync (идемпотентно по 'w:date') */
      var newDates = Object.keys(recs).filter(function (d) { return !st.dates[d]; });
      if (newDates.length) {
        var ops = newDates.map(function (d) {
          return { id: 'w:' + d, method: 'POST', path: '/api/workouts', body: { date: d, title: 'Тренировка' } };
        });
        var r = await API.request('POST', '/api/sync', { ops: ops });
        if (!r.ok) return { ok: false, reason: r.reason || ('status-' + r.status) };
        r.body.results.forEach(function (res, i) {
          var d = newDates[i];
          if (res.status === 201 && res.body && res.body.workout) {
            st.dates[d] = { hash: '', wid: res.body.workout.id, sets: {} };
          } else if (res.status === 201 || res.status === 200) {
            st.dates[d] = st.dates[d] || { hash: '', wid: null, sets: {} };
          }
        });
        touched = true;
      }

      /* 2. Изменённые дни: дельта подходов */
      for (var d in recs) {
        if (!recs.hasOwnProperty(d)) continue;
        var meta = st.dates[d];
        if (!meta) continue;                       /* создание выше не удалось — следующий flush */
        var h = hashDay(recs[d]);
        if (h === meta.hash) continue;
        if (!meta.wid) {
          var one = await API.request('POST', '/api/workouts', { date: d, title: 'Тренировка', idempotency_key: 'w:' + d });
          if (!one.ok || !one.body || !one.body.workout) continue;
          meta.wid = one.body.workout.id;
        }
        var want = daySets(recs[d]);
        var wantKeys = {};
        want.forEach(function (s) { wantKeys[s.sn + ':' + s.exercise] = s; });
        /* добавить новые подходы */
        for (var k in wantKeys) {
          if (meta.sets[k]) continue;
          var s = wantKeys[k];
          var cr = await API.request('POST', '/api/workouts/' + meta.wid + '/sets', {
            exercise: s.exercise, set_number: s.sn, weight: s.weight, reps: 0,
            successful: true, idempotency_key: 's:' + d + ':' + k
          });
          if (cr.ok && cr.body && cr.body.set) { meta.sets[k] = cr.body.set.id; touched = true; }
        }
        /* удалить исчезнувшие подходы */
        for (var kk in meta.sets) {
          if (!meta.sets.hasOwnProperty(kk) || wantKeys[kk]) continue;
          var dr = await API.request('DELETE', '/api/sets/' + meta.sets[kk]);
          if (dr.ok || dr.status === 404) { delete meta.sets[kk]; touched = true; }
        }
        meta.hash = h;
        touched = true;
      }

      /* 3. Локально удалённые даты → DELETE на сервере */
      for (var dd in st.dates) {
        if (st.dates.hasOwnProperty(dd) && !recs[dd]) {
          if (st.dates[dd].wid) {
            var wd = await API.request('DELETE', '/api/workouts/' + st.dates[dd].wid);
            if (wd.ok || wd.status === 404) { delete st.dates[dd]; touched = true; }
          } else { delete st.dates[dd]; touched = true; }
        }
      }

      saveState(st);
      return { ok: true, touched: touched };
    } finally {
      flushing = false;
    }
  }

  function pendingCount() {
    var st = loadState(); var recs = records(); var n = 0;
    Object.keys(recs).forEach(function (d) {
      var m = st.dates[d];
      if (!m || m.hash !== hashDay(recs[d])) n++;
    });
    Object.keys(st.dates).forEach(function (d) { if (!recs[d]) n++; });
    return n;
  }

  window.addEventListener('online', function () { flush(); });
  window.addEventListener('beforeunload', function () { if (pendingCount()) flush(); });

  window.__THSync = {
    flush: flush,
    pending: pendingCount,
    _state: loadState,
    _records: records
  };
})();
