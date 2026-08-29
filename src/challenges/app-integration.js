/* =============================================================
 * Train Hard — Challenges: интеграция в интерфейс приложения
 * 1) Кнопка «Челленджи» в правом нижнем углу главной (как огонёк слева)
 * 2) Шкалы челленджей в разделе «Прогресс» (перед «Достижениями»)
 * 3) Достижения: серые, пока уровень не достигнут (grayscale)
 * 4) Тост «Серия обновилась» после сброса серии (2 дня без тренировок)
 * DOM приложения не переписывается — только наблюдение и вставка
 * своих узлов. Vanilla, без зависимостей.
 * ============================================================= */
(function () {
  'use strict';

  var CSS = [
    '.thch-fab{position:fixed;right:16px;bottom:16px;z-index:30;display:flex;align-items:center;gap:8px;',
    'background:#121212;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:10px 14px;',
    'color:#fff;font-size:13px;font-weight:800;letter-spacing:.02em;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.5);',
    'transition:border-color .2s, transform .15s;font-family:inherit}',
    '.thch-fab:active{transform:scale(.96)}',
    '.thch-fab-bolt{font-size:16px;line-height:1;color:#ff5a1f}',
    '.thch-fab-dot{position:absolute;top:-4px;right:-4px;width:9px;height:9px;border-radius:50%;',
    'background:#d31027;border:2px solid #0a0a0a;display:none}',
    '.thch-fab.has-active .thch-fab-dot{display:block}',
    '.thch-pcard{background:#121212;border-radius:24px;padding:20px;margin:16px;box-shadow:0 0 0 1px rgba(255,255,255,.05);cursor:pointer}',
    '.thch-pcard-title{font-size:10px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;color:#6b7280}',
    '.thch-prow{margin-top:14px;cursor:pointer}',
    '.thch-prow-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px}',
    '.thch-prow-name{font-size:13px;font-weight:800;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.thch-prow-val{font-size:11px;font-weight:800;color:#9ca3af;flex-shrink:0}',
    '.thch-pbar{height:8px;border-radius:999px;background:#0d0d0d;margin-top:7px;overflow:hidden;',
    'box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}',
    '.thch-pfill{height:100%;border-radius:999px;background:#fff;transition:width .4s}',
    '.thch-pfill.is-done{background:#d31027}',
    '.thch-pfill.is-ended{background:#3f3f46}',
    '.thch-pempty{margin-top:10px;font-size:12px;color:#6b7280}',
    '.th-ach-gray{filter:grayscale(1)}',
    'body.thch-open .thch-fab{display:none!important}',
    '.thch-streak-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:60;',
    'background:#1a1a1a;box-shadow:0 0 0 1px rgba(255,255,255,.15);color:#fff;font-size:13px;font-weight:700;',
    'padding:12px 20px;border-radius:14px;max-width:86%;text-align:center;opacity:0;pointer-events:none;',
    'transition:opacity .3s}',
    '.thch-streak-toast.show{opacity:1}'
  ].join('');

  function addCss() {
    if (document.getElementById('thch-integration-css')) return;
    var st = document.createElement('style');
    st.id = 'thch-integration-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function svc() { return window.__THChallengeService; }
  function each(arr, fn) { for (var i = 0; i < arr.length; i++) fn(arr[i], i); }

  /* ---------- 1) FAB «Челленджи» (зеркало кнопки огонька) ---------- */
  var fab = null;

  /* Любой полноэкранный оверлей приложения: модалки (absolute inset-0 z-40),
     боковое меню (absolute inset-0 z-50), оверлей челленджей (body.thch-open).
     Тосты (z-[60]) и конфетти не считаются — они не перекрывают интерфейс. */
  function appOverlayOpen() {
    try {
      if (document.body.classList.contains('thch-open')) return true;
      var ovs = document.querySelectorAll('div.absolute.inset-0.z-40, div.absolute.inset-0.z-50');
      for (var i = 0; i < ovs.length; i++) {
        if (ovs[i].style.display !== 'none') return true;
      }
    } catch (e) {}
    return false;
  }

  function isHomeScreen() {
    /* якорь — кнопка огонька: absolute bottom-4 left-4 на главной */
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var cls = btns[i].classList;
      if (cls.contains('absolute') && cls.contains('bottom-4') && cls.contains('left-4')) return true;
    }
    return false;
  }

  function ensureFab() {
    if (fab) return;
    addCss();
    fab = document.createElement('button');
    fab.className = 'thch-fab';
    fab.setAttribute('aria-label', 'Челленджи');
    var bolt = document.createElement('span');
    bolt.className = 'thch-fab-bolt';
    bolt.textContent = '⚡';
    var label = document.createElement('span');
    label.textContent = 'Челленджи';
    var dot = document.createElement('span');
    dot.className = 'thch-fab-dot';
    fab.appendChild(bolt);
    fab.appendChild(label);
    fab.appendChild(dot);
    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      try { window.__THChallenges && window.__THChallenges.open(); } catch (err) {}
    });
    document.body.appendChild(fab);
  }

  function syncFab() {
    var home = isHomeScreen() && !appOverlayOpen();
    if (!home) { if (fab) fab.style.display = 'none'; return; }
    ensureFab();
    fab.style.display = 'flex';
    /* кнопка должна стоять НАД нижней панелью навигации, а не на ней:
       нижний отступ = высота панели + зазор (панель в потоке, не fixed) */
    var navH = 0;
    try {
      var nav = document.querySelector('nav');
      if (nav && nav.offsetHeight) navH = nav.offsetHeight;
    } catch (e) {}
    var bottom = (navH ? navH + 12 : 16);
    var want = 'calc(' + bottom + 'px + env(safe-area-inset-bottom, 0px))';
    if (fab.style.bottom !== want) fab.style.bottom = want;
    var has = false;
    try { has = (svc().getChallenges().filter(function (c) { return c.status === 'active'; }).length > 0); } catch (e) {}
    if (has) fab.classList.add('has-active'); else fab.classList.remove('has-active');
  }

  /* ---------- 2) Шкалы челленджей в «Прогрессе» ---------- */
  function findAchCard() {
    var spans = document.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].textContent === 'Достижения') {
        var card = spans[i].parentElement;
        if (card) return card;
      }
    }
    return null;
  }

  function fmtRow(c) {
    if (c.type === 'strength') {
      var cur = c.strengthCurrent || 0;
      return { name: c.title, val: cur + ' / ' + c.strengthGoal.w + ' кг' };
    }
    return { name: c.title, val: c.completedWorkouts + ' / ' + c.targetWorkouts + ' подряд' };
  }

  function pctOf(c) {
    if (c.type === 'strength') {
      var t = c.strengthGoal.w || 1;
      return Math.min(100, Math.round(((c.strengthCurrent || 0) / t) * 100));
    }
    return Math.min(100, Math.round((c.completedWorkouts / c.targetWorkouts) * 100));
  }

  function buildProgressCard() {
    var card = document.createElement('div');
    card.className = 'thch-pcard';
    card.setAttribute('data-thch', 'progress');
    card.addEventListener('click', function (e) {
      e.stopPropagation();
      try { window.__THChallenges && window.__THChallenges.open(); } catch (err) {}
    });
    var title = document.createElement('div');
    title.className = 'thch-pcard-title';
    title.textContent = 'Челленджи';
    card.appendChild(title);

    var list = [];
    try { list = svc().getChallenges(); } catch (e) {}
    var shown = list.filter(function (c) { return c.status === 'active' || c.status === 'completed'; });

    if (!shown.length) {
      var empty = document.createElement('div');
      empty.className = 'thch-pempty';
      empty.textContent = 'Пока нет челленджей — создай свой по кнопке ⚡';
      card.appendChild(empty);
      return card;
    }

    each(shown, function (c) {
      var row = document.createElement('div');
      row.className = 'thch-prow';
      var top = document.createElement('div');
      top.className = 'thch-prow-top';
      var name = document.createElement('span');
      name.className = 'thch-prow-name';
      var f = fmtRow(c);
      name.textContent = f.name;
      var val = document.createElement('span');
      val.className = 'thch-prow-val';
      val.textContent = c.status === 'completed'
        ? 'ГОТОВО'
        : f.val + (c.status === 'active' ? ' · ' + c.daysLeft + ' дн' : '');
      top.appendChild(name);
      top.appendChild(val);
      var bar = document.createElement('div');
      bar.className = 'thch-pbar';
      var fill = document.createElement('div');
      fill.className = 'thch-pfill' + (c.status === 'completed' ? ' is-done' : '');
      fill.style.width = (c.status === 'completed' ? 100 : pctOf(c)) + '%';
      bar.appendChild(fill);
      row.appendChild(top);
      row.appendChild(bar);
      card.appendChild(row);
    });
    return card;
  }

  function syncProgressCard() {
    var achCard = findAchCard();
    if (!achCard) return;
    addCss();
    var old = document.querySelector('[data-thch="progress"]');
    if (old && old.parentElement === achCard.parentElement) old.remove();
    achCard.parentElement.insertBefore(buildProgressCard(), achCard);

    /* 3) достижения: не заработанные — серые */
    var grid = achCard.querySelector('div');
    if (grid) {
      each(grid.children, function (cell) {
        if (cell.classList.contains('opacity-50')) cell.classList.add('th-ach-gray');
        else cell.classList.remove('th-ach-gray');
      });
    }
  }

  /* ---------- 4) Тост о сбросе серии ---------- */
  var streakToastShown = false;

  function showStreakToast() {
    if (streakToastShown) return;
    var from = window.__thStreakResetFrom;
    if (!from) return;
    streakToastShown = true;
    addCss();
    var t = document.createElement('div');
    t.className = 'thch-streak-toast';
    t.textContent = 'Серия обновилась: вы не тренировались 2 дня';
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 30);
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 400);
    }, 5000);
  }

  /* ---------- наблюдатель ---------- */
  function tick() {
    try { ensureObserver(); } catch (e) {}
    try { syncFab(); } catch (e) {}
    try { syncProgressCard(); } catch (e) {}
    try { showStreakToast(); } catch (e) {}
  }

  var mo = null;
  function ensureObserver() {
    if (mo) return;
    try {
      var nav = document.querySelector('nav');
      if (!nav || !nav.parentElement) return;
      mo = new MutationObserver(function () { tick(); });
      mo.observe(nav.parentElement, { childList: true });          /* оверлеи — дети контейнера приложения */
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] }); /* thch-open и т.п. */
    } catch (e) {}
  }

  function boot() {
    addCss();
    /* Security-audit: локальная аккаунтная система удалена из UI ещё в MVP 1.0,
       но у ранних пользователей в localStorage мог остаться ключ
       trainhard_react_accounts (хеши/устаревшие поля паролей). Функционально он
       нигде не читается — вычищаем, чтобы парольных данных на устройстве не было. */
    try { localStorage.removeItem('trainhard_react_accounts'); } catch (e) {}
    tick();
    setInterval(tick, 1500);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 300); });
  } else {
    setTimeout(boot, 300);
  }

  window.__THAppIntegration = { tick: tick };
})();
