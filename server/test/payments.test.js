/* §40/платежи: серверная верификация Platega / СБП (мок), анти-повтор. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');

function plategaMock(body, status = 200) {
  let calls = 0;
  return {
    merchantId: 'MERCHANT',
    secret: 'SECRET',
    amount: 99,
    periodDays: 30,
    fetch: async (url, opts) => {
      calls++;
      const response = typeof body === 'function' ? body(url, opts) : body;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => response
      };
    },
    get calls() { return calls; }
  };
}

test('payments: create возвращает ссылку Platega СБП', async () => {
  const p = plategaMock({
    transactionId: '3fa85f64-5717-4562-b3fc-2c463f66afa6',
    redirect: 'https://pay.platega.io/sbp',
    status: 'PENDING'
  });
  const env = makeServer({ platega: p });
  const { token } = await env.login({ id: 1 });

  const r = await env.call('POST', '/payments/create', {
    token,
    body: { label: 'th-abc123' },
    headers: { 'Idempotency-Key': 'th-abc123' }
  });

  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.match(r.body.url, /^https:\/\/pay\.platega\.io/);
  assert.equal(r.body.status, 'PENDING');
});

test('payments: CONFIRMED СБП → Premium на 30 дней', async () => {
  const tx = '3fa85f64-5717-4562-b3fc-2c463f66afa6';
  const p = plategaMock({
    id: tx,
    status: 'CONFIRMED',
    paymentMethod: 'SBPQR',
    paymentDetails: { amount: 99, currency: 'RUB' },
    payload: 'trainhard:1:th-abc123'
  });
  const env = makeServer({ platega: p });
  const { token } = await env.login({ id: 1 });

  const r = await env.call('POST', '/payments/verify', {
    token,
    body: { transactionId: tx }
  });

  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.until > Date.now());

  const premium = await env.call('GET', '/premium', { token });
  assert.equal(premium.body.premium_until, r.body.until);
});

test('payments: чужой payload / неверный статус / сумма → Premium не выдаётся', async () => {
  const cases = [
    { status: 'CONFIRMED', paymentMethod: 'SBPQR', paymentDetails: { amount: 99 }, payload: 'trainhard:2:th-x' },
    { status: 'PENDING', paymentMethod: 'SBPQR', paymentDetails: { amount: 99 }, payload: 'trainhard:1:th-x' },
    { status: 'CONFIRMED', paymentMethod: 'SBPQR', paymentDetails: { amount: 100 }, payload: 'trainhard:1:th-x' },
    { status: 'CONFIRMED', paymentMethod: 'CARD', paymentDetails: { amount: 99 }, payload: 'trainhard:1:th-x' }
  ];

  for (const txData of cases) {
    const p = plategaMock({ ...txData, id: '3fa85f64-5717-4562-b3fc-2c463f66afa6' });
    const env = makeServer({ platega: p });
    const { token } = await env.login({ id: 1 });
    const r = await env.call('POST', '/payments/verify', {
      token,
      body: { transactionId: txData.id }
    });
    assert.equal(r.body.ok, false);
    assert.equal((await env.call('GET', '/premium', { token })).body.premium_until, null);
  }
});

test('payments: повторная верификация того же transaction → тот же until', async () => {
  const tx = '3fa85f64-5717-4562-b3fc-2c463f66afa6';
  const p = plategaMock({
    id: tx,
    status: 'CONFIRMED',
    paymentMethod: 'SBPQR',
    paymentDetails: { amount: 99 },
    payload: 'trainhard:1:th-once'
  });
  const env = makeServer({ platega: p });
  const { token } = await env.login({ id: 1 });

  const a = await env.call('POST', '/payments/verify', { token, body: { transactionId: tx } });
  const b = await env.call('POST', '/payments/verify', { token, body: { transactionId: tx } });

  assert.equal(a.body.until, b.body.until);
  assert.equal(p.calls, 2);
});

test('payments: invalid transaction id → 400; provider off → 503', async () => {
  const env = makeServer({ platega: { merchantId: 'M', secret: 'S', amount: 99, periodDays: 30, fetch: null } });
  const { token } = await env.login({ id: 1 });

  assert.equal(
    (await env.call('POST', '/payments/verify', {
      token,
      body: { transactionId: 'bad' }
    })).code,
    400
  );

  const off = makeServer({
    platega: { merchantId: '', secret: '', amount: 0, fetch: null }
  });
  const u = await off.login({ id: 1 });

  assert.equal(
    (await off.call('POST', '/payments/verify', {
      token: u.token,
      body: { transactionId: '3fa85f64-5717-4562-b3fc-2c463f66afa6' }
    })).code,
    503
  );
});
