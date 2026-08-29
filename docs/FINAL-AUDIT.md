# Train Hard — Final Audit

Дата проверки: 2026-08-29

## Статус

READY WITH WARNINGS

Проект собирается, backend unit/integration/security tests проходят. Перед публичным запуском остаются внешние проверки: живой PostgreSQL, реальный Telegram Mini App на двух аккаунтах и production HTTPS/reverse-proxy configuration.

## Исправлено в этой итерации

- Исправлена совместимость REST API с асинхронным `PgStore`: все обращения к PostgreSQL теперь ожидаются через `await`.
- Исправлена серверная Telegram-auth цепочка для асинхронного store.
- Исправлен `withIdem` для PostgreSQL.
- Исправлены PostgreSQL INSERT/UPDATE запросы и приведены к схеме миграции.
- Добавлены корректные `id`, `created_at`, `updated_at` для production store.
- Исправлено сохранение `user_id` у workout sets.
- Исправлены типы/форматы timestamp и numeric weight.
- Исправлена схема `invites.used_by` для TEXT user IDs.
- Исправлена схема competitions: `description`, ссылки `winner_id`/`created_by`.
- Исправлено сохранение победителя соревнования.
- Исправлено реальное удаление группы.
- Исправлена схема/запросы программ и назначений.
- Исправлена команда backend tests для Node.js, где `node --test server/test/` не обрабатывает директорию как ожидалось.
- `pg` перенесён из optionalDependencies в обычные dependencies, потому что production backend без него не может работать.
- Обновлена инструкция миграции на фактический файл `db/migrations/001_init_up.sql`.
- Сохранены build-проверки и Telegram build.

## Проверено

- `python3 build.py` — PASS
- `python3 build_telegram.py` — PASS
- `node --check server/src/api.js` — PASS
- `node --check server/src/store.js` — PASS
- `node --check server/src/telegram.js` — PASS
- `npm run test:backend` — 64/64 PASS
- `npm run test:unit` — 56/56 PASS
- `node tools/run-all-tests.js --backend-only` — 64/64 PASS

## Ограничения среды проверки

Frontend jsdom tests в текущем окружении не удалось выполнить, потому что установка npm-зависимостей была прервана сетевым ограничением, а локальная копия `node_modules/jsdom` осталась неполной. Это не ошибка исходного `package.json`: `jsdom` объявлен в devDependencies.

Живое подключение к PostgreSQL в этой среде не выполнялось.

Реальный запуск внутри Telegram с двумя физическими Telegram-аккаунтами также не выполнялся.

## Что обязательно сделать перед публичным запуском

1. `npm ci`
2. применить `db/migrations/001_init_up.sql` к реальной PostgreSQL
3. задать production environment variables
4. настроить HTTPS/reverse proxy
5. проверить Telegram BotFather/Main Mini App URL
6. проверить Telegram initData на реальном устройстве
7. выполнить сценарий двух пользователей: группа → invite → тренировки → PR → Total → leaderboard
8. проверить соревнование и программы
9. выполнить полный `npm test`
10. не публиковать bot token, DATABASE_URL или JWT secret
