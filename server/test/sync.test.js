/* §40: синхронизация — очередь офлайн-операций, идемпотентность по op.id. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');

test('sync: очередь создаёт тренировку и подходы, возвращает статусы', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const r = await env.call('POST', '/sync', {
    token,
    body: {
      ops: [
        { id: 'op1', method: 'POST', path: '/workouts', body: { date: '2026-08-10', title: 'Из очереди' } },
        { id: 'op2', method: 'PATCH', path: '/workouts/nonexistent', body: {} },   /* нет такой → 404 */
      ]
    }
  });
  /* op2 с несуществующим id → 404 в результате, но очередь не падает */
  assert.equal(r.code, 200);
  const res = r.body.results;
  assert.equal(res[0].status, 201);
  assert.equal(res[0].body.workout.title, 'Из очереди');
  assert.equal(res[1].status, 404);
});

test('sync: полный цикл create→add set→delete set, повтор очереди не дублирует', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const ops = [
    { id: 'a', method: 'POST', path: '/workouts', body: { date: '2026-08-11' } },
  ];
  const first = await env.call('POST', '/sync', { token, body: { ops } });
  const wid = first.body.results[0].body.workout.id;

  const ops2 = [
    { id: 'a', method: 'POST', path: '/workouts', body: { date: '2026-08-11' } },          /* повтор */
    { id: 'b', method: 'POST', path: '/workouts/' + wid + '/sets', body: { exercise: 'bench', set_number: 1, weight: 60, reps: 5, successful: true } },
    { id: 'c', method: 'DELETE', path: '/sets/__NOPE__' },
  ];
  ops2[2].path = '/sets/unknown';
  const second = await env.call('POST', '/sync', { token, body: { ops: ops2 } });

  assert.equal(second.body.results[0].body.workout.id, wid);       /* идемпотентно */
  assert.equal(second.body.results[1].status, 201);
  assert.equal(second.body.results[2].status, 404);

  const ws = await env.call('GET', '/workouts', { token });
  assert.equal(ws.body.workouts.length, 1);                        /* дублей нет */
  const prs = await env.call('GET', '/prs', { token });
  assert.equal(prs.body.prs.bench.value, 60);
});

test('sync: неподдерживаемая операция → 400 в результате; >100 ops → 400', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const r = await env.call('POST', '/sync', {
    token, body: { ops: [{ id: 'x', method: 'GET', path: '/prs' }] }
  });
  assert.equal(r.body.results[0].status, 400);

  const big = Array.from({ length: 101 }, (_, i) => ({ id: 'o' + i, method: 'GET', path: '/x' }));
  assert.equal((await env.call('POST', '/sync', { token, body: { ops: big } })).code, 400);
});
