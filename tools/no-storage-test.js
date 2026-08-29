/* Тест: localStorage бросает SecurityError (sandbox/приватный режим) —
 * приложение обязано запускаться и работать в memory-режиме. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf-8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://trainhard.example/',
  beforeParse(window) {
    Object.defineProperty(window, 'localStorage', { get() { throw new window.DOMException('SecurityError', 'SecurityError'); } });
    window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
    window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: false }) });
    window.scrollTo = () => {}; window.alert = () => {}; window.confirm = () => true;
  }
});
const w = dom.window, d = w.document;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vis = () => { const c = d.body.cloneNode(true); c.querySelectorAll('script,style').forEach((n) => n.remove()); return c.textContent || ''; };
const anyBtn = (re) => Array.from(d.querySelectorAll('button')).find((b) => re.test((b.textContent || '').replace(/\s+/g, ' ')));
const click = (el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));

(async () => {
  await sleep(2500);
  let ok = 0, bad = 0;
  const check = (n, c) => { if (c) { ok++; console.log('  ✔ ' + n); } else { bad++; console.log('  ✘ ' + n); } };

  check('приложение запустилось без localStorage', vis().includes('Какой результат хочешь получить?'));
  check('StorageService перешёл в memory-режим', w.TrainHardStorage.available() === false);

  // проходим онбординг в memory-режиме
  click(anyBtn(/Набрать массу/)); await sleep(150);
  click(anyBtn(/Продолжить/)); await sleep(150);
  const inp = d.querySelector('input');
  if (inp) { const s = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set; s.call(inp, 'Тест'); inp.dispatchEvent(new w.Event('input', { bubbles: true })); }
  click(anyBtn(/Продолжить/)); await sleep(200);
  click(anyBtn(/Пауэрлифтинг/)); await sleep(150);
  click(anyBtn(/Продолжить/)); await sleep(200);
  if (vis().includes('Выбери специализацию')) { click(anyBtn(/Троеборье/)); await sleep(400); }
  check('онбординг пройден, главный экран', /Начать тренировку|Открыть тренировку/.test(vis()));

  w.__THPrem.activate({ source: 'test' });
  await sleep(300);
  check('Premium активируется (memory-режим)', w.__THPrem.isPremium());
  w.__thPay();
  await sleep(300);
  check('экран Premium работает', !!d.querySelector('.thp-wrap'));

  console.log('\nИтог: %d ✔ / %d ✘', ok, bad);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ТЕСТ УПАЛ:', e); process.exit(1); });
