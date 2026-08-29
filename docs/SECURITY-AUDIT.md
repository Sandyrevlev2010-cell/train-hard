# Train Hard — Security Audit (итоговый, итерация 4: + backend)

Методология: OWASP WSTG (stable) для покрытия, OWASP Cheat Sheet Series для практик.
Объект: текущая сборка `app/index.html` (single-file PWA), исходники `src/`, `sw.js`,
`manifest.webmanifest` **и серверная часть `server/`** (итерация 4).
Тесты — фактический прогон `npm test` от 2026-08-29 (итерация 5: ARENA),
всего 353, все зелёные: challenge 124 · smoke 42 · payment 28 · no-storage 5 ·
audit 24 · telegram 21 · arena 44 (фронтенд, 288) + backend 65 (`server/test/`:
auth/IDOR/PR/лидерборд/соревнования/платежи/программы/sync/api-surface/e2e).
Расклад и статус — `docs/BACKEND.md`, итог — `docs/FINAL-AUDIT.md`.

---

## 1. Executive Summary

Train Hard — frontend-only PWA. Ключевой принцип зафиксирован и соблюдён:

> **FRONTEND IS UNTRUSTED.** Всё, что пришло из клиента (localStorage, URL, hash,
> пользовательский ввод, DOM, client-side флаги, системное время), — недоверено.
> Security boundary на frontend state не строится.

Во frontend **нет секретов** (проверено словарём: api_key/secret/token/password/
private_key/client_secret/merchant/jwt — только легитимные вхождения типа `<input
type=password>` и названия полей удалённого UI). Подмена frontend/localStorage даёт
злоумышленнику максимум **контроль над собственным локальным интерфейсом и своими
локальными данными** — и ничего больше: серверных секретов, чужих данных и
доверенного доказательства оплаты во frontend не существует. Backend в этой итерации
не создавался (по условию); абстракции для Backend 2.0 сохранены (см. §11).

Зафиксированные границы честно задокументированы (§3): local Premium state,
прогресс и челленджи — личные локальные данные, не защищаемые от владельца устройства;
клевое время — не security-механизм.

## 2. Fixed Issues

### Эта итерация (iter. 3)

| # | Severity | Location | Problem | Impact | Fix | Status |
|---|---|---|---|---|---|---|
| AUD-01 | MEDIUM | бандл (legacy), `app-integration.js` | Со времён удалённого логина в бандле осталась мёртвая register/login-логика с локальным хешем пароля (`thLocalPasswordHash`) и хранилищем `trainhard_react_accounts`; у ранних пользователей в localStorage могли остаться парольные хеши/устаревшие поля | Парольные данные пользователя лежали на устройстве без функциональной необходимости (мёртвый код) | Boot-time очистка `trainhard_react_accounts` (app-integration.js); UI-пути к функциям отсутствуют (экран логина удалён в MVP 1.0); `we()` — офлайн-заглушка (P1), сетевых вызовов нет | **FIXED** (данные), код задокументирован как dead (удаление из минифицированного бандла сопряжено с риском регресса) |
| AUD-02 | LOW | P25 (`patches.py`), загрузчик профиля | Повреждённый профиль (`streak:"abc"`, `completedDays:[…]`, `records:"junk"`, `trainingPlan:"broken"`) загружался без нормализации типов | Кривой UI («Серия: abc»), потенциальные NaN в вычислениях | `thStreakFix` расширен до profile-guard: streak/bestStreak → конечные числа ≥0, completedDays → plain object, records → object, workoutLogs → array, trainingPlan → null|object | **FIXED** (тест C1: 0 runtime errors, приложение живо) |
| AUD-03 | MEDIUM | `docs/SECURITY-HEADERS.md` | Рекомендация `Permissions-Policy: camera=()` блокировала бы QR-сканер челленджей (getUserMedia) на хостинге, следом за рекомендациями | Сканер QR не работал бы на «правильно» настроенном хостинге | `camera=(self)` во всех конфигах (nginx/Netlify/Cloudflare) + пояснение | **FIXED** |
| AUD-04 | LOW | `docs/CHALLENGES.md` (докум.) | Нет | — | Проверки этой итерации добавлены в постоянный набор `tools/audit-test.js` (24 проверки) | **DONE** |

### Сводка ранее исправленного (iter. 1–2, актуально)

- Trust mode удалён из production-путей; возврат из оплаты ≠ доказательство оплаты;
  anti-replay по label; `trainhard_premium_v1` — только UI state.
- Payment: фиксированный origin ЮKassa/ЮMoney, successUrl только текущий origin
  или https-конфиг, label строго по `LABEL_RE`, URL очищается `history.replaceState`.
- XSS: challenge-title и все URL-данные — только `textContent`/React-рендер;
  `esc()` для атрибутов в premium-manager; таймер/premium innerHTML — только статические шаблоны/константы.
- Storage: StorageService try/catch + safe JSON + лимиты + memory-fallback;
  challenge-хранилище санитизируется на каждом чтении (id/duration/target/completed клампятся).
- Reset («Сбросить всё») удаляет профиль, челленджи, аналитику, таймер, pending-платёж
  и (по префиксу) legacy-аккаунты; entitlement-ключ остаётся по дизайну.

## 3. Remaining MVP Limitations (ACCEPTED, не выдаются за защиту)

| Область | Ограничение |
|---|---|
| Local Premium state | `trainhard_premium_v1` — untrusted local UI state. **Local Premium state is not a trusted proof of purchase.** Владелец устройства может включить себе Premium-косметику через DevTools — это не даёт доступа ни к чему серверному (его нет) |
| `__THPrem.activate()` | Внутренний API активации (нужен будущему verify-флоу), достижим из консоли. Даёт только локальный UI-state; удаление = security theater (localStorage пишется и напрямую). ACCEPTED |
| Локальный прогресс/челленджи | Личный журнал на устройстве; подделывается владельцем; ничего не доказывает |
| Время устройства | `joinedAt/expiresAt/streak` считаются по локальному времени; перевод часов — задокументированное ограничение |
| Исходники/DevTools | Код открыт; минификация не используется как защита; анти-DevTools не добавлялся сознательно |
| Challenge ID | Не идентифицирует личность; дубликаты у разных пользователей — норма (self-contained URL) |

## 4. Premium Security Model

```
localStorage trainhard_premium_v1   →   UI state (untrusted)
getTrustedEntitlement()/verifyUrl   →   trusted entitlement (источник отсутствует,
                                        пока backend 2.0 не включён: enabled=false)
```

- UI честно показывает три состояния: FREE / «ожидает подтверждения» (pending) / PREMIUM;
  «Payment confirmed» без верификации не показывается (текста в сборке нет).
- Путь «вернул из оплаты → premium=true» **не существует**: возврат создаёт только
  pending-запись (аудит-тест B1–B4).
- URL-параметры (?premium / ?vip / ?admin / любой hash) не влияют на Premium (B5–B6).
- Тамперинг-тест D5: `activate()` из консоли = локальный UI-state, серверных
  последствий нет (серверных сущностей нет).

## 5. Payment Security Model

- Оплата (с 29.08.2026): перевод TON на публичный адрес кошелька проекта.
  Единственный сетевой вызов — публичный API блокчейна `toncenter` по явному
  клику «Я оплатил — проверить». Секретов (приватных ключей/API-ключей) во
  frontend нет. Открытие кошелька — по ссылке `ton://transfer/…`, собираемой
  только из конфига (allowlist), произвольные URL невозможны; open redirect
  отсутствует (`location.href/assign/replace` не используются).
- `window.open(url,'_blank','noopener')` + `w.opener=null`; fallback-ссылка в UI —
  `rel="noopener noreferrer"`.
- `successUrl` = текущий origin/pathname (вычисляется) или https-URL из конфига;
  пользовательский ввод в redirect не попадает.
- `verify()` — POST на https `verifyUrl` из конфига; в MVP конфиг отключён
  (`enabled:false, verifyUrl:''`) → 0 сетевых запросов (B4, T31). Схема готова к
  Backend 2.0 без изменений UI.

## 6. Storage Security

- StorageService: try/catch на get/set/remove, safe-JSON, лимит размера, memory-фолбэк
  при выбрасывающем localStorage (no-storage-test 5 ✔).
- Ключи: профиль `trainhard_react_*`, premium UI-state, pending-платёж, таймер,
  аналитика, челленджи. Паролей/токенов/платёжных реквизитов не хранится и не хранилось
  (legacy-аккаунты вычищаются при старте — AUD-01).
- Prototype pollution: JSON.parse + spread не переписывает прототипы (own properties);
  все чтения из хранилища проходят санитайзеры (challenge) / profile-guard (профиль).
- Повреждённые данные → безопасные дефолты, без краха и без деструктивной миграции (C1–C5).

## 7. XSS / DOM Security

- `eval`/`new Function`/`document.write` — отсутствуют (A1).
- innerHTML в проекте: React-internal (экранирование React), статические шаблоны
  (interval-timer), `esc()`-экранированный URL (premium-manager), собственный UI
  челленджей — только `createElement`/`textContent`.
- Challenge title/параметры из URL выводятся исключительно текстовыми узлами
  (XSS-тест с `<img onerror>` — зелёный, §51 challenge-test).
- Шаблоны/атрибуты: `href="${…}"` из пользовательских данных отсутствуют; единственный
  динамический href — страница оплаты из allowlist-origin.

## 8. Challenge Security

- URL `?challenge=<base64url JSON>` — недоверенный вход: лимит 600 символов, строгая
  валидация версии/полей/значений (v=1; d∈{3,7,14,30,60}; n∈{3,4,5,7,10,14,30};
  e∈{bp,sq,dl}; w 1–500 шаг 0.5; speechId из словаря, иначе fallback s1; ws — id по
  регулярке, ≤12). Повреждённые ссылки → экраны ошибок, приложение не падает (T26–T30).
- В payload нет текстов речей, PII, секретов, платёжных данных — только публичные
  параметры; QR содержит ту же ссылку и генерируется/декодируется локально
  (vendor jsQR, MIT; внешних QR-API нет).
- Дубликаты: повторный join → duplicate; повторный completion → no-op; повторная
  тренировка в день → дедуп по дате (D1–D3).
- ID челленджа не является идентификацией пользователя.

## 9. PWA Security

- `sw.js`: кэш только same-origin; URL с query не кэшируются; старые версии кэша
  удаляются при activate (anti cache-poisoning); секретов и приватных ответов в кэше
  нет — фиксируется: приложению нечего кэшировать кроме собственной статики.
- Manifest: `start_url:'./'`, `scope:'./'`, standalone — deep-link `?challenge=`
  работает при cold launch/установке/offline (тесты N-блока, T-блока).
- Все ресурсы инлайн/data: — внешних загрузок нет (A4), полный офлайн (0 fetch).
- Обновление: версия кэша `trainhard-mvp-v5` + skipWaiting/clients.claim.

## 10. Recommended HTTP Headers

Полный набор с конфигами для nginx/Netlify/Cloudflare — `docs/SECURITY-HEADERS.md`
(CSP без `unsafe-eval` и без `*`, `frame-ancestors 'none'`, nosniff, Referrer-Policy,
Permissions-Policy с `camera=(self)` для QR-сканера, COOP, HSTS). Мета-теги
CSP не используются как замена заголовкам — заголовки настраиваются на хостинге.

## 11. Future Backend Requirements (интерфейсы сохранены)

```
Payment / RuStore → Trusted Verification → Backend → Trusted Entitlement → PremiumManager
LocalChallengeProvider → Future CloudChallengeProvider (интерфейс в ChallengeService)
StorageService (localStorage) → Future API → PostgreSQL
```

Что должен сделать backend 2.0: верификация label → entitlement (подписанный,
с проверкой на сервере), учёт челленджей пользователя, синхронизация профиля.
До этого момента `enabled:false` в premium-config — UI честно пишет «оплата
подключается», ложных обещаний нет.

## 12. Production Checklist

- [x] Секретов во frontend нет (словарный + контекстный скан, A2)
- [x] Payment bypass через URL отсутствует (B1–B6)
- [x] Debug/test-бекдоров нет (A3: testPremium/mockPayment/forcePremium/skipPaywall/devMode/isAdmin/backdoor)
- [x] eval/new Function/document.write нет (A1)
- [x] Внешних http(s)-ресурсов нет (A4) — только allowlist-страница оплаты по клику
- [x] Консоль модулей не раскрывает конфигурацию/платёжные данные (A5)
- [x] Повреждённые данные → дефолты без краха (C1–C5, no-storage 5 ✔)
- [x] Дубликаты событий не задваивают статистику (D1–D3)
- [x] Сброс данных удаляет всё локальное, кроме entitlement (T35)
- [x] OWASP-заголовки задокументированы для хостинга, camera=(self) для сканера
- [x] Регресс 198/198 зелёных (challenge 98 · smoke 42 · payment 29 · no-storage 5 · audit 24)
- [x] Задокументированные ограничения MVP (§3) — не маскируются под защиту

## Приложение: покрытие тестами

| Набор | Проверок | Что покрывает |
|---|---|---|
| `tools/challenge-test.js` | 98 | codec/URL/QR/сканер/превью/join/персистентность/«подряд»/strength/ошибки/XSS/офлайн/лимиты/FAB/Прогресс/сброс серии |
| `tools/smoke-test.js` | 42 | онбординг, тренировки, таймер, премиум-UI, навигация |
| `tools/payment-test.js` | 29 | платёжный флоу, verify-контракт, anti-replay, состояния UI |
| `tools/no-storage-test.js` | 5 | выбрасывающий localStorage (memory-режим) |
| `tools/audit-test.js` | 24 | статический аудит сборки + trust boundary runtime (этот аудит) |
