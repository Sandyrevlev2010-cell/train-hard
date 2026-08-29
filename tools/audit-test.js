/* Train Hard — Security/Bug audit regression (defensive audit, фаза 3).
 * Проверяет trust boundary frontend: платёжный возврат, URL-параметры,
 * повреждённые данные, legacy-пароли, отсутствие eval/секретов,
 * дубликаты событий, сброс данных. Runtime-часть через jsdom. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = path.join(__dirname, '..', 'app', 'index.html');
const html = fs.readFileSync(HTML, 'utf-8');
let fetchCalls = 0;
let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ✔ ' + n); } else { failed++; console.log('  ✘ ' + n); } };

function boot(url, seed) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url,
    beforeParse(window) {
      window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.fetch = () => { fetchCalls++; return Promise.resolve({ json: () => Promise.resolve({ ok: false }) }); };
      window.scrollTo = () => {}; window.alert = () => {}; window.confirm = () => true;
      window.__errors = [];
      window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
      if (seed) seed(window);
    }
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  /* ===== Статические проверки сборки ===== */
  console.log('— Статический аудит сборки —');
  check('A1 нет eval / new Function / document.write', !/\beval\(/.test(html) && !/new Function[ (]/.test(html) && !/document\.write/.test(html));
  check('A2 нет секретов по словарю (api_key/secret/token/password и т.п.)',
    !/(api_key|apikey|client_secret|access_token|merchant_secret|shop_secret|jwt_secret|private_key|passwd)/i.test(html.replace(/type:`?password|new-password|current-password/g, '')));
  check('A3 нет тестовых бекдоров (testPremium/mockPayment/forcePremium/skipPaywall/devMode/isAdmin)',
    !/(testPremium|debugPremium|mockPayment|forcePremium|skipPaywall|testUser|isAdmin|backdoor|unlockAll)/.test(html));
  const extScripts = (html.match(/<script[^>]+src=/g) || []).filter((s) => { const m = s.match(/src="([^"]+)"/); return m && /^https?:/.test(m[1]); });
  const extLinks = (html.match(/<link[^>]+href="[^"]+"/g) || []).filter((l) => { const m = l.match(/href="([^"]+)"/); return m && /^https?:/.test(m[1]); });
  check('A4 нет ВНЕШНИХ http(s) script/link (инлайн + data: + same-origin файлы)', extScripts.length === 0 && extLinks.length === 0);
  check('A5 консоль чистая в исходниках модулей', !/console\.(log|info|debug)/.test(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'premium', 'premium-manager.js'), 'utf-8') +
    fs.readFileSync(path.join(__dirname, '..', 'src', 'premium', 'payment-adapter.js'), 'utf-8') +
    fs.readFileSync(path.join(__dirname, '..', 'src', 'challenges', 'challenge-service.js'), 'utf-8')));
  const headersMd = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SECURITY-HEADERS.md'), 'utf-8');
  check('A6 Permissions-Policy в конфигах хостинга разрешает камеру сканера', /add_header Permissions-Policy[^\n]*camera=\(self\)/.test(headersMd) && /Permissions-Policy = [^\n]*camera=\(self\)/.test(headersMd));
  const swSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'sw.js'), 'utf-8');
  check('A7 SW: кэш same-origin, без секретов, версия указана', /CACHE = 'trainhard-mvp-v\d+'/.test(swSrc) && !/token|secret/i.test(swSrc));

  /* ===== Runtime: доверенная граница ===== */
  console.log('— Runtime: платёжный возврат и URL —');
  fetchCalls = 0;
  let dom = boot('https://th.example/?th_pay=return&label=th-abcdef12&x=1', (w) => {
    w.localStorage.setItem('trainhard_react_session', 'guest');
  });
  await sleep(2200);
  let w = dom.window;
  check('B1 возврат из оплаты НЕ активирует Premium', w.__THPrem.isPremium() === false);
  check('B2 платёж в состоянии «ожидает подтверждения» (pending)', !!w.localStorage.getItem('trainhard_premium_pending_v1'));
  check('B3 URL очищен от th_pay/label (остальные параметры сохранены)', w.location.search === '?x=1');
  check('B4 сетевых запросов при возврате — 0', fetchCalls === 0);

  fetchCalls = 0;
  let dom2 = boot('https://th.example/?premium=true&premium_until=999999999999&vip=1&admin=1#premium');
  await sleep(2000);
  check('B5 URL-параметры (?premium/vip/admin) не дают Premium', dom2.window.__THPrem.isPremium() === false);

  fetchCalls = 0;
  const enc0 = (() => { const b = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url'); return b({ v: 1, id: 'THAUD01', t: 'x', d: 7, n: 3, f: 'fullbody', l: 'standard', s: 's1' }); })();
  let dom3 = boot('https://th.example/?challenge=' + enc0);
  await sleep(2500);
  check('B6 challenge-URL не даёт Premium и не ходит в сеть', dom3.window.__THPrem.isPremium() === false && fetchCalls === 0);

  /* ===== Runtime: повреждённые данные ===== */
  console.log('— Runtime: повреждённые localStorage-данные —');
  let dom4 = boot('https://th.example/', (w) => {
    w.localStorage.setItem('trainhard_react_session', 'guest');
    w.localStorage.setItem('trainhard_react_accounts', JSON.stringify({ old: { passHash: 'x', salt: 'y' } }));
    w.localStorage.setItem('trainhard_react_data_guest', '{"streak":"abc","bestStreak":-3,"completedDays":[1,2],"records":"junk","trainingPlan":"broken","workoutLogs":"x"}');
    w.localStorage.setItem('trainhard_v1_challenges', '"not-an-array"');
    w.localStorage.setItem('trainhard_premium_v1', '{"until":"мусор"}');
  });
  await sleep(2300);
  let w4 = dom4.window;
  check('C1 загрузка с битыми данными: 0 runtime errors', (w4.__errors || []).length === 0);
  check('C2 legacy-аккаунты (парольные хеши) удалены при старте', w4.localStorage.getItem('trainhard_react_accounts') === null);
  check('C3 битой premium-запись → не Premium', w4.__THPrem.isPremium() === false);
  check('C4 битые челленджи -> пустой список, не падает', Array.isArray(w4.__THChallengeService.getChallenges()) && w4.__THChallengeService.getChallenges().length === 0);
  const txt4 = w4.document.body.textContent || '';
  check('C5 приложение живо (UI отрисован)', txt4.length > 500);

  /* ===== Runtime: дубликаты и полный флоу ===== */
  console.log('— Runtime: дубликаты событий, флоу, сброс —');
  fetchCalls = 0;
  const w4svc = w4.__THChallengeService;
  const crt = w4svc.createChallenge({ title: 'Аудит', type: 'workout', durationDays: 7, targetWorkouts: 3, speechId: 's1' });
  w4svc.joinChallenge({ v: 1, id: crt.challenge.id, t: 'Аудит', d: 7, n: 3, f: 'fullbody', l: 'standard', s: 's1' });
  check('D1 повторный join того же id отклонён', w4svc.joinChallenge({ v: 1, id: crt.challenge.id, t: 'Аудит', d: 7, n: 3, f: 'fullbody', l: 'standard', s: 's1' }).reason === 'duplicate');
  w4svc.onWorkoutCompleted(1, '2026-08-28');
  w4svc.onWorkoutCompleted(1, '2026-08-28');
  check('D2 повторная тренировка в тот же день не задваивается', w4svc.getChallenge(crt.challenge.id).completedWorkouts === 1);
  w4svc.onWorkoutCompleted(2, '2026-08-29');
  const fin = w4svc.onWorkoutCompleted(3, '2026-08-30');
  const again = w4svc.onWorkoutCompleted(4, '2026-08-30');
  check('D3 завершение один раз (повторный completion — no-op)', fin.completed.length === 1 && again.completed.length === 0);
  check('D4 полный challenge-флоу без runtime errors и сети', (w4.__errors || []).length === 0 && fetchCalls === 0);

  /* Premium-тамперинг: прямой доступ к localStorage даёт только локальный UI-state */
  try { w4.__THPrem.activate({ source: 'console-tamper', days: 30 }); } catch (e) {}
  check('D5 тампёринг activate() = только локальный UI-state (нет серверных данных)', w4.__THPrem.isPremium() === true && !w4.localStorage.getItem('trainhard_premium_pending_v1'));
  check('D6 оплата TON: только публичный адрес, приватных ключей/mnemonic во frontend нет',
    /tonAddress/.test(html) && !/(tonPrivateKey|privateKey|mnemonic|seed\s?phrase|secretKey|api_key)/i.test(html));

  console.log('\nИтог: %d ✔ / %d ✘', passed, failed);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('АУДИТ УПАЛ:', e); process.exit(1); });
