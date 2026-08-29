/* Train Hard Challenges — E2E-тест (jsdom).
 * Покрывает 35 обязательных проверок спецификации: создание, кодек,
 * ссылки, превью, join, персистентность, прогресс, завершение,
 * strength-флоу, malformed/unknown/huge/version, offline,
 * дубликаты, множественные, удаление, сброс данных. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = path.join(__dirname, '..', 'app', 'index.html');
const html = fs.readFileSync(HTML, 'utf-8');
let fetchCalls = 0;

function boot(url, seed) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url,
    beforeParse(window) {
      window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.fetch = () => { fetchCalls++; return Promise.resolve({ json: () => Promise.resolve({ ok: false }) }); };
      window.scrollTo = () => {}; window.alert = () => {}; window.confirm = () => true;
      if (seed) seed(window);
    }
  });
  return dom;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (n, c) => { if (c) { passed++; console.log('  ✔ ' + n); } else { failed++; console.log('  ✘ ' + n); } };
const vis = (d) => { const c = d.body.cloneNode(true); c.querySelectorAll('script,style').forEach((n) => n.remove()); return c.textContent || ''; };
const click = (w, el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));

const b64url = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

(async () => {
  /* ===== A. Создание обычного челленджа (T1–T4) ===== */
  console.log('— Создание обычного челленджа —');
  let dom = boot('https://th.example/');
  let w = dom.window, d = w.document;
  await sleep(2300);
  const svc = w.__THChallengeService, codec = w.__THChallengeCodec;
  check('T1 сервис/кодек/речи/QR доступны', !!svc && !!codec && !!w.__THSpeeches && !!w.__THQR);
  check('T1b UI-модуль и роутер доступны', !!w.__THChallenges && !!w.__THChallengeRouter);

  const created = svc.createChallenge({ title: 'Неделя силы', type: 'workout', durationDays: 7, targetWorkouts: 4, focus: 'fullbody', difficulty: 'standard', speechId: 's2' });
  check('T1 create ok', created.ok && /^TH[A-Z0-9]{4,8}$/.test(created.challenge.id));
  const enc = codec.encode({ v: 1, id: created.challenge.id, t: 'Неделя силы', d: 7, n: 4, f: 'fullbody', l: 'standard', s: 's2' });
  check('T3 encode ok + base64url', enc.ok && /^[A-Za-z0-9_-]+$/.test(enc.payload));
  const url = codec.buildUrl(enc.payload);
  check('T3b self-contained URL', url.includes('?challenge=') && url.startsWith('https://th.example/'));
  check('T4 payload компактный (<600)', enc.payload.length <= codec.MAX_PAYLOAD_CHARS && enc.payload.length < 220);
  const dec = codec.decode(enc.payload);
  check('T6 decode roundtrip', dec.ok && dec.challenge.t === 'Неделя силы' && dec.challenge.n === 4 && dec.challenge.s === 's2');
  check('T6b полный текст речи НЕ в payload', !enc.payload.includes('s2'.padEnd(0)) && !Buffer.from(enc.payload, 'base64url').toString('utf8').includes('Постоянство'));

  /* меню приложения содержит пункт «Челленджи» */
  const menuHtml = html.includes('Челленджи');
  check('пункт меню «Челленджи» в сборке', menuHtml);
  const anA = w.__THAnalytics.snapshot();   /* created здесь */

  /* ===== B. Открытие ссылки в «свежем браузере» (T5–T8) ===== */
  console.log('— Ссылка → Preview → Join —');
  dom = boot('https://th.example/?challenge=' + enc.payload);
  w = dom.window; d = w.document;
  await sleep(3100);
  check('T5/T7 превью открылось', !!d.querySelector('.thch') && vis(d).includes('TRAIN HARD CHALLENGE'));
  check('T7b параметры видны (4 подряд / окно 7 дн)', vis(d).includes('4 ТРЕНИРОВОК ПОДРЯД · ОКНО 7 ДН.'));
  check('T7c цитата речи s2 (short, из словаря)', vis(d).includes('Начни с того, что есть сейчас'));
  check('T50 URL очищён от payload', !w.location.search.includes('challenge='));
  click(w, Array.from(d.querySelectorAll('button')).find((b) => /ПРИСОЕДИНИТЬСЯ/.test(b.textContent)));
  await sleep(400);
  let list = JSON.parse(w.localStorage.getItem('trainhard_v1_challenges') || '[]');
  const anB = w.__THAnalytics.snapshot();   /* joined здесь */
  check('T8 join сохранил локально', list.length === 1 && list[0].id === created.challenge.id && list[0].joinedAt > 0);
  check('T8b onJoin: свой joinedAt (startMode)', typeof list[0].joinedAt === 'number' && list[0].joinedAt <= Date.now());
  check('детали открыты (прогресс 0/4)', vis(d).includes('0 / 4'));

  /* ===== C. Закрыл/открыл снова: персистентность (T9–T11) ===== */
  console.log('— Персистентность —');
  const seedData = {};
  Object.keys(w.localStorage).forEach((k) => { if (k.indexOf('trainhard_') === 0) seedData[k] = w.localStorage.getItem(k); });
  const joined = JSON.parse(seedData['trainhard_v1_challenges']);
  joined[0].completedWorkouts = 2;
  seedData['trainhard_v1_challenges'] = JSON.stringify(joined);
  dom = boot('https://th.example/', (wnd) => { Object.keys(seedData).forEach((k) => { try { wnd.localStorage.setItem(k, seedData[k]); } catch (e) {} }); });
  w = dom.window; d = w.document;
  await sleep(2300);
  const reopened = w.__THChallengeService.getChallenge(created.challenge.id);
  check('T10/T11 прогресс сохранился после «переоткрытия» (2/4)', reopened && reopened.completedWorkouts === 2);

  /* ===== D. Завершение обычного челленджа (T12–T13) ===== */
  console.log('— Завершение и результат —');
  const r3 = w.__THChallenges.onWorkoutCompleted(1, '2026-08-28');
  const r4 = w.__THChallenges.onWorkoutCompleted(2, '2026-08-29');
  check('T12 автозачёт тренировок (2→4) → COMPLETE', r3.changed && r4.changed && r4.completed.length === 1);
  const fin = w.__THChallengeService.getChallenge(created.challenge.id);
  check('T12b статус completed', fin.status === 'completed' && fin.completedAt > 0);
  check('T12c дедуп по дате (одна тренировка в день)', w.__THChallengeService.onWorkoutCompleted(3, '2026-08-29').changed === false);
  w.__THChallenges.open();
  await sleep(250);
  click(w, Array.from(d.querySelectorAll('.thch-card')).find((c) => (c.textContent || '').includes('Неделя силы')));
  await sleep(300);
  check('T13 экран результата: ПОДЕЛИТЬСЯ РЕЗУЛЬТАТОМ', vis(d).includes('ЦЕЛЬ ДОСТИГНУТА') && vis(d).includes('ПОДЕЛИТЬСЯ РЕЗУЛЬТАТОМ'));
  check('T48 финальная часть речи s2 (completion, из словаря)', vis(d).includes('Ни одна отговорка не победила'));
  const an = w.__THAnalytics.snapshot();
  check('T59 аналитика: created(A)/joined(B)/completed(D)', (anA.events['challenge_created'] || 0) >= 1 && (anB.events['challenge_joined'] || 0) >= 1 && (an.events['challenge_completed'] || 0) >= 1);

  /* ===== E. Strength-флоу (T14–T25) ===== */
  console.log('— Strength Challenge —');
  const sc = svc2(w); // helper ниже не нужен — используем w
  const strengthCreated = w.__THChallengeService.createChallenge({ title: 'Жим 80', type: 'strength', durationDays: 30, exercise: 'bp', targetKg: 80, speechId: 's3' });
  check('T14 strength create ok', strengthCreated.ok);
  const sEnc = codec2(w).encode({ v: 1, id: strengthCreated.challenge.id, t: 'Жим 80', d: 30, f: 'strength', e: 'bp', w: 80, s: 's3' });
  check('T18 encode strength', sEnc.ok && sEnc.payload.length < 200);
  const sDec = codec2(w).decode(sEnc.payload);
  check('декод: e=bp, w=80, s=s3', sDec.ok && sDec.challenge.e === 'bp' && sDec.challenge.w === 80 && sDec.challenge.s === 's3');
  check('текст речи s3 не в payload', !Buffer.from(sEnc.payload, 'base64url').toString('utf8').includes('Маленькие шаги'));

  /* T19–T21: другой «браузер» */
  dom = boot('https://th.example/?challenge=' + sEnc.payload);
  w = dom.window; d = w.document;
  await sleep(3100);
  const sVis = vis(d);
  check('T19/T20 превью: ЖИМ ЛЁЖА + 80 КГ', sVis.includes('Жим лёжа') && sVis.includes('80 КГ'));
  check('T20b подпись «личная цель» (safety)', sVis.includes('Личная цель'));
  check('T17b цитата s3 (Шаг за шагом)', sVis.includes('Маленькие шаги'));
  click(w, Array.from(d.querySelectorAll('button')).find((b) => /ПРИСОЕДИНИТЬСЯ/.test(b.textContent)));
  await sleep(400);
  const sj = JSON.parse(w.localStorage.getItem('trainhard_v1_challenges') || '[]');
  check('T21 join strength', sj.length === 1 && sj[0].type === 'strength');

  /* T22–T23: прогресс силы вручную + через рекорд */
  let prog = w.__THChallengeService.getStrengthProgress(strengthCreated.challenge.id);
  check('старт: 0 / 80 (0%)', prog.currentKg === 0 && prog.percent === 0);
  w.__THChallengeService.updateStrengthProgress(strengthCreated.challenge.id, 65);
  prog = w.__THChallengeService.getStrengthProgress(strengthCreated.challenge.id);
  check('T22 ручной прогресс 65/80 → 81%', prog.currentKg === 65 && prog.percent === 81);
  w.__THChallengeService.updateStrengthProgress(strengthCreated.challenge.id, 82.5);
  const sFin = w.__THChallengeService.getChallenge(strengthCreated.challenge.id);
  check('T23/T24 превышение цели → COMPLETE (82.5 ≥ 80)', sFin.status === 'completed');
  w.__THChallenges.open();
  await sleep(250);
  click(w, Array.from(d.querySelectorAll('.thch-card')).find((c) => (c.textContent || '').includes('Жим 80')));
  await sleep(300);
  check('T24b экран: 82.5 / 80 КГ', vis(d).includes('82.5 / 80 КГ'));
  check('T25 кнопка шаринга результата', vis(d).includes('ПОДЕЛИТЬСЯ РЕЗУЛЬТАТОМ'));

  /* PR-интеграция: рекорд из приложения подтягивает цель */
  dom = boot('https://th.example/', (wnd) => {
    try { wnd.localStorage.setItem('trainhard_react_session', 'guest'); } catch (e) {}
    try { wnd.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({ progress: { bench: [{ month: '2026-08', weight: 70 }] } })); } catch (e) {}
  });
  w = dom.window; d = w.document;
  await sleep(2300);
  w.__THChallengeService.joinChallenge({ v: 1, id: 'THPR01', t: 'PR-тест', d: 30, f: 'strength', e: 'sq', w: 100, s: 's1' });
  const prCh = w.__THChallengeService.getChallenge('THPR01');
  check('§9 PR: старт из существующих рекордов не копируется в чужое упражнение', prCh.strengthCurrent === null);
  w.__THChallengeService.deleteChallenge('THPR01');
  w.__THChallengeService.joinChallenge({ v: 1, id: 'THPR02', t: 'PR-тест 2', d: 30, f: 'strength', e: 'bp', w: 100, s: 's1' });
  const prCh2 = w.__THChallengeService.getChallenge('THPR02');
  check('§9b PR: жим подтянул рекорд 70 кг как старт', prCh2.strengthCurrent === 70);
  const hook = w.__THChallenges.onRecordAdded('bench', 102.5);
  check('§9c addRecord-хук: 102.5 ≥ 100 → завершение', hook.completed.length === 1 && w.__THChallengeService.getChallenge('THPR02').status === 'completed');

  /* ===== F. Ошибочные ссылки (T26–T30) ===== */
  console.log('— Мусорные ссылки —');
  async function badUrl(label, url, expectText) {
    const dd = boot(url);
    await sleep(3000);
    const ok = vis(dd.window.document).includes(expectText);
    check(label, ok && !!dd.window.document.querySelector('.thch'));
    dd.window.close();
  }
  await badUrl('T26 malformed base64 → НЕКОРРЕКТНАЯ ССЫЛКА', 'https://th.example/?challenge=%21%21%21notb64', 'НЕКОРРЕКТНАЯ ССЫЛКА');
  await badUrl('T26b мусорный JSON', 'https://th.example/?challenge=' + b64url({ foo: 1 }), 'НЕКОРРЕКТНАЯ ССЫЛКА');
  await badUrl('T27 unknown speechId → fallback s1 + пометка', 'https://th.example/?challenge=' + b64url({ v: 1, id: 'THSPCH', t: 'X', d: 7, n: 4, f: 'fullbody', l: 'standard', s: 's99' }), 'Мотивация по умолчанию');
  await badUrl('T28 unknown exercise → НЕ ПОДДЕРЖИВАЕТСЯ', 'https://th.example/?challenge=' + b64url({ v: 1, id: 'THEXER', t: 'X', d: 7, f: 'strength', e: 'ohp', w: 50, s: 's1' }), 'НЕ ПОДДЕРЖИВАЕТСЯ');
  await badUrl('T29 huge payload → НЕКОРРЕКТНЫЙ ЧЕЛЛЕНДЖ', 'https://th.example/?challenge=' + 'A'.repeat(3000), 'слишком большая');
  await badUrl('T30 unknown version → ВЕРСИЯ НЕ ПОДДЕРЖИВАЕТСЯ', 'https://th.example/?challenge=' + b64url({ v: 2, id: 'THVER2', t: 'X', d: 7, n: 4, f: 'fullbody', l: 'standard', s: 's1' }), 'ВЕРСИЯ НЕ ПОДДЕРЖИВАЕТСЯ');

  /* XSS через payload: <img> в title не исполняется */
  const xss = b64url({ v: 1, id: 'THXSS1', t: '<img src=x onerror=window.__xss=1>', d: 7, n: 4, f: 'fullbody', l: 'standard', s: 's1' });
  const xd = boot('https://th.example/?challenge=' + xss);
  await sleep(3000);
  check('§51 XSS: payload-текст не исполняется', !xd.window.__xss && !xd.window.document.querySelector('img[src="x"]'));
  check('§51b title выводится как текст (textContent)', vis(xd.window.document).includes('<img src=x onerror'));
  xd.window.close();

  /* ===== G. Offline / дубликаты / множественные / удаление / сброс ===== */
  console.log('— Offline, дубликаты, лимиты, удаление, сброс —');
  const before = fetchCalls; fetchCalls = 0;
  dom = boot('https://th.example/?challenge=' + enc.payload);
  w = dom.window; d = w.document;
  await sleep(3100);
  click(w, Array.from(d.querySelectorAll('button')).find((b) => /ПРИСОЕДИНИТЬСЯ/.test(b.textContent)));
  await sleep(300);
  w.__THChallengeService.joinChallenge({ v: 1, id: 'THMULT1', t: 'A', d: 3, n: 3, f: 'mixed', l: 'easy', s: 's1' });
  w.__THChallengeService.joinChallenge({ v: 1, id: 'THMULT2', t: 'B', d: 7, n: 5, f: 'core', l: 'standard', s: 's2' });
  check('T31 offline: 0 сетевых запросов за весь флоу', fetchCalls === 0);
  const dup = w.__THChallengeService.joinChallenge(JSON.parse(JSON.stringify({ v: 1, id: created.challenge.id, t: 'Неделя силы', d: 7, n: 4, f: 'fullbody', l: 'standard', s: 's2' })));
  check('T32 duplicate join отклонён', dup.ok === false && dup.reason === 'duplicate');
  w.__THChallenges.openPreview(enc.payload);
  await sleep(400);
  check('T32b «Уже участвуешь» + ОТКРЫТЬ', vis(d).includes('Уже участвуешь') && vis(d).includes('ОТКРЫТЬ ЧЕЛЛЕНДЖ'));
  const all3 = w.__THChallengeService.getChallenges();
  check('T33 несколько челленджей одновременно', all3.length === 3);
  const lim = w.__THChallengeService.joinChallenge({ v: 1, id: 'THLIM1', t: 'L', d: 3, n: 3, f: 'mixed', l: 'easy', s: 's1' });
  check('§42 лимит FREE=3 активных', lim.ok === false && lim.reason === 'limit' && lim.limit === 3);
  w.__THPrem.activate({ source: 'test', days: 30 });
  await sleep(150);
  const lim2 = w.__THChallengeService.joinChallenge({ v: 1, id: 'THLIM2', t: 'L2', d: 3, n: 3, f: 'mixed', l: 'easy', s: 's1' });
  check('§42b Premium: лимит расширяется (join ok)', lim2.ok === true);
  w.__THChallengeService.deleteChallenge('THLIM2');
  check('T34 удаление', w.__THChallengeService.getChallenge('THLIM2') === null);
  check('T35a сброс: челленджи в отдельном ключе StorageService', !!w.localStorage.getItem('trainhard_v1_challenges'));

  /* T35: «Сбросить всё» в профиле очищает челленджи (P24) — дом с готовым профилем */
  const chBeforeReset = JSON.parse(w.localStorage.getItem('trainhard_v1_challenges') || '[]');
  const resetDom = boot('https://th.example/', (wnd) => {
    try {
      wnd.localStorage.setItem('trainhard_react_session', 'guest');
      wnd.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({
        login: 'guest', name: 'Тест', city: 'Москва', height: 175, weight: 80, age: 28, gender: 'male', level: 1,
        program: 'powerlifting', trainingPlan: { name: 'Троеборье', days: [{ day: 1, focus: 'Верх', exercises: ['Жим штанги 4×8'] }] },
        completedDays: {}, streak: 0, bestStreak: 0, goalArchive: [], progress: { bench: [], squat: [], deadlift: [] },
        achievements: [], workoutLogs: [], records: {}, flameName: '', nutGoal: 'mass', premiumUntil: null, customDays: {}
      }));
      wnd.localStorage.setItem('trainhard_v1_challenges', JSON.stringify(chBeforeReset));
    } catch (e) {}
  });
  const rw = resetDom.window, rd = resetDom.window.document;
  await sleep(2400);
  click(rw, Array.from(rd.querySelectorAll('nav button')).find((b) => /Профиль/.test(b.textContent || '')));
  await sleep(500);
  const resetBtn = Array.from(rd.querySelectorAll('button')).find((b) => /Сбросить всё/.test(b.textContent || ''));
  check('T35 кнопка «Сбросить всё» найдена (профиль открыт)', !!resetBtn);
  click(rw, resetBtn);
  await sleep(800);
  check('T35 «Сбросить всё» удалил челленджи', (rw.localStorage.getItem('trainhard_v1_challenges') || 'null') === 'null' || JSON.parse(rw.localStorage.getItem('trainhard_v1_challenges') || '[]').length === 0);


  /* ===== N. FAB, аудитория «для себя / для друга», пресеты «подряд», Прогресс, серия ===== */
  console.log('— FAB, для себя/для друга, пресеты подряд, Прогресс, сброс серии —');

  /* N1: FAB появляется при якоре-огоньке, клик открывает челленджи */
  let domN = boot('https://th.example/');
  let wN = domN.window, dN = wN.document;
  await sleep(1600);
  const anchor = dN.createElement('button');
  anchor.className = 'absolute z-30 bottom-4 left-4';
  dN.body.appendChild(anchor);
  wN.__THAppIntegration.tick();
  const fab = dN.querySelector('.thch-fab');
  check('N1 FAB «⚡ Челленджи» у правого нижнего угла (при огоньке слева)', !!fab && fab.style.display === 'flex' && /Челленджи/.test(fab.textContent));
  click(wN, fab);
  await sleep(300);
  check('N1b клик по FAB открывает челленджи', vis(dN).includes('СОЗДАТЬ ЧЕЛЛЕНДЖ'));
  anchor.remove();
  wN.__THAppIntegration.tick();
  check('N1c FAB скрывается вне главной', fab.style.display === 'none');
  wN.__THChallenges.close();

  /* N2: аудитория → только 2 типа → пресеты подряд → друг → шаринг */
  wN.__THChallenges.openCreate();
  await sleep(200);
  check('N2 экран «Для кого?» (для себя / для друга)', vis(dN).includes('Для кого?') && vis(dN).includes('ДЛЯ СЕБЯ') && vis(dN).includes('ДЛЯ ДРУГА'));
  click(wN, Array.from(dN.querySelectorAll('button')).find((b) => /ДЛЯ ДРУГА/.test(b.textContent || '')));
  await sleep(200);
  check('N2b тип: только 2 кнопки (ТРЕНИРОВКИ / СИЛА)', /ТРЕНИРОВКИ/.test(vis(dN)) && /СИЛА/.test(vis(dN)) && !/Old School/.test(vis(dN)) && dN.querySelectorAll('.thch-big').length === 2);
  click(wN, Array.from(dN.querySelectorAll('.thch-big')).find((b) => /ТРЕНИРОВКИ/.test(b.textContent || '')));
  await sleep(200);
  const chipsTxt = Array.from(dN.querySelectorAll('.thch-chip')).map((c) => c.textContent.trim());
  check('N2c пресеты 3/7/14/30 подряд', ['3 подряд', '7 подряд', '14 подряд', '30 подряд'].every((x) => chipsTxt.some((c) => c.indexOf(x) === 0)));
  check('N2d нет старых_chip длительности/цели', !chipsTxt.some((x) => / дн$/.test(x) || / тренир\./.test(x)));
  check('N2e правило «подряд» объяснено', vis(dN).includes('максимум 1 день'));
  click(wN, Array.from(dN.querySelectorAll('.thch-chip')).find((c) => c.textContent.trim() === '7 подряд'));
  await sleep(150);
  click(wN, Array.from(dN.querySelectorAll('button')).find((b) => /ДАЛЕЕ/.test(b.textContent || '')));
  await sleep(150);
  click(wN, Array.from(dN.querySelectorAll('button')).find((b) => /ДАЛЕЕ/.test(b.textContent || '')));
  await sleep(150);
  click(wN, Array.from(dN.querySelectorAll('button')).find((b) => /СОЗДАТЬ ЧЕЛЛЕНДЖ/.test(b.textContent || '')));
  await sleep(250);
  check('N2f для друга → экран шаринга', vis(dN).includes('Челлендж готов') && vis(dN).includes('ПОДЕЛИТЬСЯ'));
  const encN = wN.__THChallengeCodec.encode({ v: 1, id: 'THP007', t: '7 подряд', d: 14, n: 7, f: 'fullbody', l: 'standard', s: 's1' });
  const encN2 = wN.__THChallengeCodec.encode({ v: 1, id: 'THP030', t: '30 подряд', d: 60, n: 30, f: 'fullbody', l: 'standard', s: 's1' });
  const encBad = wN.__THChallengeCodec.encode({ v: 1, id: 'THPXX1', t: 'x', d: 7, n: 99, f: 'fullbody', l: 'standard', s: 's1' });
  check('N2g codec: пресеты 7/14 и 30/60 валидны, n=99 — нет', encN.ok && encN2.ok && !encBad.ok);

  /* N3: для себя — автоприсоединение, без шаринга */
  let domS = boot('https://th.example/');
  let wS = domS.window, dS = domS.window.document;
  await sleep(1600);
  wS.__THChallenges.openCreate();
  await sleep(150);
  click(wS, Array.from(dS.querySelectorAll('button')).find((b) => /ДЛЯ СЕБЯ/.test(b.textContent || '')));
  await sleep(150);
  click(wS, Array.from(dS.querySelectorAll('.thch-big')).find((b) => /ТРЕНИРОВКИ/.test(b.textContent || '')));
  await sleep(150);
  click(wS, Array.from(dS.querySelectorAll('.thch-chip')).find((c) => c.textContent.trim() === '3 подряд'));
  await sleep(120);
  click(wS, Array.from(dS.querySelectorAll('button')).find((b) => /ДАЛЕЕ/.test(b.textContent || '')));
  await sleep(120);
  click(wS, Array.from(dS.querySelectorAll('button')).find((b) => /ДАЛЕЕ/.test(b.textContent || '')));
  await sleep(120);
  click(wS, Array.from(dS.querySelectorAll('button')).find((b) => /СОЗДАТЬ ЧЕЛЛЕНДЖ/.test(b.textContent || '')));
  await sleep(300);
  const listS = wS.__THChallengeService.getChallenges();
  check('N3 для себя: сразу присоединён (active=1, прогресс 0/3)', listS.filter((c) => c.status === 'active').length === 1 && listS[0].completedWorkouts === 0 && listS[0].targetWorkouts === 3);
  check('N3b для себя: без экрана шаринга', !vis(dS).includes('ПОДЕЛИТЬСЯ'));

  /* N4: семантика «подряд» в сервисе (перерыв ≤1 дня, 2 пропущенных — сброс) */
  const S4 = wS.__THChallengeService;
  S4.onWorkoutCompleted(1, '2026-08-28');
  S4.onWorkoutCompleted(2, '2026-08-29');
  let c4 = S4.getChallenges()[0];
  check('N4 подряд: 2 дня подряд → 2/3', c4.completedWorkouts === 2);
  const rBreak = S4.onWorkoutCompleted(3, '2026-09-02');   /* перерыв 4 дня → сброс */
  c4 = S4.getChallenges()[0];
  check('N4b перерыв >2 дней → счёт заново (1/3) + broke', c4.completedWorkouts === 1 && rBreak.broke && rBreak.broke.length === 1);
  check('N4c notice о сбросе сохранён', /заново/.test(c4.notice || ''));
  S4.onWorkoutCompleted(4, '2026-09-03');
  const rFin = S4.onWorkoutCompleted(5, '2026-09-04');
  c4 = S4.getChallenges()[0];
  check('N4d добил 3 подряд → COMPLETE', rFin.completed.length === 1 && c4.status === 'completed' && c4.completedAt > 0);
  check('N4e дедуп по дате остаётся', S4.onWorkoutCompleted(6, '2026-09-04').changed === false);

  /* N5: сброс серии (P25): 2 дня без тренировок → streak=0 + уведомление */
  const chSeed = JSON.parse(wS.localStorage.getItem('trainhard_v1_challenges') || '[]');
  let domR = boot('https://th.example/', (wnd) => {
    try {
      wnd.localStorage.setItem('trainhard_react_session', 'guest');
      wnd.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({
        login: 'guest', name: 'Тест', city: 'Москва', height: 175, weight: 80, age: 28, gender: 'male', level: 1,
        program: 'powerlifting', trainingPlan: { name: 'Троеборье', days: [{ day: 1, focus: 'Верх', exercises: ['Жим штанги 4×8'] }] },
        completedDays: { '2026-08-25': true }, streak: 5, bestStreak: 5, goalArchive: [], progress: { bench: [], squat: [], deadlift: [] },
        achievements: [], workoutLogs: [], records: {}, flameName: '', nutGoal: 'mass', premiumUntil: null, customDays: {}
      }));
      wnd.localStorage.setItem('trainhard_v1_challenges', JSON.stringify(chSeed.filter((c) => c.status !== 'completed' || true)));
    } catch (e) {}
  });
  let wR = domR.window, dR = domR.window.document;
  await sleep(2200);
  const storedR = JSON.parse(wR.localStorage.getItem('trainhard_react_data_guest') || '{}');
  check('N5 серия сброшена при загрузке (streak 5 → 0)', wR.__thStreakResetFrom === 5 && storedR.streak === 0);
  const stToast = dR.querySelector('.thch-streak-toast');
  check('N5b уведомление «Серия обновилась…2 дня»', !!stToast && /Серия обновилась/.test(stToast.textContent) && /2 дня/.test(stToast.textContent));

  /* N5c: свежая тренировка вчера — сброса нет */
  let domR2 = boot('https://th.example/', (wnd) => {
    try {
      wnd.localStorage.setItem('trainhard_react_session', 'guest');
      wnd.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({
        login: 'guest', name: 'Тест', city: 'Москва', height: 175, weight: 80, age: 28, gender: 'male', level: 1,
        program: 'powerlifting', trainingPlan: { name: 'Троеборье', days: [{ day: 1, focus: 'Верх', exercises: ['Жим штанги 4×8'] }] },
        completedDays: { [new Date(Date.now() - 864e5).toISOString().slice(0, 10)]: true }, streak: 2, bestStreak: 2, goalArchive: [], progress: { bench: [], squat: [], deadlift: [] },
        achievements: [], workoutLogs: [], records: {}, flameName: '', nutGoal: 'mass', premiumUntil: null, customDays: {}
      }));
    } catch (e) {}
  });
  await sleep(1800);
  check('N5c вчерашняя тренировка — серия жива', !domR2.window.__thStreakResetFrom && JSON.parse(domR2.window.localStorage.getItem('trainhard_react_data_guest') || '{}').streak === 2);

  /* N6: раздел «Прогресс»: шкалы челленджей + серые достижения */
  let domP = boot('https://th.example/', (wnd) => {
    try {
      wnd.localStorage.setItem('trainhard_react_session', 'guest');
      wnd.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({
        login: 'guest', name: 'Тест', city: 'Москва', height: 175, weight: 80, age: 28, gender: 'male', level: 1,
        program: 'powerlifting', trainingPlan: { name: 'Троеборье', days: [{ day: 1, focus: 'Верх', exercises: ['Жим штанги 4×8'] }] },
        completedDays: { '2026-08-28': true }, streak: 1, bestStreak: 1, goalArchive: [], progress: { bench: [], squat: [], deadlift: [] },
        achievements: ['streak7'], workoutLogs: [], records: {}, flameName: '', nutGoal: 'mass', premiumUntil: null, customDays: {}
      }));
      const now = Date.now();
      wnd.localStorage.setItem('trainhard_v1_challenges', JSON.stringify([{
        id: 'THPRG1', type: 'workout', title: 'Неделя силы', durationDays: 7, targetWorkouts: 3, focus: 'fullbody',
        difficulty: 'standard', speechId: 's2', strengthGoal: null, strengthCurrent: null,
        completedWorkouts: 1, joinedAt: now - 86400000, lastWorkoutDate: '', notice: '', completedAt: 0
      }]));
    } catch (e) {}
  });
  let wP = domP.window, dP = domP.window.document;
  await sleep(2000);
  const fabReal = dP.querySelector('.thch-fab');
  check('N6 FAB на главной (реальный React DOM)', !!fabReal && fabReal.style.display === 'flex');
  const progBtn = Array.from(dP.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Прогресс');
  click(wP, progBtn);
  await sleep(1200);
  wP.__THAppIntegration.tick();
  const pcard = dP.querySelector('[data-thch="progress"]');
  check('N6b карточка «Челленджи» в разделе Прогресс', !!pcard && /Неделя силы/.test(pcard.textContent) && /1 \/ 3 подряд/.test(pcard.textContent));
  const fillP = pcard && pcard.querySelector('.thch-pfill');
  check('N6c шкала-заполнение 33%', !!fillP && fillP.style.width === '33%');
  const achCard = Array.from(dP.querySelectorAll('span')).find((s) => s.textContent === 'Достижения');
  const grayN = achCard ? achCard.parentElement.querySelectorAll('.th-ach-gray').length : -1;
  check('N6d достижения: 4 незакрытых — серые, streak7 — цветной', grayN === 4);
  check('N6e карточка стоит перед «Достижениями»', !!(pcard && achCard && (pcard.compareDocumentPosition(achCard.parentElement) & wP.Node.DOCUMENT_POSITION_FOLLOWING)));
  /* завершаем челлендж → шкала 100% + ГОТОВО */
  wP.__THChallengeService.onWorkoutCompleted(1, '2026-08-28');
  wP.__THChallengeService.onWorkoutCompleted(2, '2026-08-29');
  wP.__THAppIntegration.tick();
  await sleep(150);
  const pcard2 = dP.querySelector('[data-thch="progress"]');
  check('N6f после завершения: 100% и ГОТОВО', !!pcard2 && /ГОТОВО/.test(pcard2.textContent) && pcard2.querySelector('.thch-pfill.is-done'));


  /* ===== S. QR-сканер, редактор без фокуса/сложности, регресс «0/4», лимит ===== */
  console.log('— QR-сканер, редактор, регресс «0/4», лимит —');

  let domQ = boot('https://th.example/');
  let wQ = domQ.window, dQ = domQ.window.document;
  await sleep(1600);

  /* S1: декодер в сборке + пиксельный roundtrip */
  check('S1 локальный декодер __THQRDecode в сборке', typeof wQ.__THQRDecode === 'function');
  const urlS = wQ.__THChallengeCodec.buildUrl(wQ.__THChallengeCodec.encode({ v: 1, id: 'THSCAN1', t: 'Скан', d: 14, n: 7, f: 'fullbody', l: 'standard', s: 's1' }).payload);
  const qrS = wQ.__THQR.generate(urlS);
  const quiet = 4, dimS = qrS.size + quiet * 2;
  const px = new wQ.Uint8ClampedArray(dimS * dimS * 4);
  for (let y = 0; y < dimS; y++) for (let x = 0; x < dimS; x++) {
    const mx = x - quiet, my = y - quiet;
    const dark = mx >= 0 && my >= 0 && mx < qrS.size && my < qrS.size && qrS.modules[my][mx];
    const i = (y * dimS + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = dark ? 0 : 255; px[i + 3] = 255;
  }
  const decS = wQ.__THQRDecode(px, dimS, dimS);
  check('S1b QR roundtrip: генерация -> декодирование = тот же URL', decS === urlS);

  /* S2: экран сканирования — ручная вставка (jsdom без камеры) */
  wQ.__THChallenges.open();
  await sleep(200);
  click(wQ, Array.from(dQ.querySelectorAll('button')).find((b) => /СКАНИРОВАТЬ QR/.test(b.textContent || '')));
  await sleep(200);
  check('S2 экран сканирования + ручной ввод', vis(dQ).includes('ИЛИ ВСТАВЬ ССЫЛКУ'));
  const inpQ = dQ.querySelector('.thch-input');
  inpQ.value = urlS;
  click(wQ, Array.from(dQ.querySelectorAll('button')).find((b) => /ОТКРЫТЬ ЧЕЛЛЕНДЖ/.test(b.textContent || '')));
  await sleep(300);
  check('S2b ссылка из поля -> превью «Скан» + ПРИСОЕДИНИТЬСЯ', vis(dQ).includes('Скан') && vis(dQ).includes('ПРИСОЕДИНИТЬСЯ'));

  /* S2c: мусор -> тост, без превью */
  wQ.__THChallenges.close();
  await sleep(100);
  wQ.__THChallenges.open();
  await sleep(150);
  click(wQ, Array.from(dQ.querySelectorAll('button')).find((b) => /СКАНИРОВАТЬ QR/.test(b.textContent || '')));
  await sleep(150);
  const inpQ2 = dQ.querySelector('.thch-input');
  inpQ2.value = 'мусор не ссылка';
  click(wQ, Array.from(dQ.querySelectorAll('button')).find((b) => /ОТКРЫТЬ ЧЕЛЛЕНДЖ/.test(b.textContent || '')));
  await sleep(150);
  const toastQ = dQ.querySelector('.thch-toast');
  check('S2c мусор -> тост «не ссылка челленджа»', !!toastQ && /не ссылка челленджа/.test(toastQ.textContent) && !vis(dQ).includes('ПРИСОЕДИНИТЬСЯ'));
  wQ.__THChallenges.close();

  /* S3: редактор тренировок — только «подряд», без Фокуса и Сложности */
  wQ.__THChallenges.openCreate();
  await sleep(150);
  click(wQ, Array.from(dQ.querySelectorAll('button')).find((b) => /ДЛЯ СЕБЯ/.test(b.textContent || '')));
  await sleep(150);
  click(wQ, Array.from(dQ.querySelectorAll('.thch-big')).find((b) => /ТРЕНИРОВКИ/.test(b.textContent || '')));
  await sleep(150);
  check('S3 редактор: нет «Фокус» и «Сложность»', !vis(dQ).includes('Фокус') && !vis(dQ).includes('Сложность'));
  check('S3b пресеты остались', /3 подряд/.test(vis(dQ)) && /30 подряд/.test(vis(dQ)));

  /* S4: регресс бага «0/4»: свой 7-подряд + старый 0/4 — в Прогрессе оба, с верными числами */
  let domW = boot('https://th.example/', (wnd) => {
    try {
      wnd.localStorage.setItem('trainhard_react_session', 'guest');
      wnd.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({
        login: 'guest', name: 'Тест', city: 'Москва', height: 175, weight: 80, age: 28, gender: 'male', level: 1,
        program: 'powerlifting', trainingPlan: { name: 'Троеборье', days: [{ day: 1, focus: 'Верх', exercises: ['Жим штанги 4×8'] }] },
        completedDays: { '2026-08-28': true }, streak: 1, bestStreak: 1, goalArchive: [], progress: { bench: [], squat: [], deadlift: [] },
        achievements: [], workoutLogs: [], records: {}, flameName: '', nutGoal: 'mass', premiumUntil: null, customDays: {}
      }));
      wnd.localStorage.setItem('trainhard_v1_challenges', JSON.stringify([{
        id: 'THOLD1', type: 'workout', title: 'Неделя силы', durationDays: 7, targetWorkouts: 4, focus: 'fullbody',
        difficulty: 'standard', speechId: 's2', strengthGoal: null, strengthCurrent: null,
        completedWorkouts: 0, joinedAt: Date.now() - 3 * 86400000, lastWorkoutDate: '', notice: '', completedAt: 0
      }]));
    } catch (e) {}
  });
  let wW = domW.window, dW = domW.window.document;
  await sleep(2000);
  const svcW = wW.__THChallengeService;
  const crtW = svcW.createChallenge({ title: '7 тренировок подряд', type: 'workout', durationDays: 14, targetWorkouts: 7, focus: 'fullbody', difficulty: 'standard', speechId: 's1' });
  const jrW = svcW.joinChallenge({ v: 1, id: crtW.challenge.id, t: crtW.challenge.title, d: 14, n: 7, f: 'fullbody', l: 'standard', s: 's1' });
  check('S4 свой «7 подряд» присоединён (target=7)', jrW.ok && svcW.getChallenge(crtW.challenge.id).targetWorkouts === 7);
  click(wW, Array.from(dW.querySelectorAll('nav button')).find((b) => /Прогресс/.test(b.textContent || '')));
  await sleep(1200);
  wW.__THAppIntegration.tick();
  await sleep(150);
  const pcardW = dW.querySelector('[data-thch="progress"]');
  const rowsW = pcardW ? Array.from(pcardW.querySelectorAll('.thch-prow')) : [];
  check('S4b в Прогрессе обе шкалы (новый + старый)', rowsW.length === 2);
  if (rowsW.length === 2) {
    check('S4c новый сверху: «0 / 7 подряд · 14 дн»', /0\/7 подряд/.test(rowsW[0].textContent.replace(/ \/ /g, '/')) || /0 \/ 7 подряд/.test(rowsW[0].textContent) && /14 дн/.test(rowsW[0].textContent));
    check('S4d старый ниже: «0 / 4 подряд · 4 дн»', /0 \/ 4 подряд/.test(rowsW[1].textContent) && /4 дн/.test(rowsW[1].textContent));
    check('S4e названия различимы', /7 тренировок подряд/.test(rowsW[0].textContent) && /Неделя силы/.test(rowsW[1].textContent));
  }

  /* S5: лимит активных — «для себя» честно предупреждает, без тихого фолбэка */
  svcW.joinChallenge({ v: 1, id: 'THLIM99', t: 'Третий', d: 7, n: 3, f: 'fullbody', l: 'standard', s: 's1' });
  check('S5 три активных (лимит FREE)', svcW.activeCount() === 3);
  wW.__THChallenges.openCreate();
  await sleep(200);
  click(wW, Array.from(dW.querySelectorAll('button')).find((b) => /ДЛЯ СЕБЯ/.test(b.textContent || '')));
  await sleep(200);
  click(wW, Array.from(dW.querySelectorAll('.thch-big')).find((b) => /ТРЕНИРОВКИ/.test(b.textContent || '')));
  await sleep(200);
  click(wW, Array.from(dW.querySelectorAll('.thch-chip')).find((c) => c.textContent.trim().indexOf('3 подряд') === 0));
  await sleep(150);
  click(wW, Array.from(dW.querySelectorAll('button')).find((b) => /ДАЛЕЕ/.test(b.textContent || '')));
  await sleep(150);
  click(wW, Array.from(dW.querySelectorAll('button')).find((b) => /ДАЛЕЕ/.test(b.textContent || '')));
  await sleep(150);
  click(wW, Array.from(dW.querySelectorAll('button')).find((b) => /СОЗДАТЬ ЧЕЛЛЕНДЖ/.test(b.textContent || '')));
  await sleep(300);
  check('S5b экран шаринга с предупреждением о лимите', vis(dW).includes('лимит активных челленджей') && vis(dW).includes('ПОДЕЛИТЬСЯ'));
  check('S5c тихо НЕ присоединился (активных всё ещё 3)', svcW.activeCount() === 3);


  /* ===== K. FAB-возврат, клик по карточке, произвольная длительность, 14/30 free ===== */
  console.log('— FAB после закрытия, карточка в Прогрессе, любая длительность, 14/30 free —');

  let domK = boot('https://th.example/');
  let wK = domK.window, dK = domK.window.document;
  await sleep(1600);
  const anchorK = dK.createElement('button');
  anchorK.className = 'absolute z-30 bottom-4 left-4';
  dK.body.appendChild(anchorK);
  wK.__THAppIntegration.tick();
  const fabK = dK.querySelector('.thch-fab');
  check('K1 FAB на главной', !!fabK && fabK.style.display === 'flex');
  click(wK, fabK);
  await sleep(250);
  check('K2 оверлей открыт — FAB скрыт (body.thch-open)', dK.body.classList.contains('thch-open'));
  click(wK, Array.from(dK.querySelectorAll('.thch-x')).find((b) => (b.textContent || '') === '✕'));
  await sleep(250);
  wK.__THAppIntegration.tick();
  check('K3 после закрытия FAB вернулся (класс снят)', !dK.body.classList.contains('thch-open') && fabK.style.display === 'flex');
  anchorK.remove();

  /* K4: карточка в Прогрессе открывается кликом по любому месту */
  let domC = boot('https://th.example/', (wnd) => {
    try {
      wnd.localStorage.setItem('trainhard_react_session', 'guest');
      wnd.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({
        login: 'guest', name: 'Тест', city: 'Москва', height: 175, weight: 80, age: 28, gender: 'male', level: 1,
        program: 'powerlifting', trainingPlan: { name: 'Троеборье', days: [{ day: 1, focus: 'Верх', exercises: ['Жим штанги 4×8'] }] },
        completedDays: {}, streak: 0, bestStreak: 0, goalArchive: [], progress: { bench: [], squat: [], deadlift: [] },
        achievements: [], workoutLogs: [], records: {}, flameName: '', nutGoal: 'mass', premiumUntil: null, customDays: {}
      }));
      wnd.localStorage.setItem('trainhard_v1_challenges', JSON.stringify([{
        id: 'THCLK1', type: 'workout', title: 'Клик-тест', durationDays: 7, targetWorkouts: 3, focus: 'fullbody',
        difficulty: 'standard', speechId: 's1', strengthGoal: null, strengthCurrent: null,
        completedWorkouts: 1, joinedAt: Date.now() - 86400000, lastWorkoutDate: '', notice: '', completedAt: 0
      }]));
    } catch (e) {}
  });
  let wC = domC.window, dC = domC.window.document;
  await sleep(2000);
  click(wC, Array.from(dC.querySelectorAll('nav button')).find((b) => /Прогресс/.test(b.textContent || '')));
  await sleep(1200);
  wC.__THAppIntegration.tick();
  await sleep(150);
  const pcardK = dC.querySelector('[data-thch="progress"]');
  check('K4 карточка «Челленджи» в Прогрессе', !!pcardK);
  click(wC, pcardK);
  await sleep(250);
  check('K4b клик по любому месту карточки -> челленджи', vis(dC).includes('СОЗДАТЬ ЧЕЛЛЕНДЖ'));
  wC.__THChallenges.close();

  /* K5: 14/30 бесплатно + свой вариант длительности */
  wK.__THChallenges.openCreate();
  await sleep(150);
  click(wK, Array.from(dK.querySelectorAll('button')).find((b) => /ДЛЯ СЕБЯ/.test(b.textContent || '')));
  await sleep(150);
  click(wK, Array.from(dK.querySelectorAll('.thch-big')).find((b) => /ТРЕНИРОВКИ/.test(b.textContent || '')));
  await sleep(150);
  const chipsK = Array.from(dK.querySelectorAll('.thch-chip')).map((c) => c.textContent.trim());
  check('K5 14 и 30 подряд без ★ (бесплатно)', chipsK.includes('14 подряд') && chipsK.includes('30 подряд'));
  const inpK = dK.querySelector('input[type="number"]');
  check('K5b поле «своё: сколько подряд» присутствует', !!inpK && /сколько подряд/.test(inpK.placeholder));
  inpK.value = '12';
  inpK.dispatchEvent(new wK.Event('change', { bubbles: true }));
  await sleep(200);
  click(wK, Array.from(dK.querySelectorAll('button')).find((b) => /ДАЛЕЕ/.test(b.textContent || '')));
  await sleep(150);
  click(wK, Array.from(dK.querySelectorAll('button')).find((b) => /ДАЛЕЕ/.test(b.textContent || '')));
  await sleep(150);
  click(wK, Array.from(dK.querySelectorAll('button')).find((b) => /СОЗДАТЬ ЧЕЛЛЕНДЖ/.test(b.textContent || '')));
  await sleep(300);
  const kList = wK.__THChallengeService.getChallenges();
  check('K5c свой вариант: 12 подряд, окно 30 дн, joined', kList.length === 1 && kList[0].targetWorkouts === 12 && kList[0].durationDays === 30 && kList[0].status === 'active');

  /* K6: codec — произвольные значения в диапазонах */
  const cdK = wK.__THChallengeCodec;
  check('K6 codec: n=8/d=45 валидны, n=1/n=100/d=200/d=0.5 — нет',
    cdK.encode({ v: 1, id: 'THRNG01', t: 'x', d: 45, n: 8, f: 'fullbody', l: 'standard', s: 's1' }).ok === true &&
    cdK.encode({ v: 1, id: 'THRNG02', t: 'x', d: 7, n: 1, f: 'fullbody', l: 'standard', s: 's1' }).ok === false &&
    cdK.encode({ v: 1, id: 'THRNG03', t: 'x', d: 7, n: 100, f: 'fullbody', l: 'standard', s: 's1' }).ok === false &&
    cdK.encode({ v: 1, id: 'THRNG04', t: 'x', d: 200, n: 3, f: 'fullbody', l: 'standard', s: 's1' }).ok === false &&
    cdK.encode({ v: 1, id: 'THRNG05', t: 'x', d: 0.5, n: 3, f: 'fullbody', l: 'standard', s: 's1' }).ok === false);


  /* ===== M. FAB над панелью, ввод «своё» без сброса ===== */
  console.log('— FAB над нижней панелью, живой ввод своих значений —');

  /* M1: FAB поднимается над nav (в jsdom нет layout — стабаем высоту панели) */
  let domM = boot('https://th.example/', (wnd) => {
    try {
      wnd.localStorage.setItem('trainhard_react_session', 'guest');
      wnd.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({
        login: 'guest', name: 'Тест', city: 'Москва', height: 175, weight: 80, age: 28, gender: 'male', level: 1,
        program: 'powerlifting', trainingPlan: { name: 'Троеборье', days: [{ day: 1, focus: 'Верх', exercises: ['Жим штанги 4×8'] }] },
        completedDays: {}, streak: 0, bestStreak: 0, goalArchive: [], progress: { bench: [], squat: [], deadlift: [] },
        achievements: [], workoutLogs: [], records: {}, flameName: '', nutGoal: 'mass', premiumUntil: null, customDays: {}
      }));
    } catch (e) {}
  });
  let wM = domM.window, dM = domM.window.document;
  await sleep(2000);
  const navM = dM.querySelector('nav');
  const fabM = dM.querySelector('.thch-fab');
  check('M1 нижняя панель и FAB на главной', !!navM && !!fabM && fabM.style.display === 'flex');
  Object.defineProperty(navM, 'offsetHeight', { value: 64, configurable: true });
  wM.__THAppIntegration.tick();
  check('M1b FAB поднят НАД панелью (bottom = высота nav + 12 = 76px)', /76px/.test(fabM.style.bottom));

  /* M2: свой ввод «подряд» — без перерисовки, значение принимается */
  wM.__THChallenges.openCreate();
  await sleep(150);
  click(wM, Array.from(dM.querySelectorAll('button')).find((b) => /ДЛЯ СЕБЯ/.test(b.textContent || '')));
  await sleep(150);
  click(wM, Array.from(dM.querySelectorAll('.thch-big')).find((b) => /ТРЕНИРОВКИ/.test(b.textContent || '')));
  await sleep(150);
  const ciM = dM.querySelector('input[type="number"]');
  check('M2 поле «своё» на месте', !!ciM && /сколько подряд/.test(ciM.placeholder));
  ciM.value = '12';
  ciM.dispatchEvent(new wM.Event('change', { bubbles: true }));
  await sleep(150);
  check('M2b экран НЕ перерисовался (тот же узел ввода)', dM.querySelector('input[type="number"]') === ciM);
  const noteM = ciM.parentElement.querySelectorAll('.thch-note');
  check('M2c подтверждение «Принято: 12 подряд · окно 30 дн»', Array.from(noteM).some((n) => /Принято: 12 подряд · окно 30 дн/.test(n.textContent)));
  click(wM, Array.from(dM.querySelectorAll('button')).find((b) => /ДАЛЕЕ/.test(b.textContent || '')));
  await sleep(200);
  check('M2d ДАЛЕЕ с первого клика -> «Мотивация»', vis(dM).includes('Выбери') || vis(dM).includes('Мотивация') || vis(dM).includes('речь'));
  /* некорректное значение — инлайн-подсказка, без тоста-перерисовки */
  wM.__THChallenges.close();
  await sleep(100);
  wM.__THChallenges.openCreate();
  await sleep(150);
  click(wM, Array.from(dM.querySelectorAll('button')).find((b) => /ДЛЯ СЕБЯ/.test(b.textContent || '')));
  await sleep(150);
  click(wM, Array.from(dM.querySelectorAll('.thch-big')).find((b) => /ТРЕНИРОВКИ/.test(b.textContent || '')));
  await sleep(150);
  const ciM2 = dM.querySelector('input[type="number"]');
  ciM2.value = '99';
  ciM2.dispatchEvent(new wM.Event('change', { bubbles: true }));
  await sleep(150);
  check('M3 99 -> инлайн-подсказка «от 2 до 30», ввод жив', dM.querySelector('input[type="number"]') === ciM2 && Array.from(dM.querySelectorAll('.thch-note')).some((n) => /от 2 до 30/.test(n.textContent)));

  /* M4: силовой свой срок — тоже без перерисовки */
  wM.__THChallenges.close();
  await sleep(100);
  wM.__THChallenges.openCreate();
  await sleep(150);
  click(wM, Array.from(dM.querySelectorAll('button')).find((b) => /ДЛЯ СЕБЯ/.test(b.textContent || '')));
  await sleep(150);
  click(wM, Array.from(dM.querySelectorAll('.thch-big')).find((b) => /СИЛА/.test(b.textContent || '')));
  await sleep(150);
  const cdM = Array.from(dM.querySelectorAll('input[type="number"]')).find((i) => /свой срок/.test(i.placeholder || ''));
  check('M4 поле «свой срок» на месте', !!cdM);
  cdM.value = '45';
  cdM.dispatchEvent(new wM.Event('change', { bubbles: true }));
  await sleep(150);
  check('M4b «Принято: срок 45 дн» без перерисовки', Array.from(dM.querySelectorAll('.thch-note')).some((n) => /Принято: срок 45 дн/.test(n.textContent)) && dM.body.contains(cdM));


  /* ===== P. FAB против меню/модалок + камера→QR конвейер ===== */
  console.log('— FAB против оверлеев, камера→QR конвейер —');

  let domF = boot('https://th.example/', (wnd) => {
    try {
      wnd.localStorage.setItem('trainhard_react_session', 'guest');
      wnd.localStorage.setItem('trainhard_react_data_guest', JSON.stringify({
        login: 'guest', name: 'Тест', city: 'Москва', height: 175, weight: 80, age: 28, gender: 'male', level: 1,
        program: 'powerlifting', trainingPlan: { name: 'Троеборье', days: [{ day: 1, focus: 'Верх', exercises: ['Жим штанги 4×8'] }] },
        completedDays: {}, streak: 0, bestStreak: 0, goalArchive: [], progress: { bench: [], squat: [], deadlift: [] },
        achievements: [], workoutLogs: [], records: {}, flameName: '', nutGoal: 'mass', premiumUntil: null, customDays: {}
      }));
    } catch (e) {}
  });
  let wF = domF.window, dF = domF.window.document;
  await sleep(2000);
  const fabF = dF.querySelector('.thch-fab');
  check('P1 FAB на чистой главной', !!fabF && fabF.style.display === 'flex');

  /* оверлей меню (классы из бандла: absolute inset-0 z-50) */
  const appRootF = dF.querySelector('nav').parentElement;
  const menuFv = dF.createElement('div');
  menuFv.className = 'absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex';
  appRootF.appendChild(menuFv);
  wF.__THAppIntegration.tick();
  check('P2 меню открыто → FAB скрыт', fabF.style.display === 'none');
  menuFv.remove();
  wF.__THAppIntegration.tick();
  check('P2b меню закрыто → FAB вернулся', fabF.style.display === 'flex');

  /* оверлей модалки (absolute inset-0 z-40) */
  const modalFv = dF.createElement('div');
  modalFv.className = 'absolute inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4';
  appRootF.appendChild(modalFv);
  wF.__THAppIntegration.tick();
  check('P3 модалка (z-40) → FAB скрыт', fabF.style.display === 'none');
  modalFv.remove();
  wF.__THAppIntegration.tick();
  check('P3b модалка закрыта → FAB вернулся', fabF.style.display === 'flex');

  /* камера→QR: полный конвейер на node-canvas (мок getUserMedia + подмена video-кадра) */
  let canvasLib = null;
  try { canvasLib = require('canvas'); } catch (e) {}
  if (!canvasLib) {
    console.log('  ⏹ P4–P6 пропущены: node-canvas не установлен (cd tools && npm i canvas)');
  } else {
    const urlFcam = wF.__THChallengeCodec.buildUrl(wF.__THChallengeCodec.encode({ v: 1, id: 'THCAM01', t: 'Камера-чек', d: 14, n: 7, f: 'fullbody', l: 'standard', s: 's1' }).payload);
    const qr = wF.__THQR.generate(urlFcam);
    const quietF = 4, dimF = qr.size + quietF * 2;
    const qc = canvasLib.createCanvas(dimF, dimF);
    const qx = qc.getContext('2d');
    qx.fillStyle = '#fff'; qx.fillRect(0, 0, dimF, dimF);
    qx.fillStyle = '#000';
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) qx.fillRect(x + quietF, y + quietF, 1, 1);

    const probe = dF.createElement('canvas');
    const pctxF = probe.getContext('2d');
    const protoF2d = pctxF && Object.getPrototypeOf(pctxF);
    const origDrawF = protoF2d && protoF2d.drawImage;
    protoF2d.drawImage = function (src) { return origDrawF.apply(this, [qc].concat(Array.from(arguments).slice(1))); };

    let stopped = 0;
    const track = { stop() { stopped++; } };
    wF.navigator.mediaDevices = { getUserMedia: () => Promise.resolve({ getTracks: () => [track] }) };

    wF.__THChallenges.open();
    await sleep(150);
    click(wF, Array.from(dF.querySelectorAll('button')).find((b) => /СКАНИРОВАТЬ QR/.test(b.textContent || '')));
    await sleep(150);
    click(wF, Array.from(dF.querySelectorAll('button')).find((b) => /ВКЛЮЧИТЬ КАМЕРУ/.test(b.textContent || '')));
    await sleep(250);
    const vid = dF.querySelector('video');
    check('P4 камера: stream подключён, статус «Сканирую…»', !!vid && /Сканирую/.test(vis(dF)));
    Object.defineProperty(vid, 'videoWidth', { value: dimF, configurable: true });
    Object.defineProperty(vid, 'videoHeight', { value: dimF, configurable: true });
    await sleep(1100);
    check('P5 QR из «камеры» распознан → превью «Камера-чек»', vis(dF).includes('Камера-чек') && vis(dF).includes('ПРИСОЕДИНИТЬСЯ'));
    check('P6 поток остановлен после декодирования (без утечки)', stopped >= 1);
    protoF2d.drawImage = origDrawF;
  }

  console.log('\nИтог: %d ✔ / %d ✘', passed, failed);
  process.exit(failed ? 1 : 0);
  function svc2(win) { return win.__THChallengeService; }
  function codec2(win) { return win.__THChallengeCodec; }
})().catch((e) => { console.error('ТЕСТ УПАЛ:', e); process.exit(1); });
