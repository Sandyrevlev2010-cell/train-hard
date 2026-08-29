/* Хелперы бэкенд-тестов: in-process вызовы API без сети. */
'use strict';
const { createApp } = require('../src/api');
const { MemoryStore } = require('../src/store');
const { signInitData } = require('../src/telegram');

const BOT_TOKEN = '7' + '0'.repeat(45);   /* фейковый, только формат */

function makeServer(opts) {
  const o = opts || {};
  const store = o.store || new MemoryStore();
  const ton = 'ton' in o ? o.ton : {
    address: 'UQTEST', amountNano: 1000000000, periodDays: 30, fetch: null
  };
  const handler = createApp({ store, botToken: o.botToken || BOT_TOKEN, ton });

  /* req/res заглушки поверх handler(req,res) */
  async function call(method, url, q) {
    const oq = q || {};
    const payload = oq.raw !== undefined ? oq.raw
      : oq.body !== undefined ? Buffer.from(JSON.stringify(oq.body)) : null;
    const ip = oq.ip || ('10.1.' + (1 + Math.floor(Math.random() * 250)) + '.7');
    const headers = { 'x-forwarded-for': ip };
    if (oq.token) headers.authorization = 'Bearer ' + oq.token;
    if (payload) headers['content-type'] = oq.contentType || 'application/json';
    Object.assign(headers, oq.headers || {});
    const req = {
      method, url, headers, socket: { remoteAddress: ip },
      on(evt, cb) {
        if (evt === 'data' && payload) cb(payload);
        if (evt === 'end') cb();
      },
      destroy() {}
    };
    const out = { code: 0, body: '', headers: {} };
    const res = {
      writeHead(code, h) { out.code = code; out.headers = h || {}; },
      end(b) { out.body = b === undefined ? '' : b; },
      setHeader() {}
    };
    await handler(req, res);
    let body = null;
    try { body = JSON.parse(out.body); } catch (e) {}
    return { code: out.code, body, text: String(out.body), headers: out.headers };
  }

  /* Успешный вход Telegram-пользователем → {token, user} */
  async function login(tu) {
    const u = Object.assign({ id: 1, first_name: 'T' }, tu);
    const initData = signInitData({
      user: JSON.stringify(u),
      auth_date: String(Math.floor(Date.now() / 1000))
    }, o.botToken || BOT_TOKEN);
    const r = await call('POST', '/auth/telegram', { body: { initData } });
    if (r.code !== 200) throw new Error('login failed: ' + r.text);
    return { token: r.body.token, user: r.body.user, call, login };
  }

  return { store, handler, call, login, botToken: o.botToken || BOT_TOKEN };
}

/* Быстрая запись тренировки через API: {token, body.workout} */
async function makeWorkout(env, token, date, key) {
  return env.call('POST', '/workouts', { token, body: { date, idempotency_key: key } });
}

/* Сид напрямую в стор с контролем времени (для лидербордов/соревнований). */
function seedSet(store, uid, date, exercise, weight, created_at, extra) {
  const w = store.createWorkout({ user_id: uid, date, title: 'seed' });
  return store.createSet(Object.assign({
    workout_id: w.id, exercise, set_number: 1, weight, reps: 1,
    successful: true, created_at
  }, extra || {}));
}

module.exports = { makeServer, loginHelper: null, makeWorkout, seedSet, BOT_TOKEN };
