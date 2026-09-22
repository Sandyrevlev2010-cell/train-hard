/* =============================================================
 * Train Hard MVP — PremiumManager
 *
 * АРХИТЕКТУРА (см. docs/SECURITY-AUDIT.md, раздел Premium):
 *
 *   PremiumManager
 *        │
 *        ├── local UI state        ← localStorage trainhard_premium_v1
 *        │   isPremium()/until()   = состояние интерфейса MVP.
 *        │   НЕ является доказательством покупки: пользователь
 *        │   контролирует localStorage и может изменить флаг.
 *        │   Это принятое ограничение frontend-only MVP.
 *        │
 *        └── trusted entitlement   ← getTrustedEntitlement()
 *            MVP:  всегда null (UNVERIFIED) — доверенного
 *                  источника пока нет.
 *            2.0:  backend / RuStore / verified payment →
 *                  только он разрешает активацию.
 *
 *   MVP:
 *     local entitlement is UI state only.
 *   Production:
 *     trusted entitlement must come from
 *     verified payment/store/backend source.
 *
 * ПРАВИЛА АКТИВАЦИИ:
 *   • Платёж → возврат в приложение → «Платёж отправлен, ожидается
 *     подтверждение». Возврат/label/localStorage НЕ активируют Premium.
 *   • Активация возможна только после verify() — подтверждения
 *     доверенной стороной (backend, сверяющий платёж с ЮKassa,
 *     или магазин приложений в Android-сборке).
 *   • Активация идемпотентна по label — повторная обработка того же
 *     платежа не продлевает подписку (anti-replay).
 * ============================================================= */
(function () {
  'use strict';

  var Storage = window.TrainHardStorage;
  var Payments = window.TrainHardPayments;
  var Analytics = function () { return window.__THAnalytics; };
  var KEY = 'trainhard_premium_v1';
  var PENDING_KEY = 'trainhard_premium_pending_v1';
  var DAY = 86400000;
  var MAX_PERIOD_DAYS = 3660;            // ≤ ~10 лет — всё, что больше, отбрасывается как мусор
  var LABEL_RE = /^[A-Za-z0-9_-]{1,64}$/;

  /* ---------- конфиг ---------- */
  function cfg() { return window.TRAINHARD_PREMIUM || { priceLabel: '1 TON', periodDays: 30 }; }
  function periodDays() {
    var d = parseInt(cfg().periodDays, 10);
    return (d > 0 && d <= MAX_PERIOD_DAYS) ? d : 30;
  }
  function paymentsReady() { return !!(Payments && Payments.isConfigured && Payments.isConfigured()); }

  /* =============================================================
   * Trusted entitlement — будущий интерфейс (§41 спека).
   * Сейчас доверенного источника нет: всегда UNVERIFIED/null.
   * ============================================================= */
  var ENTITLEMENT_UNVERIFIED = 'UNVERIFIED';

  function getTrustedEntitlement() {
    /* MVP: локальной доверенной проверки не существует.
       2.0: вернуть {until:<ms>, source:'backend'|'store'} после
       серверной/магазинной сверки. Пока — честный null. */
    return null;
  }

  /* ---------- состояние (локальный UI state) ---------- */

  /* Валидация записи entitlement: неожиданные типы/структуры
     из localStorage не принимаются. */
  function sanitizeRecord(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    var until = Number(r.until);
    if (!isFinite(until) || until < 0 || until > Date.now() + MAX_PERIOD_DAYS * DAY) return null;
    var out = {
      until: Math.floor(until),
      activatedAt: (isFinite(Number(r.activatedAt)) && Number(r.activatedAt) >= 0) ? Math.floor(Number(r.activatedAt)) : 0
    };
    if (typeof r.label === 'string' && LABEL_RE.test(r.label)) out.label = r.label;
    if (typeof r.source === 'string' && r.source.length <= 32) out.source = r.source;
    return out;
  }

  function readRecord() { return sanitizeRecord(Storage ? Storage.get(KEY, null) : null); }
  function writeRecord(r) { if (Storage) Storage.set(KEY, r); emit(); }

  function until() {
    var r = readRecord();
    return r ? r.until : 0;
  }
  function isPremium() { return Date.now() < until(); }
  function daysLeft() { return isPremium() ? Math.ceil((until() - Date.now()) / DAY) : 0; }

  /* ---------- слушатели ---------- */
  var listeners = [];
  function onChange(cb) { if (typeof cb === 'function') listeners.push(cb); }
  function emit() {
    var snap = { until: until(), isPremium: isPremium() };
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](snap); } catch (e) {} }
    rerender();
  }

  /* ---------- интеграция с React-состоянием ---------- */
  function pushToReact() {
    try {
      if (window.__THPatch) window.__THPatch({ premiumUntil: until() });
    } catch (e) {}
  }

  /* Активация. Вызывается ТОЛЬКО после подтверждения платежа
     доверенной стороной (verify) или из dev-консоли (см. SECURITY-AUDIT:
     accepted MVP limitation). Идемпотентна по label: повторная
     обработка того же платежа не продлевает подписку. */
  function activate(opts) {
    opts = opts || {};
    var label = (typeof opts.label === 'string' && LABEL_RE.test(opts.label)) ? opts.label : '';
    var current = readRecord();
    if (label && current && current.label === label && current.until > Date.now()) {
      return current;                                  /* replay того же платежа — no-op */
    }
    var days = parseInt(opts.days, 10);
    if (!(days > 0 && days <= MAX_PERIOD_DAYS)) days = periodDays();
    var base = Math.max(Date.now(), until());          /* продление суммируется */
    var rec = {
      until: base + days * DAY,
      activatedAt: Date.now(),
      source: (typeof opts.source === 'string' && opts.source.length <= 32) ? opts.source : 'unknown',
      label: label
    };
    writeRecord(rec);
    pushToReact();
    clearPending();
    if (opts.track !== false) { var a = Analytics(); if (a) a.track('purchase_success'); }
    return rec;
  }

  function deactivate() { writeRecord(null); pushToReact(); }

  /* Восстановление покупки: доверенного источника в MVP нет,
     поэтому честно сообщаем статус. */
  function restore() {
    if (isPremium()) return { status: 'active', until: until() };
    var p = readPending();
    if (p && p.label && paymentsReady()) return { status: 'verifying', label: p.label };
    if (Payments && Payments.pending) {
      var pp = Payments.pending();
      if (pp && pp.label && paymentsReady()) return { status: 'verifying', label: pp.label };
    }
    return { status: 'none' };
  }

  /* ---------- незавершённый платёж (ожидает подтверждения) ---------- */
  function sanitizePending(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    if (typeof p.label !== 'string' || !LABEL_RE.test(p.label)) return null;
    return { label: p.label, at: isFinite(Number(p.at)) ? Number(p.at) : 0 };
  }
  function readPending() { return sanitizePending(Storage ? Storage.get(PENDING_KEY, null) : null); }
  function savePending(label) { if (Storage) Storage.set(PENDING_KEY, { label: label, at: Date.now() }); }
  function clearPending() { if (Storage) Storage.remove(PENDING_KEY); }

  /* ---------- покупка ---------- */
  async function checkout() {
    var a = Analytics(); if (a) a.track('buy_click');
    if (!paymentsReady()) return { ok: false, reason: 'payments-not-configured' };

    var label = Payments.newLabel();
    var res = await Payments.open(label);
    if (!res || !res.ok) return res || { ok: false, reason: 'payment-create-failed' };

    if (Payments.savePending) {
      Payments.savePending({
        label: label,
        payment_id: res.paymentId || '',
        transaction_id: res.transactionId || '',
        at: Date.now()
      });
    }

    rerender();

    try {
      if (res.url) {
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openLink) {
          window.Telegram.WebApp.openLink(res.url);
        } else {
          window.open(res.url, '_blank', 'noopener,noreferrer');
        }
      }
    } catch (e) {
      return { ok: false, reason: 'open-failed', url: res.url };
    }

    return { ok: true, label: label };
  }

  /* Пользователь вернулся в приложение из окна оплаты без перезагрузки */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') rerender();
  });

  /* =============================================================
   * Premium-экран (рендерится в контейнер React-модалки)
   * Все динамические значения проходят esc(); label платежа
   * в DOM не вставляется вообще.
   * ============================================================= */
  var mountEl = null;
  var uiState = { verifying: false, verifyFailed: false, verifyUnavailable: false, popupUrl: null };

  function setUiState(patch) { for (var k in patch) uiState[k] = patch[k]; }

  function closeModal() {
    try {
      var el = mountEl;
      while (el && el.parentElement) {
        var c = el.getAttribute && el.getAttribute('class');
        if (c && c.indexOf('backdrop-blur') !== -1) {
          var p = readPending();
          if (p && !isPremium()) { var a = Analytics(); if (a) a.track('purchase_cancel'); }
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return;
        }
        el = el.parentElement;
      }
    } catch (e) {}
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }

  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }); }
    catch (e) { return ''; }
  }

  function mount(el) {
    if (!el || el.dataset.thPremMounted) return;
    el.dataset.thPremMounted = '1';
    mountEl = el;
    ensureCss();
    render();
  }

  function rerender() { if (mountEl) render(); }

  function render() {
    if (!mountEl) return;
    var c = cfg();
    var active = isPremium();
    var ready = paymentsReady();
    var pending = readPending();
    if (Payments && Payments.pending) {
      var pp = Payments.pending();
      if (pp && pp.label) pending = { label: pp.label, at: pp.at || Date.now() };
    }
    var h = [];

    h.push('<div class="thp-head"><div><div class="thp-kicker">Train Hard</div><div class="thp-title">' + (active ? 'Premium активен' : 'Premium') + '</div></div>');
    h.push('<button class="thp-x" aria-label="Закрыть">✕</button></div>');

    if (active) {
      h.push('<div class="thp-card thp-card--active">');
      h.push('<div class="thp-big">' + daysLeft() + '</div>');
      h.push('<div class="thp-card-note">дней осталось · до ' + esc(fmtDate(until())) + '</div>');
      h.push('<div class="thp-card-note">Все Premium-программы и питание открыты.</div>');
      h.push('</div>');
      if (ready) h.push('<button class="thp-buy" data-act="buy">Продлить на ' + periodDays() + ' дней · ' + esc(c.priceLabel) + '</button>');
    } else {
      h.push('<div class="thp-sub">Что входит в Premium</div>');
      h.push('<div class="thp-card"><ul class="thp-list">');
      h.push('<li><b>Питание с КБЖУ</b><span>Готовое меню на 7 дней и норма калорий под твой вес и цель</span></li>');
      h.push('<li><b>Old School</b><span>Программы Арнольда, Ронни Колемана и Кевина Леврона</span></li>');
      h.push('<li><b>AI-сплит</b><span>Сбалансированный сплит для набора объёма</span></li>');
      h.push('<li><b>Поддержка проекта</b><span>Тренировки, таймеры и прогресс остаются бесплатными</span></li>');
      h.push('</ul></div>');
      h.push('<div class="thp-sub">Бесплатно и без подписки</div>');
      h.push('<div class="thp-card"><div class="thp-free">Программы силы и выносливости · конструктор тренировок · таймеры · локальный прогресс и рекорды · AI-тренер · база знаний</div></div>');
      h.push('<div class="thp-price"><span class="thp-price-val">' + esc(c.priceLabel) + '</span><span class="thp-price-per">за ' + periodDays() + ' дней · разовый платёж, без автосписаний</span></div>');

      if (uiState.verifying) {
        h.push('<div class="thp-card thp-card--pay"><b>Проверяем оплату…</b><span>Сверяем платёж с сервером, это несколько секунд.</span></div>');
      } else if (uiState.verifyFailed) {
        h.push('<div class="thp-card thp-card--pay"><b>Оплата ещё не подтверждена</b><span>Если ты только что оплатил, подожди немного и нажми «Проверить оплату» ещё раз.</span></div>');
        h.push('<button class="thp-buy" data-act="restore">Проверить оплату</button>');
      } else if (uiState.verifyUnavailable) {
        h.push('<div class="thp-card thp-card--pay"><b>Проверка временно недоступна</b><span>Сервер не смог получить статус платежа. Premium не активирован.</span></div>');
        h.push('<button class="thp-buy" data-act="restore">Проверить оплату</button>');
      } else if (pending) {
        h.push('<div class="thp-card thp-card--pay"><b>Оплата через СБП</b><span>Платёж открывается на защищённой странице Platega. Автосписаний нет.</span></div>');
        h.push('<div class="thp-card"><div class="thp-ton-lbl">Код платежа</div><div class="thp-ton-code">' + esc(pending.label) + '</div></div>');
        h.push('<button class="thp-buy" data-act="restore">Проверить оплату</button>');
      } else if (ready) {
        h.push('<button class="thp-buy" data-act="buy">Оплатить ' + esc(c.priceLabel) + '</button>');
      } else {
        h.push('<div class="thp-card thp-card--pay"><b>Оплата пока недоступна.</b><span>Приём платежей ещё не настроен на сервере.</span></div>');
      }
    }

    h.push('<button class="thp-restore" data-act="restore">Восстановить покупку</button>');
    h.push('<div class="thp-terms">');
    h.push('Оплата выполняется через Platega по СБП. Данные банковской карты в Train Hard не вводятся и не хранятся. ');
    h.push('Premium активируется только после подтверждения платежа сервером. Срок — ' + periodDays() + ' дней, без автопродления.');
    h.push('</div>');

    mountEl.innerHTML = h.join('');    mountEl.innerHTML = h.join('');

    /* события */
    mountEl.querySelector('.thp-x').addEventListener('click', function (e) {
      e.stopPropagation();
      closeModal();
    });

    /* QR-код ссылки перевода (локальный генератор, без внешних сервисов) */
    try {
      var qrCv = mountEl.querySelector('.thp-ton-qr canvas');
      if (qrCv && pending && window.__THQR && Payments.transferUrl) {
        var turl = Payments.transferUrl(pending.label);
        var qc = window.__THQR.generate(turl);
        var scale = 4, quiet = 2, dim = (qc.size + quiet * 2) * scale;
        qrCv.width = dim; qrCv.height = dim;
        var qx = qrCv.getContext('2d');
        qx.fillStyle = '#fff'; qx.fillRect(0, 0, dim, dim);
        qx.fillStyle = '#000';
        for (var qy = 0; qy < qc.size; qy++)
          for (var qx2 = 0; qx2 < qc.size; qx2++)
            if (qc.modules[qy][qx2]) qx.fillRect((qx2 + quiet) * scale, (qy + quiet) * scale, scale, scale);
      }
    } catch (e) { /* без QR останутся копирование и ссылка */ }

    function copyText(txt) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt);
        var ta = document.createElement('textarea');
        ta.value = txt; ta.className = 'thp-ta';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      } catch (e) {}
      return Promise.resolve();
    }

    var act = mountEl.querySelectorAll('[data-act]');
    for (var i = 0; i < act.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var a = btn.getAttribute('data-act');
          if (a === 'buy') {
            checkout().then(function (res) {
              if (!res || !res.ok) setUiState({ verifyUnavailable: true });
              rerender();
            });
          } else if (a === 'restore') {
            doRestore();
          } else if (a === 'copy-addr') {
            copyText(tonAddr);
          } else if (a === 'copy-label') {
            copyText(pending ? pending.label : '');
          }
        });
      })(act[i]);
    }
  }

  function doRestore() {
    var r = restore();
    if (r.status === 'active') { rerender(); return; }
    if (r.status === 'verifying') { verifyPending(r.label); return; }
    /* Нечего восстанавливать — честно сообщаем */
    setUiState({ verifyFailed: false, verifyUnavailable: false });
    rerender();
    var t = mountEl.querySelector('.thp-terms');
    if (t) {
      var note = document.createElement('div');   /* безопасный DOM API, статический текст */
      note.className = 'thp-card thp-card--pay';
      var b = document.createElement('b'); b.textContent = 'Покупок не найдено';
      var s = document.createElement('span'); s.textContent = 'На этом устройстве нет подтверждённой оплаты. Если ты платил — нажми «Я оплатил — проверить»: перевод ищется в блокчейне TON по коду платежа.';
      note.appendChild(b); note.appendChild(s);
      t.parentNode.insertBefore(note, t);
      setTimeout(function () { if (note.parentNode) note.parentNode.removeChild(note); }, 6000);
    }
  }

  /* ---------- подтверждение платежа доверенной стороной ---------- */
  function handleReturn() {
    if (!Payments || !Payments.onReturn) return;
    var r = Payments.onReturn();
    if (!r) return;
    if (r.label) {
      savePending(r.label);
      if (paymentsReady() && Payments.autoVerify) {
        verifyPending(r.label);
      } else {
        /* серверной проверки нет — только честный статус, без активации */
        setUiState({ verifying: false });
      }
      /* открыть экран, чтобы показать статус платежа */
      setTimeout(function () { try { window.__thPay && window.__thPay(); } catch (e) {} }, 600);
      rerender();
    }
  }

  function verifyPending(label) {
    setUiState({ verifying: true, verifyFailed: false, verifyUnavailable: false });
    rerender();
    if (!Payments.verify) {
      setUiState({ verifying: false, verifyUnavailable: true });
      rerender();
      return;
    }
    Payments.verify(label).then(function (ans) {
      setUiState({ verifying: false });
      if (ans && ans.ok === true && isFinite(Number(ans.until))) {
        activate({ source: 'platega-sbp', label: label, track: true });
        if (Payments.clearPending) Payments.clearPending();
      } else if (ans && ans.ok === false) {
        setUiState({ verifyFailed: true });
      } else {
        setUiState({ verifyUnavailable: true });
      }
      rerender();
    });
  }

  /* ---------- стили ---------- */
  var cssInjected = false;
  function ensureCss() {
    if (cssInjected) return;
    cssInjected = true;
    var st = document.createElement('style');
    st.textContent = [
      '.thp-wrap{padding:18px 18px 22px;color:#e5e5e5;background:#0f0f0f;font-family:Playfair Display,Georgia,serif}',
      '.thp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}',
      '.thp-kicker{font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:#6b7078;font-weight:700}',
      '.thp-title{font-size:26px;font-weight:900;font-style:italic;line-height:1.05;margin-top:3px}',
      '.thp-x{flex:0 0 auto;width:34px;height:34px;display:grid;place-items:center;background:#1a1b1e;border:1px solid #2b2e34;color:#9b9fa7;font-size:15px;cursor:pointer}',
      '.thp-sub{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#6b7078;font-weight:700;margin:16px 0 6px}',
      '.thp-card{background:#121212;border:1px solid #23262b;padding:12px 14px;margin-top:8px}',
      '.thp-card--active{border-color:rgba(229,229,229,.45);text-align:center;padding:18px 14px}',
      '.thp-card--pay{border-color:rgba(229,229,229,.3)}',
      '.thp-card--pay b{display:block;font-size:13px;margin-bottom:4px}',
      '.thp-card--pay span{display:block;font-size:11px;color:#8d9199;line-height:1.5}',
      '.thp-big{font-size:44px;font-weight:900;font-style:italic;line-height:1}',
      '.thp-card-note{font-size:11px;color:#8d9199;margin-top:6px}',
      '.thp-list{list-style:none;margin:0;padding:0}',
      '.thp-list li{padding:8px 0;border-bottom:1px solid #1e2126}',
      '.thp-list li:last-child{border-bottom:0}',
      '.thp-list b{display:block;font-size:13px}',
      '.thp-list span{display:block;font-size:11px;color:#8d9199;margin-top:2px;line-height:1.45}',
      '.thp-free{font-size:11px;color:#9b9fa7;line-height:1.6}',
      '.thp-price{margin:14px 0 10px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
      '.thp-price-val{font-size:30px;font-weight:900;font-style:italic}',
      '.thp-price-per{font-size:10px;color:#8d9199;letter-spacing:.06em;text-transform:uppercase}',
      '.thp-buy{width:100%;margin-top:12px;padding:15px;background:#d31027;color:#fff;border:0;font-weight:900;font-size:12px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;box-shadow:0 12px 34px rgba(211,16,39,.25)}',
      '.thp-buy:active{transform:scale(.985)}',
      '.thp-ton-lbl{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#6b7078;font-weight:700;margin-top:10px}',
      '.thp-ton-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px;font-weight:700;color:#e5e5e5;letter-spacing:.06em}',
      '.thp-ton-addr{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#c9c9c9;word-break:break-all;line-height:1.5}',
      '.thp-ton-amt{font-size:14px;font-weight:800}',
      '.thp-ton-qr{display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:12px}',
      '.thp-ton-qr canvas{background:#fff;padding:6px;width:168px;height:168px;box-sizing:border-box}',
      '.thp-ton-qrhint{font-size:9px;color:#6b7078;text-align:center;max-width:220px}',
      '.thp-ta{position:fixed;left:-9999px;top:0}',
      '.thp-ghost,.thp-restore{width:100%;margin-top:8px;padding:12px;background:#14161a;border:1px solid #2b2e34;color:#9b9fa7;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}',
      '.thp-linkbtn{display:inline-block;margin-top:8px;padding:10px 14px;background:#14161a;border:1px solid rgba(229,229,229,.4);color:#e5e5e5;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;text-decoration:none}',
      '.thp-terms{margin-top:14px;font-size:10px;color:#6b7078;line-height:1.55;border-top:1px solid #1e2126;padding-top:12px}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- публичный API ---------- */
  window.__THPrem = {
    until: until,
    isPremium: isPremium,
    daysLeft: daysLeft,
    /* trusted-интерфейс для будущего backend/магазина (§41) */
    getTrustedEntitlement: getTrustedEntitlement,
    ENTITLEMENT_UNVERIFIED: ENTITLEMENT_UNVERIFIED,
    activate: activate,
    deactivate: deactivate,
    restore: restore,
    checkout: checkout,
    verifyPending: verifyPending,
    onChange: onChange,
    mount: mount
  };

  /* Применяем entitlement к состоянию при старте (до рендера React-экранов) */
  pushToReact();
  handleReturn();
})();
