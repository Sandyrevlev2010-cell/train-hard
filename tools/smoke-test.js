/* Смоук-тест Train Hard MVP в jsdom: загрузка, онбординг без входа,
 * тренировка, Premium, интервал-таймер, аналитика, офлайн (0 fetch). */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = path.join(__dirname, '..', 'app', 'index.html');
const html = fs.readFileSync(HTML, 'utf-8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  const msg = String((e.detail && e.detail.message) || e.message || e);
  if (/Could not load|Not implemented/.test(msg)) return;
  errors.push(msg);
});
vc.on('error', (m) => { if (!/Not implemented/.test(String(m))) errors.push(String(m)); });

let fetchCalls = 0;

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://trainhard.example/',
  virtualConsole: vc,
  beforeParse(window) {
    window.matchMedia = (q) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; }
    });
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.fetch = (...a) => { fetchCalls++; return Promise.resolve({ json: () => Promise.resolve({}), ok: false }); };
    window.scrollTo = () => {};
    window.alert = () => {};
    window.confirm = () => true;
  }
});

const { window } = dom;
const { document } = window;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $$ = (s) => Array.from(document.querySelectorAll(s));
const btns = () => $$('button').filter((b) => b.offsetParent !== undefined);
const anyBtn = (re) => $$('button').find((b) => re.test((b.textContent || '').replace(/\s+/g, ' ')));
const allBtns = () => Array.from(document.querySelectorAll('button'));
const click = (el) => {
  if (!el) throw new Error('click: элемент не найден');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};
/* видимый текст без содержимого inline-скриптов/стилей */
const vis = () => {
  const c = document.body.cloneNode(true);
  c.querySelectorAll('script,style').forEach((n) => n.remove());
  return c.textContent || '';
};
const reactInput = (inp, val) => {
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(inp, val);
  inp.dispatchEvent(new window.Event('input', { bubbles: true }));
};

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✘ ' + name); }
};

(async () => {
  console.log('— Загрузка —');
  await sleep(2500);
  check('нет JS-ошибок при старте', errors.length === 0);
  if (errors.length) console.log('    ошибки:', errors.slice(0, 5));
  check('StorageService доступен', !!window.TrainHardStorage);
  check('PremiumManager доступен', !!window.__THPrem);
  check('аналитика доступна', !!window.__THAnalytics);
  check('интервал-таймер доступен', !!window.__THTimer);

  console.log('— Онбординг без регистрации —');
  let t = vis();
  check('экран входа не показан', !t.includes('Войди или создай аккаунт') && !t.includes('придумай логин'));
  check('онбординг начинается с цели', t.includes('Какой результат хочешь получить?'));
  check('гостевая сессия создана', window.localStorage.getItem('trainhard_react_session') === 'guest');

  click(anyBtn(/Набрать массу/));
  await sleep(200);
  click(anyBtn(/Продолжить/));
  await sleep(200);
  check('шаг профиля открыт', vis().includes('Как тебя зовут?'));

  reactInput(document.querySelector('input'), 'Тест');
  click(anyBtn(/Продолжить/));
  await sleep(300);
  t = vis();
  check('шаг выбора программы открыт', t.includes('Выбери программу'));
  click(anyBtn(/Пауэрлифтинг/));
  await sleep(200);
  click(anyBtn(/Продолжить/));
  await sleep(250);
  t = vis();
  if (t.includes('Выбери специализацию')) {
    click(anyBtn(/Троеборье/));
    await sleep(500);
  }
  t = vis();
  check('главный экран открыт', t.includes('Начать тренировку') || t.includes('Открыть тренировку'));
  check('Premium CTA на главной', t.includes('Old School, AI-сплит и питание с КБЖУ'));
  check('Arena удалена с главной', !t.includes('Рейтинг · Арена') && !t.includes('Вступи в группу'));

  console.log('— Тренировка —');
  click(anyBtn(/Начать тренировку|Открыть тренировку/));
  await sleep(300);
  t = vis();
  check('экран тренировки открыт', t.includes('Тренировка ·') && t.includes('Таймер отдыха'));
  /* завершить можно тренировку «сегодня/вчера»: если ближайший день плана
     не попадает в окно (напр., выходные) — открываем вчерашний день недели
     в полоске спортивной недели */
  let done = anyBtn(/Завершить/);
  if (!done || done.disabled) {
    /* полоска «Спортивная неделя»: кнопки вида «<№ дня><число месяца>» —
       открываем вчерашний день, чтобы кнопка «Завершить (вчера)» была активна */
    const yNum = String(new Date(Date.now() - 864e5).getDate());
    const dayBtn = allBtns().find((b) => {
      const tt = (b.textContent || '').trim();
      return tt.length <= 3 && tt !== yNum && tt.endsWith(yNum);
    });
    if (dayBtn) { click(dayBtn); await sleep(400); }
    done = anyBtn(/Завершить/);
  }
  check('кнопка завершения доступна', !!done && !done.disabled);
  click(done);
  await sleep(700);
  const st = JSON.parse(window.localStorage.getItem('trainhard_react_data_guest') || '{}');
  check('тренировка записана локально', (st.workoutLogs || []).length > 0);
  const an = window.__THAnalytics.snapshot();
  check('аналитика: workout_open', (an.events['workout_open'] || 0) >= 1);
  check('аналитика: workout_complete', (an.events['workout_complete'] || 0) >= 1);
  check('статистика тренировок = 1', (st.workoutLogs || []).length === 1);

  console.log('— Premium —');
  check('trusted entitlement в MVP = UNVERIFIED', window.__THPrem.getTrustedEntitlement() === null);
  check('Premium изначально выключен', !window.__THPrem.isPremium());
  window.__thPay();
  await sleep(300);
  check('Premium-экран открыт', !!document.querySelector('.thp-wrap'));
  t = vis();
  check('преимущества перечислены', t.includes('Что входит в Premium') && t.includes('Old School') && t.includes('КБЖУ'));
  check('цена и условия показаны (план TON)', t.includes('1 TON') && t.includes('без автосписаний'));
  check('оплата настроена: TON-перевод на кошелёк проекта', t.includes('блокчейне TON'));
  check('кнопка покупки есть (оплата подключена)', !!document.querySelector('.thp-buy'));
  check('кнопки самоподтверждения оплаты нет', !document.querySelector('[data-act="confirm-paid"]'));
  check('восстановление покупки доступно', !!document.querySelector('.thp-restore'));
  check('аналитика: premium_open', (window.__THAnalytics.snapshot().events['premium_open'] || 0) >= 1);

  /* закрыть модалку кликом по фону */
  const backdrop = document.querySelector('[class*="backdrop-blur"]');
  click(backdrop);
  await sleep(200);

  /* активация — тот же путь, что и после успешной оплаты */
  window.__THPrem.activate({ source: 'test', days: 30 });
  await sleep(400);
  check('Premium активирован', window.__THPrem.isPremium());
  check('осталось 30 дней', window.__THPrem.daysLeft() === 30);
  check('entitlement в localStorage', !!window.localStorage.getItem('trainhard_premium_v1'));
  check('React-состояние обновилось (PREMIUM в шапке)', vis().includes('PREMIUM ·'));
  check('аналитика: purchase_success', (window.__THAnalytics.snapshot().events['purchase_success'] || 0) >= 1);

  /* активный Premium: контент должен открыться */
  const nut = anyBtn(/Питание/);
  if (nut) { click(nut); await sleep(300); check('Premium-питание открылось', vis().includes('Белки') || vis().includes('ккал')); }

  /* окончание подписки */
  window.__THPrem.deactivate();
  await sleep(300);
  check('после окончания подписки контент снова закрыт', !window.__THPrem.isPremium());
  window.__THPrem.activate({ source: 'test', days: 30 });
  await sleep(200);

  console.log('— Интервальный таймер —');
  window.__THTimer.open();
  await sleep(200);
  check('таймер открывается', !!document.querySelector('.thit'));
  t = vis();
  check('пресеты (Табата) на месте', t.includes('Табата'));
  click(document.querySelector('.thit [data-a="start"]'));
  await sleep(1500);
  check('таймер отсчитывает фазы', t.includes('Приготовься') || vis().includes('Приготовься') || vis().includes('Работа'));
  click(document.querySelector('.thit [data-a="reset"]'));
  document.querySelector('.thit .thit-x').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(100);

  console.log('— Офлайн и хранение —');
  check('сетевых запросов нет (' + fetchCalls + ')', fetchCalls === 0);
  check('данные гостя сохранены', !!window.localStorage.getItem('trainhard_react_data_guest'));
  check('аналитика сохранена локально', !!window.localStorage.getItem('trainhard_analytics_v1'));

  console.log('\nИтог: %d ✔ / %d ✘', passed, failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ТЕСТ УПАЛ:', e); process.exit(1); });
