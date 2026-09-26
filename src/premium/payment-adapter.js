/* =============================================================
 * Train Hard — PaymentAdapter (Platega / СБП)
 *
 * Интерфейс намеренно сохранён прежним:
 *   isConfigured / newLabel / open / onReturn / verify
 *
 * Секреты Platega НИКОГДА не попадают во frontend.
 * Создание и проверка платежа выполняются backend.
 * ============================================================= */
(function () {
  'use strict';

  var CFG = function () {
    return (window.TRAINHARD_PREMIUM || {}).payments || {};
  };

  function apiBase() {
    var c = CFG();
    var a = String(c.apiBase || 'https://train-hard.onrender.com').replace(/\/+$/, '');
    return a;
  }

  function sessionToken() {
    try {
      return localStorage.getItem('trainhard_api_session') || '';
    } catch (e) {
      return '';
    }
  }

  function isConfigured() {
    var c = CFG();
    return !!(c && c.enabled && c.provider === 'platega' && c.paymentMethod === 2 && apiBase());
  }

  function newLabel() {
    var s = '';
    try {
      if (window.crypto && crypto.getRandomValues) {
        var b = new Uint8Array(8);
        crypto.getRandomValues(b);
        for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
      }
    } catch (e) {}
    if (!s) {
      for (var j = 0; j < 16; j++) s += Math.floor(Math.random() * 16).toString(16);
    }
    return 'th-' + s;
  }

  function request(path, method, body) {
    var token = sessionToken();
    if (!token) return Promise.resolve({ ok: false, status: 401, body: null });
    var headers = { 'Authorization': 'Bearer ' + token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(apiBase() + path, {
      method: method || 'GET',
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit'
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body2) {
        return { ok: r.ok, status: r.status, body: body2 };
      });
    }).catch(function () {
      return { ok: false, status: 0, body: null };
    });
  }

  function open(label) {
    if (!isConfigured() || !/^[A-Za-z0-9_-]{1,64}$/.test(label || '')) {
      return Promise.resolve({ ok: false, reason: 'not-configured' });
    }

    return request('/payments/create', 'POST', { label: label }).then(function (r) {
      if (!r.ok || !r.body || !r.body.ok || !r.body.url || !r.body.transactionId) {
        return { ok: false, reason: r.status === 401 ? 'unauthorized' : 'create-failed' };
      }
      return {
        ok: true,
        url: r.body.url,
        transactionId: r.body.transactionId,
        label: label
      };
    });
  }

  function onReturn() {
    try {
      var q = new URLSearchParams(location.search);
      var id = (q.get('th_pay_id') || '').trim();
      if (!id) return null;
      q.delete('th_pay_id');
      var clean = location.pathname + (q.toString() ? '?' + q : '') + location.hash;
      try { history.replaceState(null, '', clean); } catch (e) {}
      return { transactionId: id };
    } catch (e) {
      return null;
    }
  }

  function verify(transactionId) {
    if (!isConfigured() || !transactionId) return null;
    return request('/payments/verify', 'POST', {
      transactionId: String(transactionId)
    }).then(function (r) {
      if (!r.ok || !r.body) {
        if (r.status === 502) return null;
        return { ok: false };
      }
      if (r.body.ok === true) {
        return { ok: true, until: Number(r.body.until) || 0 };
      }
      return { ok: false };
    }).catch(function () {
      return null;
    });
  }

  window.TrainHardPayments = {
    provider: 'platega',
    autoVerify: false,
    isConfigured: isConfigured,
    newLabel: newLabel,
    open: open,
    onReturn: onReturn,
    verify: verify
  };
})();
