/* =============================================================
 * Train Hard — ARENA UI: группы и серверные лидерборды
 *
 * Возвращает убранную в прошлых итерациях ARENA, но теперь на
 * настоящем backend (§35): группы, инвайты-коды, участие и
 * лидерборды S/B/D/Total приходят с сервера — два реальных
 * пользователя видят одни и те же данные. Ничего не имитируется:
 * нет сети/Telegram → понятные состояния, фейковых строк нет.
 *
 * Безопасность: все строки с сервера экранируются esc() (XSS §31),
 * кнопки блокируются на время запроса (§49 double-tap).
 * ============================================================= */
(function () {
  'use strict';

  var API = window.__THAPI;
  var cfg = window.TRAINHARD_ARENA || {};
  if (!API) return;

  var CSS = [
    '.thar-fab{position:fixed;left:16px;bottom:16px;z-index:30;display:flex;align-items:center;gap:8px;',
    'background:#121212;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:10px 14px;',
    'color:#fff;font-size:13px;font-weight:800;letter-spacing:.02em;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.5);',
    'font-family:inherit;transition:transform .15s}',
    '.thar-fab:active{transform:scale(.96)}',
    '.thar-root{position:fixed;inset:0;z-index:70;display:flex;align-items:flex-end;justify-content:center;',
    'background:rgba(0,0,0,.6);backdrop-filter:blur(4px)}',
    '.thar-panel{width:100%;max-width:480px;max-height:86vh;overflow:auto;background:#0b0b0d;color:#fff;',
    'border-radius:24px 24px 0 0;box-shadow:0 -10px 60px rgba(0,0,0,.7);padding:0 0 28px;font-family:inherit}',
    '.thar-head{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:16px 18px;',
    'background:#0b0b0d;border-bottom:1px solid rgba(255,255,255,.07);z-index:2}',
    '.thar-title{font-size:15px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;flex:1;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.thar-x{background:none;border:0;color:#9ca3af;font-size:20px;cursor:pointer;padding:4px 8px;line-height:1}',
    '.thar-body{padding:16px 18px 0}',
    '.thar-card{background:#121214;border:1px solid rgba(255,255,255,.06);border-radius:18px;padding:14px;margin-bottom:12px}',
    '.thar-sub{font-size:10px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin-bottom:10px}',
    '.thar-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#fff;color:#000;',
    'border:0;border-radius:14px;padding:11px 16px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;',
    'transition:opacity .2s}',
    '.thar-btn:disabled{opacity:.45;cursor:default}',
    '.thar-btn.ghost{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}',
    '.thar-btn.danger{background:transparent;color:#f87171;box-shadow:inset 0 0 0 1px rgba(248,113,113,.4)}',
    '.thar-btn.wide{width:100%}',
    '.thar-input{width:100%;box-sizing:border-box;background:#0d0d0f;color:#fff;border:1px solid rgba(255,255,255,.12);',
    'border-radius:12px;padding:11px 12px;font-size:14px;font-family:inherit;margin-bottom:8px;outline:none}',
    '.thar-input:focus{border-color:#52525b}',
    '.thar-row{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.05)}',
    '.thar-row:last-child{border-bottom:0}',
    '.thar-place{width:26px;text-align:center;font-size:15px;font-weight:900;flex-shrink:0}',
    '.thar-name{flex:1;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.thar-val{font-size:13px;font-weight:900;color:#e5e7eb;flex-shrink:0}',
    '.thar-row.me .thar-name{color:#ff5a1f}',
    '.thar-role{font-size:10px;font-weight:800;color:#9ca3af;background:#1b1b1f;border-radius:8px;padding:3px 7px;flex-shrink:0}',
    '.thar-tabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}',
    '.thar-tab{background:#121214;border:1px solid rgba(255,255,255,.08);color:#9ca3af;border-radius:11px;',
    'padding:8px 11px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit}',
    '.thar-tab.on{background:#fff;color:#000;border-color:#fff}',
    '.thar-skel{height:44px;border-radius:12px;background:linear-gradient(90deg,#141416 25%,#1d1d21 50%,#141416 75%);',
    'background-size:200% 100%;animation:thar-pulse 1.1s infinite;margin-bottom:8px}',
    '@keyframes thar-pulse{0%{background-position:200% 0}100%{background-position:-200% 0}}',
    '.thar-err{background:#1f1214;border:1px solid rgba(248,113,113,.3);border-radius:14px;padding:12px 14px;',
    'font-size:13px;color:#fca5a5;margin-bottom:12px}',
    '.thar-empty{font-size:13px;color:#6b7280;padding:8px 0 2px}',
    '.thar-code{font-size:20px;font-weight:900;letter-spacing:.14em;background:#0d0d0f;border-radius:12px;',
    'padding:12px;text-align:center;margin:8px 0;font-family:monospace}',
    '.thar-note{font-size:11px;color:#6b7280;margin-top:6px}',
    '.thar-podium{display:flex;justify-content:center;gap:8px;margin:4px 0 14px}',
    '.thar-pod{flex:1;max-width:120px;background:#121214;border:1px solid rgba(255,255,255,.07);border-radius:14px;',
    'padding:10px 6px;text-align:center}',
    '.thar-pod .m{font-size:22px;line-height:1}',
    '.thar-pod .v{font-size:15px;font-weight:900;margin-top:6px}',
    '.thar-pod .n{font-size:11px;color:#9ca3af;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  ].join('');

  var METRICS = [
    { key: 'total', label: 'Троеборье', api: 'TOTAL' },
    { key: 'squat', label: 'Присед', api: 'SQUAT' },
    { key: 'bench', label: 'Жим', api: 'BENCH' },
    { key: 'deadlift', label: 'Становая', api: 'DEADLIFT' }
  ];
  var MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
  var ROLE_LABEL = { OWNER: '👑 владелец', ADMIN: 'админ', MEMBER: 'участник' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function nameOf(u) {
    if (!u) return '—';
    return u.username ? '@' + u.username : (u.first_name || 'Спортсмен');
  }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function sound(n) { try { if (window.TrainHardEffects) window.TrainHardEffects.play(n); } catch (e) {} }

  var root = null, panel = null, open = false;
  var st = { view: 'home', group: null, metric: METRICS[0], busy: {} };

  /* ---------- каркас ---------- */
  function ensureDom() {
    if (document.getElementById('thar-css')) return;
    var style = document.createElement('style');
    style.id = 'thar-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function fab() {
    ensureDom();
    if (document.getElementById('thar-fab')) return;
    if (!API.available()) return;             /* нет Telegram-авторизации → честно не показываем */
    var b = el('button', 'thar-fab');
    b.id = 'thar-fab';
    b.innerHTML = '<span style="font-size:16px">🏛</span> АРЕНА';
    b.addEventListener('click', function () { buzz(10); openModal(); });
    document.body.appendChild(b);
  }

  function openModal() {
    if (open) return;
    open = true;
    ensureDom();
    root = el('div', 'thar-root');
    root.id = 'thar-root';
    panel = el('div', 'thar-panel');
    var head = el('div', 'thar-head');
    var title = el('div', 'thar-title', 'ARENA');
    title.id = 'thar-title';
    var x = el('button', 'thar-x', '✕');
    x.addEventListener('click', closeModal);
    head.appendChild(title); head.appendChild(x);
    panel.appendChild(head);
    var body = el('div', 'thar-body');
    body.id = 'thar-body';
    panel.appendChild(body);
    root.appendChild(panel);
    root.addEventListener('click', function (e) { if (e.target === root) closeModal(); });
    document.body.appendChild(root);
    document.body.classList.add('thch-open');
    goHome();
    var sp = API.startParam();
    if (/^[a-f0-9]{8,32}$/i.test(sp)) joinByCode(sp, true);
  }
  function closeModal() {
    open = false;
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; panel = null;
    document.body.classList.remove('thch-open');
  }
  function body() { return document.getElementById('thar-body'); }
  function setTitle(t) {
    var n = document.getElementById('thar-title');
    if (n) n.textContent = t;
  }
  function clear() { var b = body(); while (b.firstChild) b.removeChild(b.firstChild); }

  /* жив ли ещё документ (после window.close тестов/навигации) */
  function alive() {
    try { return !!(typeof document !== 'undefined' && document && document.body); }
    catch (e) { return false; }
  }

  function busy(key, on) {
    st.busy[key] = on;
    try {                                   /* окно могли закрыть во время запроса */
      var all = document.querySelectorAll('.thar-btn[data-busy="' + key + '"]');
      for (var i = 0; i < all.length; i++) all[i].disabled = on;
    } catch (e) {}
  }

  function errorBox(msg, retry) {
    var box = el('div', 'thar-err', msg);
    if (retry) {
      var b = el('button', 'thar-btn ghost', 'Повторить');
      b.style.marginTop = '8px';
      b.addEventListener('click', retry);
      box.appendChild(el('div'));
      box.appendChild(b);
    }
    return box;
  }
  function networkFail(r, retry) {
    var msg = (r && r.reason === 'network') || (r && r.status === 0)
      ? 'Нет соединения с сервером. Проверь интернет и попробуй снова.'
      : (r && r.reason === 'telegram-required')
        ? 'АРЕНА доступна внутри Telegram (нужна серверная авторизация).'
        : 'Сервер недоступен (' + ((r && r.status) || 'нет ответа') + '). Попробуй позже.';
    return errorBox(msg, retry);
  }
  function skeletons(n) {
    var wrap = document.createDocumentFragment();
    for (var i = 0; i < (n || 3); i++) wrap.appendChild(el('div', 'thar-skel'));
    return wrap;
  }

  /* ---------- экран «мой группы» ---------- */
  function goHome() {
    st.view = 'home'; st.group = null;
    setTitle('ARENA — группы');
    var b = body(); clear();
    b.appendChild(skeletons(3));
    loadHome();
  }

  async function loadHome() {
    var r = await API.request('GET', '/api/groups');
    if (!alive()) return;
    var b = body(); clear();
    if (!r.ok) { b.appendChild(networkFail(r, goHome)); return; }
    var groups = (r.body && r.body.groups) || [];

    var listCard = el('div', 'thar-card');
    listCard.appendChild(el('div', 'thar-sub', 'Мои группы'));
    if (!groups.length) {
      listCard.appendChild(el('div', 'thar-empty',
        'Пока нет групп. Создай первую и позови друзей — рейтинги посчитает сервер.'));
    }
    groups.forEach(function (g) {
      var row = el('div', 'thar-row');
      row.style.cursor = 'pointer';
      row.appendChild(el('div', 'thar-name', g.name));
      row.appendChild(el('div', 'thar-val', '→'));
      row.addEventListener('click', function () { buzz(8); openGroup(g.id); });
      listCard.appendChild(row);
    });
    b.appendChild(listCard);

    var create = el('div', 'thar-card');
    create.appendChild(el('div', 'thar-sub', 'Создать группу'));
    var inp = el('input', 'thar-input');
    inp.id = 'thar-new-name';
    inp.placeholder = 'Название (например, POWERLIFTING FRIENDS)';
    inp.maxLength = 80;
    var btn = el('button', 'thar-btn wide', 'Создать');
    btn.dataset.busy = 'create';
    btn.addEventListener('click', async function () {
      var name = inp.value.trim();
      if (name.length < 3) { inp.style.borderColor = '#f87171'; return; }
      busy('create', true); sound('tap');
      var res = await API.request('POST', '/api/groups', { name: name });
      busy('create', false);
      if (!alive()) return;
      if (res.ok && res.body && res.body.group) { buzz([15, 40, 15]); openGroup(res.body.group.id); }
      else { clear(); body().appendChild(networkFail(res, goHome)); }
    });
    create.appendChild(inp); create.appendChild(btn);
    b.appendChild(create);

    var join = el('div', 'thar-card');
    join.appendChild(el('div', 'thar-sub', 'Вступить по коду приглашения'));
    var ji = el('input', 'thar-input');
    ji.id = 'thar-join-code';
    ji.placeholder = 'Код из приглашения друга';
    ji.maxLength = 32;
    var jb = el('button', 'thar-btn ghost wide', 'Вступить');
    jb.dataset.busy = 'join';
    jb.addEventListener('click', function () {
      var code = ji.value.trim();
      if (!code) { ji.style.borderColor = '#f87171'; return; }
      joinByCode(code);
    });
    join.appendChild(ji); join.appendChild(jb);
    b.appendChild(join);
  }

  async function joinByCode(code, fromLink) {
    busy('join', true);
    var r = await API.request('POST', '/api/invites/' + encodeURIComponent(code) + '/join', {});
    busy('join', false);
    if (!open || !alive()) return;   /* модалку закрыли, пока шёл запрос */
    if (r.ok && r.body && r.body.group) {
      buzz([15, 40, 15]);
      openGroup(r.body.group.id);
    } else {
      var b = body(); clear();
      var msg = r.status === 404 ? 'Приглашение не найдено, истекло или уже использовано.'
        : r.status === 409 ? 'Ты уже участник этой группы.'
        : r.status === 0 ? 'Нет соединения с сервером.'
        : 'Не удалось вступить (' + r.status + ').';
      b.appendChild(errorBox(msg, fromLink ? goHome : null));
      if (!fromLink) loadHomeAfterError();
    }
  }
  function loadHomeAfterError() {
    var card = el('div', 'thar-card');
    card.appendChild(el('div', 'thar-empty', 'Можно вернуться к группам и попробовать другой код.'));
    body().appendChild(card);
  }

  /* ---------- экран группы + лидерборд ---------- */
  async function openGroup(gid) {
    st.view = 'group'; st.group = null;
    setTitle('Загрузка…');
    var b = body(); clear();
    b.appendChild(skeletons(4));

    var g = await API.request('GET', '/api/groups/' + gid);
    if (!alive()) return;
    if (!g.ok) { clear(); b.appendChild(networkFail(g, goHome)); return; }
    st.group = g.body.group;
    st.role = (g.body.me && g.body.me.role) || 'MEMBER';

    renderGroupShell();
    await loadBoard();
  }

  function renderGroupShell() {
    var b = body(); clear();
    setTitle(st.group.name);

    var info = el('div', 'thar-card');
    var row = el('div', 'thar-row');
    row.appendChild(el('div', 'thar-name', 'Участников: ' + (st.group.member_count || '—')));
    var role = el('div', 'thar-role', ROLE_LABEL[st.role] || st.role);
    row.appendChild(role);
    info.appendChild(row);

    var ib = el('button', 'thar-btn ghost wide', '👥 Пригласить друга');
    ib.dataset.busy = 'invite';
    ib.addEventListener('click', showInvite);
    info.appendChild(el('div'));
    info.appendChild(ib);

    if (st.role === 'OWNER') {
      var db = el('button', 'thar-btn danger wide', 'Удалить группу');
      db.style.marginTop = '8px';
      db.dataset.busy = 'del';
      db.addEventListener('click', async function () {
        if (!window.confirm('Удалить группу «' + st.group.name + '»?')) return;
        busy('del', true);
        var r = await API.request('DELETE', '/api/groups/' + st.group.id);
        busy('del', false);
        if (!alive()) return;
        if (r.ok) { buzz(20); goHome(); }
      });
      info.appendChild(db);
    } else {
      var lb = el('button', 'thar-btn danger wide', 'Выйти из группы');
      lb.style.marginTop = '8px';
      lb.dataset.busy = 'leave';
      lb.addEventListener('click', async function () {
        busy('leave', true);
        var r = await API.request('POST', '/api/groups/' + st.group.id + '/leave', {});
        busy('leave', false);
        if (!alive()) return;
        if (r.ok) { buzz(20); goHome(); }
        else { clear(); body().appendChild(errorBox('Не удалось выйти (' + r.status + ').', renderGroupShell)); }
      });
      info.appendChild(lb);
    }
    b.appendChild(info);

    var tabs = el('div', 'thar-tabs');
    tabs.id = 'thar-tabs';
    METRICS.forEach(function (m) {
      var t = el('button', 'thar-tab' + (st.metric.key === m.key ? ' on' : ''), m.label);
      t.dataset.metric = m.key;
      t.addEventListener('click', function () {
        st.metric = m; buzz(6);
        var all = tabs.querySelectorAll('.thar-tab');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
        t.classList.add('on');
        loadBoard();
      });
      tabs.appendChild(t);
    });
    b.appendChild(tabs);

    var boardCard = el('div', 'thar-card');
    boardCard.id = 'thar-board';
    boardCard.appendChild(skeletons(4));
    b.appendChild(boardCard);
  }

  async function loadBoard() {
    var card = document.getElementById('thar-board');
    if (!card) return;
    card.textContent = '';
    card.appendChild(skeletons(4));
    var r = await API.request('GET', '/api/groups/' + st.group.id + '/leaderboard?metric=' + st.metric.api);
    if (!alive() || !document.getElementById('thar-board')) return;   /* экран сменился */
    card.textContent = '';
    if (!r.ok) { card.appendChild(networkFail(r, loadBoard)); return; }
    var rows = (r.body && r.body.rows) || [];
    var me = API.user();

    var podium = rows.slice(0, 3).filter(function (x) { return x.place <= 3; });
    if (podium.length) {
      var pw = el('div', 'thar-podium');
      podium.forEach(function (x) {
        var p = el('div', 'thar-pod');
        p.appendChild(el('div', 'm', MEDALS[x.place] || ('' + x.place)));
        p.appendChild(el('div', 'v', x.value + ' кг'));
        p.appendChild(el('div', 'n', nameOf(x.user)));
        pw.appendChild(p);
      });
      card.appendChild(pw);
    }
    if (!rows.length) {
      card.appendChild(el('div', 'thar-empty',
        'Результатов пока нет. Запиши тренировку — и она появится в рейтинге (синхронизация автоматом).'));
      return;
    }
    rows.forEach(function (x) {
      var row = el('div', 'thar-row' + (me && x.user && x.user.id === me.id ? ' me' : ''));
      row.appendChild(el('div', 'thar-place', MEDALS[x.place] || x.place));
      row.appendChild(el('div', 'thar-name', nameOf(x.user)));
      row.appendChild(el('div', 'thar-val', x.value + ' кг'));
      card.appendChild(row);
    });
  }

  async function showInvite() {
    busy('invite', true);
    var r = await API.request('POST', '/api/groups/' + st.group.id + '/invite', {});
    busy('invite', false);
    if (!alive()) return;
    var b = body(); clear();
    setTitle(st.group.name);
    if (!r.ok) { b.appendChild(networkFail(r, renderGroupShell)); return; }
    var code = r.body.code;

    var card = el('div', 'thar-card');
    card.appendChild(el('div', 'thar-sub', 'Приглашение в группу'));
    card.appendChild(el('div', null, 'Передай другу код — он введёт его в Арене или откроет ссылку:'));
    var codeBox = el('div', 'thar-code');
    codeBox.id = 'thar-invite-code';
    codeBox.textContent = code;
    card.appendChild(codeBox);

    var cp = el('button', 'thar-btn wide', 'Скопировать код');
    cp.addEventListener('click', function () {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code);
        else if (window.__THQR && window.__THQR.copy) window.__THQR.copy(code);
      } catch (e) {}
      cp.textContent = 'Скопировано ✓';
      buzz(10);
    });
    card.appendChild(cp);

    if (cfg.botAppLink) {
      var link = cfg.botAppLink + code;
      var lnk = el('div', 'thar-note');
      var a = document.createElement('a');
      a.href = link;
      a.textContent = 'Открыть ссылку-приглашение в Telegram';
      a.style.color = '#ff5a1f';
      lnk.appendChild(a);
      card.appendChild(lnk);
      try {
        var w = window.Telegram && window.Telegram.WebApp;
        if (w && w.openTelegramLink) w.openTelegramLink(link);
      } catch (e) {}
    }
    card.appendChild(el('div', 'thar-note', cfg.inviteTtlNote || ''));

    var back = el('button', 'thar-btn ghost wide', '← К группе');
    back.style.marginTop = '10px';
    back.addEventListener('click', renderGroupShell);
    card.appendChild(back);
    b.appendChild(card);
  }

  /* ---------- запуск ---------- */
  function boot() {
    fab();
    /* deep-link приглашения (§22/§34): ?startapp=CODE → сразу экран вступления */
    var sp = API.startParam();
    if (API.available() && /^[a-f0-9]{8,32}$/i.test(sp)) setTimeout(openModal, 250);
    /* синхронизация: после загрузки отправить накопленное (если Telegram) */
    if (window.__THSync && API.available()) setTimeout(function () { window.__THSync.flush(); }, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.__THArena = { open: openModal, close: closeModal, _goHome: goHome, _state: st };
})();
