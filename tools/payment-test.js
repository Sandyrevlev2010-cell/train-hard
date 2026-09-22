/* Train Hard — Platega / СБП frontend payment flow test. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = path.join(__dirname, '..', 'app', 'index.html');
const html = fs.readFileSync(HTML, 'utf-8');

let passed = 0, failed = 0;
const check = (name, ok) => {
  if (ok) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✘ ' + name); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function boot() {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://trainhard.example/',
    beforeParse(window) {
      window.matchMedia = () => ({
        matches: false, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}
      });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.scrollTo = () => {};
      window.alert = () => {};
      window.confirm = () => true;

      window.Telegram = {
        WebApp: {
          initData: 'test-init-data',
          initDataUnsafe: { user: { id: 1 }, start_param: '' },
          openLink: (url) => { window.__openedPaymentUrl = url; },
          ready() {},
          expand() {}
        }
      };

      window.__THAPI = {
        request: async (method, path, body) => {
          window.__apiCalls.push({ method, path, body });
          if (path === '/payments/create') {
            return {
              ok: true,
              status: 201,
              body: {
                payment_id: 'tx-test-001',
                transaction_id: 'tx-test-001',
                url: 'https://pay.platega.io/?id=test',
                status: 'PENDING'
              }
            };
          }
          if (path === '/payments/verify') {
            return {
              ok: true,
              status: 200,
              body: window.__paymentConfirmed
                ? { ok: true, until: Date.now() + 30 * 86400000 }
                : { ok: false, status: 'PENDING' }
            };
          }
          return { ok: false, status: 404, body: null };
        }
      };

      window.__apiCalls = [];
      window.__paymentConfirmed = false;

      try {
        window.localStorage.setItem('trainhard_react_session', 'guest');
        window.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({
          login: 'guest', name: 'Тест', city: 'Москва',
          height: 175, weight: 80, age: 16, gender: 'male', level: 1,
          trainingPlan: {}, completedDays: {}, streak: 0, bestStreak: 0,
          goalArchive: [], progress: { bench: [], squat: [], deadlift: [] },
          achievements: [], workoutLogs: [], records: {},
          premiumUntil: null, customDays: {}
        }));
      } catch (e) {}
    }
  });
}

const visible = (d) => {
  const c = d.body.cloneNode(true);
  c.querySelectorAll('script,style').forEach(n => n.remove());
  return c.textContent || '';
};
const btn = (d, re) => Array.from(d.querySelectorAll('button')).find(b => re.test(b.textContent || ''));
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));

(async () => {
  console.log('— Конфигурация Platega —');
  let dom = boot();
  let w = dom.window, d = w.document;
  await sleep(2200);

  check('адаптер настроен на Platega', w.TrainHardPayments.isConfigured() === true);
  check('provider = platega', w.TrainHardPayments.provider === 'platega');
  check('автопроверка выключена', w.TrainHardPayments.autoVerify === false);
  check('нет TON provider в адаптере', !/ton/i.test(String(w.TrainHardPayments.provider)));

  console.log('— Создание платежа —');
  const label = w.TrainHardPayments.newLabel();
  check('label валиден', /^th-[a-f0-9]{16}$/.test(label));

  const opened = await w.TrainHardPayments.open(label);
  check('backend create вызван', w.__apiCalls.some(x => x.path === '/payments/create'));
  check('получена HTTPS ссылка Platega', opened.ok === true && /^https:\/\/pay\.platega\.io\//.test(opened.url));
  check('pending сохранён', !!w.TrainHardPayments.pending() && w.TrainHardPayments.pending().payment_id === 'tx-test-001');

  console.log('— Проверка статуса —');
  let ans = await w.TrainHardPayments.verify(label);
  check('PENDING не активирует Premium', ans && ans.ok === false);

  w.__paymentConfirmed = true;
  ans = await w.TrainHardPayments.verify(label);
  check('CONFIRMED возвращает until', ans && ans.ok === true && ans.until > Date.now());
  check('verify использует backend, а не Platega напрямую',
    w.__apiCalls.some(x => x.path === '/payments/verify') &&
    !w.__apiCalls.some(x => String(x.path).includes('toncenter')));

  console.log('— Полный Premium UI —');
  w.__thPay && w.__thPay();
  await sleep(300);
  check('UI содержит СБП', visible(d).includes('СБП'));
  check('UI не содержит TON', !visible(d).includes('TON'));
  check('цена 299 ₽', visible(d).includes('299 ₽'));

  dom.window.close();
  console.log('\nИтог: %d ✔ / %d ✘', passed, failed);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('ТЕСТ УПАЛ:', e);
  process.exit(1);
});
