/* =============================================================
 * Train Hard — PaymentAdapter (TON-переводы)
 *
 * План подписки: tonAmount TON / periodDays дней (конфиг premium-config).
 *
 * • Адрес кошелька — ПУБЛИЧЕНЫЙ идентификатор получателя, не секрет.
 * • Секретов в клиенте нет: подтверждение платежа — открытый блокчейн TON
 *   (публичный API toncenter), а не утверждение клиента.
 * • Каждый платёж сопровождается уникальным КОММЕНТАРОМ (label вида
 *   th-xxxxxxxx) — по нему перевод находится среди входящих транзакций.
 *   Label связывает флоу с конкретной попыткой оплаты, но НЕ является
 *   доказательством оплаты: доказательство — только найденная транзакция
 *   с корректной суммой.
 * • verify() — frontend-проверка через публичный API: это удобство и
 *   лучший доступный вариант без backend, но НЕ security boundary
 *   (см. docs/PREMIUM-PAYMENTS.md, «ограничения»).
 *
 * Интерфейс совместим с прежним адаптером (isConfigured/newLabel/
 * open/onReturn/verify) — PremiumManager не меняется структурно.
 * ============================================================= */
(function () {
  'use strict';

  /* Публичный API блокчейна TON (без ключа; при росте нагрузки ключ
     запрашивается бесплатно и живёт только на сервере будущего backend) */
  var TONCENTER = 'https://toncenter.com/api/v2/getTransactions';

  var LABEL_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var ADDR_RE = /^[A-Za-z0-9_-]{48}$/;          // user-friendly TON-адрес

  var CFG = function () { return (window.TRAINHARD_PREMIUM || {}).payments || {}; };

  function addr() {
    var a = CFG().tonAddress;
    return (typeof a === 'string' && ADDR_RE.test(a)) ? a : '';
  }
  function amountNano() {
    var t = Number(CFG().tonAmount);
    if (!isFinite(t) || t < 0.1) return 0;
    return Math.round(t * 1e9);
  }

  /* ---------- готовность ---------- */
  function isConfigured() {
    var c = CFG();
    return !!(c && c.enabled && c.provider === 'ton' && addr() && amountNano() > 0);
  }

  /* ---------- label платежа ---------- */
  function newLabel() {
    var s = '';
    for (var i = 0; i < 4; i++) s += Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    return 'th-' + s;
  }

  /* ---------- ссылка на перевод ---------- */
  /* ton://transfer/<addr>?amount=<nano>&text=<label> — стандартная
     deep-link схема TON-кошельков (Tonkeeper/Tonhub/…): подставляет
     адрес, сумму и комментарий перевода. */
  function transferUrl(label) {
    if (!isConfigured() || !LABEL_RE.test(label || '')) return '';
    return 'ton://transfer/' + addr() + '?amount=' + amountNano() + '&text=' + encodeURIComponent(label);
  }

  /* Открытие оплаты: для TON окно не открываем — экран Premium сам
     показывает адрес/сумму/QR и кнопку «Открыть в кошельке». */
  function open(label) {
    if (!isConfigured() || !LABEL_RE.test(label || '')) return { ok: false, reason: 'not-configured' };
    return { ok: true, url: transferUrl(label) };
  }

  /* Легаси-очистка возвратов старого web-флоу (?th_pay=return&label=…):
     URL чистим, pending ставим, Premium НЕ активируем. Возврат сам по
     себе ничего не доказывает. Автопроверки по возврату нет (autoVerify). */
  function onReturn() {
    try {
      var q = new URLSearchParams(location.search);
      if (q.get('th_pay') !== 'return') return null;
      var label = (q.get('label') || '').trim();
      q.delete('th_pay'); q.delete('label');
      var clean = location.pathname + (q.toString() ? '?' + q : '') + location.hash;
      try { history.replaceState(null, '', clean); } catch (e) {}
      return LABEL_RE.test(label) ? { label: label } : { label: '' };
    } catch (e) { return null; }
  }

  /* ---------- подтверждение платежа по блокчейну ---------- */
  /* Ищем среди последних входящих переводов на адрес проекта транзакцию
     с комментарием == label и суммой >= цены плана.
     → Promise<{ok:true, until:ms}> | Promise<{ok:false}> | null (сеть) */
  function verify(label) {
    if (!isConfigured() || !LABEL_RE.test(label || '')) return null;
    var url = TONCENTER + '?address=' + encodeURIComponent(addr()) + '&limit=50';
    return fetch(url, { method: 'GET', credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        try {
          var list = (j && j.ok && Array.isArray(j.result)) ? j.result : [];
          var need = amountNano();
          var period = Number((window.TRAINHARD_PREMIUM || {}).periodDays) || 30;
          for (var i = 0; i < list.length; i++) {
            var tx = list[i];
            if (tx.in !== true) continue;                          /* только входящие */
            if (String(tx.message || '') !== label) continue;      /* комментарий = код платежа */
            if (Number(tx.value) < need) continue;                 /* сумма не меньше цены плана */
            return { ok: true, until: Date.now() + period * 86400000 };
          }
          return { ok: false };
        } catch (e) { return null; }
      })
      .catch(function () { return null; });
  }

  window.TrainHardPayments = {
    provider: 'ton',
    autoVerify: false,          /* проверка только по явному клику пользователя */
    isConfigured: isConfigured,
    newLabel: newLabel,
    transferUrl: transferUrl,
    open: open,
    onReturn: onReturn,
    verify: verify
  };
})();
