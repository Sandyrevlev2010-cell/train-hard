/* §40: группы — создание, инвайты, вступление, роли, выход, права. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeServer } = require('./helpers');

async function setupGroup(env, ownerId) {
  const owner = await env.login({ id: ownerId });
  const g = await env.call('POST', '/groups', { token: owner.token, body: { name: 'Качалка' } });
  return { owner, group: g.body.group };
}

test('groups: создание, короткое имя → 400', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 1 });
  const g = await env.call('POST', '/groups', { token, body: { name: 'Качалка' } });
  assert.equal(g.code, 201);
  assert.equal(g.body.group.name, 'Качалка');
  assert.equal((await env.call('POST', '/groups', { token, body: { name: 'A' } })).code, 400);
});

test('groups: инвайт → вступление по коду → повторное вступление 409', async () => {
  const env = makeServer();
  const { owner, group } = await setupGroup(env, 1);
  const inv = await env.call('POST', '/groups/' + group.id + '/invite', { token: owner.token, body: {} });
  assert.equal(inv.code, 201);
  assert.match(inv.body.code, /^[a-f0-9]{16}$/);      /* код без персональных данных */

  const guest = await env.login({ id: 2 });
  const join = await env.call('POST', '/invites/' + inv.body.code + '/join', { token: guest.token, body: {} });
  assert.equal(join.code, 200);

  const again = await env.call('POST', '/invites/' + inv.body.code + '/join', { token: guest.token, body: {} });
  assert.equal(again.code, 409);                     /* уже участник */
});

test('groups: несуществующий/просроченный/использованный код → 404', async () => {
  const env = makeServer();
  const { token } = await env.login({ id: 9 });
  assert.equal((await env.call('POST', '/invites/deadbeef/join', { token, body: {} })).code, 404);

  const { owner, group } = await setupGroup(env, 1);
  const inv = await env.call('POST', '/groups/' + group.id + '/invite', { token: owner.token, body: {} });
  /* имитируем просрочку напрямую в сторе */
  const st = env.store.getInvite(inv.body.code);
  st.expires_at = Date.now() - 1000;
  const guest = await env.login({ id: 3 });
  assert.equal((await env.call('POST', '/invites/' + inv.body.code + '/join', { token: guest.token, body: {} })).code, 404);
});

test('groups: инвайт одноразовый — второй пользователь по тому же коду → 404', async () => {
  const env = makeServer();
  const { owner, group } = await setupGroup(env, 1);
  const inv = await env.call('POST', '/groups/' + group.id + '/invite', { token: owner.token, body: {} });
  const g1 = await env.login({ id: 2 });
  const g2 = await env.login({ id: 3 });
  assert.equal((await env.call('POST', '/invites/' + inv.body.code + '/join', { token: g1.token, body: {} })).code, 200);
  assert.equal((await env.call('POST', '/invites/' + inv.body.code + '/join', { token: g2.token, body: {} })).code, 404);
});

test('groups: выход участника; владелец не может выйти', async () => {
  const env = makeServer();
  const { owner, group } = await setupGroup(env, 1);
  const inv = await env.call('POST', '/groups/' + group.id + '/invite', { token: owner.token, body: {} });
  const guest = await env.login({ id: 2 });
  await env.call('POST', '/invites/' + inv.body.code + '/join', { token: guest.token, body: {} });

  assert.equal((await env.call('POST', '/groups/' + group.id + '/leave', { token: guest.token, body: {} })).code, 200);
  assert.equal((await env.call('POST', '/groups/' + group.id + '/leave', { token: owner.token, body: {} })).code, 400);
});

test('groups: смена ролей — только владелец; OWNER нельзя менять', async () => {
  const env = makeServer();
  const { owner, group } = await setupGroup(env, 1);
  const inv = await env.call('POST', '/groups/' + group.id + '/invite', { token: owner.token, body: {} });
  const guest = await env.login({ id: 2 });
  await env.call('POST', '/invites/' + inv.body.code + '/join', { token: guest.token, body: {} });

  const members = await env.call('GET', '/groups/' + group.id + '/members', { token: owner.token });
  assert.equal(members.body.members.length, 2);
  const gid = members.body.members.find((m) => m.user_id === guest.user.id).user_id;

  const up = await env.call('POST', '/groups/' + group.id + '/members/' + gid + '/role', {
    token: owner.token, body: { role: 'ADMIN' }
  });
  assert.equal(up.code, 200);
  const nope = await env.call('POST', '/groups/' + group.id + '/members/' + gid + '/role', {
    token: guest.token, body: { role: 'MEMBER' }            /* админ не владелец */
  });
  assert.equal(nope.code, 403);
  const ownerRole = await env.call('POST', '/groups/' + group.id + '/members/' + owner.user.id + '/role', {
    token: owner.token, body: { role: 'MEMBER' }
  });
  assert.equal(ownerRole.code, 400);
});

test('groups: обычный участник не может создать инвайт (403)', async () => {
  const env = makeServer();
  const { owner, group } = await setupGroup(env, 1);
  const inv = await env.call('POST', '/groups/' + group.id + '/invite', { token: owner.token, body: {} });
  const guest = await env.login({ id: 2 });
  await env.call('POST', '/invites/' + inv.body.code + '/join', { token: guest.token, body: {} });
  const r = await env.call('POST', '/groups/' + group.id + '/invite', { token: guest.token, body: {} });
  assert.equal(r.code, 403);
});

test('groups: подгруппы — создание, многократное членство', async () => {
  const env = makeServer();
  const { owner, group } = await setupGroup(env, 1);
  const a = await env.call('POST', '/groups/' + group.id + '/subgroups', { token: owner.token, body: { name: 'Утро' } });
  const b = await env.call('POST', '/groups/' + group.id + '/subgroups', { token: owner.token, body: { name: 'Вечер' } });
  assert.equal(a.code, 201); assert.equal(b.code, 201);

  const inv = await env.call('POST', '/groups/' + group.id + '/invite', { token: owner.token, body: {} });
  const guest = await env.login({ id: 2 });
  await env.call('POST', '/invites/' + inv.body.code + '/join', { token: guest.token, body: {} });

  assert.equal((await env.call('POST', '/subgroups/' + a.body.subgroup.id + '/join', { token: guest.token, body: {} })).code, 200);
  assert.equal((await env.call('POST', '/subgroups/' + b.body.subgroup.id + '/join', { token: guest.token, body: {} })).code, 200);
  const list = await env.call('GET', '/groups/' + group.id + '/subgroups', { token: guest.token });
  assert.equal(list.body.subgroups.length, 2);
});

test('groups: удаление группы — только владелец', async () => {
  const env = makeServer();
  const { owner, group } = await setupGroup(env, 1);
  const inv = await env.call('POST', '/groups/' + group.id + '/invite', { token: owner.token, body: {} });
  const guest = await env.login({ id: 2 });
  await env.call('POST', '/invites/' + inv.body.code + '/join', { token: guest.token, body: {} });

  assert.equal((await env.call('DELETE', '/groups/' + group.id, { token: guest.token })).code, 403);
  assert.equal((await env.call('DELETE', '/groups/' + group.id, { token: owner.token })).code, 200);
});
