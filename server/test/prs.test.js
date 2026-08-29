/* §40: PR и Total считаются из истории на сервере; удаление → пересчёт. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');

async function addSet(env, token, date, exercise, weight, ok, key) {
  const w = await env.call('POST', '/workouts', { token, body: { date, idempotency_key: 'w' + key } });
  return env.call('POST', '/workouts/' + w.body.workout.id + '/sets', {
    token, body: { exercise, set_number: 1, weight, reps: 1, successful: ok !== false, idempotency_key: 's' + key }
  });
}

test('PR: новый максимум заменяет старый', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  await addSet(env, token, '2026-07-01', 'squat', 100, true, 'a');
  await addSet(env, token, '2026-07-10', 'squat', 110, true, 'b');
  await addSet(env, token, '2026-07-20', 'squat', 105, true, 'c');   /* не PR */

  const prs = await env.call('GET', '/prs', { token });
  assert.equal(prs.body.prs.squat.value, 110);
});

test('PR: неудачный подход не учитывается', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  await addSet(env, token, '2026-07-01', 'bench', 90, true, 'a');
  await addSet(env, token, '2026-07-02', 'bench', 200, false, 'b');  /* fail */

  const prs = await env.call('GET', '/prs', { token });
  assert.equal(prs.body.prs.bench.value, 90);
});

test('PR: удаление подхода → пересчёт вниз', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const s1 = await addSet(env, token, '2026-07-01', 'deadlift', 180, true, 'a');
  await addSet(env, token, '2026-07-05', 'deadlift', 200, true, 'b');
  assert.equal((await env.call('GET', '/prs', { token })).body.prs.deadlift.value, 200);

  const list = await env.call('GET', '/workouts', { token });
  const w200 = list.body.workouts.find((x) => x.date === '2026-07-05');
  const del = await env.call('DELETE', '/workouts/' + w200.id, { token });
  assert.equal(del.code, 200);
  const after = await env.call('GET', '/prs', { token });
  assert.equal(after.body.prs.deadlift.value, 180);       /* вернулись к предыдущему PR */
  assert.equal(after.body.prs.deadlift.set_id, s1.body.set.id);  /* именно тот старый подход */
});

test('Total = присед + жим + тяга, только успешные; без одного — null', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  await addSet(env, token, '2026-07-01', 'squat', 140, true, 'a');
  await addSet(env, token, '2026-07-01', 'bench', 100, true, 'b');
  const t0 = await env.call('GET', '/total', { token });
  assert.equal(t0.body.total, null);                      /* тяги нет */

  await addSet(env, token, '2026-07-02', 'deadlift', 180, true, 'c');
  await addSet(env, token, '2026-07-02', 'bench', 90, true, 'd');   /* не PR */
  const t1 = await env.call('GET', '/total', { token });
  assert.equal(t1.body.total, 140 + 100 + 180);
  assert.equal(t1.body.parts.bench.value, 100);           /* максимум, не последняя */
});

test('Total: без дублей — одна и та же тренировка не считается дважды', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  await addSet(env, token, '2026-07-01', 'squat', 100, true, 'a');
  await addSet(env, token, '2026-07-01', 'bench', 80, true, 'b');
  await addSet(env, token, '2026-07-01', 'deadlift', 120, true, 'c');
  /* двойной клик по «сохранить» с одним ключом → один набор */
  await env.call('POST', '/workouts', { token, body: { date: '2026-07-02', idempotency_key: 'dup' } });
  const dup = await env.call('POST', '/workouts', { token, body: { date: '2026-07-02', idempotency_key: 'dup' } });
  assert.equal(dup.code, 201);
  const t = await env.call('GET', '/total', { token });
  assert.equal(t.body.total, 300);
  assert.equal((await env.call('GET', '/workouts', { token })).body.workouts.length, 4); /* 3 seed + 1 dup */
});
