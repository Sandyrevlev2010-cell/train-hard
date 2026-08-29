/* Train Hard — TON-платежи: E2E-тест (jsdom).
 * План: 1 TON / 30 дней. Проверяется весь флоу: экран Premium, TON-лист
 * (адрес/код/QR/ссылка), подтверждение через мок toncenter, анти-реплей,
 * отказы (сумма/комментарий/сеть), легаси-возврат ?th_pay без активации. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = path.join(__dirname, '..', 'app', 'index.html');
const html = fs.readFileSync(HTML, 'utf-8');
const TON_ADDR = 'UQCFlpQJExAvzamuoBazfMw67wBzGXBEWkci0DLQxYw5Yi8a';

let passed = 0, failed = 0, fetchCalls = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ✔ ' + n); } else { failed++; console.log('  ✘ ' + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* мок-ответ toncenter (меняется на лету через window.__tonResp) */
function boot(url, tonResp) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url,
    beforeParse(window) {
      window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.fetch = (u) => {
        fetchCalls++;
        window.__lastFetchUrl = String(u);
        const r = typeof window.__tonResp === 'function' ? window.__tonResp() : window.__tonResp;
        if (r === 'FAIL') return Promise.reject(new Error('net'));
        return Promise.resolve({ json: () => Promise.resolve(r) });
      };
      window.scrollTo = () => {}; window.alert = () => {}; window.confirm = () => true;
      window.__tonResp = tonResp;
      try {
        window.localStorage.setItem('trainhard_react_session', 'guest');
        window.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({
          login: 'guest', name: 'Тест', city: 'Москва', height: 175, weight: 80, age: 28, gender: 'male', level: 1,
          program: 'powerlifting', trainingPlan: { name: 'Троеборье', days: [{ day: 1, focus: 'Верх', exercises: ['Жим штанги 4×8'] }] },
          completedDays: {}, streak: 0, bestStreak: 0, goalArchive: [], progress: { bench: [], squat: [], deadlift: [] },
          achievements: [], workoutLogs: [], records: {}, flameName: '', nutGoal: 'mass', premiumUntil: null, customDays: {}
        }));
      } catch (e) {}
    }
  });
}
const vis = (d) => { const c = d.body.cloneNode(true); c.querySelectorAll('script,style').forEach((n) => n.remove()); return c.textContent || ''; };
const btn = (w, d, re) => Array.from(d.querySelectorAll('button')).find((b) => re.test(b.textContent || ''));
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const pendingLabel = (w) => { try { return (JSON.parse(w.localStorage.getItem('trainhard_premium_pending_v1') || 'null') || {}).label; } catch (e) { return null; } };

(async () => {
  /* ===== Конфигурация и адаптер ===== */
  console.log('— Конфигурация TON —');
  const empty = { ok: true, result: [] };
  let dom = boot('https://th.example/', empty);
  let w = dom.window, d = w.document;
  await sleep(2300);
  check('адаптер TON настроен (адрес/сумма/провайдер)', w.TrainHardPayments.isConfigured() === true && w.TrainHardPayments.provider === 'ton');
  const lbl = w.TrainHardPayments.newLabel();
  check('label формата th-hex', /^th-[a-f0-9]{16}$/.test(lbl));
  const turl = w.TrainHardPayments.transferUrl(lbl);
  check('ссылка перевода: ton://transfer/<адрес>?amount=1e9&text=label',
    turl === 'ton://transfer/' + TON_ADDR + '?amount=1000000000&text=' + lbl);
  check('autosverify выключен (проверка только по клику)', w.TrainHardPayments.autoVerify === false);

  /* ===== Экран Premium и TON-лист ===== */
  console.log('— Экран Premium: план и TON-лист —');
  w.__thPay();
  await sleep(300);
  const t1 = vis(d);
  check('план «1 TON / 30 дней» на экране', t1.includes('1 TON') && t1.includes('30 дней'));
  check('старой цены в рублях нет', !t1.includes('100 ₽'));
  const buy = btn(w, d, /Оформить Premium/);
  check('кнопка покупки с планом TON', !!buy && /1 TON/.test(buy.textContent));
  click(w, buy);
  await sleep(300);
  const label = pendingLabel(w);
  check('pending-платёж создан с кодом', /^th-[a-f0-9]{16}$/.test(label || ''));
  const t2 = vis(d);
  check('TON-лист: адрес кошелька проекта', t2.includes(TON_ADDR));
  check('TON-лист: код платежа показан', t2.includes(label));
  check('TON-лист: сумма и период', t2.includes('1 TON') && /за 30 дней/.test(t2));
  const qr = d.querySelector('.thp-ton-qr canvas');
  check('QR-код оплаты нарисован', !!qr && qr.width > 100 && qr.height > 100);
  const walletLink = d.querySelector('a.thp-linkbtn');
  check('кнопка «Открыть в кошельке» (ton:// с кодом)', !!walletLink && walletLink.getAttribute('href') === turl.replace(lbl, label));
  check('кнопки копирования есть', !!btn(w, d, /Скопировать адрес/) && !!btn(w, d, /Скопировать код/));
  const copyBtn = btn(w, d, /Скопировать адрес/);
  let copied = '';
  try {
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: (s) => { copied = s; return Promise.resolve(); } }, configurable: true });
  } catch (e) {}
  click(w, copyBtn);
  await sleep(100);
  check('копирование адреса работает', copied === TON_ADDR);

  /* ===== Подтверждение оплаты (мок toncenter) ===== */
  console.log('— Проверка платежа —');
  w.__tonResp = { ok: true, result: [
    { in: false, value: '9999999999', message: 'чужой исходящий' },
    { in: true, value: '1000000000', message: label },
    { in: true, value: '500000000', message: 'другой код' }
  ]};
  click(w, btn(w, d, /Я оплатил — проверить/));
  await sleep(400);
  check('Premium активирован после найденной транзакции', w.__THPrem.isPremium() === true);
  const until1 = w.__THPrem.until();
  check('срок = 30 дней от сейчас', until1 > Date.now() + 29.5 * 864e5 && until1 < Date.now() + 30.5 * 864e5);
  check('запрос ушёл на публичный API toncenter', /toncenter\.com\/api\/v2\/getTransactions\?address=/.test(w.__lastFetchUrl || ''));
  const rec = JSON.parse(w.localStorage.getItem('trainhard_premium_v1') || '{}');
  check('entitlement: источник ton-verify + код платежа', rec.source === 'ton-verify' && rec.label === label);
  check('аналитика: purchase_success', (w.__THAnalytics.snapshot().events['purchase_success'] || 0) >= 1);

  /* анти-реплей: тот же платёж не продлевает срок повторно */
  w.__tonResp = { ok: true, result: [{ in: true, value: '1000000000', message: label }] };
  w.__THPrem.verifyPending && w.__THPrem.verifyPending(label);
  await sleep(300);
  check('анти-реплей: повторная проверка не продлевает срок', w.__THPrem.until() === until1);
  dom.window.close();

  /* ===== Отказы ===== */
  console.log('— Отказы —');
  const cases = [
    ['сумма меньше цены (0.1 TON)', { ok: true, result: [{ in: true, value: '100000000', message: 'LABEL' }] }],
    ['чужой комментарий', { ok: true, result: [{ in: true, value: '1000000000', message: 'не тот код' }] },
    ],
    ['исходящий, а не входящий', { ok: true, result: [{ in: false, value: '1000000000', message: 'LABEL' }] }]
  ];
  for (const [name, resp] of cases) {
    const dm = boot('https://th.example/', resp);
    await sleep(2200);
    const ww = dm.window, dd = ww.document;
    const lb = ww.TrainHardPayments.newLabel();
    ww.__THPrem.checkout ? null : 0;
    try { ww.localStorage.setItem('trainhard_premium_pending_v1', JSON.stringify({ label: lb, at: Date.now() })); } catch (e) {}
    ww.__tonResp = { ok: true, result: resp.result.map((r) => ({ ...r, message: r.message === 'LABEL' ? lb : r.message })) };
    ww.__thPay();
    await sleep(250);
    click(ww, btn(ww, dd, /Я оплатил — проверить/));
    await sleep(350);
    check('отказ: ' + name + ' → Premium НЕ активирован', ww.__THPrem.isPremium() === false && vis(dd).includes('Оплата не подтверждена'));
    dm.window.close();
  }

  /* сеть недоступна → честный статус, без активации */
  const dmN = boot('https://th.example/', 'FAIL');
  await sleep(2200);
  const wn = dmN.window, dn = wn.document;
  const ln = wn.TrainHardPayments.newLabel();
  wn.localStorage.setItem('trainhard_premium_pending_v1', JSON.stringify({ label: ln, at: Date.now() }));
  wn.__thPay();
  await sleep(250);
  click(wn, btn(wn, dn, /Я оплатил — проверить/));
  await sleep(350);
  check('сеть недоступна → «Проверка временно недоступна», Premium off',
    wn.__THPrem.isPremium() === false && vis(dn).includes('Проверка подписки временно недоступна'));
  dmN.window.close();

  /* ===== Легаси-возврат и URL ===== */
  console.log('— Легаси-возврат ?th_pay —');
  fetchCalls = 0;
  const dmR = boot('https://th.example/?th_pay=return&label=th-abcdef12&z=1', empty);
  await sleep(2300);
  const wr = dmR.window;
  check('возврат НЕ активирует Premium', wr.__THPrem.isPremium() === false);
  check('pending сохранён, URL очищен', pendingLabel(wr) === 'th-abcdef12' && wr.location.search === '?z=1');
  check('автозапросов в сеть нет (проверка только по клику)', fetchCalls === 0);
  dmR.window.close();

  console.log('\nИтог: %d ✔ / %d ✘', passed, failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ТЕСТ УПАЛ:', e); process.exit(1); });
