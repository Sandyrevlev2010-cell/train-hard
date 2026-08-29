# Train Hard — Backend API

Дата актуализации: 2026-08-29 (итерация 5: ARENA). Соответствует коду `server/src/`,
проверено 65 автотестами (`npm run test:backend`). Тесты гоняются на MemoryStore;
**PgStore написан, но против живого PostgreSQL не прогонялся** (см. «Статус»).

## Архитектура

```
Telegram Mini App (frontend)          Backend (Node.js ≥18)         PostgreSQL
┌────────────────────────┐   HTTPS    ┌──────────────────────┐    ┌──────────┐
│ initData (подпись TG)  │ ─────────► │ POST /auth/telegram  │    │ users    │
│ Bearer token (сессия)  │            │ проверка HMAC        ├───►│ workouts │
│ localStorage = КЭШ,    │            │ сессии sha256        │    │ sets     │
│ не источник истины     │            │ PR/Total/лидерборд   │    │ groups   │
└────────────────────────┘            │ идемпотентность      │    │ ...      │
                                      └──────────────────────┘    └──────────┘
```

- `server/src/index.js` — вход. ENV: `PORT`, `BOT_TOKEN`, `DATABASE_URL`,
  `TON_ADDRESS`, `TON_AMOUNT_NANO`, `TON_PERIOD_DAYS` (см. `server/.env.example`).
- `server/src/api.js` — маршруты, права, идемпотентность, rate limit.
- `server/src/store.js` — `MemoryStore` (dev/тесты) и `PgStore` (prod, параметризованный SQL).
- `db/migrations/` — схема (up/down): `telegram_id UNIQUE`, `UNIQUE(group_id,user_id)`,
  `UNIQUE(user_id,key)` для идемпотентности, `weeks JSONB` у программ.

## Авторизация (главное изменение)

Раньше (MVP): фронтенд доверял своему `user_id` из localStorage. Теперь:

1. Mini App получает от Telegram `initData` (подписано HMAC-SHA256 с секретом
   `HMAC(bot_token, "WebAppData")`).
2. `POST /auth/telegram {initData}` — сервер проверяет подпись
   (`crypto.timingSafeEqual`), свежесть `auth_date` (≤24ч, ≤60с из будущего)
   и наличие `user`. Создаёт/обновляет пользователя по `telegram_id UNIQUE`.
3. Ответ: Bearer-токен (сессия на 30 дней; в БД хранится только sha256 токена).
4. Все прочие маршруты требуют `Authorization: Bearer <token>`.
   **`user_id` из тела запроса игнорируется** — владелец всегда из сессии.

## Маршруты

| Метод и путь | Описание |
|---|---|
| `GET /health` | живость (без авторизации) |
| `POST /auth/telegram` | вход по подписанному initData → `{token, user}` |
| `GET /me` | профиль + `premium_until` |
| `POST /workouts` `{date, title?, notes?, idempotency_key?}` | создать тренировку |
| `GET /workouts?from&to` | список (только свои) |
| `PATCH /workouts/:id` | изменить (только свою, иначе 404) |
| `DELETE /workouts/:id` | удалить (каскадом подходы) |
| `POST /workouts/:id/sets` `{exercise, set_number, weight, reps, successful, idempotency_key?}` | подход; exercise ∈ squat/bench/deadlift |
| `DELETE /sets/:id` | удалить подход (PR пересчитается) |
| `GET /prs` | лучшие успешные подходы по упражнениям (из истории) |
| `GET /total` | Total = S+B+D (null, если какого-то нет) |
| `POST /groups` `{name}` / `GET /groups` / `DELETE /groups/:id` | группы (удаление — OWNER) |
| `GET /groups/:id/members` · `POST /groups/:id/members/:uid/role` | состав; роли ADMIN/MEMBER — только OWNER |
| `POST /groups/:id/leave` | выход (владелец не может выйти) |
| `POST /groups/:id/invite` → `{code, expires_at}` | код-инвайт (hex 16, 24ч, одноразовый) |
| `POST /invites/:code/join` | вступить (нет/просрочен/использован → 404, уже участник → 409) |
| `POST /groups/:id/subgroups` · `POST /subgroups/:id/join` | подгруппы, многократное членство |
| `GET /groups/:id/leaderboard?metric&subgroup_id` | серверный лидерборд |
| `POST /groups/:id/competitions` `{name, type, start_at, end_at}` | type ∈ TOTAL/SQUAT/BENCH/DEADLIFT/PR_PROGRESS |
| `POST /competitions/:id/start` · `/finish` · `GET /standings` | жизненный цикл (OWNER/ADMIN) |
| `POST /programs` `{name, level, frequency, weeks}` | программа (weeks — структура PROGRAM→PHASE→WEEK→WORKOUT→EXERCISE→SET) |
| `POST /programs/:id/assign` `{group_id}` | назначить группе (OWNER/ADMIN) |
| `GET /programs/:id/schedule?1rm_squat&1rm_bench&1rm_deadlift&step` | раскладка %1ПМ с округлением к шагу (1.25/2.5/5) |
| `GET /workouts/:id` · `PUT /workouts/:id` | получить/заменить свою тренировку |
| `GET /groups/:id` · `POST /groups/:id/join` `{code}` | инфо группы для участника; вступление по коду |
| `GET /groups/:id/competitions` · `GET /competitions/:id` · `POST /competitions/:id/join` | соревнования: список/карточка/участие |
| `GET /profile` | синоним `/me` (профиль + premium_until) |
| `POST /payments/verify` `{label}` | серверная верификация TON (ниже) |
| `GET /premium` | `premium_until` |
| `POST /sync` `{ops:[{id,method,path,body}]}` | очередь офлайн-операций (≤100), идемпотентна по `op.id` |

## Правила домена (проверены тестами)

- **PR** — максимум среди успешных подходов; при удалении пересчитывается вниз.
- **Total = S+B+D**, только успешные, только если все три упражнения есть.
- **Лидерборд**: значение ↓; при равенстве — раньше достигший выше (по `created_at`);
  равные значение+время → одинаковое место (1,1,3). Никакого рандома.
- **Соревнования**: в зачёт только подходы в окне `start_at..end_at`;
  `PR_PROGRESS` = прирост Total относительно базы до начала.
- **Идемпотентность**: `idempotency_key` на POST тренировок/подходов + заголовок
  `Idempotency-Key`; повтор даёт тот же результат, дублей нет (double-tap, retry).

## Безопасность

| Угроза | Мера |
|---|---|
| Поддельный пользователь | сервер проверяет подпись initData; `user_id` из тела игнорируется |
| IDOR | каждый объект проверяется на владельца/членство; чужое → 404 (без раскрытия) |
| SQL-инъекции | только параметризованные запросы (`$1...`), строк нет |
| XSS | API отдаёт strict `application/json` + `nosniff`; экранирование при рендере — на фронтенде |
| Mass assignment | обработчики собирают объекты явно; `role`/`is_admin` из тела не создаются |
| Replay initData | `auth_date` ≤24ч + подпись; replay платежей — `label` одноразово |
| Перебор/флуд | rate limit: 240 req/min на IP, 10 req/min на `/auth` и `/payments` |
| Крупные/битые тела | только JSON, ≤64KB → 413/400/415 |
| Утечки в ошибках | наружу — `{error}` без стека; подробности только в логах сервера |

## Premium: серверная верификация TON

Фронтенд показывает QR/`ton://transfer/<addr>?amount=<nano>&text=<label>` и кнопку
«Я оплатил — проверить». Проверка — на сервере (`POST /payments/verify`):
`toncenter getTransactions` → входящая транзакция с `message === label` и
`value ≥ amountNano` → `entitlements.until = now + 30 дней` (продление GREATEST).
Повторная верификация того же label ничего не продлевает. Клиент не может
выдать себе Premium — entitlement живёт только на сервере.

## Статус (честно)

- ✅ Реализовано и покрыто тестами (MemoryStore): вся таблица маршрутов выше,
  65 тестов: auth 7 · workouts 6 · PR 5 · groups 9 · leaderboard 5 ·
  competitions 5 · security 9 · payments 5 · programs 3 · sync 3 ·
  api-surface 5 (префикс /api, PUT, join по коду, CORS) ·
  e2e двух пользователей 3 (§44/45/46).
- Все пути доступны и с префиксом `/api` (§7): `/api/workouts` ≡ `/workouts`.
  CORS: `CORS_ORIGIN` (default `*`), preflight `OPTIONS` → 204.
- ⚠️ `PgStore` — тот же контракт на параметризованном SQL, но **не запускался
  против живого PostgreSQL** (нет БД в этом окружении). Интеграция: применить
  `db/migrations/001_init_up.sql`, `npm i pg`, пройтись по 57 тестам на PgStore.
- ⚠️ `server/` — plain JavaScript (не TypeScript): сохранена стратегия
  «минимальные изменения существующего стека».
- ⚠️ Фронтенд-бандл (4 МБ, минифицирован) пока работает на localStorage как
  основном хранилище; интеграция фронтенда с API (`/auth/telegram`, `/sync`,
  лидерборды, entitlement) — следующий отдельный этап (см. финальный отчёт).
