/* Поверхность API из §7: /api-префикс, PUT/GET workout, join по коду,
 * competitions list/join/description, /profile, CORS. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');

test('api: /api-префикс эквивалентен прямым путям', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const a = await env.call('POST', '/api/workouts', { token, body: { date: '2026-08-01' } });
  assert.equal(a.code, 201);
  const b = await env.call('GET', '/api/workouts', { token });
  assert.equal(b.code, 200);
  assert.equal(b.body.workouts.length, 1);
  assert.equal((await env.call('GET', '/api/me', { token })).code, 200);
});

test('api: GET/PUT /workouts/:id', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const w = (await env.call('POST', '/workouts', { token, body: { date: '2026-08-01' } })).body.workout;
  assert.equal((await env.call('GET', '/workouts/' + w.id, { token })).code, 200);
  const u = await env.call('PUT', '/workouts/' + w.id, { token, body: { title: 'Через PUT' } });
  assert.equal(u.code, 200);
  assert.equal(u.body.workout.title, 'Через PUT');
});

test('api: POST /groups/:id/join по коду; POST /profile', async () => {
  const env = makeServer();
  const A = await env.login({ id: 1 });
  const g = (await env.call('POST', '/groups', { token: A.token, body: { name: 'Клуб' } })).body.group;
  const code = (await env.call('POST', '/groups/' + g.id + '/invite', { token: A.token, body: {} })).body.code;
  const B = await env.login({ id: 2 });
  const j = await env.call('POST', '/groups/' + g.id + '/join', { token: B.token, body: { code } });
  assert.equal(j.code, 200);
  assert.equal((await env.call('POST', '/groups/' + g.id + '/join', { token: B.token, body: { code } })).code, 200);  /* повтор безвреден */
  const other = await env.call('POST', '/groups/' + g.id + '/join', { token: B.token, body: { code: 'nope' } });
  assert.equal(other.code, 404);
  assert.equal((await env.call('GET', '/profile', { token: B.token })).code, 200);
  const gi = await env.call('GET', '/groups/' + g.id, { token: B.token });
  assert.equal(gi.body.group.member_count, 2);
  assert.equal(gi.body.me.role, 'MEMBER');
});

test('api: список соревнований группы + join + description', async () => {
  const env = makeServer();
  const A = await env.login({ id: 1 });
  const g = (await env.call('POST', '/groups', { token: A.token, body: { name: 'Клуб' } })).body.group;
  const c = (await env.call('POST', '/groups/' + g.id + '/competitions', {
    token: A.token, body: { name: 'Cup', description: 'desc', type: 'TOTAL', start_at: 1754000000000, end_at: 1755000000000 }
  })).body.competition;
  const list = await env.call('GET', '/groups/' + g.id + '/competitions', { token: A.token });
  assert.equal(list.body.competitions.length, 1);
  assert.equal((await env.call('POST', '/competitions/' + c.id + '/join', { token: A.token, body: {} })).code, 200);
  const one = await env.call('GET', '/competitions/' + c.id, { token: A.token });
  assert.equal(one.body.participants, 1);
  assert.equal(one.body.competition.description, 'desc');
});

test('api: CORS — заголовки на ответах и preflight OPTIONS 204', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const r = await env.call('GET', '/me', { token });
  assert.equal(r.headers['Access-Control-Allow-Origin'], '*');
  const pre = await env.call('OPTIONS', '/api/workouts', { headers: { 'access-control-request-method': 'POST' } });
  assert.equal(pre.code, 204);
  assert.equal(pre.headers['Access-Control-Allow-Headers'].includes('Authorization'), true);
});
