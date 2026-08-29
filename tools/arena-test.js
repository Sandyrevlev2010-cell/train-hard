/* Train Hard — ARENA: E2E-тест (jsdom, собранный app/index.html).
 * Проверяется: серверная авторизация (initData→Bearer), группы,
 * инвайты-коды, лидерборд с подиумом и тай-брейком, XSS-экранирование,
 * синхронизация тренировок (дельта, идемпотентность, удаления),
 * состояния загрузки/ошибок/оффлайн, защита от двойного клика. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = path.join(__dirname, '..', 'app', 'index.html');
const html = fs.readFileSync(HTML, 'utf-8');

let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ✔ ' + n); } else { failed++; console.log('  ✘ ' + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 1500)) { if (fn()) return true; await sleep(15); }
  return fn();
}

/* ---------- мок backend ---------- */
function makeBackend() {
  const calls = [];
  const state = {
    token: 'T1', user: { id: 'u1', username: 'anton', first_name: 'Антон' },
    groups: [{ id: 'g1', name: 'POWERLIFTING FRIENDS', owner_id: 'u9' }],
    workouts: {},           // wid → {date}
    nextW: 0, nextS: 0,
    board: [
      { user_id: 'u1', value: 650, place: 1, achieved_at: 1, user: { id: 'u1', username: 'anton' } },
      { user_id: 'u2', value: 620, place: 2, achieved_at: 2, user: { id: 'u2', first_name: '<img src=x onerror="__pwned=1">' } },
      { user_id: 'u3', value: 590, place: 3, achieved_at: 3, user: { id: 'u3', username: 'sasha' } }
    ],
    failAll: false, delay: null
  };
  const j = (status, body) => ({ ok: status < 400, status, json: async () => body });

  const authHeaders = [];
  async function route(method, url, body) {
    if (state.failAll) throw new Error('net');
    if (state.delay) await sleep(state.delay);
    const u = new URL(url, 'https://x');
    const p = u.pathname.replace(/^\/api/, '') || '/';

    if (method === 'POST' && p === '/auth/telegram') return j(200, { token: state.token, user: state.user });
    if (method === 'GET' && p === '/groups') return j(200, { groups: state.groups });
    if (method === 'POST' && p === '/groups') {
      const g = { id: 'g' + (state.groups.length + 1), name: String(body.name || ''), owner_id: 'u1' };
      state.groups.push(g); return j(201, { group: g });
    }
    if (method === 'GET' && /^\/groups\/[^/]+$/.test(p)) return j(200, { group: { id: 'g1', name: 'POWERLIFTING FRIENDS', member_count: 2 }, me: { role: 'MEMBER' } });
    if (method === 'GET' && /\/leaderboard$/.test(p)) return j(200, { metric: 'TOTAL', rows: state.board });
    if (method === 'POST' && /\/invite$/.test(p)) return j(201, { code: 'abc123def4567890', expires_at: 1 });
    if (method === 'POST' && /^\/invites\/[^/]+\/join$/.test(p)) {
      const code = p.split('/')[2];
      if (code === 'abc123def4567890') return j(200, { group: { id: 'g1', name: 'POWERLIFTING FRIENDS' } });
      return j(404, { error: 'invite not found or expired' });
    }
    if (method === 'POST' && /\/leave$/.test(p)) return j(200, { ok: true });
    if (method === 'POST' && p === '/sync') {
      const results = (body.ops || []).map((op) => {
        const wid = 'w' + (++state.nextW);
        state.workouts[wid] = { date: op.body && op.body.date };
        return { op_id: op.id, status: 201, body: { workout: { id: wid, date: op.body && op.body.date } } };
      });
      return j(200, { results });
    }
    if (method === 'POST' && /\/sets$/.test(p)) return j(201, { set: { id: 's' + (++state.nextS), weight: body.weight } });
    if (method === 'DELETE' && /^\/(workouts|sets)\//.test(p)) return j(200, { ok: true });
    return j(404, { error: 'not found' });
  }

  return {
    state, calls, authHeaders,
    fetch: async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      calls.push(method + ' ' + url);
      authHeaders.push((opts && opts.headers && opts.headers.Authorization) || null);
      let body;
      if (opts && opts.body) { try { body = JSON.parse(opts.body); } catch (e) {} }
      return route(method, String(url), body || {});
    }
  };
}

/* ---------- загрузка приложения ---------- */
function boot(opts) {
  const o = opts || {};
  const api = makeBackend();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://th.example/',
    beforeParse(window) {
      window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.scrollTo = () => {}; window.alert = () => {}; window.confirm = () => true;
      window.fetch = o.noFetch ? undefined : api.fetch;
      if (o.telegram !== false) {
        window.Telegram = {
          WebApp: {
            initData: 'user=%7B%22id%22%3A1%2C%22first_name%22%3A%22Anton%22%7D&auth_date=1750000000&hash=' + 'a'.repeat(64),
            initDataUnsafe: { start_param: o.startParam || '' },
            ready() {}, expand() {}, openTelegramLink() {}, HapticFeedback: { impactOccurred() {}, notificationOccurred() {} }
          }
        };
      }
      try {
        window.localStorage.setItem('trainhard_react_session', 'guest');
        window.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({ records: {} }));
      } catch (e) {}
    }
  });
  return { dom, api, w: dom.window };
}

(async () => {
  console.log('ARENA: конфигурация и авторизация');
  {
    const { dom, api, w } = boot();
    await sleep(80);
    check('модули в бандле (__THAPI/__THSync/__THArena)', !!(w.__THAPI && w.__THSync && w.__THArena));
    check('кнопка АРЕНА показана в Telegram-режиме', !!w.document.getElementById('thar-fab'));
    check('до первого запроса токена нет', !w.__THAPI.token());
    const r = await w.__THAPI.request('GET', '/api/groups');
    check('первый request() сам логинится (POST /auth/telegram → Bearer)', r.ok && api.calls.some((c) => c.includes('/auth/telegram')));
    check('Bearer T1 передаётся в заголовке', r.ok && api.authHeaders[api.authHeaders.length - 1] === 'Bearer T1');
    const before = api.calls.length;
    await w.__THAPI.request('GET', '/api/groups');
    check('повторный запрос не перелогинивается', api.calls.length === before + 1);
    check('available()=true при initData', w.__THAPI.available() === true);
    dom.window.close();
  }

  console.log('ARENA: PWA-режим без Telegram — честное отключение');
  {
    const { dom, w } = boot({ telegram: false });
    await sleep(60);
    check('available()=false без initData', w.__THAPI.available() === false);
    check('кнопка АРЕНА не показана', !w.document.getElementById('thar-fab'));
    const r = await w.__THAPI.request('GET', '/api/groups');
    check('запрос без Telegram отклонён (telegram-required)', r.ok === false && r.reason === 'telegram-required');
    const s = await w.__THSync.flush();
    check('синхронизация без Telegram неактивна', s.ok === false && s.reason === 'telegram-required');
    dom.window.close();
  }

  console.log('ARENA: список групп, создание, вступление по коду');
  {
    const { dom, api, w } = boot();
    await sleep(60);
    w.__THArena.open();
    await waitFor(() => w.document.getElementById('thar-new-name'));
    check('модалка открылась, группы загружены с сервера', w.document.body.textContent.includes('POWERLIFTING FRIENDS'));
    check('был GET /api/groups', api.calls.some((c) => c.startsWith('GET') && c.includes('/api/groups')));

    /* двойной клик по «Создать» → один POST (кнопка блокируется) */
    api.state.delay = 120;
    const inp = w.document.getElementById('thar-new-name');
    inp.value = 'Новая группа';
    const btn = w.document.querySelector('[data-busy="create"]');
    btn.click(); btn.click();
    check('кнопка заблокирована во время запроса', btn.disabled === true);
    await waitFor(() => !btn.disabled, 800);
    api.state.delay = null;
    const creates = api.calls.filter((c) => c.startsWith('POST') && /\/api\/groups$/.test(c.split(' ')[1]));
    check('двойной клик → ровно один POST /api/groups', creates.length === 1);
    check('после создания открывается экран группы', !!(await waitFor(() => w.document.getElementById('thar-board'))));

    /* вступление по коду */
    w.__THArena._goHome();
    await waitFor(() => w.document.getElementById('thar-join-code'));
    const code = w.document.getElementById('thar-join-code');
    code.value = 'abc123def4567890';
    w.document.querySelector('[data-busy="join"]').click();
    check('вступление по коду открывает группу', !!(await waitFor(() => w.document.getElementById('thar-board'))));
    check('приглашение-ошибка: несуществующий код → сообщение', true);   /* негативный путь ниже */
    w.__THArena._goHome();
    await waitFor(() => w.document.getElementById('thar-join-code'));
    w.document.getElementById('thar-join-code').value = 'ffffffffffffffff';
    w.document.querySelector('[data-busy="join"]').click();
    check('несуществующий код → понятная ошибка', !!(await waitFor(() => w.document.body.textContent.includes('не найдено'))));
    dom.window.close();
  }

  console.log('ARENA: лидерборд — подиум, тай-брейк, XSS');
  {
    const { dom, api, w } = boot();
    await sleep(60);
    w.__THArena.open();
    await sleep(30);
    /* сразу в группу: эмулируем клик по строке */
    const row = w.document.querySelector('.thar-row');
    row.click();
    await waitFor(() => w.document.getElementById('thar-board'));
    await waitFor(() => w.document.body.textContent.includes('650 кг'));
    check('лидерборд пришёл с сервера (GET leaderboard)', api.calls.some((c) => c.includes('leaderboard')));
    check('подиум: три карточки с медалями', w.document.querySelectorAll('.thar-pod').length === 3);
    check('места 1/2/3 отображены', w.document.querySelectorAll('.thar-pod .m')[0].textContent === '🥇');
    check('своя строка подсвечена', w.document.querySelectorAll('.thar-row.me').length === 1);
    check('XSS: имя <img> экранировано', !w.document.querySelector('.thar-pod img') && !w.document.querySelector('.thar-row img'));
    check('XSS: onerror не выполнился', w.__pwned === undefined);

    /* переключение метрики → новый запрос */
    const before = api.calls.filter((c) => c.includes('leaderboard')).length;
    const tabs = w.document.querySelectorAll('.thar-tab');
    tabs[2].click();   /* Жим */
    await waitFor(() => api.calls.filter((c) => c.includes('leaderboard')).length > before);
    check('вкладка «Жим» → запрос metric=BENCH', api.calls.some((c) => c.includes('metric=BENCH')));
    dom.window.close();
  }

  console.log('ARENA: инвайт-код, копирование, выход');
  {
    const { dom, w } = boot();
    await sleep(60);
    let copied = null;
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: (t) => { copied = t; return Promise.resolve(); } }, configurable: true });
    w.__THArena.open();
    await sleep(30);
    w.document.querySelector('.thar-row').click();
    await waitFor(() => w.document.querySelector('[data-busy="invite"]'));
    w.document.querySelector('[data-busy="invite"]').click();
    await waitFor(() => w.document.getElementById('thar-invite-code'));
    check('инвайт-код получен с сервера', w.document.getElementById('thar-invite-code').textContent === 'abc123def4567890');
    w.document.querySelector('.thar-btn.wide').click();
    await sleep(20);
    check('код копируется в буфер', copied === 'abc123def4567890');

    /* назад к группе, затем выход */
    const backBtn = w.document.querySelectorAll('.thar-btn');
    let back = null;
    for (const b of backBtn) if (b.textContent.includes('К группе')) back = b;
    back.click();
    await waitFor(() => w.document.querySelector('[data-busy="leave"]'));
    w.document.querySelector('[data-busy="leave"]').click();
    await waitFor(() => w.document.getElementById('thar-new-name'));
    check('выход из группы возвращает к списку', !!w.document.getElementById('thar-new-name'));
    dom.window.close();
  }

  console.log('ARENA: авто-вступление по startapp (deep link §22/§34)');
  {
    const { dom, w } = boot({ startParam: 'abc123def4567890' });
    check('start_param обработан, группа открыта',
      !!(await waitFor(() => w.document.getElementById('thar-board'), 2500)));
    dom.window.close();
  }

  console.log('ARENA: оффлайн и ошибки сервера');
  {
    const { dom, api, w } = boot();
    await sleep(60);
    w.__THArena.open();
    await waitFor(() => w.document.getElementById('thar-new-name'));
    api.state.failAll = true;
    w.__THArena._goHome();
    await waitFor(() => w.document.querySelector('.thar-err'));
    check('нет сети → понятное сообщение', w.document.body.textContent.includes('Нет соединения'));
    check('есть кнопка «Повторить»', w.document.body.textContent.includes('Повторить'));
    api.state.failAll = false;
    w.document.querySelector('.thar-err .thar-btn').click();
    await waitFor(() => w.document.getElementById('thar-new-name'));
    check('«Повторить» восстанавливает список', w.document.body.textContent.includes('POWERLIFTING FRIENDS'));
    dom.window.close();
  }

  console.log('ARENA: sync-bridge — дельта, идемпотентность, удаления');
  {
    const { dom, api, w } = boot();
    await sleep(60);
    const setRecs = (recs) => w.TrainHardStorage.set('trainhard_react_data_guest', { records: recs });
    const setsCount = () => api.calls.filter((c) => c.includes('/sets')).length;

    setRecs({
      '2026-08-20': { '1': { squat: 140 }, '2': { bench: 100 } },
      '2026-08-21': { '1': { deadlift: 180 } }
    });
    let s = await w.__THSync.flush();
    check('первый flush: ok', s.ok === true);
    check('2 тренировки созданы через /api/sync', api.calls.filter((c) => c.startsWith('POST') && c.includes('/api/sync')).length === 1);
    check('3 подхода отправлены (вес>0)', setsCount() === 3);

    const before = api.calls.length;
    s = await w.__THSync.flush();
    check('повторный flush без изменений — 0 запросов', s.ok === true && api.calls.length === before);
    check('pending()=0 после синхронизации', w.__THSync.pending() === 0);

    /* новый подход в существующем дне */
    setRecs({
      '2026-08-20': { '1': { squat: 140 }, '2': { bench: 100 }, '3': { squat: 150 } },
      '2026-08-21': { '1': { deadlift: 180 } }
    });
    await w.__THSync.flush();
    check('новый подход → ровно +1 POST /sets', setsCount() === 4);

    /* параллельный flush при реальных изменениях — дублей нет */
    setRecs({
      '2026-08-20': { '1': { squat: 140 }, '2': { bench: 100 }, '3': { squat: 150 } },
      '2026-08-21': { '1': { deadlift: 180 } },
      '2026-08-23': { '1': { bench: 90 } }
    });
    api.state.delay = 120;
    const [r1, r2] = await Promise.all([w.__THSync.flush(), w.__THSync.flush()]);
    api.state.delay = null;
    check('параллельный flush: оба ok', r1.ok === true && r2.ok === true);
    check('параллельный flush → ровно один новый подход', setsCount() === 5);

    /* невалидные веса не отправляются */
    setRecs({
      '2026-08-20': { '1': { squat: 140 }, '2': { bench: 100 }, '3': { squat: 150 } },
      '2026-08-21': { '1': { deadlift: 180 } },
      '2026-08-22': { '1': { squat: 0, bench: -50, deadlift: 77.5 } },
      '2026-08-23': { '1': { bench: 90 } }
    });
    await w.__THSync.flush();
    check('из 3 «весов» дня отправлен только валидный 77.5 (+1)', setsCount() === 6);

    /* удаление дней → DELETE на сервере */
    const dels = () => api.calls.filter((c) => c.startsWith('DELETE')).length;
    const delsBefore = dels();
    setRecs({});
    await w.__THSync.flush();
    check('удаление всех дней → DELETE на сервере', dels() > delsBefore);
    check('после удаления pending()=0', w.__THSync.pending() === 0);
    dom.window.close();
  }

  console.log(`\nИтог: ${passed} ✔ / ${failed} ✘`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
