/* §44/45/46 (скриптовая эмуляция двух пользователей; живой Telegram в песочнице
 * недоступен — BLOCKED, см. docs/FINAL-AUDIT.md): группы, инвайты, лидерборды
 * S/B/D/Total, соревнование TOTAL CHALLENGE, программа + раскладка. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');

/* Полный сценарий USER A / USER B из §44 */
test('e2e §44: A создаёт группу+инвайт, B вступает, оба видят все 4 лидерборда', async () => {
  const env = makeServer();

  /* --- USER A --- */
  const A = await env.login({ id: 5001, username: 'user_a', first_name: 'UserA' });
  assert.equal((await env.call('GET', '/me', { token: A.token })).code, 200);          /* 2. авторизуется */
  const g = await env.call('POST', '/groups', { token: A.token, body: { name: 'POWERLIFTING FRIENDS' } }); /* 3 */
  assert.equal(g.code, 201);
  const inv = await env.call('POST', '/groups/' + g.body.group.id + '/invite', { token: A.token, body: {} }); /* 4 */
  assert.equal(inv.code, 201);
  /* 5-7: присед/жим/тяга; тренировка через /sync (как реальный фронтенд) */
  const syncA = await env.call('POST', '/sync', {
    token: A.token,
    body: { ops: [{ id: 'a-w1', method: 'POST', path: '/workouts', body: { date: '2026-08-20' } }] }
  });
  assert.equal(syncA.body.results[0].status, 201);
  const wid = syncA.body.results[0].body.workout.id;
  const sq = await env.call('POST', '/workouts/' + wid + '/sets', {
    token: A.token, body: { exercise: 'squat', set_number: 1, weight: 180, reps: 5, successful: true, idempotency_key: 'a-squat' }
  });
  assert.equal(sq.code, 201);
  for (const [ex, w] of [['bench', 130], ['deadlift', 220]]) {
    const r = await env.call('POST', '/workouts/' + wid + '/sets', {
      token: A.token, body: { exercise: ex, set_number: 1, weight: w, reps: 3, successful: true, idempotency_key: 'a-' + ex }
    });
    assert.equal(r.code, 201);
  }

  /* --- USER B: открывает инвайт --- */
  const B = await env.login({ id: 5002, username: 'user_b', first_name: 'UserB' });
  const join = await env.call('POST', '/invites/' + inv.body.code + '/join', { token: B.token, body: {} });
  assert.equal(join.code, 200);                                                        /* 2. вступил */
  const bw = await env.call('POST', '/workouts', { token: B.token, body: { date: '2026-08-21', idempotency_key: 'b-w1' } });
  for (const [ex, w] of [['squat', 160], ['bench', 145], ['deadlift', 230]]) {
    const r = await env.call('POST', '/workouts/' + bw.body.workout.id + '/sets', {
      token: B.token, body: { exercise: ex, set_number: 1, weight: w, reps: 3, successful: true, idempotency_key: 'b-' + ex }
    });
    assert.equal(r.code, 201);
  }

  /* --- ПРОВЕРКА: оба видят одинаковые серверные лидерборды --- */
  const gid = g.body.group.id;
  const boards = {};
  for (const [who, token] of [['A', A.token], ['B', B.token]]) {
    const perMetric = {};
    for (const metric of ['SQUAT', 'BENCH', 'DEADLIFT', 'TOTAL']) {
      const r = await env.call('GET', '/groups/' + gid + '/leaderboard?metric=' + metric, { token });
      assert.equal(r.code, 200);
      perMetric[metric] = r.body.rows.map((x) => x.user.username + ':' + x.value + ':' + x.place);
    }
    boards[who] = perMetric;
  }
  assert.deepEqual(boards.A, boards.B);                       /* данные одинаковы у обоих */
  assert.deepEqual(boards.A.SQUAT, ['user_a:180:1', 'user_b:160:2']);
  assert.deepEqual(boards.A.BENCH, ['user_b:145:1', 'user_a:130:2']);
  assert.deepEqual(boards.A.DEADLIFT, ['user_b:230:1', 'user_a:220:2']);
  assert.deepEqual(boards.A.TOTAL, ['user_b:535:1', 'user_a:530:2']);   /* B: 160+145+230, A: 180+130+220 */

  /* PR изменился → лидерборд обновился у обоих */
  await env.call('POST', '/workouts/' + bw.body.workout.id + '/sets', {
    token: B.token, body: { exercise: 'squat', set_number: 2, weight: 200, reps: 1, successful: true, idempotency_key: 'b-s2' }
  });
  const t2 = (await env.call('GET', '/groups/' + gid + '/leaderboard?metric=TOTAL', { token: A.token })).body.rows;
  assert.equal(t2[0].value, 575);                             /* B: 200+145+230 */
  const t2b = (await env.call('GET', '/groups/' + gid + '/leaderboard?metric=TOTAL', { token: B.token })).body.rows;
  assert.deepEqual(t2, t2b);
});

/* §45: соревнование TOTAL CHALLENGE — создание, участие, результаты, победитель */
test('e2e §45: TOTAL CHALLENGE от создания до победителя', async () => {
  const env = makeServer();
  const A = await env.login({ id: 6001, first_name: 'A' });
  const g = (await env.call('POST', '/groups', { token: A.token, body: { name: 'Лига' } })).body.group;
  const inv = (await env.call('POST', '/groups/' + g.id + '/invite', { token: A.token, body: {} })).body.code;
  const B = await env.login({ id: 6002, first_name: 'B' });
  await env.call('POST', '/invites/' + inv + '/join', { token: B.token, body: {} });

  const start = Date.now() - 86400000, end = Date.now() + 7 * 86400000;
  const comp = (await env.call('POST', '/groups/' + g.id + '/competitions', {
    token: A.token, body: { name: 'TOTAL CHALLENGE', description: 'Кто сильнее за неделю', type: 'TOTAL', start_at: start, end_at: end }
  })).body.competition;
  assert.equal(comp.description, 'Кто сильнее за неделю');

  await env.call('POST', '/competitions/' + comp.id + '/join', { token: A.token, body: {} });
  await env.call('POST', '/competitions/' + comp.id + '/join', { token: B.token, body: {} });
  assert.equal((await env.call('GET', '/competitions/' + comp.id, { token: A.token })).body.participants, 2);

  const today = new Date().toISOString().slice(0, 10);
  const aw = (await env.call('POST', '/workouts', { token: A.token, body: { date: today } })).body.workout;
  const bw = (await env.call('POST', '/workouts', { token: B.token, body: { date: today } })).body.workout;
  for (const [tok, w] of [[A.token, aw], [B.token, bw]]) {
    for (const [ex, kg] of [['squat', 150], ['bench', 110], ['deadlift', 190]]) {
      await env.call('POST', '/workouts/' + w.id + '/sets', { token: tok, body: { exercise: ex, set_number: 1, weight: kg, reps: 3, successful: true } });
    }
  }
  /* A вырывается вперёд */
  await env.call('POST', '/workouts/' + aw.id + '/sets', { token: A.token, body: { exercise: 'deadlift', set_number: 2, weight: 210, reps: 1, successful: true } });

  const standings = (await env.call('GET', '/competitions/' + comp.id + '/standings', { token: B.token })).body.rows;
  assert.equal(standings[0].value, 470);                      /* A: 150+110+210 */
  assert.equal(standings[1].value, 450);

  await env.call('POST', '/competitions/' + comp.id + '/start', { token: A.token, body: {} });
  const fin = await env.call('POST', '/competitions/' + comp.id + '/finish', { token: A.token, body: {} });
  assert.equal(fin.code, 200);
  assert.equal(fin.body.winner, A.user.id);
  assert.equal((await env.call('POST', '/competitions/' + comp.id + '/join', { token: B.token, body: {} })).code, 409);  /* завершено */
});

/* §46: программа Powerlifting Beginner → назначение → раскладка %1ПМ */
test('e2e §46: программа назначена группе, раскладка по 1ПМ', async () => {
  const env = makeServer();
  const A = await env.login({ id: 7001, first_name: 'A' });
  const g = (await env.call('POST', '/groups', { token: A.token, body: { name: 'Клуб новичков' } })).body.group;

  const weeks = [{
    phase: 'Техника', week: 1,
    workouts: [
      { day: 1, exercises: [{ exercise: 'squat', percent: 70, sets: 3, reps: 5 }, { exercise: 'bench', percent: 70, sets: 3, reps: 5 }] },
      { day: 2, exercises: [{ exercise: 'deadlift', percent: 70, sets: 3, reps: 5 }, { exercise: 'bench', percent: 60, sets: 3, reps: 8 }] }
    ]
  }];
  const p = (await env.call('POST', '/programs', {
    token: A.token, body: { name: 'Powerlifting Beginner', level: 'beginner', frequency: 2, weeks }
  })).body.program;
  const asg = await env.call('POST', '/programs/' + p.id + '/assign', { token: A.token, body: { group_id: g.id } });
  assert.equal(asg.code, 201);

  const sched = (await env.call('GET', '/programs/' + p.id + '/schedule?1rm_squat=100&1rm_bench=80&1rm_deadlift=140&step=2.5', { token: A.token })).body;
  assert.equal(sched.weeks[0].workouts[0].exercises[0].weight_kg, 70);    /* 100*0.7 */
  assert.equal(sched.weeks[0].workouts[1].exercises[1].weight_kg, 47.5);  /* 80*0.6=48 → ближ. шаг 2.5 = 47.5 */
});
