/* Train Hard — Telegram Mini App: E2E-тест (jsdom).
 * Два режима: обычный браузер (Telegram отсутствует — ничего не ломается)
 * и внутри Telegram (мок Telegram.WebApp). */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = path.join(__dirname, '..', 'telegram', 'index.html');
const html = fs.readFileSync(HTML, 'utf-8');
let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ✔ ' + n); } else { failed++; console.log('  ✘ ' + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(seed) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://th.example/',
    beforeParse(window) {
      window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: false }) });
      window.scrollTo = () => {}; window.alert = () => {}; window.confirm = () => true;
      window.__errors = [];
      window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
      if (seed) seed(window);
    }
  });
}

/* мок Telegram.WebApp */
function mockTelegram(w, opts) {
  const c = { ready: 0, expand: 0, header: null, bg: null, dvs: 0, openLink: [], haptic: [], backShow: 0, backHide: 0, backClick: [] };
  w.__tg = c;
  w.Telegram = {
    WebApp: {
      initData: 'user=%7B%22id%22%3A12345%7D&auth_date=1&hash=mock',
      initDataUnsafe: {
        user: { id: 12345, first_name: 'Иван' },
        start_param: (opts && opts.startParam) || ''
      },
      version: '8.0',
      ready() { c.ready++; },
      expand() { c.expand++; },
      setHeaderColor(v) { c.header = v; },
      setBackgroundColor(v) { c.bg = v; },
      disableVerticalSwipes() { c.dvs++; },
      HapticFeedback: {
        notificationOccurred(k) { c.haptic.push('n:' + k); },
        impactOccurred(k) { c.haptic.push('i:' + k); }
      },
      BackButton: {
        show() { c.backShow++; },
        hide() { c.backHide++; },
        onClick(fn) { c.backClick.push(fn); }
      },
      openLink(u) { c.openLink.push(u); }
    }
  };
}

(async () => {
  /* ===== Статика ===== */
  console.log('— Статика Telegram-сборки —');
  check('T1 единственный внешний скрипт — telegram.org',
    JSON.stringify(html.match(/<script[^>]+src="http[^"]+"/g) || []) === JSON.stringify(['<script src="https://telegram.org/js/telegram-web-app.js"']));
  check('T2 SW-регистрация и manifest убраны', !html.includes('th-mvp-pwa-register') && !html.includes('manifest.webmanifest'));
  check('T3 boot перед бандлом', html.indexOf('th-tg-boot') < html.indexOf('var e=Object.create'));
  check('T4 Telegram-модуль после основного бандла', html.indexOf('th-tg-miniapp') > html.indexOf('var e=Object.create'));


  /* ===== Браузерный режим ===== */
  console.log('— Обычный браузер (без Telegram) —');
  let domB = boot((w) => {
    try { w.localStorage.setItem('trainhard_react_session', 'guest'); } catch (e) {}
  });
  await sleep(2300);
  const wB = domB.window;
  check('B1 приложение живо, 0 ошибок', (wB.__errors || []).length === 0 && (wB.document.body.textContent || '').length > 500);
  check('B2 session не тронут (guest)', wB.localStorage.getItem('trainhard_react_session') === 'guest');
  check('B3 модуль Telegram тихо отключился', !wB.__THTelegram);

  /* ===== Режим Telegram ===== */
  console.log('— Внутри Telegram (мок) —');
  let domT = boot((w) => {
    mockTelegram(w, { startParam: payload });
    try {
      w.localStorage.setItem('trainhard_react_session', 'guest');
      w.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({
        login: 'guest', name: 'Гость', city: 'Москва', height: 175, weight: 80, age: 28, gender: 'male', level: 1,
        program: 'powerlifting', trainingPlan: { name: 'Троеборье', days: [{ day: 1, focus: 'Верх', exercises: ['Жим штанги 4×8'] }] },
        completedDays: {}, streak: 0, bestStreak: 0, goalArchive: [], progress: { bench: [], squat: [], deadlift: [] },
        achievements: [], workoutLogs: [], records: {}, flameName: '', nutGoal: 'mass', premiumUntil: null, customDays: {}
      }));
    } catch (e) {}
  });
  await sleep(3200);
  const wT = domT.window, dT = wT.document;
  const c = wT.__tg;
  check('G1 ready() и expand() вызваны', c.ready >= 1 && c.expand >= 1);
  check('G2 тёмная шапка/фон (#0a0a0a)', c.header === '#0a0a0a' && c.bg === '#0a0a0a');
  check('G3 вертикальные свайпы отключены', c.dvs >= 1);
  check('G4 изоляция аккаунта: session=tg12345, guest-прогресс унаследован',
    wT.localStorage.getItem('trainhard_react_session') === 'tg12345' &&
    !!wT.localStorage.getItem('trainhard_react_data_tg12345'));
  check('G5 0 runtime ошибок', (wT.__errors || []).length === 0);
  const txtT = dT.body.textContent || '';
  check('G6 Telegram UI отрисован', txtT.length > 500);
  check('G7 URL приложения чистый', wT.location.search === '');

  /* BackButton */
  const backFn = c.backClick[0];
  check('G8 BackButton подписан', typeof backFn === 'function');
  await sleep(1000);
  check('G9 без оверлея → BackButton.hide', c.backHide >= 1);

  /* haptic через TrainHardEffects */
  const beforeH = c.haptic.length;
  try { wT.TrainHardEffects && wT.TrainHardEffects.play('achievement'); } catch (e) {}
  check('G12 достижение → haptic success', c.haptic.length > beforeH && c.haptic.indexOf('n:success') !== -1);

  /* openLink */
  const opened = wT.open('https://example.com/docs');
  check('G13 window.open внешней ссылки → Telegram openLink', c.openLink.includes('https://example.com/docs') && opened === null);

  console.log('\nИтог: %d ✔ / %d ✘', passed, failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ТЕСТ УПАЛ:', e); process.exit(1); });
