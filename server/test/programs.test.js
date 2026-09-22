/* §40: программы — создание, назначение группе, раскладка %1ПМ с округлением. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');

const WEEKS = [{
  phase: 'Объём', week: 1,
  workouts: [
    { day: 1, exercises: [{ exercise: 'squat', percent: 80, sets: 4, reps: 5 }, { exercise: 'bench', percent: 70, sets: 3, reps: 5 }] },
    { day: 2, exercises: [{ exercise: 'deadlift', percent: 75, sets: 3, reps: 5 }] }
  ]
}];

test('programs: валидация при создании', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const ok = await env.call('POST', '/programs', {
    token, body: { name: 'База', level: 'beginner', frequency: 3, weeks: WEEKS }
  });
  assert.equal(ok.code, 201);
  assert.equal(ok.body.program.weeks.length, 1);

  assert.equal((await env.call('POST', '/programs', {
    token, body: { name: 'X', level: 'pro', frequency: 3, weeks: WEEKS }
  })).code, 400);
  assert.equal((await env.call('POST', '/programs', {
    token, body: { name: 'X', level: 'beginner', frequency: 7, weeks: WEEKS }
  })).code, 400);
  assert.equal((await env.call('POST', '/programs', {
    token, body: { name: 'X', level: 'beginner', frequency: 3, weeks: [] }
  })).code, 400);
});

test('programs: назначение группе — владелец программы + админ группы', async () => {
  const env = makeServer();
  const owner = await env.login({ id: 1 });
  const p = (await env.call('POST', '/programs', {
    token: owner.token, body: { name: 'База', level: 'beginner', frequency: 3, weeks: WEEKS }
  })).body.program;
  const g = (await env.call('POST', '/groups', { token: owner.token, body: { name: 'Клуб' } })).body.group;
  const inv = await env.call('POST', '/groups/' + g.id + '/invite', { token: owner.token, body: {} });
  const m = await env.login({ id: 2 });
  await env.call('POST', '/invites/' + inv.body.code + '/join', { token: m.token, body: {} });

  const a = await env.call('POST', '/programs/' + p.id + '/assign', { token: m.token, body: { group_id: g.id } });
  assert.equal(a.code, 404);
  const b = await env.call('POST', '/programs/' + p.id + '/assign', { token: owner.token, body: { group_id: g.id } });
  assert.equal(b.code, 201);
});

test('programs: schedule — % от 1ПМ, округление к шагу 2.5', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const p = (await env.call('POST', '/programs', {
    token, body: { name: 'База', level: 'beginner', frequency: 3, weeks: WEEKS }
  })).body.program;

  const s = await env.call('GET', '/programs/' + p.id + '/schedule?1rm_squat=103&1rm_bench=70&1rm_deadlift=140&step=2.5', { token });
  assert.equal(s.code, 200);
  const day1 = s.body.weeks[0].workouts[0].exercises;
  /* 103*0.8=82.4 → кратно 2.5 → 82.5;  70*0.7=49 → 50;  140*0.75=105 */
  assert.equal(day1[0].weight_kg, 82.5);
  assert.equal(day1[1].weight_kg, 50);
  assert.equal(s.body.weeks[0].workouts[1].exercises[0].weight_kg, 105);
  assert.equal(s.body.step, 2.5);

  assert.equal((await env.call('GET', '/programs/' + p.id + '/schedule', { token })).code, 400);
});
