/* §40: соревнования — жизненный цикл, окна, права. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer, seedSet } = require('./helpers');

async function setup(env) {
  const owner = await env.login({ id: 1 });
  const g = await env.call('POST', '/groups', { token: owner.token, body: { name: 'Лига' } });
  const gid = g.body.group.id;
  const inv = await env.call('POST', '/groups/' + gid + '/invite', { token: owner.token, body: {} });
  const member = await env.login({ id: 2 });
  await env.call('POST', '/invites/' + inv.body.code + '/join', { token: member.token, body: {} });
  const outsider = await env.login({ id: 3 });
  return { owner, member, outsider, gid };
}

const START = Date.now() - 5 * 86400000;
const END = Date.now() + 5 * 86400000;
/* дата YYYY-MM-DD со смещением в днях от сегодня (окно соревнования = ±5 дней) */
const d = (off) => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);

test('competitions: валидация при создании (тип, даты)', async () => {
  const env = makeServer();
  const { owner, gid } = await setup(env);
  const ok = await env.call('POST', '/groups/' + gid + '/competitions', {
    token: owner.token, body: { name: 'Кубок', type: 'TOTAL', start_at: START, end_at: END }
  });
  assert.equal(ok.code, 201);
  assert.equal(ok.body.competition.status, 'UPCOMING');

  assert.equal((await env.call('POST', '/groups/' + gid + '/competitions', {
    token: owner.token, body: { name: 'X', type: 'SNATCH', start_at: START, end_at: END }
  })).code, 400);
  assert.equal((await env.call('POST', '/groups/' + gid + '/competitions', {
    token: owner.token, body: { name: 'X', type: 'TOTAL', start_at: END, end_at: START }
  })).code, 400);
});

test('competitions: жизненный цикл UPCOMING → ACTIVE → FINISHED, повторный finish 409', async () => {
  const env = makeServer();
  const { owner, gid } = await setup(env);
  const c = (await env.call('POST', '/groups/' + gid + '/competitions', {
    token: owner.token, body: { name: 'Кубок', type: 'SQUAT', start_at: START, end_at: END }
  })).body.competition;

  assert.equal((await env.call('POST', '/competitions/' + c.id + '/start', { token: owner.token, body: {} })).body.competition.status, 'ACTIVE');
  const fin = await env.call('POST', '/competitions/' + c.id + '/finish', { token: owner.token, body: {} });
  assert.equal(fin.code, 200);
  assert.equal((await env.call('POST', '/competitions/' + c.id + '/finish', { token: owner.token, body: {} })).code, 409);
});

test('competitions: standings — учитываются только подходы в окне', async () => {
  const env = makeServer();
  const { owner, member, gid } = await setup(env);
  const c = (await env.call('POST', '/groups/' + gid + '/competitions', {
    token: owner.token, body: { name: 'Кубок', type: 'SQUAT', start_at: START, end_at: END }
  })).body.competition;

  /* до окна: 300 (не считается), в окне: 150 */
  seedSet(env.store, owner.user.id, d(-20), 'squat', 300, START - 10 * 86400000, { user_id: owner.user.id });
  seedSet(env.store, owner.user.id, d(-1), 'squat', 150, START + 86400000, { user_id: owner.user.id });
  /* у соперника в окне 200 */
  seedSet(env.store, member.user.id, d(-2), 'squat', 200, START + 2 * 86400000, { user_id: member.user.id });

  const st = await env.call('GET', '/competitions/' + c.id + '/standings', { token: owner.token });
  assert.equal(st.code, 200);
  assert.deepEqual(st.body.rows.map((x) => x.value), [200, 150]);
});

test('competitions: PR_PROGRESS — прирост тотала относительно базы', async () => {
  const env = makeServer();
  const { owner, member, gid } = await setup(env);
  const c = (await env.call('POST', '/groups/' + gid + '/competitions', {
    token: owner.token, body: { name: 'Прогресс', type: 'PR_PROGRESS', start_at: START, end_at: END }
  })).body.competition;

  /* owner: база 400 → в окне 450 → прирост 50; member: базы нет, в окне 300 → прирост 300 */
  const t = START - 10 * 86400000;
  for (const [ex, w] of [['squat', 140], ['bench', 100], ['deadlift', 160]]) {
    seedSet(env.store, owner.user.id, d(-20), ex, w, t, { user_id: owner.user.id });
  }
  for (const [ex, w] of [['squat', 150], ['bench', 100], ['deadlift', 200]]) {
    seedSet(env.store, owner.user.id, d(-1), ex, w, START + 86400000, { user_id: owner.user.id });
  }
  for (const [ex, w] of [['squat', 100], ['bench', 80], ['deadlift', 120]]) {
    seedSet(env.store, member.user.id, d(-2), ex, w, START + 2 * 86400000, { user_id: member.user.id });
  }

  const rows = (await env.call('GET', '/competitions/' + c.id + '/standings', { token: owner.token })).body.rows;
  const byId = Object.fromEntries(rows.map((x) => [x.user_id, x.value]));
  assert.equal(byId[owner.user.id], 50);
  assert.equal(byId[member.user.id], 300);
});

test('competitions: права — участник не админ, чужой → 404', async () => {
  const env = makeServer();
  const { owner, member, outsider, gid } = await setup(env);
  const c = (await env.call('POST', '/groups/' + gid + '/competitions', {
    token: owner.token, body: { name: 'Кубок', type: 'TOTAL', start_at: START, end_at: END }
  })).body.competition;

  assert.equal((await env.call('POST', '/competitions/' + c.id + '/start', { token: member.token, body: {} })).code, 403);
  assert.equal((await env.call('POST', '/competitions/' + c.id + '/start', { token: outsider.token, body: {} })).code, 404);
  assert.equal((await env.call('GET', '/competitions/' + c.id + '/standings', { token: outsider.token })).code, 404);
  assert.equal((await env.call('POST', '/groups/' + gid + '/competitions', {
    token: member.token, body: { name: 'X', type: 'TOTAL', start_at: START, end_at: END }
  })).code, 403);
});
