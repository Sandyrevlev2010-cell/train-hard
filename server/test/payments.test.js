/* Platega / СБП payment flow: create, status verification, callback, replay protection. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');

function plategaMock() {
  const calls = [];
  const tx = {
    id: 'tx-test-001',
    status: 'PENDING',
    payload: '',
    paymentDetails: { amount: 299, currency: 'RUB' }
  };

  return {
    merchantId: 'merchant-test',
    secret: 'secret-test',
    amountRub: 299,
    periodDays: 30,
    apiBase: 'https://app.platega.test',
    calls,
    tx,
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      if (url.endsWith('/transaction/process')) {
        tx.payload = JSON.parse(opts.body).payload;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            transactionId: tx.id,
            redirect: 'https://pay.platega.io/?id=test',
            status: 'PENDING',
            expiresIn: '00:15:00'
          })
        };
      }
      if (url.endsWith('/transaction/' + tx.id)) {
        return { ok: true, status: 200, json: async () => ({ ...tx }) };
      }
      throw new Error('unexpected URL');
    }
  };
}

test('payments: create returns Platega SBP redirect and transaction id', async () => {
  const platega = plategaMock();
  const env = makeServer({ platega });
  const { token } = await env.login({ id: 1, username: 'test' });

  const r = await env.call('POST', '/payments/create', {
    token,
    body: { client_label: 'th-test1234' }
  });

  assert.equal(r.code, 201);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.payment_id, 'tx-test-001');
  assert.match(r.body.url, /^https:\/\/pay\.platega\.io\//);
  assert.equal(platega.calls.length, 1);
});

test('payments: pending does not activate Premium, confirmed status does', async () => {
  const platega = plategaMock();
  const env = makeServer({ platega });
  const { token } = await env.login({ id: 1 });

  await env.call('POST', '/payments/create', {
    token,
    body: { client_label: 'th-test1234' }
  });

  const pending = await env.call('POST', '/payments/verify', {
    token,
    body: { payment_id: platega.tx.id }
  });
  assert.equal(pending.code, 200);
  assert.equal(pending.body.ok, false);

  platega.tx.status = 'CONFIRMED';

  const confirmed = await env.call('POST', '/payments/verify', {
    token,
    body: { payment_id: platega.tx.id }
  });
  assert.equal(confirmed.code, 200);
  assert.equal(confirmed.body.ok, true);
  assert.ok(confirmed.body.until > Date.now());

  const premium = await env.call('GET', '/premium', { token });
  assert.equal(premium.body.premium_until, confirmed.body.until);
});

test('payments: transaction cannot be claimed by another user', async () => {
  const platega = plategaMock();
  const env = makeServer({ platega });
  const a = await env.login({ id: 1 });
  const b = await env.login({ id: 2 });

  await env.call('POST', '/payments/create', {
    token: a.token,
    body: { client_label: 'th-user-a' }
  });

  platega.tx.status = 'CONFIRMED';

  const r = await env.call('POST', '/payments/verify', {
    token: b.token,
    body: { payment_id: platega.tx.id }
  });

  assert.equal(r.code, 403);
  assert.equal((await env.call('GET', '/premium', { token: b.token })).body.premium_until, null);
});

test('payments: confirmed transaction is idempotent', async () => {
  const platega = plategaMock();
  const env = makeServer({ platega });
  const { token } = await env.login({ id: 1 });

  await env.call('POST', '/payments/create', {
    token,
    body: { client_label: 'th-test1234' }
  });
  platega.tx.status = 'CONFIRMED';

  const a = await env.call('POST', '/payments/verify', {
    token,
    body: { payment_id: platega.tx.id }
  });
  const b = await env.call('POST', '/payments/verify', {
    token,
    body: { payment_id: platega.tx.id }
  });

  assert.equal(a.body.until, b.body.until);
  assert.equal(platega.calls.filter(x => x.url.includes('/transaction/')).length, 1);
});

test('payments: Platega callback authenticates and activates entitlement', async () => {
  const platega = plategaMock();
  const env = makeServer({ platega });
  const { token } = await env.login({ id: 1 });

  await env.call('POST', '/payments/create', {
    token,
    body: { client_label: 'th-test1234' }
  });

  const cb = await env.call('POST', '/payments/platega/callback', {
    body: {
      id: platega.tx.id,
      amount: 299,
      currency: 'RUB',
      status: 'CONFIRMED',
      payload: platega.tx.payload,
      paymentMethod: 2
    },
    headers: {
      'x-merchantid': 'merchant-test',
      'x-secret': 'secret-test'
    }
  });

  assert.equal(cb.code, 200);
  const premium = await env.call('GET', '/premium', { token });
  assert.ok(premium.body.premium_until > Date.now());
});

test('payments: invalid callback secret is rejected', async () => {
  const platega = plategaMock();
  const env = makeServer({ platega });

  const cb = await env.call('POST', '/payments/platega/callback', {
    body: { status: 'CONFIRMED', id: 'tx-test-001', amount: 299 },
    headers: {
      'x-merchantid': 'wrong',
      'x-secret': 'wrong'
    }
  });

  assert.equal(cb.code, 401);
});
