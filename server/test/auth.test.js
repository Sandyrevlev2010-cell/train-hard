/* §40: авторизация — новый/существующий пользователь, битая подпись, просрочка. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');
const { signInitData } = require('../src/telegram');

function initDataFor(env, tu, authDateSec) {
  return signInitData({
    user: JSON.stringify(tu),
    auth_date: String(authDateSec !== undefined ? authDateSec : Math.floor(Date.now() / 1000))
  }, env.botToken);
}

test('auth: новый пользователь → 200, токен работает, /me отвечает', async () => {
  const env = makeServer();
  const r = await env.call('POST', '/auth/telegram', {
    body: { initData: initDataFor(env, { id: 101, username: 'alpha', first_name: 'A' }) }
  });
  assert.equal(r.code, 200);
  assert.ok(r.body.token);
  assert.equal(r.body.user.telegram_id, 101);

  const me = await env.call('GET', '/me', { token: r.body.token });
  assert.equal(me.code, 200);
  assert.equal(me.body.user.telegram_id, 101);
});

test('auth: повторный вход того же telegram_id → тот же user id', async () => {
  const env = makeServer();
  const a = await env.call('POST', '/auth/telegram', { body: { initData: initDataFor(env, { id: 202, first_name: 'B' }) } });
  const b = await env.call('POST', '/auth/telegram', { body: { initData: initDataFor(env, { id: 202, first_name: 'B2' }) } });
  assert.equal(a.code, 200); assert.equal(b.code, 200);
  assert.equal(a.body.user.id, b.body.user.id);
  const list = await env.call('GET', '/workouts', { token: a.body.token });
  assert.equal(list.code, 200);
});

test('auth: чужой bot_token в подписи → 401 bad signature', async () => {
  const env = makeServer();
  const bad = signInitData({
    user: JSON.stringify({ id: 1 }), auth_date: String(Math.floor(Date.now() / 1000))
  }, '9' + '0'.repeat(45));
  const r = await env.call('POST', '/auth/telegram', { body: { initData: bad } });
  assert.equal(r.code, 401);
  assert.match(r.body.error, /signature/);
});

test('auth: просроченный auth_date (>24ч) → 401 expired', async () => {
  const env = makeServer();
  const old = Math.floor(Date.now() / 1000) - 25 * 3600;
  const r = await env.call('POST', '/auth/telegram', {
    body: { initData: initDataFor(env, { id: 5 }, old) }
  });
  assert.equal(r.code, 401);
  assert.match(r.body.error, /expired/);
});

test('auth: auth_date из будущего (>60с) → 401', async () => {
  const env = makeServer();
  const future = Math.floor(Date.now() / 1000) + 3600;
  const r = await env.call('POST', '/auth/telegram', {
    body: { initData: initDataFor(env, { id: 5 }, future) }
  });
  assert.equal(r.code, 401);
});

test('auth: без токена и с мусорным токеном → 401', async () => {
  const env = makeServer();
  assert.equal((await env.call('GET', '/me', {})).code, 401);
  assert.equal((await env.call('GET', '/me', { token: 'garbage!!!' })).code, 401);
  assert.equal((await env.call('GET', '/workouts', { token: 'a'.repeat(64) })).code, 401);
});

test('auth: tampered initData (подмена id после подписи) → 401', async () => {
  const env = makeServer();
  const params = new URLSearchParams(initDataFor(env, { id: 7 }));
  params.set('user', JSON.stringify({ id: 999 }));          /* подменили после подписи */
  const r = await env.call('POST', '/auth/telegram', { body: { initData: params.toString() } });
  assert.equal(r.code, 401);
});
