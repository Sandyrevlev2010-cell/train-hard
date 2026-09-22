# Train Hard — Telegram Mini App для пауэрлифтинга

Дневник тренировок (присед/жим/тяга), PR и Total, тренировочные программы,
интервальный таймер, Premium за TON — и **ARENA**: настоящие группы
и серверные лидерборды между реальными пользователями.

Архитектура (§57):

```
TELEGRAM → Mini App (app/ или telegram/) → Backend API (server/) → PostgreSQL (db/)
                                             │
                              auth по подписи initData, группы, лидерборды,
                              соревнования, программы, синхронизация, TON-платежи
```

## Требования

- Node.js ≥ 18 (тесты, backend; встроенный fetch)
- Python 3.9+ с Pillow (сборка бандла из `original.html`)
- PostgreSQL 15+ — только для продакшена (dev/тесты работают на MemoryStore)
- Telegram-бот (BotFather) — для авторизации и Mini App

## Installation

```bash
unzip TrainHard-ALL.zip && cd trainhard
npm install          # dev: jsdom, jsqr; optional: pg, canvas
npm test             # 353 ✔ (см. «Tests»)
```

`npm install` идемпотентен; `package-lock.json` зафиксирован. Optional-пакеты не обязательны:
без `pg` backend работает на MemoryStore.

## Development

```bash
npm run dev          # фронтенд http://localhost:8080 + API http://localhost:8787
```

- API без `DATABASE_URL` — in-memory (данные до рестарта).
- Локально в браузере АРЕНА отключена: нет Telegram initData → нет серверной
  авторизации (это честное поведение, не баг). В Telegram-клиенте работает.
- Пересборка фронтенда: `npm run build` (это же — production build бандла).

## Database setup

```bash
# схема (+ откат)
psql "$DATABASE_URL" -f db/migrations/001_init_up.sql
psql "$DATABASE_URL" -f db/migrations/001_init_down.sql   # down, если нужно

npm i pg                       # драйвер (optional в package.json)
DATABASE_URL=... node server/src/index.js
```

Таблицы: users (telegram_id UNIQUE), sessions, workouts, workout_sets,
idempotency, groups, group_members (UNIQUE group_id+user_id), subgroups,
subgroup_members, invites, competitions, competition_members, programs (weeks
JSONB: PROGRAM→PHASE→WEEK→WORKOUT→EXERCISE→SET), program_assignments,
entitlements. PR/Total не хранятся, а считаются из истории (пересчёт при
удалении — автоматический).

## Environment variables

Шаблон — `.env.example` (копия для backend — `server/.env.example`).

| Переменная | Назначение |
|---|---|
| `PORT` | порт API (8787) |
| `TELEGRAM_BOT_TOKEN` | токен BotFather — обязателен для `/api/auth/telegram` |
| `DATABASE_URL` | PostgreSQL; пусто → MemoryStore (только dev) |
| `CORS_ORIGIN` | origin фронтенда (`*` только для dev) |
| `TON_ADDRESS` / `TON_AMOUNT_NANO` / `TON_PERIOD_DAYS` | Premium: 1 TON / 30 дней |

На фронтенде секретов нет: только `window.TRAINHARD_ARENA = { apiBase, botAppLink }`
(`src/arena/arena-config.js`).

## Tests

Фактический прогон `npm test` от 2026-08-29 (чистая комната: unpack → npm install → npm test):

```
frontend/smoke      42 ✔   frontend/security  24 ✔
frontend/payments   28 ✔   frontend/telegram  21 ✔
frontend/arena     44 ✔   ← ARENA + sync-bridge
frontend/storage     5 ✔   backend/all        65 ✔   ← node --test server/test/
ИТОГО: 353 ✔ / 0 ✘ (exit 0)
```

- `npm test` — всё; `npm run test:unit` — юнит-тесты backend;
  `npm run test:integration` — e2e двух пользователей (§44/45/46);
  `npm run test:security` — IDOR/XSS/auth-тесты + audit-регресс;
  `npm run test:frontend` — только jsdom-наборы.
- Тесты не запускались против живого PostgreSQL и живого Telegram —
  это зафиксировано в `docs/FINAL-AUDIT.md` (BLOCKED-раздел).

## Production build

```bash
npm run build        # python3 build.py (app/index.html, PWA)
                     # + python3 build_telegram.py (telegram/index.html, Mini App)
```

`build.py` падает с понятной ошибкой, если `original.html` отсутствует или
патч-анкер не уникален — тихое повреждение минифицированного кода исключено.

## Deployment

Пошагово (бесплатный тариф): **Neon (PostgreSQL) + Render (backend) +
Cloudflare Pages (фронтенд)** — см. `docs/DEPLOYMENT.md`. Security-заголовки —
`docs/SECURITY-HEADERS.md`.

## Telegram Bot setup

Инструкция BotFather (бот, Main Mini App, меню, deep links `startapp`):
`docs/TELEGRAM-SETUP.md`.

## Mini App setup

Mini App = `telegram/index.html`, публикуется как одна страница HTTPS.
Порядок: задеплоить фронтенд → задеплоить backend (включая `TELEGRAM_BOT_TOKEN`,
`CORS_ORIGIN`) → в BotFather указать URL фронтенда → открыть Mini App в Telegram.
`apiBase`/`botAppLink` прописываются в `src/arena/arena-config.js` перед сборкой.

## Troubleshooting

| Симптом | Причина/решение |
|---|---|
| `build.py: ОШИБКА: отсутствует original.html` | файл есть в архиве; распакуй полностью |
| АРЕНА не видна в браузере | нет Telegram initData — норма; открой в Telegram |
| `401 invalid init data: expired` | initData старше 24ч — переоткрой Mini App |
| «Нет соединения с сервером» в Арене | не задан `apiBase` или backend спит (Render free) |
| Приглашение «не найдено» | код одноразовый и живёт 24 часа — создай новый |
| Лидерборд пуст | тренировки синхронизируются после записи; проверь интернет |
| `npm i pg` не установился | это optional — API сейчас на MemoryStore |

## Изменения против исходной версии (кратко)

- **Вход/регистрация удалены** — онбординг «цель → профиль → программа» без аккаунтов;
- **ARENA сначала удалена** (имитация мультиплеера), **затем возвращена настоящей**
  (итерация 5): группы/инвайты/лидерборды через Backend API, авторизация подписью
  Telegram initData, синхронизация тренировок (`src/sync/sync-bridge.js`);
- **Premium** — только серверное подтверждение (TON + toncenter), сценариев
  самоподтверждения нет; серверная верификация `POST /api/payments/verify`;
- **Интервальный таймер**, PWA, экспорт/импорт JSON сохранены;
- Убраны мусорные Cloudflare-скрипты и ложные тексты.

Структура кода, аудит и статус готовности — `docs/FINAL-AUDIT.md`,
`docs/BACKEND.md`, `docs/SECURITY-AUDIT.md`.
