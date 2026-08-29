/* =============================================================
 * Train Hard MVP — интервальный таймер
 * Работает полностью офлайн: подготовка → работа → отдых ×N кругов.
 * Звуки/вибрация — через существующий TrainHardEffects.
 * Настройки сохраняются локально (trainhard_interval_timer_v1).
 * ============================================================= */
(function () {
  'use strict';

  var Storage = window.TrainHardStorage;
  var KEY = 'trainhard_interval_timer_v1';

  var PRESETS = [
    { id: 'tabata', name: 'Табата', work: 20, rest: 10, rounds: 8 },
    { id: 'circuit', name: 'Круговая', work: 40, rest: 20, rounds: 10 },
    { id: 'custom', name: 'Свой', work: 30, rest: 30, rounds: 8 }
  ];

  var cfg = { work: 30, rest: 30, rounds: 8, prepare: 5 };
  try {
    var saved = Storage ? Storage.get(KEY, null) : null;
    if (saved && typeof saved === 'object') {
      cfg = {
        work: clampInt(saved.work, 5, 3600, 30),
        rest: clampInt(saved.rest, 5, 3600, 30),
        rounds: clampInt(saved.rounds, 1, 50, 8),
        prepare: clampInt(saved.prepare, 0, 60, 5)
      };
    }
  } catch (e) {}

  function clampInt(v, min, max, d) {
    v = parseInt(v, 10);
    if (isNaN(v)) return d;
    return Math.max(min, Math.min(max, v));
  }
  function saveCfg() { if (Storage) Storage.set(KEY, cfg); }

  /* ---------- состояние таймера ---------- */
  var running = false;      // идёт отсчёт
  var phase = 'idle';       // idle | prepare | work | rest | done
  var phaseLeft = 0;
  var round = 0;
  var tickHandle = null;
  var wakeLock = null;
  var lastTs = 0;

  function sfx(name, vib) {
    try { if (window.TrainHardEffects) window.TrainHardEffects.play(name); } catch (e) {}
    try { if (navigator.vibrate && vib) navigator.vibrate(vib); } catch (e) {}
  }

  function phaseTotal() {
    if (phase === 'prepare') return cfg.prepare;
    if (phase === 'work') return cfg.work;
    if (phase === 'rest') return cfg.rest;
    return 1;
  }

  function nextPhase() {
    if (phase === 'prepare') { phase = 'work'; round = 1; phaseLeft = cfg.work; sfx('tap', [80]); return; }
    if (phase === 'work') {
      if (cfg.rest > 0) { phase = 'rest'; phaseLeft = cfg.rest; sfx('success', [120]); }
      else finishRound();
      return;
    }
    if (phase === 'rest') { finishRound(); return; }
  }

  function finishRound() {
    if (round >= cfg.rounds) {
      phase = 'done'; running = false; stopTicker(); releaseWake();
      sfx('achievement', [90, 60, 90, 60, 160]);
    } else {
      round++; phase = 'work'; phaseLeft = cfg.work; sfx('streak', [80, 40, 80]);
    }
  }

  function start() {
    if (phase === 'idle' || phase === 'done') {
      round = 0;
      phase = cfg.prepare > 0 ? 'prepare' : 'work';
      if (phase === 'work') round = 1;
      phaseLeft = phase === 'prepare' ? cfg.prepare : cfg.work;
    }
    running = true;
    lastTs = Date.now();
    startTicker();
    requestWake();
    sfx('tap', 40);
  }

  function pause() { running = false; stopTicker(); releaseWake(); sfx('tap', 30); }
  function reset() { running = false; stopTicker(); releaseWake(); phase = 'idle'; round = 0; phaseLeft = 0; }

  function startTicker() {
    stopTicker();
    tickHandle = setInterval(tick, 250);
  }
  function stopTicker() { if (tickHandle) { clearInterval(tickHandle); tickHandle = null; } }

  function tick() {
    if (!running) return;
    var now = Date.now();
    var dt = (now - lastTs) / 1000;
    lastTs = now;
    if (dt <= 0) return;
    phaseLeft -= dt;
    while (phaseLeft <= 0 && running) {
      var overshoot = -phaseLeft;
      nextPhase();
      if (phase === 'done') { phaseLeft = 0; break; }
      phaseLeft = Math.max(0, phaseTotal() - overshoot);
    }
    paint();
  }

  /* ---------- wake lock (экран не гаснет во время круга) ---------- */
  function requestWake() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').then(function (wl) { wakeLock = wl; }).catch(function () {});
      }
    } catch (e) {}
  }
  function releaseWake() { try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {} }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && running) { lastTs = Date.now(); requestWake(); }
  });

  /* ---------- UI ---------- */
  var root = null;

  function fmt(s) {
    s = Math.max(0, Math.ceil(s));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m > 0 ? m + ':' : '') + String(r).padStart(m > 0 ? 2 : 1, '0');
  }

  function phaseLabel() {
    return { idle: 'Готов?', prepare: 'Приготовься', work: 'Работа', rest: 'Отдых', done: 'Готово!' }[phase] || '';
  }

  function open() {
    if (!root) build();
    root.style.display = 'flex';
    paint();
    sfx('swipe', 30);
  }
  function close() { pause(); root.style.display = 'none'; }

  function build() {
    ensureCss();
    root = document.createElement('div');
    root.className = 'thit';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Интервальный таймер');
    root.innerHTML =
      '<div class="thit-panel">' +
        '<div class="thit-head"><span class="thit-title">Интервальный таймер</span>' +
        '<button class="thit-x" aria-label="Закрыть">✕</button></div>' +
        '<div class="thit-stage"><div class="thit-phase"></div>' +
          '<div class="thit-time">0</div>' +
          '<div class="thit-round"></div>' +
          '<div class="thit-bar"><div class="thit-fill"></div></div></div>' +
        '<div class="thit-ctrl">' +
          '<button class="thit-btn thit-btn--main" data-a="start">Старт</button>' +
          '<button class="thit-btn" data-a="reset">Сброс</button>' +
        '</div>' +
        '<div class="thit-presets"></div>' +
        '<div class="thit-cfg">' +
          row('work', 'Работа, сек', 5, 600) +
          row('rest', 'Отдых, сек', 5, 600) +
          row('rounds', 'Круги', 1, 50) +
          row('prepare', 'Подготовка, сек', 0, 30) +
        '</div>' +
        '<div class="thit-note">Работает без интернета · звук и вибрация как в основных тренировках</div>' +
      '</div>';
    document.body.appendChild(root);

    root.querySelector('.thit-x').addEventListener('click', close);
    var btns = root.querySelectorAll('[data-a]');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () {
          var a = b.getAttribute('data-a');
          if (a === 'start') { running ? pause() : start(); }
          else if (a === 'reset') { reset(); }
          paint();
        });
      })(btns[i]);
    }
    buildPresets();
    bindCfgInputs();
    paint();
  }

  function row(key, label, min, max) {
    return '<label class="thit-row"><span>' + label + '</span>' +
      '<input type="number" data-k="' + key + '" min="' + min + '" max="' + max + '" value="' + cfg[key] + '" inputmode="numeric"></label>';
  }

  function buildPresets() {
    var box = root.querySelector('.thit-presets');
    var h = '';
    for (var i = 0; i < PRESETS.length; i++) {
      var p = PRESETS[i];
      h += '<button class="thit-preset" data-p="' + p.id + '">' + p.name +
        ' · ' + p.work + '/' + p.rest + ' ×' + p.rounds + '</button>';
    }
    box.innerHTML = h;
    var els = box.querySelectorAll('[data-p]');
    for (var j = 0; j < els.length; j++) {
      (function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-p');
          for (var k = 0; k < PRESETS.length; k++) {
            if (PRESETS[k].id === id) {
              cfg.work = PRESETS[k].work; cfg.rest = PRESETS[k].rest; cfg.rounds = PRESETS[k].rounds;
            }
          }
          saveCfg(); reset(); syncInputs(); paint(); sfx('tap', 30);
        });
      })(els[j]);
    }
  }

  function bindCfgInputs() {
    var ins = root.querySelectorAll('input[data-k]');
    for (var i = 0; i < ins.length; i++) {
      (function (inp) {
        inp.addEventListener('change', function () {
          var k = inp.getAttribute('data-k');
          var limits = { work: [5, 3600], rest: [5, 3600], rounds: [1, 50], prepare: [0, 60] }[k];
          cfg[k] = clampInt(inp.value, limits[0], limits[1], cfg[k]);
          inp.value = cfg[k];
          saveCfg(); reset(); paint();
        });
      })(ins[i]);
    }
  }

  function syncInputs() {
    var ins = root.querySelectorAll('input[data-k]');
    for (var i = 0; i < ins.length; i++) {
      ins[i].value = cfg[ins[i].getAttribute('data-k')];
    }
  }

  function paint() {
    if (!root) return;
    var phEl = root.querySelector('.thit-phase');
    var tEl = root.querySelector('.thit-time');
    var rEl = root.querySelector('.thit-round');
    var fEl = root.querySelector('.thit-fill');
    var mainBtn = root.querySelector('.thit-btn--main');

    phEl.textContent = phaseLabel();
    phEl.className = 'thit-phase' + (phase === 'work' ? ' is-work' : phase === 'rest' ? ' is-rest' : phase === 'done' ? ' is-done' : '');
    tEl.textContent = phase === 'idle' ? fmt(cfg.work) : phase === 'done' ? '✓' : fmt(phaseLeft);
    rEl.textContent = phase === 'idle' ? cfg.rounds + ' кругов' : phase === 'done' ? 'Тренировка завершена' : 'Круг ' + round + ' / ' + cfg.rounds;
    var total = phaseTotal();
    var pct = Math.max(0, Math.min(100, (total ? (total - phaseLeft) / total : 0) * 100));
    fEl.style.width = pct + '%';
    fEl.className = 'thit-fill' + (phase === 'work' ? ' is-work' : phase === 'rest' ? ' is-rest' : '');
    mainBtn.textContent = phase === 'done' ? 'Ещё раз' : running ? 'Пауза' : 'Старт';
  }

  function ensureCss() {
    var st = document.createElement('style');
    st.textContent = [
      '.thit{position:fixed;inset:0;z-index:9990;display:none;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.86);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);font-family:Playfair Display,Georgia,serif}',
      '.thit-panel{width:100%;max-width:480px;max-height:94vh;overflow-y:auto;background:#0a0a0a;border:1px solid rgba(255,255,255,.16);border-bottom:0;padding:16px 18px calc(18px + env(safe-area-inset-bottom))}',
      '.thit-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}',
      '.thit-title{font-size:13px;font-weight:900;letter-spacing:.2em;text-transform:uppercase}',
      '.thit-x{width:36px;height:36px;display:grid;place-items:center;background:#1a1b1e;border:1px solid #2b2e34;color:#9b9fa7;cursor:pointer}',
      '.thit-stage{text-align:center;padding:18px 0 10px}',
      '.thit-phase{font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#9b9fa7;font-weight:800}',
      '.thit-phase.is-work{color:#d31027}',
      '.thit-phase.is-rest{color:#e5e5e5}',
      '.thit-phase.is-done{color:#e5e5e5}',
      '.thit-time{font-size:88px;font-weight:900;font-style:italic;line-height:1.05;color:#fff;margin:4px 0}',
      '.thit-round{font-size:11px;color:#8d9199;letter-spacing:.12em;text-transform:uppercase}',
      '.thit-bar{height:3px;background:#1e2126;margin:14px 0 4px}',
      '.thit-fill{height:100%;width:0;background:#e5e5e5;transition:width .25s linear}',
      '.thit-fill.is-work{background:#d31027}',
      '.thit-fill.is-rest{background:#8d9199}',
      '.thit-ctrl{display:flex;gap:8px;margin-top:14px}',
      '.thit-btn{flex:1;padding:15px;background:#14161a;border:1px solid #2b2e34;color:#e5e5e5;font-weight:900;font-size:12px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}',
      '.thit-btn:active{transform:scale(.985)}',
      '.thit-btn--main{flex:2;background:#d31027;border:0;color:#fff;box-shadow:0 12px 34px rgba(211,16,39,.25)}',
      '.thit-presets{display:flex;gap:6px;margin-top:12px;flex-wrap:wrap}',
      '.thit-preset{padding:9px 11px;background:#121317;border:1px solid #2a2d33;color:#9b9fa7;font-size:10px;font-weight:800;letter-spacing:.04em;cursor:pointer}',
      '.thit-preset:active{transform:scale(.97)}',
      '.thit-cfg{margin-top:12px;border-top:1px solid #1e2126;padding-top:10px}',
      '.thit-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0}',
      '.thit-row span{font-size:11px;color:#9b9fa7}',
      '.thit-row input{width:86px;background:#14161a;border:1px solid #2b2e34;color:#fff;padding:8px 10px;font-size:13px;font-weight:700;text-align:center;outline:none}',
      '.thit-row input:focus{border-color:rgba(211,16,39,.6)}',
      '.thit-note{margin-top:12px;font-size:9px;color:#5d6167;letter-spacing:.06em;text-transform:uppercase;text-align:center}'
    ].join('\n');
    document.head.appendChild(st);
  }

  window.__THTimer = { open: open };
})();
