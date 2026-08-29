/* =============================================================
 * Train Hard Challenges — ChallengeService
 *
 * Полностью локальная логика челленджей. Хранение — через
 * существующий StorageService (localStorage + memory-фолбэк),
 * ключ trainhard_v1_challenges. Никакого backend.
 *
 * Архитектура (будущее — без переписывания UI):
 *   ChallengeService → LocalChallengeProvider (сейчас)
 *   ChallengeService → CloudChallengeProvider (2.0, не реализован)
 * Провайдер инкапсулирован в конце файла (loadAll/persist).
 *
 * Принципы:
 *  • Challenge DATA self-contained в ссылке; id — не источник данных;
 *  • никакого прогресса друзей/лидербордов (без backend это неизвестно);
 *  • time-based логика локальная (accepted limitation: часы устройства);
 *  • strength goal — личный трекер цели, не соревнование и не медрекомендация.
 * ============================================================= */
(function () {
  'use strict';

  var Storage = window.TrainHardStorage;
  var Codec = window.__THChallengeCodec;
  var KEY = 'trainhard_v1_challenges';
  var DAY = 86400000;
  var FREE_ACTIVE_LIMIT = 3;
  var PREMIUM_ACTIVE_LIMIT = 10;

  function isPremium() {
    try { return !!(window.__THPrem && window.__THPrem.isPremium()); } catch (e) { return false; }
  }
  function track(ev) {
    try { window.__THAnalytics && window.__THAnalytics.track(ev); } catch (e) {}
  }

  /* ---------------- LocalChallengeProvider ---------------- */
  function sanitizeStored(ch) {
    if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return null;
    if (typeof ch.id !== 'string' || !/^TH[A-Z0-9]{4,8}$/.test(ch.id)) return null;
    var out = {
      id: ch.id,
      type: ch.type === 'strength' ? 'strength' : 'workout',
      title: (typeof ch.title === 'string' ? ch.title : '').slice(0, 60),
      durationDays: Codec.isValidDuration(Number(ch.durationDays)) ? Math.floor(Number(ch.durationDays)) : 7,
      speechId: typeof ch.speechId === 'string' ? ch.speechId.slice(0, 8) : 's1',
      joinedAt: Number(ch.joinedAt) > 0 ? Number(ch.joinedAt) : 0,
      completedWorkouts: isFinite(Number(ch.completedWorkouts)) ? Math.max(0, Math.floor(Number(ch.completedWorkouts))) : 0,
      lastWorkoutDate: typeof ch.lastWorkoutDate === 'string' ? ch.lastWorkoutDate.slice(0, 10) : '',
      strengthCurrent: (ch.strengthCurrent === null || ch.strengthCurrent === undefined || !isFinite(Number(ch.strengthCurrent))) ? null : Math.min(1000, Number(ch.strengthCurrent)),
      completedAt: Number(ch.completedAt) > 0 ? Number(ch.completedAt) : 0,
      notice: typeof ch.notice === 'string' ? ch.notice.slice(0, 80) : ''
    };
    if (out.type === 'strength') {
      var e = ch.strengthGoal && ch.strengthGoal.e;
      var w = ch.strengthGoal && Number(ch.strengthGoal.w);
      if (!Codec.EXERCISES[e] || !isFinite(w) || w < 1 || w > 500) return null;
      out.strengthGoal = { e: e, w: Math.round(w * 2) / 2 };
    } else {
      /* валидные цели — из кодека (3/4/5/7/10/14/30), иначе честный дефолт */
      out.targetWorkouts = Codec.isValidTarget(Number(ch.targetWorkouts)) ? Math.floor(Number(ch.targetWorkouts)) : 4;
      if (Codec.FOCUS.indexOf(ch.focus) !== -1) out.focus = ch.focus; else out.focus = 'fullbody';
      if (['easy', 'standard', 'hard'].indexOf(ch.difficulty) !== -1) out.difficulty = ch.difficulty; else out.difficulty = 'standard';
    }
    return out;
  }

  var Provider = {
    loadAll: function () {
      var raw = Storage ? Storage.get(KEY, null) : null;
      if (!Array.isArray(raw)) return [];
      var out = [];
      for (var i = 0; i < raw.length; i++) {
        var ch = sanitizeStored(raw[i]);
        if (ch) out.push(ch);
      }
      return out;
    },
    persist: function (list) { if (Storage) Storage.set(KEY, list); }
    /* CloudChallengeProvider (2.0): тот же интерфейс + серверная синхронизация */
  };

  /* ---------------- статусы и расчёт ---------------- */
  function expiresAt(ch) { return ch.joinedAt + ch.durationDays * DAY; }

  function statusOf(ch) {
    var now = Date.now();
    if (ch.completedAt) return 'completed';
    if (ch.type === 'strength') {
      if (ch.strengthCurrent !== null && ch.strengthGoal && ch.strengthCurrent >= ch.strengthGoal.w) return 'completed';
    } else if (ch.completedWorkouts >= ch.targetWorkouts) {
      return 'completed';
    }
    if (now >= expiresAt(ch)) return 'ended';
    return 'active';
  }

  function withDerived(ch) {
    var s = statusOf(ch);
    return {
      id: ch.id, type: ch.type, title: ch.title, durationDays: ch.durationDays,
      targetWorkouts: ch.targetWorkouts, focus: ch.focus, difficulty: ch.difficulty,
      speechId: ch.speechId, strengthGoal: ch.strengthGoal, strengthCurrent: ch.strengthCurrent,
      completedWorkouts: ch.completedWorkouts, joinedAt: ch.joinedAt, notice: ch.notice,
      completedAt: ch.completedAt || 0,
      expiresAt: expiresAt(ch),
      daysLeft: Math.max(0, Math.ceil((expiresAt(ch) - Date.now()) / DAY)),
      status: s
    };
  }

  /* ---------------- CRUD ---------------- */

  function getChallenges() {
    return Provider.loadAll().map(withDerived).sort(function (a, b) {
      var rank = { active: 0, completed: 1, ended: 2 };
      return rank[a.status] - rank[b.status] || b.joinedAt - a.joinedAt;
    });
  }

  function getChallenge(id) {
    var all = Provider.loadAll();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return withDerived(all[i]);
    return null;
  }

  function activeCount() {
    return Provider.loadAll().filter(function (c) { return statusOf(c) === 'active'; }).length;
  }

  function activeLimit() { return isPremium() ? PREMIUM_ACTIVE_LIMIT : FREE_ACTIVE_LIMIT; }

  /* Создание: валидация через кодек + уникальный id */
  function createChallenge(input) {
    var compact = {
      v: Codec.VERSION,
      id: input.id || Codec.makeId(),
      t: input.title || '',
      d: input.durationDays,
      f: input.type === 'strength' ? 'strength' : (input.focus || 'fullbody'),
      s: input.speechId
    };
    if (input.type === 'strength') {
      compact.e = input.exercise;
      compact.w = input.targetKg;
    } else {
      compact.n = input.targetWorkouts;
      compact.l = input.difficulty || 'standard';
    }
    var v = Codec.validate(compact);
    if (!v.ok) return { ok: false, error: v.error };
    compact = v.challenge;

    var all = Provider.loadAll();
    while (all.some(function (c) { return c.id === compact.id; })) compact.id = Codec.makeId();

    var ch = {
      id: compact.id,
      type: compact.f === 'strength' ? 'strength' : 'workout',
      title: compact.t || defaultTitle(compact),
      durationDays: compact.d,
      speechId: compact.s,
      joinedAt: 0,                    /* автор ещё не «участник»; joinedAt появится при join */
      completedWorkouts: 0,
      lastWorkoutDate: '',
      strengthCurrent: null,
      completedAt: 0,
      notice: ''
    };
    if (ch.type === 'strength') ch.strengthGoal = { e: compact.e, w: compact.w };
    else { ch.targetWorkouts = compact.n; ch.focus = compact.f; ch.difficulty = compact.l; }

    track('challenge_created');
    return { ok: true, challenge: ch, compact: compact };
  }

  function defaultTitle(c) {
    if (c.f === 'strength') {
      var names = { bp: 'Жим', sq: 'Присед', dl: 'Становая' };
      return 'Сила: ' + (names[c.e] || 'цель') + ' ' + c.w + ' кг';
    }
    return c.d + ' дн · ' + c.n + ' тренировки';
  }

  /* Join: compact (из ссылки) → локальная копия. startMode = onJoin. */
  function joinChallenge(compact, opts) {
    opts = opts || {};
    var v = Codec.validate(compact);
    if (!v.ok) return { ok: false, error: v.error };
    var c = v.challenge;

    var all = Provider.loadAll();
    var existing = null;
    for (var i = 0; i < all.length; i++) if (all[i].id === c.id) existing = all[i];
    if (existing) return { ok: false, reason: 'duplicate', challenge: withDerived(existing) };

    if (!opts.ignoreLimit && activeCount() >= activeLimit()) {
      return { ok: false, reason: 'limit', limit: activeLimit(), premium: isPremium() };
    }

    var ch = {
      id: c.id,
      type: c.f === 'strength' ? 'strength' : 'workout',
      title: c.t || defaultTitle(c),
      durationDays: c.d,
      speechId: c.s,
      joinedAt: Date.now(),                      /* onJoin: старт у каждого свой */
      completedWorkouts: 0,
      lastWorkoutDate: '',
      strengthCurrent: null,
      completedAt: 0,
      notice: v.speechUnknown ? 'Мотивация по умолчанию' : ''
    };
    if (ch.type === 'strength') ch.strengthGoal = { e: c.e, w: c.w };
    else {
      ch.targetWorkouts = c.n; ch.focus = c.f; ch.difficulty = c.l;
      if (c.ws && c.ws.length) ch.notice = 'Некоторые тренировки челленджа недоступны в этой версии';
    }

    /* стартовое значение силовой цели — из существующих рекордов (PR), не дубль таблицы */
    if (ch.type === 'strength' && window.__THRecords) {
      var best = window.__THRecords.getBest(Codec.EXERCISES[c.e]);
      if (best !== null && isFinite(best)) ch.strengthCurrent = Math.min(best, c.w);
    }

    all.push(ch);
    Provider.persist(all);
    track('challenge_joined');
    return { ok: true, challenge: withDerived(ch) };
  }

  function update(id, mutator) {
    var all = Provider.loadAll();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) {
        mutator(all[i]);
        Provider.persist(all);
        return withDerived(all[i]);
      }
    }
    return null;
  }

  function saveChallenge(ch) {   /* ручное сохранение (например, автору у себя) */
    if (!ch || !ch.id) return { ok: false };
    var all = Provider.loadAll();
    if (!ch.joinedAt) ch.joinedAt = Date.now();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === ch.id) { all[i] = sanitizeStored(ch) || all[i]; Provider.persist(all); return { ok: true, challenge: withDerived(all[i]) }; }
    }
    all.push(sanitizeStored(ch));
    Provider.persist(all);
    return { ok: true, challenge: withDerived(ch) };
  }

  function deleteChallenge(id) {
    var all = Provider.loadAll().filter(function (c) { return c.id !== id; });
    Provider.persist(all);
    return true;
  }

  /* ---------------- прогресс ---------------- */

  /* Завершение тренировки в приложении (вызов из completeWorkout-обёртки) */
  /* Разница в днях между двумя ключами 'YYYY-MM-DD' (локальная полночь) */
  function daysBetween(a, b) {
    try {
      var ta = new Date(a + 'T00:00:00').getTime();
      var tb = new Date(b + 'T00:00:00').getTime();
      if (!isFinite(ta) || !isFinite(tb)) return 0;
      return Math.round((tb - ta) / 86400000);
    } catch (e) { return 0; }
  }

  function onWorkoutCompleted(day, dateStr) {
    var all = Provider.loadAll();
    var changed = false;
    var completedList = [];
    var brokeList = [];
    for (var i = 0; i < all.length; i++) {
      var ch = all[i];
      if (ch.type !== 'workout' || statusOf(ch) !== 'active') continue;
      if (typeof dateStr === 'string' && ch.lastWorkoutDate === dateStr) continue;   /* одна тренировка в день */
      /* «Подряд»: перерыв между тренировками максимум 1 день.
         2 пропущенных дня — счёт челленджа стартует заново (как серия огонька). */
      if (typeof dateStr === 'string' && ch.lastWorkoutDate &&
          daysBetween(ch.lastWorkoutDate, dateStr.slice(0, 10)) > 2 && ch.completedWorkouts > 0) {
        ch.completedWorkouts = 0;
        ch.notice = 'Перерыв больше 2 дней — счёт челленджа начался заново';
        brokeList.push(ch.id);
      }
      if (ch.completedWorkouts < ch.targetWorkouts) {
        ch.completedWorkouts++;
        if (typeof dateStr === 'string') ch.lastWorkoutDate = dateStr.slice(0, 10);
        changed = true;
      }
      if (ch.completedWorkouts >= ch.targetWorkouts && !ch.completedAt) {
        ch.completedAt = Date.now();
        completedList.push(ch.id);
      }
    }
    if (changed) {
      Provider.persist(all);
      completedList.forEach(function () { track('challenge_completed'); });
    }
    return { changed: changed, completed: completedList, broke: brokeList };
  }

  /* Новый рекорд в приложении (вызов из addRecord-обёртки) */
  function onRecordAdded(exercise, kg) {
    var all = Provider.loadAll();
    var changed = false, completedList = [];
    for (var i = 0; i < all.length; i++) {
      var ch = all[i];
      if (ch.type !== 'strength' || statusOf(ch) !== 'active') continue;
      if (!ch.strengthGoal || Codec.EXERCISES[ch.strengthGoal.e] !== exercise) continue;
      var w = Number(kg);
      if (!isFinite(w) || w <= 0) continue;
      if (ch.strengthCurrent === null || w > ch.strengthCurrent) {
        ch.strengthCurrent = Math.min(w, ch.strengthGoal.w);   /* личный журнал; цель достигается по факту */
        changed = true;
      }
      if (ch.strengthCurrent >= ch.strengthGoal.w && !ch.completedAt) {
        ch.completedAt = Date.now();
        completedList.push(ch.id);
      }
    }
    if (changed) {
      Provider.persist(all);
      completedList.forEach(function () { track('challenge_completed'); });
    }
    return { changed: changed, completed: completedList };
  }

  /* Ручное обновление силового прогресса (личный тренировочный журнал) */
  function updateStrengthProgress(id, kg) {
    var w = Number(kg);
    if (!isFinite(w) || w < 0 || w > 500) return { ok: false, error: 'invalid' };
    var ch = getChallenge(id);
    if (!ch || ch.type !== 'strength') return { ok: false, error: 'not-found' };
    var completedBefore = ch.status === 'completed';
    var updated = update(id, function (c) {
      c.strengthCurrent = w;
      if (w >= c.strengthGoal.w && !c.completedAt) c.completedAt = Date.now();
    });
    if (updated && updated.status === 'completed' && !completedBefore) track('challenge_completed');
    return { ok: true, challenge: updated };
  }

  function getStrengthProgress(id) {
    var ch = getChallenge(id);
    if (!ch || ch.type !== 'strength' || !ch.strengthGoal) return null;
    var cur = ch.strengthCurrent === null ? 0 : ch.strengthCurrent;
    return {
      currentKg: cur,
      targetKg: ch.strengthGoal.w,
      percent: Math.min(100, Math.round((cur / ch.strengthGoal.w) * 100)),
      reached: cur >= ch.strengthGoal.w
    };
  }

  function completeChallenge(id) {   /* явное завершение (расчётное, не «кнопка честности») */
    var ch = getChallenge(id);
    if (!ch) return { ok: false };
    var done = ch.status === 'completed';
    var updated = update(id, function (c) { if (!c.completedAt && statusOf(c) === 'completed') c.completedAt = Date.now(); });
    if (updated && !done) track('challenge_completed');
    return { ok: true, challenge: updated };
  }

  function sharedTracked() { track('challenge_shared'); }

  window.__THChallengeService = {
    KEY: KEY,
    FREE_ACTIVE_LIMIT: FREE_ACTIVE_LIMIT,
    PREMIUM_ACTIVE_LIMIT: PREMIUM_ACTIVE_LIMIT,
    createChallenge: createChallenge,
    joinChallenge: joinChallenge,
    saveChallenge: saveChallenge,
    getChallenge: getChallenge,
    getChallenges: getChallenges,
    deleteChallenge: deleteChallenge,
    onWorkoutCompleted: onWorkoutCompleted,
    onRecordAdded: onRecordAdded,
    updateStrengthProgress: updateStrengthProgress,
    getStrengthProgress: getStrengthProgress,
    completeChallenge: completeChallenge,
    activeCount: activeCount,
    activeLimit: activeLimit,
    statusOf: statusOf,
    trackShared: sharedTracked
  };
})();
