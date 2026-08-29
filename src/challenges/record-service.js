/* =============================================================
 * Train Hard Challenges — PersonalRecordService
 *
 * ТОНКИЙ слой чтения поверх СУЩЕСТВУЮЩЕЙ системы рекордов
 * Train Hard (state.progress / state.records в
 * trainhard_react_data_<login>). Второй таблицы рекордов
 * не создаётся; ничего не пишется.
 * ============================================================= */
(function () {
  'use strict';

  var Storage = window.TrainHardStorage;
  var EXE_INDEX = { bench: 'bench', squat: 'squat', deadlift: 'deadlift' };

  function login() {
    var s = Storage ? Storage.get('trainhard_react_session', null) : null;
    return (typeof s === 'string' && s) ? s : 'guest';
  }

  function state() {
    var st = Storage ? Storage.get('trainhard_react_data_' + login(), null) : null;
    return (st && typeof st === 'object' && !Array.isArray(st)) ? st : {};
  }

  /* Лучший подтверждённый результат по упражнению (кг) или null */
  function getBest(exercise) {
    var key = EXE_INDEX[exercise];
    if (!key) return null;
    var st = state();
    var best = null;
    /* progress: { bench: [{month:'YYYY-MM', weight:N}, ...] } */
    var prog = st.progress;
    if (prog && typeof prog === 'object' && !Array.isArray(prog) && Array.isArray(prog[key])) {
      for (var i = 0; i < prog[key].length; i++) {
        var e = prog[key][i];
        if (e && typeof e === 'object' && isFinite(Number(e.weight)) && Number(e.weight) > 0) {
          var w = Number(e.weight);
          if (best === null || w > best) best = w;
        }
      }
    }
    /* records: { 'YYYY-MM-DD': { '01': { bench: N } } } — страховочный источник */
    if (best === null && st.records && typeof st.records === 'object') {
      Object.keys(st.records).forEach(function (day) {
        var sets = st.records[day];
        if (!sets || typeof sets !== 'object') return;
        Object.keys(sets).forEach(function (sn) {
          var w = sets[sn] && Number(sets[sn][key]);
          if (isFinite(w) && w > 0 && (best === null || w > best)) best = w;
        });
      });
    }
    return best;
  }

  window.__THRecords = { getBest: getBest };
})();
