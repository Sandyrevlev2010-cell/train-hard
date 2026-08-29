# Train Hard — настройка через BotFather (§40)

## 1. Создать бота

1. В Telegram открыть **@BotFather** → `/newbot`.
2. Имя: `Train Hard`; username: `trainhard_<что-то>_bot`.
3. Получить **токен** вида `7123456789:AA...` — это `TELEGRAM_BOT_TOKEN`
   (только на сервер, никогда во фронтенд/репозиторий).

## 2. Создать Mini App

1. BotFather → `/newapp` (или Bot Settings → Menu Button → Edit).
2. Выбрать бота.
3. Название: `Train Hard`, короткое описание — «Дневник пауэрлифтинга: PR, Total, группы, рейтинги».
4. **Web App URL**: адрес фронтенда из HTTPS, например
   `https://trainhard-pages-dev.pages.dev` (см. docs/DEPLOYMENT.md).
5. Фото/гиф — по желанию (иконка есть в `app/icons/`).

## 3. Menu Button

BotFather → `/setmenubutton` → выбрать бота → `Web app` → тот же URL.
Теперь у бота справа внизу кнопка «Открыть приложение».

## 4. Команды (опционально)

`/setcommands`:
```
start - открыть Train Hard
```

## 5. Deep links (инвайты ARENA, §22/§34)

Приглашение в группу — стандартный Telegram `startapp`-линк:

```
https://t.me/<bot_username>/<app_short_name>?startapp=<invite_code>
```

- `<app_short_name>` — короткое имя Mini App из шага 2;
- `<invite_code>` — 16-значный hex-код, создаётся в Арене («Пригласить друга»).

Шаблон ссылки задается в `src/arena/arena-config.js` (`botAppLink`) перед
сборкой. При открытии Telegram запускает Mini App, приложение читает
`Telegram.WebApp.initDataUnsafe.start_param`, отправляет код на
`POST /api/invites/:code/join` (сервер проверяет срок/одноразовость/членство).
Персональных данных в URL нет — только случайный код.

## 6. Проверка интеграции в приложении

- `Telegram.WebApp.ready()` / `expand()` — вызываются (тест telegram 21 ✔);
- тема, BackButton, HapticFeedback, safe areas — поддержаны;
- `initData` передаётся только на `/api/auth/telegram` (HTTPS!).

## 7. Что должно быть готово ДО подключения

1. Backend задеплоен и `curl .../api/health` отвечает `{"ok":true}`.
2. `TELEGRAM_BOT_TOKEN` на сервере совпадает с ботом (иначе подписи initData
   не сойдутся → 401 invalid init data).
3. `CORS_ORIGIN` = URL фронтенда (иначе браузер зарежет запросы АРЕНЫ).
4. `apiBase` в `arena-config.js` = URL backend.

## Открыть приложение

В Telegram: чат с ботом → кнопка Menu Button («Открыть приложение») —
или меню «…» → «Открыть веб-приложение». Тесты на реальных iOS/Android —
владельцу (в песочнице эмуляции нет, см. FINAL-AUDIT).
