/* §40/платежи: серверная верификация TON через toncenter (мок), анти-повтор по label. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');

function tonMock(txs) {
  let calls = 0;
  return {
    address: 'UQWALLET', amountNano: 1000000000, periodDays: 30,
    fetch: async () => { calls++; return { json: async () => ({ ok: true, result: txs }) }; },
    get calls() { return calls; }
  };
}

test('payments: найдена входящая транзакция с label и суммой → ok, выдан until', async () => {
  const ton = tonMock([{ in: true, value: '1000000000', message: 'th-abc123' }]);
  const env = makeServer({ ton });
  const { token } = await env.login({ id: 1 });

  const r = await env.call('POST', '/payments/verify', { token, body: { label: 'th-abc123' } });
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  const until = r.body.until;
  assert.ok(until > Date.now() && until <= Date.now() + 31 * 86400000);

  const p = await env.call('GET', '/premium', { token });
  assert.equal(p.body.premium_until, until);
});

test('payments: недостаточная сумма / чужой label / исходящая → ok:false', async () => {
  const ton = tonMock([
    { in: true, value: '500000000', message: 'th-low' },
    { in: true, value: '1000000000', message: 'th-other' },  /* label th-none в моке отсутствует */
    { in: false, value: '1000000000', message: 'th-out' }
  ]);
  const env = makeServer({ ton });
  const { token } = await env.login({ id: 1 });
  for (const label of ['th-low', 'th-none', 'th-out']) {
    const r = await env.call('POST', '/payments/verify', { token, body: { label } });
    assert.equal(r.body.ok, false);
  }
  assert.equal((await env.call('GET', '/premium', { token })).body.premium_until, null);
});

test('payments: повторная верификация того же label не продлевает и не дёргает API', async () => {
  const ton = tonMock([{ in: true, value: '1000000000', message: 'th-once' }]);
  const env = makeServer({ ton });
  const { token } = await env.login({ id: 1 });
  const a = await env.call('POST', '/payments/verify', { token, body: { label: 'th-once' } });
  const b = await env.call('POST', '/payments/verify', { token, body: { label: 'th-once' } });
  assert.equal(a.body.until, b.body.until);      /* анти-повтор: тот же until */
  assert.equal(ton.calls, 1);
});

test('payments: невалидный label → 400; платежи не настроены → 503', async () => {
  const env = makeServer({ ton: { address: 'UQWALLET', amountNano: 1e9, periodDays: 30, fetch: async () => ({ json: async () => ({ result: [] }) }) } });
  const { token } = await env.login({ id: 1 });
  assert.equal((await env.call('POST', '/payments/verify', { token, body: { label: 'плохо!' } })).code, 400);

  const off = makeServer({ ton: { address: '', amountNano: 0, fetch: null } });
  const u = await off.login({ id: 1 });
  assert.equal((await off.call('POST', '/payments/verify', { token: u.token, body: { label: 'th-x' } })).code, 503);
});

test('payments: blockchain API недоступен → 502, entitlement не меняется', async () => {
  const ton = { address: 'UQW', amountNano: 1e9, periodDays: 30, fetch: async () => { throw new Error('down'); } };
  const env = makeServer({ ton });
  const { token } = await env.login({ id: 1 });
  const r = await env.call('POST', '/payments/verify', { token, body: { label: 'th-down' } });
  assert.equal(r.code, 502);
  assert.equal((await env.call('GET', '/premium', { token })).body.premium_until, null);
});
