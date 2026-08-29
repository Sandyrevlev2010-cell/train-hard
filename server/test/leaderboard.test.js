/* §40: серверный лидерборд — сортировка, тай-брейк «раньше — выше», одинаковые места, обновление. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer, seedSet } = require('./helpers');

/* Группа из 3 пользователей с сидированной историей (created_at контролируем). */
async function seededBoard(env, metric) {
  const owner = await env.login({ id: 100 });
  const g = await env.call('POST', '/groups', { token: owner.token, body: { name: 'Клуб' } });
  const gid = g.body.group.id;
  const uids = [owner.user.id];
  for (const tg of [201, 202]) {
    const inv = await env.call('POST', '/groups/' + gid + '/invite', { token: owner.token, body: {} });
    const u = await env.login({ id: tg });
    await env.call('POST', '/invites/' + inv.body.code + '/join', { token: u.token, body: {} });
    uids.push(u.user.id);
  }
  const t0 = 1750000000000;
  /* A (owner): S150 B100 D200 = 450, достигнуто раньше */
  seedSet(env.store, uids[0], '2026-06-01', 'squat', 150, t0, { user_id: uids[0] });
  seedSet(env.store, uids[0], '2026-06-01', 'bench', 100, t0, { user_id: uids[0] });
  seedSet(env.store, uids[0], '2026-06-01', 'deadlift', 200, t0, { user_id: uids[0] });
  /* B: S140 B120 D190 = 450, достигнуто позже */
  seedSet(env.store, uids[1], '2026-06-05', 'squat', 140, t0 + 86400000, { user_id: uids[1] });
  seedSet(env.store, uids[1], '2026-06-05', 'bench', 120, t0 + 86400000, { user_id: uids[1] });
  seedSet(env.store, uids[1], '2026-06-05', 'deadlift', 190, t0 + 86400000, { user_id: uids[1] });
  /* C: только жим */
  seedSet(env.store, uids[2], '2026-06-03', 'bench', 130, t0 + 2 * 86400000, { user_id: uids[2] });
  const r = await env.call('GET', '/groups/' + gid + '/leaderboard' + (metric ? '?metric=' + metric : ''), { token: owner.token });
  return { r, uids, gid };
}

test('leaderboard: равный тотал — раньше достигнувший выше', async () => {
  const { r, uids } = await seededBoard(makeServer(), null);
  assert.equal(r.code, 200);
  const rows = r.body.rows;
  assert.equal(rows.length, 2);                       /* C без тотала */
  assert.equal(rows[0].user_id, uids[0]);             /* A раньше */
  assert.equal(rows[0].value, 450);
  assert.equal(rows[0].place, 1);
  assert.equal(rows[1].place, 2);
});

test('leaderboard: metric=BENCH — одиночное упражнение', async () => {
  const { r, uids } = await seededBoard(makeServer(), 'BENCH');
  const vals = r.body.rows.map((x) => x.value);
  assert.deepEqual(vals, [130, 120, 100]);            /* C 130, B 120, A 100 */
  assert.equal(r.body.rows[0].user_id, uids[2]);
});

test('leaderboard: новое достижение меняет таблицу', async () => {
  const env = makeServer();
  const owner = await env.login({ id: 100 });
  const g = await env.call('POST', '/groups', { token: owner.token, body: { name: 'Клуб' } });
  const gid = g.body.group.id;
  const inv = await env.call('POST', '/groups/' + gid + '/invite', { token: owner.token, body: {} });
  const u = await env.login({ id: 201 });
  await env.call('POST', '/invites/' + inv.body.code + '/join', { token: u.token, body: {} });

  const t0 = 1750000000000;
  seedSet(env.store, owner.user.id, '2026-06-01', 'squat', 100, t0, { user_id: owner.user.id });
  seedSet(env.store, u.user.id, '2026-06-02', 'squat', 110, t0 + 3600000, { user_id: u.user.id });
  let rows = (await env.call('GET', '/groups/' + gid + '/leaderboard?metric=SQUAT', { token: owner.token })).body.rows;
  assert.equal(rows[0].user_id, u.user.id);

  seedSet(env.store, owner.user.id, '2026-06-10', 'squat', 120, t0 + 2 * 86400000, { user_id: owner.user.id });
  rows = (await env.call('GET', '/groups/' + gid + '/leaderboard?metric=SQUAT', { token: owner.token })).body.rows;
  assert.equal(rows[0].user_id, owner.user.id);
  assert.equal(rows[0].value, 120);
});

test('leaderboard: равные значение и время → одинаковое место (1,1,3)', async () => {
  const env = makeServer();
  const owner = await env.login({ id: 100 });
  const g = await env.call('POST', '/groups', { token: owner.token, body: { name: 'Клуб' } });
  const gid = g.body.group.id;
  const uids = [owner.user.id];
  for (const tg of [201, 202]) {
    const inv = await env.call('POST', '/groups/' + gid + '/invite', { token: owner.token, body: {} });
    const u = await env.login({ id: tg });
    await env.call('POST', '/invites/' + inv.body.code + '/join', { token: u.token, body: {} });
    uids.push(u.user.id);
  }
  const t0 = 1750000000000;
  seedSet(env.store, uids[0], '2026-06-01', 'squat', 100, t0, { user_id: uids[0] });
  seedSet(env.store, uids[1], '2026-06-01', 'squat', 100, t0, { user_id: uids[1] });
  seedSet(env.store, uids[2], '2026-06-01', 'squat', 90, t0, { user_id: uids[2] });

  const rows = (await env.call('GET', '/groups/' + gid + '/leaderboard?metric=SQUAT', { token: owner.token })).body.rows;
  assert.deepEqual(rows.map((x) => x.place), [1, 1, 3]);
});

test('leaderboard: фильтр по подгруппе', async () => {
  const env = makeServer();
  const owner = await env.login({ id: 100 });
  const g = await env.call('POST', '/groups', { token: owner.token, body: { name: 'Клуб' } });
  const gid = g.body.group.id;
  const sg = await env.call('POST', '/groups/' + gid + '/subgroups', { token: owner.token, body: { name: 'Мастера' } });

  const inv = await env.call('POST', '/groups/' + gid + '/invite', { token: owner.token, body: {} });
  const u = await env.login({ id: 201 });
  await env.call('POST', '/invites/' + inv.body.code + '/join', { token: u.token, body: {} });
  await env.call('POST', '/subgroups/' + sg.body.subgroup.id + '/join', { token: owner.token, body: {} });
  /* владелец вступил в подгруппу, u — нет */

  const t0 = 1750000000000;
  seedSet(env.store, owner.user.id, '2026-06-01', 'squat', 80, t0, { user_id: owner.user.id });
  seedSet(env.store, u.user.id, '2026-06-01', 'squat', 200, t0, { user_id: u.user.id });

  const rows = (await env.call('GET', '/groups/' + gid + '/leaderboard?metric=SQUAT&subgroup_id=' + sg.body.subgroup.id, { token: owner.token })).body.rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, owner.user.id);
});
