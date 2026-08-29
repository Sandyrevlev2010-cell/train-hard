# Train Hard — Deployment (бесплатные тарифы)

Вариант выбран из §38: PostgreSQL-архитектура сохраняется, backend — обычный
Node.js-процесс (не Cloudflare Workers, т.к. pg = TCP-соединения).

```
Telegram → https://trainhard.pages.dev (фронтенд, Cloudflare Pages)
                  │ fetch(apiBase)
                  ▼
           https://trainhard-api.onrender.com (backend, Render free)
                  │ pg (SSL)
                  ▼
           Neon PostgreSQL (free)
```

## 1. База данных — Neon (free)

1. https://neon.tech → регистрация → проект `trainhard`.
2. Скопировать connection string: `postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`.
3. Применить схему (локально, где есть psql):
   ```bash
   psql "postgres://...neon.tech/neondb?sslmode=require" -f db/migrations/001_init_up.sql
   ```

## 2. Backend — Render (free web service)

1. Код должен быть в git-репозитории (Render деплоит из repo).
   `.env`, токены и `original.html` — НЕ коммитить: архив проекта приватный.
2. Render → New → Web Service:
   - Build Command: `npm ci --omit=optional && npm run build` —
     `--no-optional` исключает canvas (нативная сборка не нужна серверу);
   - Start Command: `node server/src/index.js`.
3. Environment:
   - `TELEGRAM_BOT_TOKEN` — из BotFather;
   - `DATABASE_URL` — строка Neon;
   - `CORS_ORIGIN` — точный origin фронтенда, например `https://trainhard.pages.dev`;
   - `TON_ADDRESS`/`TON_AMOUNT_NANO`/`TON_PERIOD_DAYS` — как в `.env.example`.
4. Получить URL сервиса, например `https://trainhard-api.onrender.com`;
   проверить: `curl https://.../api/health` → `{"ok":true}`.

Нюанс free-тарифа: сервис засыпает (~15 мин без трафика), первый запрос после
пробуждения занимает десятки секунд — в Арене это видно как «Нет соединения»,
кнопка «Повторить» решает.

## 3. Фронтенд — Cloudflare Pages (free)

1. Указать `apiBase` и `botAppLink` в `src/arena/arena-config.js`:
   ```js
   window.TRAINHARD_ARENA = { apiBase: 'https://trainhard-api.onrender.com',
                              botAppLink: 'https://t.me/<бот>/<app>?startapp=' };
   ```
2. Собрать: `npm run build`.
3. Cloudflare Pages → Create project → Direct Upload:
   - артефакт Mini App — файл `telegram/index.html`;
   - артефакт PWA — каталог `app/` (опционально, отдельно).
4. Получить URL, например `https://trainhard-pages-dev.pages.dev`.

## 4. Telegram BotFather

Полная инструкция: `docs/TELEGRAM-SETUP.md` (кратко: /newbot → /newapp →
URL = URL фронтенда из шага 3 → Menu Button).

## 5. Проверка продакшена (§44, живые пользователи)

1. User A открывает Mini App из бота → АРЕНА → создать группу → «Пригласить друга»
   → переслать ссылку-приглашение.
2. User B открывает ссылку в Telegram → приложение стартует → экран вступления →
   «Вступить».
3. Оба записывают тренировки (присед/жим/тяга). Через секунды данные уходят
   на сервер (`/api/sync`).
4. У обоих в Арене — одинаковые лидерборды: Присед / Жим / Становая / Троеборье.
   Изменение PR у одного меняет таблицу у другого.

## Стоимость

| Сервис | Тариф | Ограничения |
|---|---|---|
| Neon | Free | 0.5 GB, автопауза проекта |
| Render | Free | сон сервиса, 750 ч/мес |
| Cloudflare Pages | Free | 500 сборок/мес, безлимит трафика |
| toncenter | публичный API | ~1 rps без ключа (ключ — при росте) |

Платных сервисов нет. Домен (опционально) — единственная возможная трата.
