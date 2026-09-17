/* Train Hard — Arena UI v3
 * Path: src/arena/arena-ui.js
 *
 * Arena:
 * 1. Если группы нет — только «Вступить в группу» / «Создать группу».
 * 2. Вступление — по Telegram invite link.
 * 3. Создание — название группы -> силовые.
 * 4. После вступления/создания — силовые: присед, жим, тяга.
 * 5. Один пользователь может состоять только в одной группе.
 * 6. Telegram startapp автоматически используется для приглашения.
 */

(function () {
  'use strict';

  var cfg = window.TRAINHARD_ARENA || {};
  var API_BASE = String(cfg.apiBase || '').replace(/\/+$/, '');
  var SESSION_KEY = 'trainhard_api_session';

  var state = {
    group: null,
    stats: {
      squat: null,
      bench: null,
      deadlift: null
    },
    loading: false
  };

  var root = null;

  /* ---------------------------------------------------------
     Telegram
  --------------------------------------------------------- */

  function tg() {
    return window.Telegram && window.Telegram.WebApp
      ? window.Telegram.WebApp
      : null;
  }

  function startParam() {
    var app = tg();
    if (!app) return '';

    try {
      return String(
        app.initDataUnsafe &&
        app.initDataUnsafe.start_param
          ? app.initDataUnsafe.start_param
          : ''
      );
    } catch (e) {
      return '';
    }
  }

  function initTelegram() {
    var app = tg();
    if (!app) return;

    try {
      if (typeof app.ready === 'function') app.ready();
      if (typeof app.expand === 'function') app.expand();

      if (typeof app.disableVerticalSwipes === 'function') {
        app.disableVerticalSwipes();
      }
    } catch (e) {
      console.warn('[TrainHard Arena] Telegram init:', e);
    }
  }

  /* ---------------------------------------------------------
     API
  --------------------------------------------------------- */

  function getInitData() {
    var app = tg();

    if (!app) return '';

    try {
      return String(app.initData || '');
    } catch (e) {
      return '';
    }
  }

  function getSession() {
    try {
      return localStorage.getItem(SESSION_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setSession(token) {
    try {
      if (token) {
        localStorage.setItem(SESSION_KEY, token);
      }
    } catch (e) {}
  }

  async function request(method, path, body) {
    var headers = {
      'Content-Type': 'application/json'
    };

    var initData = getInitData();
    var session = getSession();

    if (initData) {
      headers['X-Telegram-Init-Data'] = initData;
    }

    if (session) {
      headers.Authorization = 'Bearer ' + session;
    }

    var response = await fetch(API_BASE + path, {
      method: method,
      headers: headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    var text = await response.text();
    var data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }

    if (!response.ok) {
      var message =
        data &&
        typeof data === 'object' &&
        (data.error || data.message);

      var error = new Error(
        message || ('HTTP ' + response.status)
      );

      error.status = response.status;
      error.data = data;

      throw error;
    }

    if (
      data &&
      typeof data === 'object' &&
      data.token
    ) {
      setSession(String(data.token));
    }

    return data;
  }

  /* ---------------------------------------------------------
     Helpers
  --------------------------------------------------------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function kg(value) {
    if (value === null || value === undefined || value === '') {
      return '—';
    }

    var n = Number(value);

    if (!Number.isFinite(n)) return '—';

    return Number.isInteger(n)
      ? String(n)
      : n.toFixed(2).replace(/\.00$/, '');
  }

  function normalizeWeight(value) {
    if (value === '' || value === null || value === undefined) {
      return null;
    }

    var n = Number(value);

    if (!Number.isFinite(n)) {
      throw new Error('Введите корректный вес');
    }

    if (n < 0 || n > 1000) {
      throw new Error('Вес должен быть от 0 до 1000 кг');
    }

    return Math.round(n * 100) / 100;
  }

  function totalStats(stats) {
    return (
      Number(stats.squat || 0) +
      Number(stats.bench || 0) +
      Number(stats.deadlift || 0)
    );
  }

  function errorMessage(error) {
    if (!error) return 'Произошла ошибка';

    if (
      error.status === 409
    ) {
      return (
        error.message ||
        'Вы уже состоите в группе'
      );
    }

    if (
      error.status === 401 ||
      error.status === 403
    ) {
      return 'Не удалось подтвердить аккаунт Telegram';
    }

    if (
      error.status === 404
    ) {
      return 'Группа или приглашение не найдены';
    }

    return error.message || 'Произошла ошибка';
  }

  function showError(message) {
    var box = root && root.querySelector('.arena-error');

    if (!box) return;

    box.textContent = message || '';
    box.classList.toggle('show', Boolean(message));
  }

  function setLoading(value) {
    state.loading = Boolean(value);

    if (!root) return;

    root.classList.toggle(
      'arena-loading',
      state.loading
    );

    var buttons = root.querySelectorAll('button');

    buttons.forEach(function (button) {
      button.disabled = state.loading;
    });
  }

  /* ---------------------------------------------------------
     Styles
  --------------------------------------------------------- */

  function injectStyles() {
    if (document.getElementById('trainhard-arena-style')) {
      return;
    }

    var style = document.createElement('style');

    style.id = 'trainhard-arena-style';

    style.textContent = `
      .th-arena-overlay {
        position: fixed;
        inset: 0;
        z-index: 999999;
        overflow-y: auto;
        background:
          radial-gradient(
            circle at 10% 0%,
            rgba(255, 74, 54, .20),
            transparent 32%
          ),
          radial-gradient(
            circle at 100% 20%,
            rgba(255, 145, 40, .15),
            transparent 34%
          ),
          #090909;
        color: #fff;
        font-family:
          -apple-system,
          BlinkMacSystemFont,
          "SF Pro Display",
          "Segoe UI",
          sans-serif;
      }

      .th-arena {
        min-height: 100%;
        max-width: 620px;
        margin: 0 auto;
        padding:
          calc(18px + env(safe-area-inset-top))
          18px
          calc(30px + env(safe-area-inset-bottom));
        box-sizing: border-box;
      }

      .arena-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
      }

      .arena-back {
        width: 42px;
        height: 42px;
        border: 0;
        border-radius: 14px;
        background: rgba(255,255,255,.08);
        color: #fff;
        font-size: 21px;
        cursor: pointer;
      }

      .arena-title {
        margin: 0;
        font-size: 29px;
        font-weight: 900;
        letter-spacing: -1px;
      }

      .arena-subtitle {
        margin: 5px 0 0;
        color: rgba(255,255,255,.56);
        font-size: 13px;
      }

      .arena-hero {
        position: relative;
        overflow: hidden;
        border-radius: 27px;
        padding: 28px 22px;
        margin-bottom: 16px;
        background:
          linear-gradient(
            135deg,
            #40110c 0%,
            #b51e12 48%,
            #ff6a1a 100%
          );
        box-shadow:
          0 18px 45px rgba(0,0,0,.35);
      }

      .arena-hero:after {
        content: "";
        position: absolute;
        width: 170px;
        height: 170px;
        right: -65px;
        top: -65px;
        border-radius: 50%;
        background: rgba(255,255,255,.12);
      }

      .arena-hero-label {
        position: relative;
        z-index: 1;
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        opacity: .72;
      }

      .arena-hero h2 {
        position: relative;
        z-index: 1;
        margin: 8px 0 0;
        font-size: 31px;
        line-height: 1.05;
      }

      .arena-card {
        background: rgba(255,255,255,.065);
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 22px;
        padding: 18px;
        margin-bottom: 13px;
        box-sizing: border-box;
        backdrop-filter: blur(16px);
      }

      .arena-actions {
        display: grid;
        gap: 12px;
      }

      .arena-btn {
        width: 100%;
        min-height: 58px;
        border: 0;
        border-radius: 18px;
        padding: 0 18px;
        color: #fff;
        background: #1c1c1e;
        font-size: 16px;
        font-weight: 850;
        cursor: pointer;
        transition:
          transform .15s ease,
          opacity .15s ease;
      }

      .arena-btn:active {
        transform: scale(.98);
      }

      .arena-btn-primary {
        background:
          linear-gradient(135deg,#e72d1c,#ff721d);
        box-shadow:
          0 12px 28px rgba(238,65,28,.24);
      }

      .arena-btn-secondary {
        background: rgba(255,255,255,.09);
      }

      .arena-btn-danger {
        background: rgba(255,50,50,.12);
        color: #ff8f86;
      }

      .arena-input {
        width: 100%;
        box-sizing: border-box;
        height: 53px;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 15px;
        outline: none;
        padding: 0 15px;
        background: rgba(0,0,0,.24);
        color: #fff;
        font-size: 16px;
      }

      .arena-input:focus {
        border-color: rgba(255,95,60,.8);
      }

      .arena-field {
        margin-bottom: 14px;
      }

      .arena-label {
        display: block;
        margin-bottom: 7px;
        color: rgba(255,255,255,.65);
        font-size: 13px;
        font-weight: 700;
      }

      .arena-error {
        display: none;
        margin: 10px 0;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255,50,50,.12);
        color: #ff9b92;
        font-size: 13px;
      }

      .arena-error.show {
        display: block;
      }

      .arena-info {
        color: rgba(255,255,255,.55);
        font-size: 13px;
        line-height: 1.5;
      }

      .arena-group-name {
        font-size: 25px;
        font-weight: 900;
        margin: 0 0 4px;
      }

      .arena-group-meta {
        color: rgba(255,255,255,.55);
        font-size: 13px;
      }

      .arena-total {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        margin: 18px 0 3px;
      }

      .arena-total-value {
        font-size: 42px;
        font-weight: 950;
        letter-spacing: -2px;
      }

      .arena-total-unit {
        color: rgba(255,255,255,.5);
        font-size: 13px;
        margin-bottom: 8px;
      }

      .arena-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 9px;
      }

      .arena-stat {
        padding: 14px 10px;
        border-radius: 17px;
        background: rgba(255,255,255,.055);
        text-align: center;
      }

      .arena-stat-label {
        color: rgba(255,255,255,.45);
        font-size: 10px;
        text-transform: uppercase;
        font-weight: 800;
      }

      .arena-stat-value {
        margin-top: 5px;
        font-size: 19px;
        font-weight: 900;
      }

      .arena-section-title {
        margin: 0 0 13px;
        font-size: 17px;
        font-weight: 900;
      }

      .arena-rank {
        display: grid;
        grid-template-columns: 43px 1fr auto;
        gap: 11px;
        align-items: center;
        padding: 13px 0;
        border-bottom: 1px solid rgba(255,255,255,.06);
      }

      .arena-rank:last-child {
        border-bottom: 0;
      }

      .arena-place {
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 13px;
        background: rgba(255,255,255,.07);
        font-weight: 900;
      }

      .arena-rank-name {
        font-size: 14px;
        font-weight: 800;
      }

      .arena-rank-sub {
        margin-top: 2px;
        color: rgba(255,255,255,.42);
        font-size: 11px;
      }

      .arena-rank-total {
        font-size: 16px;
        font-weight: 950;
      }

      .arena-invite {
        display: none;
      }

      .arena-invite.show {
        display: block;
      }

      .arena-link {
        display: block;
        word-break: break-all;
        margin-top: 10px;
        padding: 12px;
        border-radius: 13px;
        background: rgba(0,0,0,.25);
        color: #ff9b75;
        font-size: 12px;
      }

      .arena-loading {
        pointer-events: none;
      }

      @media (max-width: 420px) {
        .th-arena {
          padding-left: 13px;
          padding-right: 13px;
        }

        .arena-title {
          font-size: 26px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* ---------------------------------------------------------
     Root
  --------------------------------------------------------- */

  function createRoot() {
    if (root) return root;

    root = document.createElement('div');
    root.className = 'th-arena-overlay';

    document.body.appendChild(root);
    document.body.classList.add('thch-open');

    return root;
  }

  function destroyRoot() {
    if (!root) return;

    root.remove();
    root = null;

    document.body.classList.remove('thch-open');
  }

  function shell(content, back) {
    return `
      <div class="th-arena">
        <div class="arena-header">
          ${
            back
              ? '<button class="arena-back" data-action="home">‹</button>'
              : '<div style="width:42px"></div>'
          }

          <div style="text-align:center">
            <h1 class="arena-title">ARENA</h1>
            <p class="arena-subtitle">Train Hard</p>
          </div>

          <div style="width:42px"></div>
        </div>

        ${content}
      </div>
    `;
  }

  function bindCommon() {
    if (!root) return;

    root.querySelectorAll('[data-action]').forEach(function (button) {
      button.addEventListener('click', async function () {
        var action = button.getAttribute('data-action');

        if (action === 'home') {
          await home();
        }

        if (action === 'join') {
          joinForm();
        }

        if (action === 'create') {
          createForm();
        }

        if (action === 'save-stats') {
          await saveStats();
        }

        if (action === 'show-group') {
          await showGroup();
        }

        if (action === 'leaderboard') {
          await leaderboard();
        }

        if (action === 'invite') {
          await createInvite();
        }

        if (action === 'copy-invite') {
          copyInvite();
        }

        if (action === 'leave') {
          await leaveGroup();
        }
      });
    });
  }

  /* ---------------------------------------------------------
     Home
  --------------------------------------------------------- */

  async function home(error) {
    if (!root) createRoot();

    root.innerHTML = shell(`
      <div class="arena-hero">
        <div class="arena-hero-label">POWER • COMPETE • IMPROVE</div>
        <h2>Твоя силовая<br>арена</h2>
      </div>

      <div class="arena-card">
        <div class="arena-actions">

          <button
            class="arena-btn arena-btn-primary"
            data-action="join">
            ⚡ Вступить в группу
          </button>

          <button
            class="arena-btn arena-btn-secondary"
            data-action="create">
            ＋ Создать группу
          </button>

        </div>

        <div class="arena-error ${error ? 'show' : ''}">
          ${esc(error || '')}
        </div>

        <p class="arena-info" style="margin:15px 2px 0">
          В Arena можно состоять только в одной группе.
          После вступления или создания группы добавь свои
          силовые показатели.
        </p>
      </div>
    `);

    bindCommon();
  }

  /* ---------------------------------------------------------
     Join
  --------------------------------------------------------- */

  function joinForm() {
    if (!root) return;

    root.innerHTML = shell(`
      <div class="arena-card">

        <h2 class="arena-section-title">
          Вступление в группу
        </h2>

        <p class="arena-info">
          Открой ссылку-приглашение от участника группы.
          Telegram автоматически передаст приглашение в Arena.
        </p>

        <div class="arena-error"></div>

        <button
          class="arena-btn arena-btn-primary"
          data-action="home">
          ← Назад
        </button>

      </div>
    `, true);

    bindCommon();

    if (startParam()) {
      autoJoin(startParam());
    }
  }

  async function autoJoin(token) {
    if (!token) return;

    setLoading(true);
    showError('');

    try {
      var group = await request(
        'POST',
        '/api/invites/' +
          encodeURIComponent(token) +
          '/join',
        {}
      );

      state.group = group && group.group
        ? group.group
        : group;

      await statsForm('Ты вступил в группу');
    } catch (error) {
      console.warn(
        '[TrainHard Arena] auto join:',
        error
      );

      await home(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  /* ---------------------------------------------------------
     Create
  --------------------------------------------------------- */

  function createForm() {
    if (!root) return;

    root.innerHTML = shell(`
      <div class="arena-card">

        <h2 class="arena-section-title">
          Создать группу
        </h2>

        <div class="arena-field">
          <label class="arena-label">
            Название группы
          </label>

          <input
            id="arena-group-name"
            class="arena-input"
            maxlength="80"
            placeholder="Например: Train Hard Team"
            autocomplete="off">
        </div>

        <div class="arena-error"></div>

        <button
          class="arena-btn arena-btn-primary"
          id="arena-create-submit">
          Создать группу
        </button>

      </div>
    `, true);

    bindCommon();

    var button =
      root.querySelector('#arena-create-submit');

    button.addEventListener('click', async function () {
      var input =
        root.querySelector('#arena-group-name');

      var name = String(input.value || '').trim();

      if (!name) {
        showError('Введите название группы');
        return;
      }

      setLoading(true);
      showError('');

      try {
        var group = await request(
          'POST',
          '/api/groups',
          { name: name }
        );

        state.group = group && group.group
          ? group.group
          : group;

        await statsForm('Группа создана');
      } catch (error) {
        showError(errorMessage(error));
      } finally {
        setLoading(false);
      }
    });
  }

  /* ---------------------------------------------------------
     Stats
  --------------------------------------------------------- */

  async function statsForm(title) {
    if (!root) return;

    root.innerHTML = shell(`
      <div class="arena-hero">
        <div class="arena-hero-label">
          ${esc(title || 'Твои силовые')}
        </div>
        <h2>Добавь<br>результаты</h2>
      </div>

      <div class="arena-card">

        <div class="arena-field">
          <label class="arena-label">
            Присед — кг
          </label>

          <input
            id="arena-squat"
            class="arena-input"
            type="number"
            min="0"
            max="1000"
            step="0.01"
            inputmode="decimal"
            placeholder="Например, 140">
        </div>

        <div class="arena-field">
          <label class="arena-label">
            Жим лёжа — кг
          </label>

          <input
            id="arena-bench"
            class="arena-input"
            type="number"
            min="0"
            max="1000"
            step="0.01"
            inputmode="decimal"
            placeholder="Например, 100">
        </div>

        <div class="arena-field">
          <label class="arena-label">
            Становая тяга — кг
          </label>

          <input
            id="arena-deadlift"
            class="arena-input"
            type="number"
            min="0"
            max="1000"
            step="0.01"
            inputmode="decimal"
            placeholder="Например, 180">
        </div>

        <div class="arena-error"></div>

        <button
          class="arena-btn arena-btn-primary"
          data-action="save-stats">
          Сохранить силовые
        </button>

      </div>
    `, false);

    bindCommon();
  }

  async function saveStats() {
    var squat =
      root.querySelector('#arena-squat');

    var bench =
      root.querySelector('#arena-bench');

    var deadlift =
      root.querySelector('#arena-deadlift');

    try {
      var stats = {
        squat: normalizeWeight(squat.value),
        bench: normalizeWeight(bench.value),
        deadlift: normalizeWeight(deadlift.value)
      };

      state.stats = stats;

      setLoading(true);
      showError('');

      await request(
        'PUT',
        '/api/arena/stats',
        stats
      );

      await showGroup();
    } catch (error) {
      showError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  /* ---------------------------------------------------------
     Group
  --------------------------------------------------------- */

  async function loadMyGroup() {
    var groups = await request(
      'GET',
      '/api/groups'
    );

    if (Array.isArray(groups)) {
      return groups[0] || null;
    }

    if (
      groups &&
      Array.isArray(groups.groups)
    ) {
      return groups.groups[0] || null;
    }

    return null;
  }

  async function showGroup() {
    if (!root) createRoot();

    try {
      if (!state.group) {
        state.group = await loadMyGroup();
      }
    } catch (error) {
      await home(errorMessage(error));
      return;
    }

    if (!state.group) {
      await home();
      return;
    }

    var groupId =
      state.group.id ||
      state.group.group_id;

    var group = state.group;

    try {
      var fresh = await request(
        'GET',
        '/api/groups/' +
          encodeURIComponent(groupId)
      );

      if (fresh) {
        group = fresh.group || fresh;
        state.group = group;
      }
    } catch (error) {
      console.warn(
        '[TrainHard Arena] group load:',
        error
      );
    }

    var stats = state.stats;

    try {
      var leaderboardData =
        await request(
          'GET',
          '/api/groups/' +
            encodeURIComponent(groupId) +
            '/leaderboard?metric=TOTAL'
        );

      var me =
        leaderboardData &&
        Array.isArray(leaderboardData.rows)
          ? leaderboardData.rows.find(function (row) {
              return String(row.user_id) ===
                String(
                  leaderboardData.me_user_id ||
                  ''
                );
            })
          : null;

      if (me) {
        stats = {
          squat: me.squat,
          bench: me.bench,
          deadlift: me.deadlift
        };

        state.stats = stats;
      }
    } catch (error) {
      console.warn(
        '[TrainHard Arena] stats load:',
        error
      );
    }

    root.innerHTML = shell(`
      <div class="arena-hero">
        <div class="arena-hero-label">
          ARENA GROUP
        </div>

        <h2>
          ${esc(
            group.name ||
            group.title ||
            'Моя группа'
          )}
        </h2>
      </div>

      <div class="arena-card">

        <div class="arena-group-name">
          ${esc(
            group.name ||
            group.title ||
            'Моя группа'
          )}
        </div>

        <div class="arena-group-meta">
          Силовой тотал
        </div>

        <div class="arena-total">
          <div class="arena-total-value">
            ${kg(totalStats(stats))}
          </div>

          <div class="arena-total-unit">
            KG TOTAL
          </div>
        </div>

        <div class="arena-stats">

          <div class="arena-stat">
            <div class="arena-stat-label">
              Squat
            </div>
            <div class="arena-stat-value">
              ${kg(stats.squat)}
            </div>
          </div>

          <div class="arena-stat">
            <div class="arena-stat-label">
              Bench
            </div>
            <div class="arena-stat-value">
              ${kg(stats.bench)}
            </div>
          </div>

          <div class="arena-stat">
            <div class="arena-stat-label">
              Deadlift
            </div>
            <div class="arena-stat-value">
              ${kg(stats.deadlift)}
            </div>
          </div>

        </div>
      </div>

      <div class="arena-card">

        <h3 class="arena-section-title">
          Arena
        </h3>

        <div class="arena-actions">

          <button
            class="arena-btn arena-btn-primary"
            data-action="leaderboard">
            🏆 Таблица группы
          </button>

          <button
            class="arena-btn arena-btn-secondary"
            data-action="invite">
            🔗 Пригласить участника
          </button>

          <button
            class="arena-btn arena-btn-secondary"
            id="arena-update-stats">
            Изменить силовые
          </button>

          <button
            class="arena-btn arena-btn-danger"
            data-action="leave">
            Выйти из группы
          </button>

        </div>

        <div class="arena-invite"></div>

        <div class="arena-error"></div>
      </div>
    `, false);

    bindCommon();

    var update =
      root.querySelector('#arena-update-stats');

    update.addEventListener('click', function () {
      statsForm('Обновление силовых');

      setTimeout(function () {
        var a = root.querySelector('#arena-squat');
        var b = root.querySelector('#arena-bench');
        var c = root.querySelector('#arena-deadlift');

        if (a) a.value =
          stats.squat == null ? '' : stats.squat;

        if (b) b.value =
          stats.bench == null ? '' : stats.bench;

        if (c) c.value =
          stats.deadlift == null ? '' : stats.deadlift;
      }, 0);
    });
  }

  /* ---------------------------------------------------------
     Leaderboard
  --------------------------------------------------------- */

  async function leaderboard() {
    if (!state.group) return;

    var groupId =
      state.group.id ||
      state.group.group_id;

    setLoading(true);

    try {
      var data = await request(
        'GET',
        '/api/groups/' +
          encodeURIComponent(groupId) +
          '/leaderboard?metric=TOTAL'
      );

      var rows =
        data && Array.isArray(data.rows)
          ? data.rows
          : Array.isArray(data)
            ? data
            : [];

      root.innerHTML = shell(`
        <div class="arena-hero">
          <div class="arena-hero-label">
            LEADERBOARD
          </div>
          <h2>Таблица<br>силы</h2>
        </div>

        <div class="arena-card">

          <h3 class="arena-section-title">
            Участники
          </h3>

          ${
            rows.length
              ? rows.map(function (row, index) {
                  var place =
                    row.place ||
                    row.rank ||
                    index + 1;

                  var name =
                    row.name ||
                    row.username ||
                    row.first_name ||
                    'Участник';

                  var total =
                    row.total;

                  if (
                    total === undefined ||
                    total === null
                  ) {
                    total =
                      Number(row.squat || 0) +
                      Number(row.bench || 0) +
                      Number(row.deadlift || 0);
                  }

                  return `
                    <div class="arena-rank">

                      <div class="arena-place">
                        ${esc(place)}
                      </div>

                      <div>
                        <div class="arena-rank-name">
                          ${esc(name)}
                        </div>

                        <div class="arena-rank-sub">
                          Присед ${kg(row.squat)}
                          · Жим ${kg(row.bench)}
                          · Тяга ${kg(row.deadlift)}
                        </div>
                      </div>

                      <div class="arena-rank-total">
                        ${kg(total)}
                      </div>

                    </div>
                  `;
                }).join('')
              : `
                <p class="arena-info">
                  Пока в группе нет результатов.
                </p>
              `
          }

        </div>
      `, true);

      bindCommon();
    } catch (error) {
      await showGroup();
      showError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  /* ---------------------------------------------------------
     Invite
  --------------------------------------------------------- */

  async function createInvite() {
    if (!state.group) return;

    var groupId =
      state.group.id ||
      state.group.group_id;

    setLoading(true);

    try {
      var data = await request(
        'POST',
        '/api/groups/' +
          encodeURIComponent(groupId) +
          '/invite',
        {}
      );

      var token =
        data &&
        (
          data.code ||
          data.token ||
          (
            data.invite &&
            (
              data.invite.code ||
              data.invite.token
            )
          )
        );

      if (!token) {
        throw new Error(
          'Сервер не вернул приглашение'
        );
      }

      /*
       * Telegram Mini App deep link.
       * startapp -> WebApp.initDataUnsafe.start_param
       */
      var link =
        'https://t.me/trainhard_power_bot/trainhard' +
        '?startapp=' +
        encodeURIComponent(token);

      var box =
        root.querySelector('.arena-invite');

      box.classList.add('show');

      box.innerHTML = `
        <div class="arena-card" style="margin:14px 0 0">

          <div class="arena-section-title">
            Ссылка приглашения
          </div>

          <div class="arena-link">
            ${esc(link)}
          </div>

          <button
            class="arena-btn arena-btn-primary"
            style="margin-top:10px"
            data-action="copy-invite">
            Скопировать ссылку
          </button>

          <p class="arena-info" style="margin-bottom:0">
            Ссылка одноразовая и действует ограниченное время.
            При открытии пользователь автоматически попадёт
            в эту группу.
          </p>

        </div>
      `;

      box.setAttribute(
        'data-invite-link',
        link
      );

      var copy =
        box.querySelector('[data-action="copy-invite"]');

      copy.addEventListener(
        'click',
        copyInvite
      );
    } catch (error) {
      showError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function copyInvite() {
    var box =
      root.querySelector('.arena-invite');

    if (!box) return;

    var link =
      box.getAttribute('data-invite-link');

    if (!link) return;

    try {
      if (
        navigator.clipboard &&
        navigator.clipboard.writeText
      ) {
        await navigator.clipboard.writeText(link);
      } else {
        var textarea =
          document.createElement('textarea');

        textarea.value = link;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';

        document.body.appendChild(textarea);
        textarea.select();

        document.execCommand('copy');
        textarea.remove();
      }

      var button =
        box.querySelector(
          '[data-action="copy-invite"]'
        );

      if (button) {
        button.textContent = '✓ Ссылка скопирована';

        setTimeout(function () {
          if (button) {
            button.textContent =
              'Скопировать ссылку';
          }
        }, 1800);
      }
    } catch (error) {
      showError(
        'Не удалось скопировать ссылку'
      );
    }
  }

  /* ---------------------------------------------------------
     Leave
  --------------------------------------------------------- */

  async function leaveGroup() {
    if (!state.group) return;

    var confirmed =
      window.confirm(
        'Выйти из группы?'
      );

    if (!confirmed) return;

    var groupId =
      state.group.id ||
      state.group.group_id;

    setLoading(true);

    try {
      await request(
        'POST',
        '/api/groups/' +
          encodeURIComponent(groupId) +
          '/leave',
        {}
      );

      state.group = null;

      state.stats = {
        squat: null,
        bench: null,
        deadlift: null
      };

      await home();
    } catch (error) {
      showError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  /* ---------------------------------------------------------
     Open / Close
  --------------------------------------------------------- */

  async function open() {
    injectStyles();
    initTelegram();

    if (!root) {
      createRoot();
    }

    setLoading(true);

    try {
      /*
       * First check the user's existing group.
       */
      state.group = await loadMyGroup();

      /*
       * If Telegram opened Arena through an invite,
       * automatically join the group.
       */
      var inviteToken = startParam();

      if (!state.group && inviteToken) {
        await autoJoin(inviteToken);
        return;
      }

      if (state.group) {
        await showGroup();
      } else {
        await home();
      }
    } catch (error) {
      await home(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  function close() {
    destroyRoot();
  }

  /* ---------------------------------------------------------
     Public API
  --------------------------------------------------------- */

  window.__THArena = {
    open: open,
    close: close,
    refresh: open
  };

  /*
   * Optional aliases for existing project code.
   */
  window.TrainHardArena = window.__THArena;

})();
