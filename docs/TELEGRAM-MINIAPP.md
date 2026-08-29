# Train Hard — Telegram Mini App

Сборка `telegram/index.html` — та же функциональность (тренировки, таймер,
прогресс, серия, челленджи, QR-сканер, база знаний, офлайн), оптимизированная
для запуска внутри Telegram.

## Как собирается

```
python3 build.py            # основная web-сборка (app/index.html)
python3 build_telegram.py   # → telegram/index.html
```

`build_telegram.py` берёт готовый `app/index.html` и:
- добавляет **единственный внешний скрипт** `https://telegram.org/js/telegram-web-app.js`
  (официальное требование) в `<head>`;
- добавляет инлайн **boot-скрипт до React-бандла** (изоляция аккаунтов, см. ниже);
- добавляет модуль **telegram-miniapp.js** после остальных модулей;
- убирает service worker и manifest (в Telegram WebView SW не нужен,
  mini app кэшируется самим Telegram).

Модуль полностью feature-detected: в обычном браузере (и в sandbox-предпросмотре)
приложение работает как обычно — Telegram-интеграция просто не активируется.

## Оптимизации под Telegram

| Что | Зачем |
|---|---|
| `ready()` + `expand()` | раскрыть на весь экран сразу |
| `setHeaderColor/setBackgroundColor('#0a0a0a')` | шапка Telegram под тёмный дизайн, без белой вспышки |
| `disableVerticalSwipes()` + `overscroll-behavior:none` | свайп-вниз при скролле тренировок не закрывает mini app |
| **BackButton Telegram** | закрывает открытые оверлеи (челленджи/таймер); скрывается, когда оверлеев нет |
| **HapticFeedback** | вибрация на достижениях и завершении челленджей (обёртка TrainHardEffects) |
| **deep-link `start_param`** | ссылка на челлендж открывает превью (см. ниже) |
| `openLink()` | внешние http(s) ссылки — через нативный просмотр Telegram |
| **изоляция аккаунтов** | данные профилей разных Telegram-юзеров на одном устройстве не смешиваются |

## Изоляция данных аккаунта

Boot-скрипт (до старта приложения) читает `initDataUnsafe.user.id` и переключает
сессию `trainhard_react_session` на ключ `tg<id>`; при первом заходе гостевой
прогресс наследуется. «Сбросить всё» очищает и эти данные (префикс
`trainhard_react_`).

## Челленджи в Telegram

- Ссылка челленджа — обычный URL mini app: `https://<домен>/?challenge=<payload>`.
  Если домен привязан к боту в BotFather, Telegram открывает её как mini app.
- Короткая форма через бота: `https://t.me/<bot>/<app>?startapp=<payload>` —
  payload приходит в `initDataUnsafe.start_param`, модуль сам открывает превью.
- «Поделиться» внутри Telegram: Web Share API → открытая ссылка в чат;
  fallback — копирование (в Telegram WebView share часто недоступен, копирование
  всегда работает).
- В payload только публичные параметры челленджа — никаких персональных данных.

## Публикация (чек-лист)

1. HTTPS-хостинг: положить `telegram/index.html` на домен с валидным сертификатом
   (например `https://app.trainhard.ru/`). Заголовки безопасности — см.
   `docs/SECURITY-HEADERS.md` (CSP: добавить `script-src https://telegram.org`).
2. В [@BotFather](https://t.me/BotFather): `/newbot` → `/newapp` → выбрать бота,
   указать заголовок, короткое имя, URL `https://app.trainhard.ru/`.
3. Для поддержки `startapp`-ссылок — короткое имя mini app выдаёт BotFather.
4. Тест: открыть mini app из чата, проверить офлайн-запуск (второй запуск без
   сети — работает из кэша Telegram), deep-link челленджа, BackButton.

## Ограничения (принципиально, без backend)

- **initData не верифицируется**: `initDataUnsafe.user` — удобная локальная
  персонализация, НЕ доказательство личности. Любые серверные решения по
  initData требуют проверки подписи на backend (будущая версия; HMAC с токеном
  бота — токен живёт только на сервере).
- Service Worker внутри Telegram нестабилен (особенно iOS) — офлайн в mini app
  обеспечивает кэш Telegram; для браузера используйте основную сборку `app/`.
- `localStorage` в mini app привязан к устройству; кросс-устройственная
  синхронизация — в планах (Telegram CloudStorage или backend 2.0).
- Оплата Premium работает и в mini app: TON-лист с QR и копированием
  отображается прямо в Telegram; ссылка «Открыть в кошельке» через openLink
  запустит внешний TON-кошелёк. Проверка платежа — по кнопке (см.
  docs/PREMIUM-PAYMENTS.md).

## Тесты

`tools/telegram-test.js` — 21 проверка: статика сборки (единственный внешний
скрипт, SW/manifest убраны), браузерный режим (деградация без Telegram) и
режим Telegram (мок WebApp: ready/expand/тема/свайпы, изоляция аккаунта,
deep-link → превью, BackButton открытие/закрытие, haptic, openLink).
