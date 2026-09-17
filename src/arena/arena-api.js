/* =========================================================
 * Train Hard — ARENA UI v3
 *
 * Uses existing window.__THAPI from arena-api.js.
 *
 * Arena flow:
 *   no group
 *      -> Join group
 *      -> Create group
 *
 *   after join/create
 *      -> Squat / Bench / Deadlift
 *      -> Group leaderboard
 *
 * Telegram:
 *   startapp -> automatic invitation join
 *
 * Rule:
 *   one user can belong to only one group
 * ========================================================= */

(function () {
  'use strict';

  var API = window.__THAPI;
  var cfg = window.TRAINHARD_ARENA || {};

  var root = null;
  var state = {
    group: null,
    stats: {
      squat: null,
      bench: null,
      deadlift: null
    },
    inviteLink: '',
    busy: false
  };

  /* =========================================================
   Telegram
   ========================================================= */

  function tg() {
    try {
      return window.Telegram &&
        window.Telegram.WebApp
        ? window.Telegram.WebApp
        : null;
    } catch (e) {
      return null;
    }
  }

  function startParam() {
    try {
      if (
        API &&
        typeof API.startParam === 'function'
      ) {
        return String(API.startParam() || '');
      }
    } catch (e) {}

    try {
      var app = tg();

      return String(
        app &&
        app.initDataUnsafe &&
        app.initDataUnsafe.start_param
          ? app.initDataUnsafe.start_param
          : ''
      );
    } catch (e) {
      return '';
    }
  }

  function telegramInit() {
    var app = tg();

    if (!app) return;

    try {
      if (typeof app.ready === 'function') {
        app.ready();
      }

      if (typeof app.expand === 'function') {
        app.expand();
      }

      if (
        typeof app.disableVerticalSwipes ===
        'function'
      ) {
        app.disableVerticalSwipes();
      }
    } catch (e) {
      console.warn(
        '[TrainHard Arena] Telegram init:',
        e
      );
    }
  }

  /* =========================================================
   API wrapper
   ========================================================= */

  async function api(method, path, body) {
    if (!API || typeof API.request !== 'function') {
      throw new Error(
        'Arena API client не найден'
      );
    }

    var result = await API.request(
      method,
      path,
      body
    );

    /*
     * Existing arena-api.js returns:
     *
     * {
     *   ok: true/false,
     *   status: 200,
     *   body: {...}
     * }
     */

    if (!result || result.ok !== true) {
      var message = '';

      if (
        result &&
        result.body &&
        typeof result.body === 'object'
      ) {
        message =
          result.body.error ||
          result.body.message ||
          '';
      }

      if (!message && result) {
        if (result.reason === 'telegram-required') {
          message =
            'Открой Train Hard внутри Telegram';
        } else if (
          result.reason === 'network'
        ) {
          message =
            'Нет соединения с сервером';
        } else if (result.status === 401) {
          message =
            'Не удалось подтвердить Telegram-аккаунт';
        } else if (result.status === 403) {
          message =
            'Доступ запрещён';
        } else if (result.status === 404) {
          message =
            'Группа или приглашение не найдены';
        } else if (result.status === 409) {
          message =
            'Вы уже состоите в группе';
        }
      }

      throw Object.assign(
        new Error(
          message ||
          'Ошибка запроса к серверу'
        ),
        {
          status:
            result && result.status
              ? result.status
              : 0,
          response: result
        }
      );
    }

    return result.body;
  }

  /* =========================================================
   Helpers
   ========================================================= */

  function esc(value) {
    return String(
      value == null ? '' : value
    )
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function weight(value) {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return '—';
    }

    var n = Number(value);

    if (!Number.isFinite(n)) {
      return '—';
    }

    return Number.isInteger(n)
      ? String(n)
      : String(
          Math.round(n * 100) / 100
        );
  }

  function total(stats) {
    if (
      stats.squat == null ||
      stats.bench == null ||
      stats.deadlift == null
    ) {
      return null;
    }

    return (
      Number(stats.squat) +
      Number(stats.bench) +
      Number(stats.deadlift)
    );
  }

  function parseWeight(value) {
    if (
      value === '' ||
      value === null ||
      value === undefined
    ) {
      return null;
    }

    var n = Number(value);

    if (
      !Number.isFinite(n) ||
      n < 0 ||
      n > 1000
    ) {
      throw new Error(
        'Вес должен быть от 0 до 1000 кг'
      );
    }

    return Math.round(n * 100) / 100;
  }

  function groupId(group) {
    if (!group) return '';

    return String(
      group.id ||
      group.group_id ||
      ''
    );
  }

  function groupName(group) {
    if (!group) {
      return 'Моя группа';
    }

    return (
      group.name ||
      group.title ||
      'Моя группа'
    );
  }

  function userName(row) {
    return (
      row.name ||
      row.first_name ||
      row.username ||
      'Участник'
    );
  }

  function showError(message) {
    if (!root) return;

    var boxes =
      root.querySelectorAll(
        '.th-arena-error'
      );

    boxes.forEach(function (box) {
      box.textContent =
        message || '';

      box.classList.toggle(
        'show',
        Boolean(message)
      );
    });
  }

  function busy(value) {
    state.busy = Boolean(value);

    if (!root) return;

    root.classList.toggle(
      'is-loading',
      state.busy
    );

    root
      .querySelectorAll('button')
      .forEach(function (button) {
        button.disabled =
          state.busy;
      });
  }

  /* =========================================================
   Styles
   ========================================================= */

  function styles() {
    if (
      document.getElementById(
        'trainhard-arena-v3-style'
      )
    ) {
      return;
    }

    var style =
      document.createElement('style');

    style.id =
      'trainhard-arena-v3-style';

    style.textContent = `
      .th-arena-overlay {
        position: fixed;
        inset: 0;
        z-index: 999999;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;

        background:
          radial-gradient(
            circle at 0% 0%,
            rgba(255,65,35,.20),
            transparent 34%
          ),
          radial-gradient(
            circle at 100% 20%,
            rgba(255,145,35,.14),
            transparent 34%
          ),
          #080808;

        color: #fff;

        font-family:
          -apple-system,
          BlinkMacSystemFont,
          "SF Pro Display",
          "Segoe UI",
          sans-serif;
      }

      .th-arena {
        width: 100%;
        max-width: 640px;
        min-height: 100%;
        margin: 0 auto;
        padding:
          calc(18px + env(safe-area-inset-top))
          16px
          calc(32px + env(safe-area-inset-bottom));
        box-sizing: border-box;
      }

      .th-arena-header {
        display: grid;
        grid-template-columns: 42px 1fr 42px;
        align-items: center;
        margin-bottom: 20px;
      }

      .th-arena-title {
        margin: 0;
        text-align: center;
        font-size: 29px;
        line-height: 1;
        font-weight: 950;
        letter-spacing: -1.2px;
      }

      .th-arena-subtitle {
        margin: 6px 0 0;
        text-align: center;
        color: rgba(255,255,255,.48);
        font-size: 11px;
        font-weight: 700;
      }

      .th-arena-back {
        width: 42px;
        height: 42px;
        border: 0;
        border-radius: 14px;
        background: rgba(255,255,255,.08);
        color: #fff;
        font-size: 25px;
        line-height: 42px;
        cursor: pointer;
      }

      .th-arena-spacer {
        width: 42px;
        height: 42px;
      }

      .th-arena-hero {
        position: relative;
        overflow: hidden;
        margin-bottom: 14px;
        padding: 27px 21px;
        border-radius: 26px;

        background:
          linear-gradient(
            135deg,
            #3d0b08 0%,
            #a9190e 48%,
            #ff6b1c 100%
          );

        box-shadow:
          0 20px 50px
          rgba(0,0,0,.35);
      }

      .th-arena-hero:before {
        content: "";
        position: absolute;
        width: 190px;
        height: 190px;
        right: -75px;
        top: -85px;
        border-radius: 50%;
        background:
          rgba(255,255,255,.10);
      }

      .th-arena-hero-label {
        position: relative;
        z-index: 1;
        color: rgba(255,255,255,.68);
        font-size: 10px;
        font-weight: 900;
        letter-spacing: 1.7px;
        text-transform: uppercase;
      }

      .th-arena-hero h2 {
        position: relative;
        z-index: 1;
        margin: 8px 0 0;
        font-size: 32px;
        line-height: 1.02;
        letter-spacing: -1.4px;
      }

      .th-arena-card {
        margin-bottom: 13px;
        padding: 18px;
        border: 1px solid
          rgba(255,255,255,.065);
        border-radius: 22px;
        background:
          rgba(255,255,255,.055);
        box-sizing: border-box;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
      }

      .th-arena-actions {
        display: grid;
        gap: 11px;
      }

      .th-arena-btn {
        width: 100%;
        min-height: 57px;
        border: 0;
        border-radius: 17px;
        padding: 0 17px;

        background: #1b1b1d;
        color: #fff;

        font-size: 16px;
        font-weight: 850;

        cursor: pointer;
        transition:
          transform .12s ease,
          opacity .12s ease;
      }

      .th-arena-btn:active {
        transform: scale(.985);
      }

      .th-arena-btn:disabled {
        opacity: .5;
      }

      .th-arena-primary {
        background:
          linear-gradient(
            135deg,
            #e92d1c,
            #ff741d
          );

        box-shadow:
          0 13px 30px
          rgba(235,58,25,.24);
      }

      .th-arena-secondary {
        background:
          rgba(255,255,255,.085);
      }

      .th-arena-danger {
        color: #ff8e85;
        background:
          rgba(255,50,50,.10);
      }

      .th-arena-field {
        margin-bottom: 14px;
      }

      .th-arena-label {
        display: block;
        margin-bottom: 7px;
        color: rgba(255,255,255,.60);
        font-size: 12px;
        font-weight: 750;
      }

      .th-arena-input {
        width: 100%;
        height: 53px;
        box-sizing: border-box;

        border: 1px solid
          rgba(255,255,255,.10);
        border-radius: 15px;

        outline: none;
        padding: 0 14px;

        background:
          rgba(0,0,0,.24);
        color: #fff;

        font-size: 16px;
      }

      .th-arena-input:focus {
        border-color:
          rgba(255,91,55,.85);
      }

      .th-arena-error {
        display: none;
        margin: 10px 0;
        padding: 12px 14px;

        border-radius: 14px;
        background:
          rgba(255,55,50,.11);

        color: #ff9c94;
        font-size: 13px;
        line-height: 1.4;
      }

      .th-arena-error.show {
        display: block;
      }

      .th-arena-info {
        margin: 13px 2px 0;
        color: rgba(255,255,255,.46);
        font-size: 12px;
        line-height: 1.5;
      }

      .th-arena-section-title {
        margin: 0 0 13px;
        font-size: 17px;
        font-weight: 900;
      }

      .th-arena-group-name {
        margin: 0 0 5px;
        font-size: 25px;
        line-height: 1.05;
        font-weight: 950;
        letter-spacing: -.7px;
      }

      .th-arena-group-meta {
        color: rgba(255,255,255,.45);
        font-size: 12px;
      }

      .th-arena-total {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        margin: 17px 0 10px;
      }

      .th-arena-total-value {
        font-size: 43px;
        line-height: .95;
        font-weight: 950;
        letter-spacing: -2px;
      }

      .th-arena-total-unit {
        margin-bottom: 5px;
        color: rgba(255,255,255,.42);
        font-size: 10px;
        font-weight: 800;
      }

      .th-arena-stats {
        display: grid;
        grid-template-columns:
          repeat(3, minmax(0,1fr));
        gap: 8px;
      }

      .th-arena-stat {
        padding: 13px 7px;
        border-radius: 16px;
        background:
          rgba(255,255,255,.055);
        text-align: center;
      }

      .th-arena-stat-label {
        color: rgba(255,255,255,.42);
        font-size: 9px;
        font-weight: 850;
        text-transform: uppercase;
      }

      .th-arena-stat-value {
        margin-top: 5px;
        font-size: 18px;
        font-weight: 950;
      }

      .th-arena-rank {
        display: grid;
        grid-template-columns:
          42px minmax(0,1fr) auto;
        gap: 10px;
        align-items: center;

        padding: 12px 0;

        border-bottom: 1px solid
          rgba(255,255,255,.055);
      }

      .th-arena-rank:last-child {
        border-bottom: 0;
      }

      .th-arena-place {
        width: 38px;
        height: 38px;

        display: flex;
        align-items: center;
        justify-content: center;

        border-radius: 13px;
        background:
          rgba(255,255,255,.075);

        font-size: 14px;
        font-weight: 950;
      }

      .th-arena-rank-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;

        font-size: 14px;
        font-weight: 850;
      }

      .th-arena-rank-sub {
        margin-top: 3px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;

        color: rgba(255,255,255,.40);
        font-size: 10px;
      }

      .th-arena-rank-total {
        font-size: 16px;
        font-weight: 950;
      }

      .th-arena-invite {
        display: none;
        margin-top: 13px;
      }

      .th-arena-invite.show {
        display: block;
      }

      .th-arena-link {
        margin-top: 9px;
        padding: 12px;

        border-radius: 13px;
        background:
          rgba(0,0,0,.25);

        color: #ff9b73;

        word-break: break-all;

        font-size: 11px;
        line-height: 1.45;
      }

      .is-loading {
        cursor: wait;
      }

      @media (max-width: 420px) {
        .th-arena {
          padding-left: 12px;
          padding-right: 12px;
        }

        .th-arena-hero h2 {
          font-size: 29px;
        }

        .th-arena-total-value {
          font-size: 38px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* =========================================================
   Root
   ========================================================= */

  function createRoot() {
    if (root) return root;

    root =
      document.createElement('div');

    root.className =
      'th-arena-overlay';

    document.body.appendChild(root);

    document.body.classList.add(
      'thch-open'
    );

    return root;
  }

  function close() {
    if (!root) return;

    root.remove();
    root = null;

    document.body.classList.remove(
      'thch-open'
    );
  }

  function layout(content, back) {
    return `
      <div class="th-arena">

        <div class="th-arena-header">

          ${
            back
              ? `
                <button
                  class="th-arena-back"
                  data-arena-action="home"
                  aria-label="Назад">
                  ‹
                </button>
              `
              : `
                <div class="th-arena-spacer"></div>
              `
          }

          <div>
            <h1 class="th-arena-title">
              ARENA
            </h1>

            <p class="th-arena-subtitle">
              TRAIN HARD
            </p>
          </div>

          <div class="th-arena-spacer"></div>

        </div>

        ${content}

      </div>
    `;
  }

  function bind() {
    if (!root) return;

    root
      .querySelectorAll(
        '[data-arena-action]'
      )
      .forEach(function (button) {

        button.addEventListener(
          'click',
          async function () {

            if (state.busy) return;

            var action =
              button.getAttribute(
                'data-arena-action'
              );

            if (action === 'home') {
              await home();
            }

            if (action === 'join') {
              joinScreen();
            }

            if (action === 'create') {
              createScreen();
            }

            if (action === 'save-stats') {
              await saveStats();
            }

            if (action === 'leaderboard') {
              await leaderboard();
            }

            if (action === 'invite') {
              await createInvite();
            }

            if (action === 'copy-invite') {
              await copyInvite();
            }

            if (action === 'leave') {
              await leaveGroup();
            }
          }
        );
      });
  }

  /* =========================================================
   Home
   ========================================================= */

  async function home(error) {
    if (!root) createRoot();

    root.innerHTML =
      layout(`
        <div class="th-arena-hero">

          <div class="th-arena-hero-label">
            POWER • COMPETE • IMPROVE
          </div>

          <h2>
            Твоя силовая<br>
            арена
          </h2>

        </div>

        <div class="th-arena-card">

          <div class="th-arena-actions">

            <button
              class="
                th-arena-btn
                th-arena-primary
              "
              data-arena-action="join">
              ⚡ Вступить в группу
            </button>

            <button
              class="
                th-arena-btn
                th-arena-secondary
              "
              data-arena-action="create">
              ＋ Создать группу
            </button>

          </div>

          <div
            class="th-arena-error
              ${error ? 'show' : ''}">
            ${esc(error || '')}
          </div>

          <p class="th-arena-info">
            В Arena можно состоять только
            в одной группе. После вступления
            или создания группы ты укажешь
            свои силовые показатели.
          </p>

        </div>
      `);

    bind();
  }

  /* =========================================================
   Join screen
   ========================================================= */

  function joinScreen() {
    if (!root) return;

    root.innerHTML =
      layout(`
        <div class="th-arena-card">

          <h2 class="th-arena-section-title">
            Вступить в группу
          </h2>

          <p class="th-arena-info">
            Получи ссылку-приглашение
            от участника группы и открой
            её в Telegram.
          </p>

          <p class="th-arena-info">
            При открытии ссылки группа
            подключится автоматически.
          </p>

          <div class="th-arena-error"></div>

          <button
            class="
              th-arena-btn
              th-arena-secondary
            "
            data-arena-action="home">
            ← Назад
          </button>

        </div>
      `, true);

    bind();

    var token = startParam();

    if (token) {
      autoJoin(token);
    }
  }

  /* =========================================================
   Automatic invite join
   ========================================================= */

  async function autoJoin(token) {
    if (!token) return;

    busy(true);
    showError('');

    try {
      var result =
        await api(
          'POST',
          '/invites/' +
            encodeURIComponent(token) +
            '/join',
          {}
        );

      state.group =
        result && result.group
          ? result.group
          : result;

      await statsScreen(
        'Ты вступил в группу'
      );

    } catch (error) {

      console.warn(
        '[TrainHard Arena] invite join:',
        error
      );

      await home(
        error.message ||
        'Не удалось вступить в группу'
      );

    } finally {
      busy(false);
    }
  }

  /* =========================================================
   Create group
   ========================================================= */

  function createScreen() {
    if (!root) return;

    root.innerHTML =
      layout(`
        <div class="th-arena-card">

          <h2 class="th-arena-section-title">
            Создать группу
          </h2>

          <div class="th-arena-field">

            <label
              class="th-arena-label">
              Название группы
            </label>

            <input
              id="th-arena-group-name"
              class="th-arena-input"
              type="text"
              maxlength="80"
              autocomplete="off"
              placeholder="Например: Train Hard Team">

          </div>

          <div class="th-arena-error"></div>

          <button
            id="th-arena-create"
            class="
              th-arena-btn
              th-arena-primary
            ">
            Создать группу
          </button>

        </div>
      `, true);

    bind();

    var button =
      root.querySelector(
        '#th-arena-create'
      );

    button.addEventListener(
      'click',
      createGroup
    );
  }

  async function createGroup() {
    if (state.busy) return;

    var input =
      root.querySelector(
        '#th-arena-group-name'
      );

    var name =
      String(
        input &&
        input.value
          ? input.value
          : ''
      ).trim();

    if (!name) {
      showError(
        'Введите название группы'
      );
      return;
    }

    busy(true);
    showError('');

    try {
      var result =
        await api(
          'POST',
          '/groups',
          {
            name: name
          }
        );

      state.group =
        result && result.group
          ? result.group
          : result;

      await statsScreen(
        'Группа создана'
      );

    } catch (error) {

      showError(
        error.message ||
        'Не удалось создать группу'
      );

    } finally {
      busy(false);
    }
  }

  /* =========================================================
   Stats screen
   ========================================================= */

  async function statsScreen(title) {
    if (!root) createRoot();

    root.innerHTML =
      layout(`
        <div class="th-arena-hero">

          <div class="th-arena-hero-label">
            ${esc(title || 'ТВОИ СИЛОВЫЕ')}
          </div>

          <h2>
            Добавь<br>
            результаты
          </h2>

        </div>

        <div class="th-arena-card">

          <div class="th-arena-field">

            <label class="th-arena-label">
              Присед — кг
            </label>

            <input
              id="th-arena-squat"
              class="th-arena-input"
              type="number"
              min="0"
              max="1000"
              step="0.01"
              inputmode="decimal"
              placeholder="Например, 140">

          </div>

          <div class="th-arena-field">

            <label class="th-arena-label">
              Жим лёжа — кг
            </label>

            <input
              id="th-arena-bench"
              class="th-arena-input"
              type="number"
              min="0"
              max="1000"
              step="0.01"
              inputmode="decimal"
              placeholder="Например, 100">

          </div>

          <div class="th-arena-field">

            <label class="th-arena-label">
              Становая тяга — кг
            </label>

            <input
              id="th-arena-deadlift"
              class="th-arena-input"
              type="number"
              min="0"
              max="1000"
              step="0.01"
              inputmode="decimal"
              placeholder="Например, 180">

          </div>

          <div class="th-arena-error"></div>

          <button
            class="
              th-arena-btn
              th-arena-primary
            "
            data-arena-action="save-stats">
            Сохранить силовые
          </button>

        </div>
      `);

    bind();
  }

  async function saveStats() {
    if (state.busy) return;

    var squat =
      root.querySelector(
        '#th-arena-squat'
      );

    var bench =
      root.querySelector(
        '#th-arena-bench'
      );

    var deadlift =
      root.querySelector(
        '#th-arena-deadlift'
      );

    try {

      var stats = {
        squat:
          parseWeight(
            squat.value
          ),

        bench:
          parseWeight(
            bench.value
          ),

        deadlift:
          parseWeight(
            deadlift.value
          )
      };

      state.stats = stats;

      busy(true);
      showError('');

      await api(
        'PUT',
        '/arena/stats',
        stats
      );

      await showGroup();

    } catch (error) {

      showError(
        error.message ||
        'Не удалось сохранить силовые'
      );

    } finally {
      busy(false);
    }
  }

  /* =========================================================
   Load user's group
   ========================================================= */

  async function loadMyGroup() {
    var result =
      await api(
        'GET',
        '/groups'
      );

    if (Array.isArray(result)) {
      return result[0] || null;
    }

    if (
      result &&
      Array.isArray(result.groups)
    ) {
      return result.groups[0] || null;
    }

    return null;
  }

  /* =========================================================
   Group screen
   ========================================================= */

  async function showGroup() {
    if (!root) createRoot();

    try {

      if (!state.group) {
        state.group =
          await loadMyGroup();
      }

    } catch (error) {

      await home(
        error.message ||
        'Не удалось загрузить группу'
      );

      return;
    }

    if (!state.group) {
      await home();
      return;
    }

    var gid =
      groupId(state.group);

    if (!gid) {
      await home(
        'Сервер вернул некорректную группу'
      );
      return;
    }

    /*
     * Refresh group from server.
     */
    try {

      var fresh =
        await api(
          'GET',
          '/groups/' +
            encodeURIComponent(gid)
        );

      if (fresh) {
        state.group =
          fresh.group ||
          fresh;
      }

    } catch (error) {
      console.warn(
        '[TrainHard Arena] group refresh:',
        error
      );
    }

    root.innerHTML =
      layout(`
        <div class="th-arena-hero">

          <div class="th-arena-hero-label">
            ARENA GROUP
          </div>

          <h2>
            ${esc(
              groupName(
                state.group
              )
            )}
          </h2>

        </div>

        <div class="th-arena-card">

          <div class="th-arena-group-name">
            ${esc(
              groupName(
                state.group
              )
            )}
          </div>

          <div class="th-arena-group-meta">
            Твой силовой тотал
          </div>

          <div class="th-arena-total">

            <div
              id="th-arena-total"
              class="th-arena-total-value">
              —
            </div>

            <div class="th-arena-total-unit">
              KG TOTAL
            </div>

          </div>

          <div class="th-arena-stats">

            <div class="th-arena-stat">
              <div class="th-arena-stat-label">
                Squat
              </div>

              <div
                id="th-arena-squat-value"
                class="th-arena-stat-value">
                —
              </div>
            </div>

            <div class="th-arena-stat">
              <div class="th-arena-stat-label">
                Bench
              </div>

              <div
                id="th-arena-bench-value"
                class="th-arena-stat-value">
                —
              </div>
            </div>

            <div class="th-arena-stat">
              <div class="th-arena-stat-label">
                Deadlift
              </div>

              <div
                id="th-arena-deadlift-value"
                class="th-arena-stat-value">
                —
              </div>
            </div>

          </div>

        </div>

        <div class="th-arena-card">

          <h3 class="th-arena-section-title">
            Arena
          </h3>

          <div class="th-arena-actions">

            <button
              class="
                th-arena-btn
                th-arena-primary
              "
              data-arena-action="leaderboard">
              🏆 Таблица группы
            </button>

            <button
              class="
                th-arena-btn
                th-arena-secondary
              "
              data-arena-action="invite">
              🔗 Пригласить участника
            </button>

            <button
              id="th-arena-edit-stats"
              class="
                th-arena-btn
                th-arena-secondary
              ">
              Изменить силовые
            </button>

            <button
              class="
                th-arena-btn
                th-arena-danger
              "
              data-arena-action="leave">
              Выйти из группы
            </button>

          </div>

          <div
            class="th-arena-invite"
            id="th-arena-invite">
          </div>

          <div class="th-arena-error"></div>

        </div>
      `, false);

    bind();

    await loadMyStats();

    var edit =
      root.querySelector(
        '#th-arena-edit-stats'
      );

    edit.addEventListener(
      'click',
      editStats
    );
  }

  /* =========================================================
   Load stats through leaderboard
   ========================================================= */

  async function loadMyStats() {
    if (!state.group) return;

    var gid =
      groupId(state.group);

    try {

      var result =
        await api(
          'GET',
          '/groups/' +
            encodeURIComponent(gid) +
            '/leaderboard?metric=TOTAL'
        );

      var rows =
        result &&
        Array.isArray(result.rows)
          ? result.rows
          : Array.isArray(result)
            ? result
            : [];

      /*
       * Find current user from API client.
       */
      var currentUser =
        API &&
        typeof API.user === 'function'
          ? API.user()
          : null;

      var currentId =
        currentUser &&
        currentUser.id != null
          ? String(currentUser.id)
          : '';

      var mine = null;

      rows.some(function (row) {

        var id =
          row.user_id != null
            ? String(row.user_id)
            : (
                row.user &&
                row.user.id != null
                  ? String(row.user.id)
                  : ''
              );

        if (
          currentId &&
          id === currentId
        ) {
          mine = row;
          return true;
        }

        return false;
      });

      if (!mine && rows.length === 1) {
        mine = rows[0];
      }

      if (mine) {

        state.stats = {
          squat:
            mine.squat == null
              ? null
              : Number(mine.squat),

          bench:
            mine.bench == null
              ? null
              : Number(mine.bench),

          deadlift:
            mine.deadlift == null
              ? null
              : Number(mine.deadlift)
        };

        renderStats();
      }

    } catch (error) {

      console.warn(
        '[TrainHard Arena] stats:',
        error
      );
    }
  }

  function renderStats() {
    if (!root) return;

    var s = state.stats;

    var squat =
      root.querySelector(
        '#th-arena-squat-value'
      );

    var bench =
      root.querySelector(
        '#th-arena-bench-value'
      );

    var deadlift =
      root.querySelector(
        '#th-arena-deadlift-value'
      );

    var totalEl =
      root.querySelector(
        '#th-arena-total'
      );

    if (squat) {
      squat.textContent =
        weight(s.squat);
    }

    if (bench) {
      bench.textContent =
        weight(s.bench);
    }

    if (deadlift) {
      deadlift.textContent =
        weight(s.deadlift);
    }

    if (totalEl) {
      var t = total(s);

      totalEl.textContent =
        t == null
          ? '—'
          : weight(t);
    }
  }

  /* =========================================================
   Edit stats
   ========================================================= */

  function editStats() {
    statsScreen(
      'Обновление силовых'
    );

    setTimeout(function () {

      var squat =
        root.querySelector(
          '#th-arena-squat'
        );

      var bench =
        root.querySelector(
          '#th-arena-bench'
        );

      var deadlift =
        root.querySelector(
          '#th-arena-deadlift'
        );

      if (squat) {
        squat.value =
          state.stats.squat == null
            ? ''
            : state.stats.squat;
      }

      if (bench) {
        bench.value =
          state.stats.bench == null
            ? ''
            : state.stats.bench;
      }

      if (deadlift) {
        deadlift.value =
          state.stats.deadlift == null
            ? ''
            : state.stats.deadlift;
      }

    }, 0);
  }

  /* =========================================================
   Leaderboard
   ========================================================= */

  async function leaderboard() {
    if (!state.group) return;

    var gid =
      groupId(state.group);

    busy(true);

    try {

      var result =
        await api(
          'GET',
          '/groups/' +
            encodeURIComponent(gid) +
            '/leaderboard?metric=TOTAL'
        );

      var rows =
        result &&
        Array.isArray(result.rows)
          ? result.rows
          : Array.isArray(result)
            ? result
            : [];

      root.innerHTML =
        layout(`
          <div class="th-arena-hero">

            <div class="th-arena-hero-label">
              LEADERBOARD
            </div>

            <h2>
              Таблица<br>
              силы
            </h2>

          </div>

          <div class="th-arena-card">

            <h3 class="th-arena-section-title">
              Участники
            </h3>

            ${
              rows.length
                ? rows.map(
                    function (row, index) {

                      var place =
                        row.place ||
                        row.rank ||
                        index + 1;

                      var name =
                        userName(
                          row.user ||
                          row
                        );

                      var totalValue =
                        row.value;

                      if (
                        totalValue ==
                        null
                      ) {
                        totalValue =
                          row.total;

                        if (
                          totalValue ==
                          null
                        ) {
                          totalValue =
                            (
                              Number(
                                row.squat || 0
                              ) +
                              Number(
                                row.bench || 0
                              ) +
                              Number(
                                row.deadlift ||
                                0
                              )
                            );
                        }
                      }

                      return `
                        <div
                          class="
                            th-arena-rank
                          ">

                          <div
                            class="
                              th-arena-place
                            ">
                            ${esc(place)}
                          </div>

                          <div>

                            <div
                              class="
                                th-arena-rank-name
                              ">
                              ${esc(name)}
                            </div>

                            <div
                              class="
                                th-arena-rank-sub
                              ">
                              Присед
                              ${weight(row.squat)}
                              · Жим
                              ${weight(row.bench)}
                              · Тяга
                              ${weight(row.deadlift)}
                            </div>

                          </div>

                          <div
                            class="
                              th-arena-rank-total
                            ">
                            ${weight(totalValue)}
                          </div>

                        </div>
                      `;
                    }
                  ).join('')
                : `
                    <p class="th-arena-info">
                      Пока нет результатов.
                    </p>
                  `
            }

          </div>
        `, true);

      bind();

    } catch (error) {

      await showGroup();

      showError(
        error.message ||
        'Не удалось загрузить таблицу'
      );

    } finally {
      busy(false);
    }
  }

  /* =========================================================
   Invite
   ========================================================= */

  async function createInvite() {
    if (!state.group) return;

    var gid =
      groupId(state.group);

    busy(true);
    showError('');

    try {

      var result =
        await api(
          'POST',
          '/groups/' +
            encodeURIComponent(gid) +
            '/invite',
          {}
        );

      var token =
        result &&
        (
          result.code ||
          result.token ||
          (
            result.invite &&
            (
              result.invite.code ||
              result.invite.token
            )
          )
        );

      if (!token) {
        throw new Error(
          'Сервер не вернул токен приглашения'
        );
      }

      var base =
        cfg.botAppLink ||
        'https://t.me/trainhard_power_bot/trainhard?startapp=';

      /*
       * If config already contains ?startapp=,
       * append token directly.
       */
      var link =
        String(base) +
        encodeURIComponent(token);

      state.inviteLink = link;

      var box =
        root.querySelector(
          '#th-arena-invite'
        );

      box.classList.add('show');

      box.innerHTML = `
        <div class="th-arena-card">

          <div
            class="th-arena-section-title">
            Ссылка приглашения
          </div>

          <div
            class="th-arena-link">
            ${esc(link)}
          </div>

          <button
            class="
              th-arena-btn
              th-arena-primary
            "
            style="margin-top:10px"
            data-arena-action="copy-invite">
            Скопировать ссылку
          </button>

          <p class="th-arena-info">
            Одноразовая ссылка.
            При открытии в Telegram
            пользователь автоматически
            вступит в эту группу.
          </p>

        </div>
      `;

      bind();

    } catch (error) {

      showError(
        error.message ||
        'Не удалось создать приглашение'
      );

    } finally {
      busy(false);
    }
  }

  async function copyInvite() {
    if (!state.inviteLink) return;

    try {

      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText ===
          'function'
      ) {

        await navigator.clipboard.writeText(
          state.inviteLink
        );

      } else {

        var textarea =
          document.createElement(
            'textarea'
          );

        textarea.value =
          state.inviteLink;

        textarea.style.position =
          'fixed';

        textarea.style.opacity =
          '0';

        document.body.appendChild(
          textarea
        );

        textarea.select();

        document.execCommand(
          'copy'
        );

        textarea.remove();
      }

      var button =
        root.querySelector(
          '[data-arena-action="copy-invite"]'
        );

      if (button) {

        button.textContent =
          '✓ Ссылка скопирована';

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

  /* =========================================================
   Leave group
   ========================================================= */

  async function leaveGroup() {
    if (!state.group) return;

    var confirmed =
      window.confirm(
        'Выйти из этой группы?'
      );

    if (!confirmed) return;

    var gid =
      groupId(state.group);

    busy(true);
    showError('');

    try {

      await api(
        'POST',
        '/groups/' +
          encodeURIComponent(gid) +
          '/leave',
        {}
      );

      state.group = null;

      state.stats = {
        squat: null,
        bench: null,
        deadlift: null
      };

      state.inviteLink = '';

      await home();

    } catch (error) {

      showError(
        error.message ||
        'Не удалось выйти из группы'
      );

    } finally {
      busy(false);
    }
  }

  /* =========================================================
   Open
   ========================================================= */

  async function open() {
    styles();
    telegramInit();

    if (!root) {
      createRoot();
    }

    busy(true);

    try {

      /*
       * IMPORTANT:
       * First check existing membership.
       * This preserves the one-group rule.
       */
      state.group =
        await loadMyGroup();

      /*
       * If there is no group and Telegram
       * supplied startapp, automatically join.
       */
      var invite =
        startParam();

      if (
        !state.group &&
        invite
      ) {

        await autoJoin(
          invite
        );

        return;
      }

      if (state.group) {
        await showGroup();
      } else {
        await home();
      }

    } catch (error) {

      console.error(
        '[TrainHard Arena] open:',
        error
      );

      await home(
        error.message ||
        'Не удалось открыть Arena'
      );

    } finally {
      busy(false);
    }
  }

  /* =========================================================
   Public API
   ========================================================= */

  window.__THArena = {
    open: open,
    close: close,
    refresh: open
  };

  /*
   * Compatibility alias.
   */
  window.TrainHardArena =
    window.__THArena;

})();
