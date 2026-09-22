/* Train Hard — PaymentAdapter: Platega / СБП.
 * Platega credentials never reach the frontend.
 */
(function () {
  'use strict';
  var LABEL_RE = /^[A-Za-z0-9_-]{1,128}$/;

  function cfg() { return (window.TRAINHARD_PREMIUM || {}).payments || {}; }
  function api() { return window.__THAPI || null; }
  function isConfigured() { var c = cfg(); return !!(c.enabled && c.provider === 'platega'); }

  function newLabel() {
    var s = '';
    for (var i = 0; i < 4; i++) s += Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    return 'th-' + s;
  }

  function savePending(x) {
    try { localStorage.setItem('trainhard_platega_pending_v1', JSON.stringify(x)); } catch (e) {}
  }
  function clearPending() {
    try { localStorage.removeItem('trainhard_platega_pending_v1'); } catch (e) {}
  }
  function pending() {
    try {
      var x = JSON.parse(localStorage.getItem('trainhard_platega_pending_v1') || 'null');
      return x && typeof x === 'object' ? x : null;
    } catch (e) { return null; }
  }

  function open(label) {
    if (!isConfigured() || !LABEL_RE.test(label || '')) return Promise.resolve({ ok: false, reason: 'not-configured' });
    var a = api();
    if (!a || typeof a.request !== 'function') return Promise.resolve({ ok: false, reason: 'auth-unavailable' });

    return a.request('POST', '/payments/create', { client_label: label }).then(function (r) {
      if (!r || !r.ok || !r.body || !r.body.url) {
        return { ok: false, reason: (r && r.reason) || 'payment-create-failed', status: r && r.status };
      }
      var x = {
        label: label,
        payment_id: String(r.body.payment_id || ''),
        transaction_id: String(r.body.transaction_id || ''),
        at: Date.now()
      };
      savePending(x);
      return { ok: true, label: label, paymentId: x.payment_id, transactionId: x.transaction_id, url: String(r.body.url) };
    });
  }

  function verify(label) {
    if (!isConfigured() || !LABEL_RE.test(label || '')) return Promise.resolve(null);
    var p = pending();
    var a = api();
    if (!p || !p.payment_id || !a || typeof a.request !== 'function') return Promise.resolve({ ok: false });
    return a.request('POST', '/payments/verify', { payment_id: p.payment_id }).then(function (r) {
      if (!r || !r.ok || !r.body) return null;
      if (r.body.ok === true && Number.isFinite(Number(r.body.until))) return { ok: true, until: Number(r.body.until) };
      if (r.body.ok === false) return { ok: false, status: r.body.status || 'PENDING' };
      return null;
    }).catch(function () { return null; });
  }

  window.TrainHardPayments = {
    provider: 'platega',
    autoVerify: false,
    isConfigured: isConfigured,
    newLabel: newLabel,
    transferUrl: function () { return ''; },
    open: open,
    verify: verify,
    savePending: savePending,
    clearPending: clearPending,
    pending: pending,
    onReturn: function () { return null; }
  };
})();