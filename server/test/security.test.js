/* §40: безопасность — IDOR, XSS, mass assignment, rate limit, размеры/типы тел. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');

test('security: IDOR — чужая тренировка невидима и неизменяема (404)', async () => {
  const env = makeServer();
  const a = await env.login({ id: 1 });
  const b = await env.login({ id: 2 });
  const w = (await env.call('POST', '/workouts', { token: a.token, body: { date: '2026-08-01' } })).body.workout;

  assert.equal((await env.call('GET', '/workouts/' + w.id, { token: b.token })).code, 404);
  assert.equal((await env.call('PATCH', '/workouts/' + w.id, { token: b.token, body: { title: 'X' } })).code, 404);
  assert.equal((await env.call('DELETE', '/workouts/' + w.id, { token: b.token })).code, 404);
  /* список b не содержит запись a */
  const list = await env.call('GET', '/workouts', { token: b.token });
  assert.equal(list.body.workouts.length, 0);
});

test('security: IDOR — чужой подход и добавление в чужую тренировку', async () => {
  const env = makeServer();
  const a = await env.login({ id: 1 });
  const b = await env.login({ id: 2 });
  const w = (await env.call('POST', '/workouts', { token: a.token, body: { date: '2026-08-01' } })).body.workout;
  const s = (await env.call('POST', '/workouts/' + w.id + '/sets', {
    token: a.token, body: { exercise: 'squat', set_number: 1, weight: 100, reps: 5 }
  })).body.set;

  assert.equal((await env.call('POST', '/workouts/' + w.id + '/sets', {
    token: b.token, body: { exercise: 'squat', set_number: 1, weight: 1, reps: 1 }
  })).code, 404);
  assert.equal((await env.call('DELETE', '/sets/' + s.id, { token: b.token })).code, 404);
  assert.equal((await env.call('DELETE', '/sets/' + s.id, { token: a.token })).code, 200);
});

test('security: IDOR — чужая группа/соревнование → 404 (не 403, нет перечисления)', async () => {
  const env = makeServer();
  const a = await env.login({ id: 1 });
  const b = await env.login({ id: 2 });
  const g = (await env.call('POST', '/groups', { token: a.token, body: { name: 'Личное' } })).body.group;
  const c = (await env.call('POST', '/groups/' + g.id + '/competitions', {
    token: a.token, body: { name: 'K', type: 'TOTAL', start_at: 1754000000000, end_at: 1755000000000 }
  })).body.competition;

  assert.equal((await env.call('GET', '/groups/' + g.id + '/members', { token: b.token })).code, 404);
  assert.equal((await env.call('GET', '/groups/' + g.id + '/leaderboard', { token: b.token })).code, 404);
  assert.equal((await env.call('GET', '/competitions/' + c.id + '/standings', { token: b.token })).code, 404);
  assert.equal((await env.call('POST', '/groups/' + g.id + '/leave', { token: b.token, body: {} })).code, 404);
});

test('security: XSS в title — экранирование не нужно в API, но раздаём strict JSON', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const payload = '<img src=x onerror=alert(1)>"\'<script>';
  const w = await env.call('POST', '/workouts', { token, body: { date: '2026-08-01', title: payload } });
  assert.equal(w.code, 201);
  /* значение сохранено как данные (JSON-строка), отдаётся с JSON content-type + nosniff */
  assert.equal(w.body.workout.title, payload);
  assert.match(String(w.headers['Content-Type']), /application\/json/);
  assert.equal(w.headers['X-Content-Type-Options'], 'nosniff');
  /* защита = strict JSON content-type + nosniff; экранирование при рендере — на фронтенде */
});

test('security: mass assignment — role/admin в теле не создают полей', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const w = await env.call('POST', '/workouts', {
    token, body: { date: '2026-08-01', role: 'ADMIN', is_admin: true, premium_until: 9999999999999 }
  });
  assert.equal(w.body.workout.role, undefined);
  assert.equal(w.body.workout.is_admin, undefined);
  assert.equal(w.body.workout.premium_until, undefined);
});

test('security: content-type не JSON → 415; битый JSON → 400; >64KB → 413', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const big = { date: '2026-08-01', notes: 'x'.repeat(70 * 1024) };

  assert.equal((await env.call('POST', '/workouts', {
    token, body: big, contentType: 'text/plain'
  })).code, 415);
  assert.equal((await env.call('POST', '/workouts', {
    token, raw: Buffer.from('{not json'), contentType: 'application/json'
  })).code, 400);
  assert.equal((await env.call('POST', '/workouts', {
    token, body: big
  })).code, 413);
});

test('security: rate limit — 11-й /auth в минуту с одного IP → 429', async () => {
  const env = makeServer();
  let last = null;
  for (let i = 0; i < 11; i++) {
    last = await env.call('POST', '/auth/telegram', {
      ip: '10.9.9.9', body: { initData: 'hash=' + 'a'.repeat(64) }
    });
  }
  assert.equal(last.code, 429);
});

test('security: несуществующий маршрут → 404 без стека', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const r = await env.call('GET', '/admin/secret', { token });
  assert.equal(r.code, 404);
  assert.ok(!r.text.includes('at '));       /* никаких stack traces наружу */
});
