/* §40: CRUD тренировок, идемпотентность (double-tap), валидация. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');

test('workouts: create → list → patch → delete', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });

  const c = await env.call('POST', '/workouts', {
    token, body: { date: '2026-08-01', title: 'Ноги', notes: 'тяжело', idempotency_key: 'w1' }
  });
  assert.equal(c.code, 201);
  const id = c.body.workout.id;

  const l = await env.call('GET', '/workouts?from=2026-08-01&to=2026-08-01', { token });
  assert.equal(l.code, 200);
  assert.equal(l.body.workouts.length, 1);
  assert.equal(l.body.workouts[0].title, 'Ноги');

  const p = await env.call('PATCH', '/workouts/' + id, { token, body: { title: 'Присед', notes: '' } });
  assert.equal(p.code, 200);
  assert.equal(p.body.workout.title, 'Присед');

  const d = await env.call('DELETE', '/workouts/' + id, { token });
  assert.equal(d.code, 200);
  assert.equal((await env.call('GET', '/workouts', { token })).body.workouts.length, 0);
});

test('workouts: повторный POST с тем же idempotency_key → тот же id (double-tap)', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const a = await env.call('POST', '/workouts', { token, body: { date: '2026-08-02', idempotency_key: 'tap' } });
  const b = await env.call('POST', '/workouts', { token, body: { date: '2026-08-02', idempotency_key: 'tap' } });
  assert.equal(a.code, 201);
  assert.equal(b.code, 201);
  assert.equal(a.body.workout.id, b.body.workout.id);
  assert.equal((await env.call('GET', '/workouts', { token })).body.workouts.length, 1);
});

test('workouts: разные ключи → разные тренировки', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const a = await env.call('POST', '/workouts', { token, body: { date: '2026-08-02', idempotency_key: 'k1' } });
  const b = await env.call('POST', '/workouts', { token, body: { date: '2026-08-03', idempotency_key: 'k2' } });
  assert.notEqual(a.body.workout.id, b.body.workout.id);
});

test('workouts: невалидная дата → 400', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const r = await env.call('POST', '/workouts', { token, body: { date: '01-08-2026' } });
  assert.equal(r.code, 400);
  const r2 = await env.call('POST', '/workouts', { token, body: { date: '2026-13-45' } });
  assert.equal(r2.code, 400);
});

test('sets: добавление в свою тренировку, валидация полей', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const w = (await env.call('POST', '/workouts', { token, body: { date: '2026-08-04' } })).body.workout;

  const s = await env.call('POST', '/workouts/' + w.id + '/sets', {
    token, body: { exercise: 'squat', set_number: 1, weight: 100.5, reps: 5, successful: true, idempotency_key: 's1' }
  });
  assert.equal(s.code, 201);
  assert.equal(s.body.set.weight, 100.5);

  const bad = await env.call('POST', '/workouts/' + w.id + '/sets', {
    token, body: { exercise: 'curl', set_number: 1, weight: 10, reps: 5 }
  });
  assert.equal(bad.code, 400);
  const bad2 = await env.call('POST', '/workouts/' + w.id + '/sets', {
    token, body: { exercise: 'bench', set_number: 1, weight: -5, reps: 5 }
  });
  assert.equal(bad2.code, 400);
});

test('workouts: масс-назначение — user_id из тела игнорируется', async () => {
  const env = makeServer();
  const { token, user } = await env.login({ id: 1 });
  const w = await env.call('POST', '/workouts', {
    token, body: { date: '2026-08-05', user_id: 'someone-else', role: 'ADMIN' }
  });
  assert.equal(w.code, 201);
  assert.equal(w.body.workout.user_id, user.id);
  assert.equal(w.body.workout.role, undefined);
});
