/* =============================================================
 * Train Hard Challenges — UI (vanilla-оверлей в стиле приложения)
 *
 * Экраны: MY CHALLENGES · CREATE · SHARE/QR · PREVIEW · DETAIL ·
 * COMPLETE. Весь пользовательский текст (названия челленджей из
 * URL) выводится ТОЛЬКО через textContent — innerHTML для
 * URL-данных не используется.
 * ============================================================= */
(function () {
  'use strict';

  var Service = window.__THChallengeService;
  var Codec = window.__THChallengeCodec;
  var Speeches = window.__THSpeeches;

  var FOCUS_LBL = { fullbody: 'Фулбади', upper: 'Верх тела', lower: 'Низ тела', core: 'Кор', cardio: 'Кардио', mobility: 'Мобильность', mixed: 'Микс' };
  var DIFF_LBL = { easy: 'Лёгкий', standard: 'Обычный', hard: 'Сложный' };
  var EXE_LBL = { bp: 'Жим лёжа', sq: 'Присед', dl: 'Становая тяга' };
  var EXE_ICON = { bp: ' bench', sq: ' squat', dl: ' deadlift' };

  var root = null;
  var draft = null;          /* черновик создания */
  var audience = '';         /* 'self' | 'friend' — для кого создаём */
  var lastResult = null;     /* для шаринга результата */

  /* ---------- утилиты DOM ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function btn(label, cls, fn) {
    var b = el('button', cls || 'thch-btn', label);
    b.addEventListener('click', function (e) { e.stopPropagation(); fn(e); });
    return b;
  }
  function chip(label, active, fn, extra) {
    var c = el('button', 'thch-chip' + (active ? ' is-on' : ''), label);
    if (extra) {
      var tag = el('span', 'thch-chip-tag', extra);
      c.appendChild(tag);
    }
    c.addEventListener('click', function (e) { e.stopPropagation(); fn(c); });
    return c;
  }
  function isPrem() { try { return !!(window.__THPrem && window.__THPrem.isPremium()); } catch (e) { return false; } }
  /* окно для произвольного «N подряд»: 7/14/30/60 дней */
  function windowFor(n) { return n <= 3 ? 7 : n <= 7 ? 14 : n <= 14 ? 30 : 60; }
  function openPremium() { try { window.__thPay && window.__thPay(); } catch (e) {} }

  var Analytics = function (ev) { try { window.__THAnalytics && window.__THAnalytics.track(ev); } catch (e) {} };

  /* ---------- каркас ---------- */
  function ensureRoot() {
    if (root) return root;
    ensureCss();
    root = el('div', 'thch');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Челленджи Train Hard');
    document.body.appendChild(root);
    return root;
  }

  function open() { ensureRoot().style.display = 'flex'; showList(); }
  function close() { stopScan(); if (root) root.style.display = 'none'; try { document.body.classList.remove('thch-open'); } catch (e) {} }

  function screen(title, opts) {
    opts = opts || {};
    ensureRoot();
    stopScan();
    try { document.body.classList.add('thch-open'); } catch (e) {}
    root.innerHTML = '';
    var panel = el('div', 'thch-panel');
    var head = el('div', 'thch-head');
    var back = btn('←', 'thch-x', function () { (opts.back || showList)(); });
    back.setAttribute('aria-label', 'Назад');
    head.appendChild(back);
    head.appendChild(el('span', 'thch-title', title));
    var x = btn('✕', 'thch-x', function () { (opts.close || close)(); });
    x.setAttribute('aria-label', 'Закрыть');
    head.appendChild(x);
    panel.appendChild(head);
    var body = el('div', 'thch-body');
    panel.appendChild(body);
    root.appendChild(panel);
    return body;
  }

  /* ---------- СПИСОК ---------- */
  function showList() {
    var body = screen('Челленджи');
    var list = Service.getChallenges();

    var createBtn = btn('+ СОЗДАТЬ ЧЕЛЛЕНДЖ', 'thch-btn thch-btn--main', function () { showCreateAudience(); });
    body.appendChild(createBtn);

    var limitNote = el('div', 'thch-note',
      'Активных: ' + Service.activeCount() + ' из ' + Service.activeLimit() +
      (isPrem() ? ' (Premium)' : ' · Premium: до ' + Service.PREMIUM_ACTIVE_LIMIT));
    body.appendChild(limitNote);

    var scanBtn = btn('СКАНИРОВАТЬ QR 📷', 'thch-btn', function () { showScan(); });
    body.appendChild(scanBtn);

    if (!list.length) {
      var empty = el('div', 'thch-empty');
      empty.appendChild(el('div', 'thch-empty-emoji', '🔥'));
      empty.appendChild(el('div', '', 'Челленджей пока нет.'));
      empty.appendChild(el('div', 'thch-note', 'Создай свой или открой ссылку друга — челлендж появится здесь.'));
      body.appendChild(empty);
      return;
    }

    var sections = [['active', 'АКТИВНЫЕ'], ['completed', 'ЗАВЕРШЁННЫЕ'], ['ended', 'ЗАВЕРШИЛИСЬ ПО СРОКУ']];
    sections.forEach(function (sec) {
      var items = list.filter(function (c) { return c.status === sec[0]; });
      if (!items.length) return;
      body.appendChild(el('div', 'thch-sub', sec[1]));
      items.forEach(function (c) { body.appendChild(challengeCard(c)); });
    });
  }

  function challengeCard(c) {
    var card = el('button', 'thch-card thch-card--' + c.status);
    card.addEventListener('click', function (e) { e.stopPropagation(); showDetail(c.id); });

    var top = el('div', 'thch-card-top');
    top.appendChild(el('span', 'thch-card-type', c.type === 'strength' ? 'СИЛА' : 'ТРЕНИРОВКИ'));
    var sp = Speeches.get(c.speechId);
    top.appendChild(el('span', 'thch-card-speech', sp.title));
    card.appendChild(top);

    card.appendChild(el('div', 'thch-card-title', c.title || 'Челлендж'));

    var mid = el('div', 'thch-card-mid');
    if (c.type === 'strength') {
      var cur = c.strengthCurrent === null ? 0 : c.strengthCurrent;
      mid.appendChild(el('span', 'thch-card-progress', cur + ' / ' + c.strengthGoal.w + ' кг'));
      var pct = Math.min(100, Math.round((cur / c.strengthGoal.w) * 100));
      mid.appendChild(el('span', 'thch-card-pct', pct + '%'));
    } else {
      mid.appendChild(el('span', 'thch-card-progress', c.completedWorkouts + ' / ' + c.targetWorkouts + ' подряд'));
      mid.appendChild(el('span', 'thch-card-pct', Math.round((c.completedWorkouts / c.targetWorkouts) * 100) + '%'));
    }
    card.appendChild(mid);

    var bar = el('div', 'thch-bar');
    var fill = el('div', 'thch-bar-fill');
    var p = c.type === 'strength'
      ? Math.min(100, ((c.strengthCurrent || 0) / c.strengthGoal.w) * 100)
      : Math.min(100, (c.completedWorkouts / c.targetWorkouts) * 100);
    fill.style.width = Math.max(0, Math.min(100, p)) + '%';
    bar.appendChild(fill);
    card.appendChild(bar);

    var bottom = el('div', 'thch-card-bottom');
    if (c.status === 'active') bottom.appendChild(el('span', 'thch-days', 'осталось ' + c.daysLeft + ' дн'));
    else if (c.status === 'completed') bottom.appendChild(el('span', 'thch-done', '🔥 ЦЕЛЬ ДОСТИГНУТА'));
    else bottom.appendChild(el('span', 'thch-ended', 'срок вышел'));
    bottom.appendChild(el('span', 'thch-arrow', '→'));
    card.appendChild(bottom);
    return card;
  }

  /* ---------- СОЗДАНИЕ: тип ---------- */
  /* ---------- СКАНИРОВАНИЕ QR ---------- */
  var scanCleanup = null;

  function stopScan() {
    if (scanCleanup) { try { scanCleanup(); } catch (e) {} scanCleanup = null; }
  }

  /* Из текста (URL / raw payload) -> payload челленджа или null */
  function extractPayload(text) {
    text = String(text == null ? '' : text).trim();
    var m = text.match(/[?&]challenge=([A-Za-z0-9_-]+)/) || text.match(/#challenge=([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return text;   /* вставили «сырой» payload */
    return null;
  }

  function showScan() {
    stopScan();
    var body = screen('Сканировать QR', { back: showList });

    body.appendChild(el('div', 'thch-q', 'QR-код челленджа'));
    body.appendChild(el('div', 'thch-note', 'Наведи камеру на QR — челлендж откроется в превью. Декодирование локальное, без сети.'));

    var canCam = false;
    try { canCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); } catch (e) {}

    var video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.style.width = '100%';
    video.style.background = '#000';
    video.style.display = 'none';
    body.appendChild(video);

    var status = el('div', 'thch-note', canCam ? 'Камера выключена.' : 'Камера недоступна в этом окружении — вставь ссылку вручную ниже.');
    body.appendChild(status);

    body.appendChild(btn(canCam ? 'ВКЛЮЧИТЬ КАМЕРУ' : 'КАМЕРЫ НЕТ', 'thch-btn thch-btn--main', function () {
      if (!canCam) { status.textContent = 'Камера недоступна — вставь ссылку вручную ниже.'; return; }
      startCamera();
    }));

    function decoded(text) {
      var payload = extractPayload(text);
      if (!payload) { status.textContent = 'Это не ссылка челленджа'; return; }
      stopScan();
      openPreview(payload);
    }

    function startCamera() {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(function (stream) {
          video.style.display = 'block';
          try { video.srcObject = stream; } catch (e) { video.src = URL.createObjectURL(stream); }
          try { var pr = video.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
          status.textContent = 'Сканирую…';
          var canvas = document.createElement('canvas');
          var timer = setInterval(function () {
            if (!video.videoWidth) return;
            try {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              var ctx = canvas.getContext && canvas.getContext('2d');
              if (!ctx) return;
              ctx.drawImage(video, 0, 0);
              var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              var text = window.__THQRDecode ? window.__THQRDecode(img.data, img.width, img.height) : null;
              if (text) decoded(text);
            } catch (e) {}
          }, 300);
          scanCleanup = function () {
            clearInterval(timer);
            try { stream.getTracks().forEach(function (t) { t.stop(); } ); } catch (e) {}
          };
        })
        .catch(function () {
          status.textContent = 'Нет доступа к камере — вставь ссылку вручную ниже.';
        });
    }

    body.appendChild(el('div', 'thch-sub', 'ИЛИ ВСТАВЬ ССЫЛКУ'));
    var inp = el('input', 'thch-input');
    inp.placeholder = 'https://…?challenge=…';
    body.appendChild(inp);
    body.appendChild(btn('ОТКРЫТЬ ЧЕЛЛЕНДЖ', 'thch-btn', function () {
      var payload = extractPayload(inp.value);
      if (!payload) { toast('Это не ссылка челленджа'); return; }
      stopScan();
      openPreview(payload);
    }));
    body.appendChild(el('div', 'thch-note', 'Ссылка — та же, что приходит при обычном шаринге.'));
  }

  /* ---------- СОЗДАНИЕ: для кого ---------- */
  function showCreateAudience() {
    draft = null;
    var body = screen('Новый челлендж', { back: showList });

    body.appendChild(el('div', 'thch-q', 'Для кого?'));
    body.appendChild(el('div', 'thch-note', 'Для себя — челлендж сразу начнётся. Для друга — сделаем ссылку и QR.'));

    var grid = el('div', 'thch-grid2');
    grid.appendChild(bigChoice('ДЛЯ СЕБЯ', 'Начну прямо сейчас', '🔥', function () {
      audience = 'self';
      showCreateType();
    }));
    grid.appendChild(bigChoice('ДЛЯ ДРУГА', 'Ссылка + QR на отправку', '📤', function () {
      audience = 'friend';
      showCreateType();
    }));
    body.appendChild(grid);
  }

  /* ---------- СОЗДАНИЕ: тип (только 2 кнопки) ---------- */
  function showCreateType() {
    if (audience !== 'self' && audience !== 'friend') { showCreateAudience(); return; }
    draft = null;
    var body = screen('Создать челлендж', { back: showCreateAudience });

    body.appendChild(el('div', 'thch-q', 'Что хочешь устроить?'));
    body.appendChild(el('div', 'thch-note', 'Тренировки подряд или личная силовая цель.'));

    var grid = el('div', 'thch-grid2');
    grid.appendChild(bigChoice('ТРЕНИРОВКИ', 'N тренировок подряд', '💪', function () {
      draft = { type: 'workout', durationDays: Codec.PRESETS[0].d, targetWorkouts: Codec.PRESETS[0].n, focus: 'fullbody', difficulty: 'standard', speechId: 's1', title: '' };
      showCreateWorkout();
    }));
    grid.appendChild(bigChoice('СИЛА', 'Личная цель по весу', '🏋', function () {
      draft = { type: 'strength', exercise: 'bp', targetKg: 80, durationDays: 30, speechId: 's3', title: '' };
      showCreateStrength();
    }));
    body.appendChild(grid);
  }

  function bigChoice(title, sub, emoji, fn) {
    var c = el('button', 'thch-big');
    c.appendChild(el('span', 'thch-big-emoji', emoji));
    var t = el('span', 'thch-big-txt');
    t.appendChild(el('span', 'thch-big-title', title));
    t.appendChild(el('span', 'thch-big-sub', sub));
    c.appendChild(t);
    c.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    return c;
  }

  /* ---------- СОЗДАНИЕ: тренировки ---------- */
  function showCreateWorkout() {
    var body = screen('Челлендж тренировок', { back: showCreateType });
    body.appendChild(el('div', 'thch-q', 'Сколько тренировок подряд?'));
    var pRow = el('div', 'thch-chips');
    Codec.PRESETS.forEach(function (p) {
      pRow.appendChild(chip(p.n + ' подряд', draft.targetWorkouts === p.n, function () {
        draft.targetWorkouts = p.n; draft.durationDays = p.d; showCreateWorkout();
      }));
    });
    body.appendChild(pRow);
    var ci = el('input', 'thch-input');
    ci.type = 'number'; ci.min = '2'; ci.max = '30';
    ci.placeholder = 'или своё: сколько подряд (2–30)';
    /* ввод без перерисовки экрана: значение сохраняется в черновик,
       подтверждение — строкой под полем (экран не пересоздаётся,
       поэтому ввод не «сбрасывается» и ДАЛЕЕ срабатывает с первого клика) */
    var ciNote = el('div', 'thch-note', draft.targetWorkouts && Codec.PRESETS.every(function (p) { return p.n !== draft.targetWorkouts; }) ? 'Принято: ' + draft.targetWorkouts + ' подряд · окно ' + draft.durationDays + ' дн' : '');
    ci.addEventListener('change', function () {
      var v = parseInt(ci.value, 10);
      if (Codec.isValidTarget(v)) {
        draft.targetWorkouts = v; draft.durationDays = windowFor(v);
        ciNote.textContent = 'Принято: ' + v + ' подряд · окно ' + draft.durationDays + ' дн';
      } else {
        ciNote.textContent = 'Нужно целое от 2 до 30';
      }
    });
    body.appendChild(ci);
    body.appendChild(ciNote);
    body.appendChild(el('div', 'thch-note', 'Перерыв между тренировками — максимум 1 день. Два дня без тренировок — счёт начнётся заново. Срок подбирается автоматически.'));

    body.appendChild(btn('ДАЛЕЕ →', 'thch-btn thch-btn--main', showCreateMotivation));
  }

  /* ---------- СОЗДАНИЕ: сила ---------- */
  function showCreateStrength() {
    var body = screen('Силовая цель', { back: showCreateType });
    body.appendChild(el('div', 'thch-q', 'Упражнение'));
    var eRow = el('div', 'thch-chips');
    ['bp', 'sq', 'dl'].forEach(function (e) {
      eRow.appendChild(chip(EXE_LBL[e], draft.exercise === e, function () {
        draft.exercise = e; showCreateStrength();
      }));
    });
    body.appendChild(eRow);

    body.appendChild(el('div', 'thch-q', 'Целевой вес (кг)'));
    var wRow = el('div', 'thch-chips');
    [60, 80, 100, 120].forEach(function (w) {
      wRow.appendChild(chip(w + ' кг', draft.targetKg === w, function () {
        draft.targetKg = w; showCreateStrength();
      }));
    });
    body.appendChild(wRow);
    var inp = el('input', 'thch-input');
    inp.type = 'number'; inp.min = '1'; inp.max = '500'; inp.step = '0.5';
    inp.value = draft.targetKg; inp.placeholder = 'свой вес, кг';
    inp.addEventListener('change', function () {
      var v = parseFloat(inp.value);
      if (isFinite(v) && v >= 1 && v <= 500) draft.targetKg = Math.round(v * 2) / 2;
      inp.value = draft.targetKg;
    });
    body.appendChild(inp);
    var best = window.__THRecords ? window.__THRecords.getBest(Codec.EXERCISES[draft.exercise]) : null;
    if (best) {
      body.appendChild(el('div', 'thch-note', 'Твой текущий рекорд: ' + best + ' кг. Цель — личная, двигайся в своём темпе.'));
    } else {
      body.appendChild(el('div', 'thch-note', 'Личная цель, не соревнование. Безопасность важнее цифры.'));
    }

    body.appendChild(el('div', 'thch-q', 'Срок'));
    var dRow = el('div', 'thch-chips');
    [3, 7, 14, 30].forEach(function (d) {
      dRow.appendChild(chip(d + ' дн', draft.durationDays === d, function () {
        draft.durationDays = d; showCreateStrength();
      }));
    });
    body.appendChild(dRow);
    var cd = el('input', 'thch-input');
    cd.type = 'number'; cd.min = '1'; cd.max = '90';
    cd.placeholder = 'или свой срок, дней (1–90)';
    var cdNote = el('div', 'thch-note', '');
    cd.addEventListener('change', function () {
      var v = parseInt(cd.value, 10);
      if (Codec.isValidDuration(v)) {
        draft.durationDays = v;
        cdNote.textContent = 'Принято: срок ' + v + ' дн';
      } else {
        cdNote.textContent = 'Срок — целое от 1 до 90 дней';
      }
    });
    body.appendChild(cd);
    body.appendChild(cdNote);

    body.appendChild(btn('ДАЛЕЕ →', 'thch-btn thch-btn--main', showCreateMotivation));
  }

  /* ---------- СОЗДАНИЕ: мотивация ---------- */
  function showCreateMotivation() {
    var body = screen('Мотивация', { back: draft.type === 'strength' ? showCreateStrength : showCreateWorkout });
    body.appendChild(el('div', 'thch-q', 'Выбери ОДНУ речь'));
    body.appendChild(el('div', 'thch-note', 'В ссылку попадёт только её id — текст хранится в приложении.'));

    var list = el('div', 'thch-speeches');
    Speeches.ids.forEach(function (id) {
      var s = Speeches.all[id];
      var prem = s.premium && !isPrem();
      var card = el('button', 'thch-speech' + (draft.speechId === id ? ' is-on' : '') + (s.premium ? ' is-prem' : ''));
      var top = el('span', 'thch-speech-top');
      top.appendChild(el('span', 'thch-speech-title', s.title + (s.premium ? ' · Premium' : '')));
      top.appendChild(el('span', 'thch-speech-tag', s.tag));
      card.appendChild(top);
      card.appendChild(el('span', 'thch-speech-short', s.short));
      card.addEventListener('click', function (e) {
        e.stopPropagation();
        if (s.premium && !isPrem()) { openPremium(); return; }
        draft.speechId = id; showCreateMotivation();
      });
      list.appendChild(card);
    });
    body.appendChild(list);
    body.appendChild(btn('ДАЛЕЕ →', 'thch-btn thch-btn--main', showCreateTitle));
  }

  /* ---------- СОЗДАНИЕ: название ---------- */
  function showCreateTitle() {
    var body = screen('Название', { back: showCreateMotivation });
    body.appendChild(el('div', 'thch-q', 'Название челленджа'));
    var def = draft.type === 'strength'
      ? 'Сила: ' + EXE_LBL[draft.exercise] + ' ' + draft.targetKg + ' кг'
      : draft.targetWorkouts + ' тренировок подряд';
    var inp = el('input', 'thch-input');
    inp.maxLength = 40; inp.value = draft.title || def; inp.placeholder = def;
    inp.addEventListener('input', function () { draft.title = inp.value.slice(0, 40); });
    body.appendChild(inp);
    body.appendChild(el('div', 'thch-note', 'Без имени, почты и личных данных — в ссылке только параметры челленджа.'));
    body.appendChild(btn('СОЗДАТЬ ЧЕЛЛЕНДЖ 🔥', 'thch-btn thch-btn--main', function () {
      var res = Service.createChallenge({
        title: draft.title || def,
        type: draft.type,
        durationDays: draft.durationDays,
        targetWorkouts: draft.targetWorkouts,
        focus: draft.focus,
        difficulty: draft.difficulty,
        exercise: draft.exercise,
        targetKg: draft.targetKg,
        speechId: draft.speechId
      });
      if (!res.ok) { toast('Не удалось создать челлендж'); return; }
      var enc = Codec.encode({
        v: 1, id: res.challenge.id, t: res.challenge.title, d: res.challenge.durationDays,
        f: res.challenge.type === 'strength' ? 'strength' : res.challenge.focus,
        e: res.challenge.strengthGoal ? res.challenge.strengthGoal.e : undefined,
        w: res.challenge.strengthGoal ? res.challenge.strengthGoal.w : undefined,
        n: res.challenge.targetWorkouts, l: res.challenge.difficulty, s: res.challenge.speechId
      });
      if (!enc.ok) { toast('Ошибка кодирования'); return; }
      if (audience === 'self') {
        var compact = {
          v: 1, id: res.challenge.id, t: res.challenge.title, d: res.challenge.durationDays,
          f: res.challenge.type === 'strength' ? 'strength' : res.challenge.focus,
          e: res.challenge.strengthGoal ? res.challenge.strengthGoal.e : undefined,
          w: res.challenge.strengthGoal ? res.challenge.strengthGoal.w : undefined,
          n: res.challenge.targetWorkouts, l: res.challenge.difficulty, s: res.challenge.speechId
        };
        var jr = Service.joinChallenge(compact);
        if (jr.ok) {
          toast('Челлендж начался! Погнали 🔥');
          showDetail(res.challenge.id);
          return;
        }
        var warn = null;
        if (jr.reason === 'limit') {
          warn = 'Не удалось присоединиться: лимит активных челленджей (' + (jr.limit || '') + '). ' +
                 'Освободи слот в списке — или отправь ссылку другу ниже.';
        } else if (jr.reason === 'duplicate') {
          warn = 'Ты уже участвуешь в этом челлендже. Ссылка ниже — для друзей.';
        }
        showShare(res.challenge, enc.payload, warn);
        return;
      }
      showShare(res.challenge, enc.payload);
    }));
  }

  /* ---------- SHARE ---------- */
  function shareCardData(ch) {
    var sp = Speeches.get(ch.speechId);
    if (ch.type === 'strength') {
      return { head: 'СИЛОВОЙ ЧЕЛЛЕНДЖ', lines: [EXE_LBL[ch.strengthGoal.e].toUpperCase(), 'ЦЕЛЬ: ' + ch.strengthGoal.w + ' КГ'], quote: sp.short };
    }
    return { head: 'ЧЕЛЛЕНДЖ: ПОДРЯД', lines: [ch.targetWorkouts + ' ТРЕНИРОВОК ПОДРЯД', (FOCUS_LBL[ch.focus] || '').toUpperCase()], quote: sp.short };
  }

  function showShare(ch, payload, warn) {
    var url = Codec.buildUrl(payload);
    lastResult = { kind: 'join', url: url, ch: ch };
    var body = screen('Челлендж готов!', { back: showList });
    if (warn) body.appendChild(el('div', 'thch-warn', warn));
    var data = shareCardData(ch);

    var card = el('div', 'thch-sharecard');
    card.appendChild(el('div', 'thch-sc-brand', 'TRAIN HARD'));
    card.appendChild(el('div', 'thch-sc-fire', '🔥'));
    card.appendChild(el('div', 'thch-sc-head', data.head));
    data.lines.forEach(function (l) { card.appendChild(el('div', 'thch-sc-line', l)); });
    card.appendChild(el('div', 'thch-sc-quote', '«' + data.quote + '»'));
    card.appendChild(el('div', 'thch-sc-cta', 'ПРИСОЕДИНЯЙСЯ'));
    body.appendChild(card);

    body.appendChild(btn('ПОДЕЛИТЬСЯ', 'thch-btn thch-btn--main', function () {
      shareUrl(url, ch.title || 'Челлендж Train Hard');
    }));
    body.appendChild(btn('СКОПИРОВАТЬ ССЫЛКУ', 'thch-btn', function () {
      copyText(url);
    }));
    body.appendChild(btn('QR-КОД', 'thch-btn', function () { showQr(url); }));
    body.appendChild(el('div', 'thch-note', 'Ссылка самодостаточна: все параметры челленджа внутри неё. Сервер не участвует.'));
    body.appendChild(btn('ГОТОВО', 'thch-btn thch-btn--ghost', function () { showList(); }));

    Analytics('challenge_shared');
    Service.trackShared();
  }

  function showQr(url) {
    var body = screen('QR-код', { back: function () { showList(); } });
    body.appendChild(el('div', 'thch-q', 'Покажи другу —'));
    body.appendChild(el('div', 'thch-note', 'в QR та же ссылка с параметрами челленджа.'));
    var holder = el('div', 'thch-qr');
    var canvas = el('canvas');
    holder.appendChild(canvas);
    body.appendChild(holder);
    var ok = false;
    try { ok = !!window.__THQR.draw(canvas, url, 4); } catch (e) { ok = false; }
    if (!ok) holder.appendChild(el('div', 'thch-note', 'QR недоступен в этом окружении — воспользуйся ссылкой.'));
    body.appendChild(btn('СКОПИРОВАТЬ ССЫЛКУ', 'thch-btn', function () { copyText(url); }));
    body.appendChild(btn('← НАЗАД', 'thch-btn thch-btn--ghost', function () { showList(); }));
  }

  function shareUrl(url, title) {
    if (navigator.share) {
      navigator.share({ title: title || 'Train Hard Challenge', text: '🔥 Приглашаю в челлендж Train Hard', url: url })
        .then(function () {}, function () {});
      Analytics('challenge_shared');
      return;
    }
    copyText(url);
  }

  function copyText(text) {
    var done = function () { toast('Ссылка скопирована'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
        return;
      }
    } catch (e) {}
    legacyCopy(text, done);
  }
  function legacyCopy(text, done) {
    try {
      var ta = el('textarea', 'thch-ta');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e) { toast('Не удалось скопировать'); }
  }

  /* ---------- PREVIEW (из ссылки) ---------- */
  function openPreview(payload) {
    ensureRoot().style.display = 'flex';
    var res = Codec.decode(payload);
    if (!res.ok) {
      if (res.error === 'too-large') return previewError('НЕКОРРЕКТНЫЙ ЧЕЛЛЕНДЖ', 'Ссылка слишком большая.');
      if (res.error === 'version') return previewError('ВЕРСИЯ НЕ ПОДДЕРЖИВАЕТСЯ', 'Челлендж создан в другой версии Train Hard.');
      if (res.error === 'exercise-unsupported') return previewError('СИЛОВАЯ ЦЕЛЬ НЕ ПОДДЕРЖИВАЕТСЯ', 'Этот силовой челлендж не поддерживается в текущей версии.');
      return previewError('НЕКОРРЕКТНАЯ ССЫЛКА', 'Челлендж повреждён или ссылка неполная.');
    }
    var c = res.challenge;
    var existing = Service.getChallenge(c.id);
    if (existing) return previewDuplicate(existing);

    var body = screen('Челлендж', { close: close, back: close });
    var hero = el('div', 'thch-hero');
    hero.appendChild(el('div', 'thch-hero-fire', '🔥'));
    hero.appendChild(el('div', 'thch-hero-brand', 'TRAIN HARD CHALLENGE'));
    hero.appendChild(el('div', 'thch-hero-title', c.t || 'Челлендж'));
    body.appendChild(hero);

    var params = el('div', 'thch-card');
    if (c.f === 'strength') {
      params.appendChild(el('div', 'thch-param', 'СИЛОВАЯ ЦЕЛЬ'));
      params.appendChild(el('div', 'thch-param-big', EXE_LBL[c.e]));
      params.appendChild(el('div', 'thch-param-big', c.w + ' КГ'));
      params.appendChild(el('div', 'thch-note', 'Личная цель: двигайся в своём темпе, техника важнее цифры.'));
    } else {
      params.appendChild(el('div', 'thch-param', c.n + ' ТРЕНИРОВОК ПОДРЯД · ОКНО ' + c.d + ' ДН.'));
      params.appendChild(el('div', 'thch-param-big', (FOCUS_LBL[c.f] || '').toUpperCase()));
      params.appendChild(el('div', 'thch-param', 'Сложность: ' + DIFF_LBL[c.l] + ' · ' + c.d + ' дней'));
    }
    body.appendChild(params);

    if (res.speechUnknown) {
      body.appendChild(el('div', 'thch-note', 'Мотивация по умолчанию (речь из ссылки неизвестна этой версии).'));
    }
    var sp = Speeches.get(c.s);
    var quote = el('div', 'thch-quote');
    quote.appendChild(el('div', 'thch-quote-title', sp.title));
    quote.appendChild(el('div', 'thch-quote-text', '«' + sp.short + '»'));
    body.appendChild(quote);

    body.appendChild(btn('ПРИСОЕДИНИТЬСЯ 🔥', 'thch-btn thch-btn--main', function () {
      var j = Service.joinChallenge(c);
      if (j.ok) { toast('Ты в челлендже!'); showDetail(c.id); return; }
      if (j.reason === 'duplicate') { previewDuplicate(j.challenge); return; }
      if (j.reason === 'limit') {
        limitMessage(j.limit, j.premium);
        return;
      }
      toast('Не удалось присоединиться');
    }));
    body.appendChild(btn('НЕ СЕЙЧАС', 'thch-btn thch-btn--ghost', function () { close(); }));
  }

  function previewDuplicate(existing) {
    var body = screen('Уже участвуешь', { close: close, back: close });
    body.appendChild(el('div', 'thch-q', 'Ты уже присоединился к этому челленджу.'));
    body.appendChild(el('div', 'thch-note', 'Дубликаты не создаются.'));
    body.appendChild(btn('ОТКРЫТЬ ЧЕЛЛЕНДЖ', 'thch-btn thch-btn--main', function () { showDetail(existing.id); }));
    body.appendChild(btn('ЗАКРЫТЬ', 'thch-btn thch-btn--ghost', close));
  }

  function limitMessage(limit, premium) {
    var body = screen('Лимит активных', { close: close, back: close });
    body.appendChild(el('div', 'thch-q', 'Активных челленджей уже ' + limit + '.'));
    body.appendChild(el('div', 'thch-note', premium
      ? 'Заверши или удали текущий, чтобы начать новый.'
      : 'Бесплатно — до ' + Service.FREE_ACTIVE_LIMIT + ' активных. Premium — до ' + Service.PREMIUM_ACTIVE_LIMIT + '.'));
    if (!premium) body.appendChild(btn('ОТКРЫТЬ PREMIUM', 'thch-btn thch-btn--main', function () { close(); openPremium(); }));
    body.appendChild(btn('МОИ ЧЕЛЛЕНДЖИ', 'thch-btn', function () { showList(); }));
    body.appendChild(btn('ЗАКРЫТЬ', 'thch-btn thch-btn--ghost', close));
  }

  function previewError(title, sub) {
    var body = screen('Ошибка ссылки', { close: close, back: close });
    body.appendChild(el('div', 'thch-q', title));
    body.appendChild(el('div', 'thch-note', sub));
    body.appendChild(btn('ЗАКРЫТЬ', 'thch-btn thch-btn--ghost', close));
  }

  /* ---------- ДЕТАЛИ ---------- */
  function showDetail(id) {
    var c = Service.getChallenge(id);
    if (!c) { toast('Челлендж не найден'); return showList(); }
    if (c.status === 'completed') return showComplete(c, false);

    var body = screen('Челлендж', { back: showList });
    body.appendChild(el('div', 'thch-hero-title', c.title || 'Челлендж'));

    var prog = el('div', 'thch-card');
    if (c.type === 'strength') {
      var p = Service.getStrengthProgress(id);
      prog.appendChild(el('div', 'thch-param', 'СИЛОВАЯ ЦЕЛЬ · ' + EXE_LBL[c.strengthGoal.e]));
      prog.appendChild(el('div', 'thch-param-big', p.currentKg + ' / ' + p.targetKg + ' КГ'));
      var bar = el('div', 'thch-bar'); var fill = el('div', 'thch-bar-fill');
      fill.style.width = p.percent + '%'; bar.appendChild(fill); prog.appendChild(bar);
      prog.appendChild(el('div', 'thch-note', p.percent + '% · Личная цель, не соревнование.'));
      body.appendChild(prog);

      var inp = el('input', 'thch-input');
      inp.type = 'number'; inp.min = '0'; inp.max = '500'; inp.step = '0.5'; inp.placeholder = 'Подтверждённый результат, кг';
      body.appendChild(inp);
      body.appendChild(btn('ЗАПИСАТЬ РЕЗУЛЬТАТ', 'thch-btn thch-btn--main', function () {
        var v = parseFloat(inp.value);
        if (!isFinite(v) || v < 0 || v > 500) { toast('Введи вес (0–500 кг)'); return; }
        var r = Service.updateStrengthProgress(id, v);
        if (r.ok) { toast('Записано: ' + v + ' кг'); showDetail(id); }
      }));
      var best = window.__THRecords ? window.__THRecords.getBest(Codec.EXERCISES[c.strengthGoal.e]) : null;
      if (best !== null) {
        body.appendChild(btn('ВЗЯТЬ ИЗ МОИХ РЕКОРДОВ (' + best + ' КГ)', 'thch-btn', function () {
          var r = Service.updateStrengthProgress(id, best);
          if (r.ok) showDetail(id);
        }));
      }
    } else {
      prog.appendChild(el('div', 'thch-param', c.targetWorkouts + ' ТРЕНИРОВОК ПОДРЯД · ' + (FOCUS_LBL[c.focus] || '')));
      prog.appendChild(el('div', 'thch-param-big', c.completedWorkouts + ' / ' + c.targetWorkouts));
      var bar2 = el('div', 'thch-bar'); var fill2 = el('div', 'thch-bar-fill');
      fill2.style.width = Math.min(100, (c.completedWorkouts / c.targetWorkouts) * 100) + '%';
      bar2.appendChild(fill2); prog.appendChild(bar2);
      prog.appendChild(el('div', 'thch-note', 'осталось ' + c.daysLeft + ' дн'));
      body.appendChild(prog);
      body.appendChild(el('div', 'thch-note', 'Тренировки засчитываются автоматически, когда ты завершаешь тренировку в приложении.'));
    }

    if (c.notice) body.appendChild(el('div', 'thch-note', c.notice));

    /* сообщение дня из речи (только speechId хранится) */
    var sp = Speeches.get(c.speechId);
    var lines = sp.full.split('\n');
    var dayIdx = Math.floor(Date.now() / 86400000);
    var mot = el('div', 'thch-quote');
    mot.appendChild(el('div', 'thch-quote-title', 'СООБЩЕНИЕ ДНЯ · ' + sp.title));
    mot.appendChild(el('div', 'thch-quote-text', lines[dayIdx % lines.length]));
    body.appendChild(mot);

    /* поделиться приглашением */
    body.appendChild(btn('ПРИГЛАСИТЬ ДРУГА', 'thch-btn', function () {
      var enc = detailToPayload(c);
      if (!enc.ok) { toast('Ошибка кодирования'); return; }
      showShare(minifyForShare(c), enc.payload);
    }));

    body.appendChild(btn('УДАЛИТЬ ЧЕЛЛЕНДЖ', 'thch-btn thch-btn--danger', function () {
      Service.deleteChallenge(id);
      toast('Челлендж удалён');
      showList();
    }));
  }

  function detailToPayload(c) {
    return Codec.encode({
      v: 1, id: c.id, t: c.title, d: c.durationDays,
      f: c.type === 'strength' ? 'strength' : c.focus,
      e: c.strengthGoal ? c.strengthGoal.e : undefined,
      w: c.strengthGoal ? c.strengthGoal.w : undefined,
      n: c.targetWorkouts, l: c.difficulty, s: c.speechId
    });
  }
  function minifyForShare(c) { return c; }

  /* ---------- ЗАВЕРШЕНИЕ ---------- */
  function showComplete(c, celebrate) {
    var body = screen('Челлендж завершён', { back: showList });
    try { if (window.TrainHardEffects && celebrate !== false) window.TrainHardEffects.play('achievement'); } catch (e) {}

    var hero = el('div', 'thch-complete');
    hero.appendChild(el('div', 'thch-hero-fire', '🔥'));
    hero.appendChild(el('div', 'thch-hero-title', 'ЦЕЛЬ ДОСТИГНУТА'));
    body.appendChild(hero);

    var res = el('div', 'thch-card');
    if (c.type === 'strength') {
      res.appendChild(el('div', 'thch-param', EXE_LBL[c.strengthGoal.e].toUpperCase()));
      res.appendChild(el('div', 'thch-param-big', (c.strengthCurrent || c.strengthGoal.w) + ' / ' + c.strengthGoal.w + ' КГ'));
    } else {
      res.appendChild(el('div', 'thch-param', (c.title || 'ЧЕЛЛЕНДЖ')));
      res.appendChild(el('div', 'thch-param-big', c.completedWorkouts + ' / ' + c.targetWorkouts + ' ПОДРЯД'));
    }
    body.appendChild(res);

    var sp = Speeches.get(c.speechId);
    var fin = el('div', 'thch-quote');
    fin.appendChild(el('div', 'thch-quote-title', 'ФИНАЛ · ' + sp.title));
    fin.appendChild(el('div', 'thch-quote-text', '«' + sp.completion + '»'));
    body.appendChild(fin);

    body.appendChild(btn('ПОДЕЛИТЬСЯ РЕЗУЛЬТАТОМ', 'thch-btn thch-btn--main', function () {
      var text = c.type === 'strength'
        ? '🔥 Train Hard: силовой челлендж завершён — ' + EXE_LBL[c.strengthGoal.e] + ', цель ' + c.strengthGoal.w + ' кг достигнута!'
        : '🔥 Train Hard: челлендж завершён — ' + c.completedWorkouts + '/' + c.targetWorkouts + ' тренировок!';
      var url = '';
      try { url = Codec.baseUrl(); } catch (e) {}
      if (navigator.share) {
        navigator.share({ title: 'Train Hard', text: text, url: url || undefined }).then(function () {}, function () {});
      } else copyText(text);
      Analytics('challenge_shared');
    }));
    body.appendChild(btn('МОИ ЧЕЛЛЕНДЖИ', 'thch-btn', showList));
    body.appendChild(btn('УДАЛИТЬ ЧЕЛЛЕНДЖ', 'thch-btn thch-btn--danger', function () {
      Service.deleteChallenge(c.id); toast('Челлендж удалён'); showList();
    }));
  }

  /* ---------- toast ---------- */
  var toastTimer = null;
  function toast(text) {
    var t = document.querySelector('.thch-toast');
    if (!t) {
      t = el('div', 'thch-toast');
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  /* ---------- CSS (фирменный монохром) ---------- */
  var cssDone = false;
  function ensureCss() {
    if (cssDone) return;
    cssDone = true;
    var st = document.createElement('style');
    st.textContent = [
      '.thch{position:fixed;inset:0;z-index:9985;display:none;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.86);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);font-family:Playfair Display,Georgia,serif}',
      '.thch-panel{width:100%;max-width:480px;max-height:94vh;overflow-y:auto;background:#0a0a0a;border:1px solid rgba(255,255,255,.16);border-bottom:0;padding:14px 16px calc(18px + env(safe-area-inset-bottom))}',
      '.thch-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}',
      '.thch-title{font-size:13px;font-weight:900;letter-spacing:.2em;text-transform:uppercase;flex:1;text-align:center}',
      '.thch-x{width:36px;height:36px;flex:0 0 36px;display:grid;place-items:center;background:#1a1b1e;border:1px solid #2b2e34;color:#9b9fa7;font-size:15px;cursor:pointer}',
      '.thch-body>*+*{margin-top:10px}',
      '.thch-q{font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;margin-top:14px}',
      '.thch-sub{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#6b7078;font-weight:800;margin-top:16px}',
      '.thch-note{font-size:10px;color:#7d828a;line-height:1.5}',
      '.thch-warn{padding:10px 12px;border:1px solid rgba(211,16,39,.55);color:#ff5964;font-size:11px;font-weight:700;line-height:1.5}',
      '.thch-btn{width:100%;padding:14px;background:#14161a;border:1px solid #2b2e34;color:#e5e5e5;font-weight:900;font-size:11px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;text-align:center}',
      '.thch-btn:active{transform:scale(.985)}',
      '.thch-btn--main{background:#d31027;border:0;color:#fff;box-shadow:0 12px 34px rgba(211,16,39,.25)}',
      '.thch-btn--ghost{background:transparent;border-color:#23262b;color:#8d9199}',
      '.thch-btn--danger{background:rgba(211,16,39,.1);border-color:rgba(211,16,39,.5);color:#ff5964;font-size:10px}',
      '.thch-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.thch-chip{padding:9px 12px;background:#121317;border:1px solid #2a2d33;color:#9b9fa7;font-size:11px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
      '.thch-chip.is-on{border-color:#e5e5e5;color:#fff;background:linear-gradient(145deg,rgba(131,131,131,.2),rgba(131,131,131,.08))}',
      '.thch-chip-tag{font-size:8px;color:#d9a64a;font-weight:900}',
      '.thch-input{width:100%;box-sizing:border-box;background:#14161a;border:1px solid #2b2e34;color:#fff;padding:12px 14px;font-size:15px;font-weight:700;outline:none}',
      '.thch-input:focus{border-color:rgba(211,16,39,.6)}',
      '.thch-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.thch-big{display:flex;gap:10px;align-items:center;background:#121317;border:1px solid #2a2d33;padding:14px;cursor:pointer;text-align:left}',
      '.thch-big-emoji{font-size:22px}',
      '.thch-big-txt{display:flex;flex-direction:column;gap:3px}',
      '.thch-big-title{font-size:13px;font-weight:900;letter-spacing:.08em}',
      '.thch-big-sub{font-size:9px;color:#8d9199}',
      '.thch-tpl{display:flex;flex-direction:column;gap:4px;background:#101216;border:1px solid #23262b;padding:11px;cursor:pointer;text-align:left}',
      '.thch-tpl.is-prem{border-color:rgba(217,166,74,.4)}',
      '.thch-tpl-title{font-size:11px;font-weight:900}',
      '.thch-tpl-sub{font-size:9px;color:#8d9199}',
      '.thch-card{background:#121212;border:1px solid #23262b;padding:12px 14px;display:block;width:100%;box-sizing:border-box;text-align:left;cursor:pointer}',
      '.thch-card-top{display:flex;justify-content:space-between;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:#6b7078;font-weight:800}',
      '.thch-card-title{font-size:14px;font-weight:900;margin-top:5px}',
      '.thch-card-mid{display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:#9b9fa7}',
      '.thch-card-pct{font-weight:900;color:#e5e5e5}',
      '.thch-bar{height:3px;background:#1e2126;margin-top:8px}',
      '.thch-bar-fill{height:100%;background:#d31027;transition:width .4s}',
      '.thch-card-bottom{display:flex;justify-content:space-between;margin-top:8px;font-size:9px;letter-spacing:.08em;text-transform:uppercase}',
      '.thch-days{color:#8d9199}',
      '.thch-done{color:#e5e5e5;font-weight:900}',
      '.thch-ended{color:#5d6167}',
      '.thch-arrow{color:#6b7078}',
      '.thch-empty{text-align:center;padding:26px 0;display:flex;flex-direction:column;gap:8px;align-items:center}',
      '.thch-empty-emoji{font-size:34px}',
      '.thch-speeches{display:flex;flex-direction:column;gap:8px}',
      '.thch-speech{background:#121317;border:1px solid #2a2d33;padding:12px;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:5px}',
      '.thch-speech.is-on{border-color:#e5e5e5}',
      '.thch-speech.is-prem .thch-speech-title::after{content:" ★"}',
      '.thch-speech-top{display:flex;justify-content:space-between;align-items:baseline}',
      '.thch-speech-title{font-size:12px;font-weight:900;letter-spacing:.08em}',
      '.thch-speech-tag{font-size:9px;color:#8d9199}',
      '.thch-speech-short{font-size:10px;color:#8d9199;line-height:1.5}',
      '.thch-hero{text-align:center;padding:12px 0 4px}',
      '.thch-hero-fire{font-size:40px}',
      '.thch-hero-brand{font-size:9px;letter-spacing:.3em;text-transform:uppercase;color:#6b7078;font-weight:800;margin-top:4px}',
      '.thch-hero-title{font-size:22px;font-weight:900;font-style:italic;margin-top:6px;line-height:1.15}',
      '.thch-param{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#8d9199;font-weight:800;margin-top:6px}',
      '.thch-param-big{font-size:24px;font-weight:900;margin-top:3px}',
      '.thch-quote{border-left:2px solid #d31027;padding:8px 0 8px 12px;margin-top:14px}',
      '.thch-quote-title{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#8d9199;font-weight:800}',
      '.thch-quote-text{font-size:13px;font-style:italic;line-height:1.5;margin-top:5px;color:#e5e5e5}',
      '.thch-sharecard{border:1px solid rgba(229,229,229,.35);padding:22px 16px;text-align:center;background:linear-gradient(145deg,#14161a,#0c0d10)}',
      '.thch-sc-brand{font-size:10px;letter-spacing:.3em;font-weight:900}',
      '.thch-sc-fire{font-size:34px;margin-top:8px}',
      '.thch-sc-head{font-size:15px;font-weight:900;font-style:italic;margin-top:6px}',
      '.thch-sc-line{font-size:12px;letter-spacing:.14em;text-transform:uppercase;margin-top:4px;color:#c9c9c9}',
      '.thch-sc-quote{font-size:11px;font-style:italic;color:#8d9199;margin-top:12px;line-height:1.5}',
      '.thch-sc-cta{display:inline-block;margin-top:14px;padding:9px 18px;border:1px solid rgba(229,229,229,.5);font-size:10px;font-weight:900;letter-spacing:.2em}',
      '.thch-qr{display:flex;justify-content:center;padding:14px;background:#fff;margin-top:4px}',
      '.thch-qr canvas{max-width:100%;height:auto}',
      '.thch-complete{text-align:center;padding:14px 0 4px}',
      '.thch-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%) translateY(20px);background:#1a1b1e;border:1px solid rgba(255,255,255,.18);color:#fff;font-size:12px;font-weight:700;padding:10px 18px;opacity:0;pointer-events:none;transition:all .25s;z-index:9999;max-width:86%;text-align:center}',
      '.thch-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}',
      '.thch-ta{position:fixed;left:-9999px;top:0}',
      '@media(max-width:480px){.thch-panel{border-left:0;border-right:0}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- публичный API ---------- */
  window.__THChallenges = {
    open: open,
    openCreate: showCreateAudience,
    openPreview: openPreview,
    close: close,
    /* хуки из React-обёрток */
    onWorkoutCompleted: function (day, dateStr) {
      var r = Service.onWorkoutCompleted(day, dateStr);
      if (r.completed && r.completed.length) {
        toast('🔥 Челлендж завершён!');
        try { window.TrainHardEffects && window.TrainHardEffects.play('achievement'); } catch (e) {}
      }
      return r;
    },
    onRecordAdded: function (exercise, kg) {
      var r = Service.onRecordAdded(exercise, kg);
      if (r.completed && r.completed.length) {
        toast('🔥 Силовая цель достигнута!');
        try { window.TrainHardEffects && window.TrainHardEffects.play('achievement'); } catch (e) {}
      }
      return r;
    }
  };
})();
