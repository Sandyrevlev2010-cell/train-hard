# Android-сборка и публикация в RuStore

## Почему это не «оболочка над сайтом»

Вся функциональность Train Hard MVP локальна: программы, тренировки, таймеры (отдыха и
интервальный), прогресс, достижения, база знаний, звуки, Premium-гейтинг — всё работает
из `app/index.html` внутри WebView **без сети**. Android-версия — это то же самое
приложение, упакованное в нативный контейнер, с платёжным модулем, заменённым на
RuStore Billing.

## Структура сборки

```
trainhard-android/
├── capacitor.config.json      # appId: ru.trainhard.app, webDir: www
├── www/                       # = содержимое app/ (index.html, manifest, icons, sw.js)
├── android/                   # Android Studio project (генерируется Capacitor)
└── ru-store-billing/          # плагин RuStore Billing (см. ниже)
```

## Пошагово

### 1. Подготовка веб-части
```bash
mkdir trainhard-android && cd trainhard-android
mkdir www && cp -r ../trainhard/app/* www/
npm init -y && npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Train Hard" ru.trainhard.app --web-dir www
npx cap add android
```

### 2. capacitor.config.json
```json
{
  "appId": "ru.trainhard.app",
  "appName": "Train Hard",
  "webDir": "www",
  "android": { "allowMixedContent": false },
  "server": { "androidScheme": "https" }
}
```

### 3. Иконки и splash
Сгенерируйте из `app/icons/icon-512.png` (уже есть):
Android Studio → `res` → Image Asset → Launcher Icons (adaptive) + Splash Screen.

### 4. Платежи: RuStore Billing вместо ЮKassa
В сборке для RuStore платежи идут через **RuStore Billing SDK** (официальный механизм
оплаты платформы — требования RuStore для цифровых товаров):
- плагин: `@capacitor-community / rustore-billing` или нативный мост;
- интерфейс уже подготовлен: замените `src/premium/payment-adapter.js` на адаптер
  с теми же методами (`open/onReturn/verify` → `purchase/consumption/confirm`) —
  `PremiumManager` менять не нужно;
- серверная валидация чека RuStore (когда появится backend) подключается в `verify()`.

### 5. Офлайн-поведение
`sw.js` внутри WebView не используется — всё уже в одном файле; сеть нужна только для
перехода на страницу оплаты (в RuStore-сборке — не нужна вообще).

### 6. Сборка APK/AAB
```bash
npx cap sync android
cd android && ./gradlew assembleRelease   # APK для проверки
./gradlew bundleRelease                    # AAB для публикации
```
Требования: Android Studio, JDK 17, SDK 34+.

### 7. Публикация в RuStore
1. Аккаунт разработчика RuStore (https://www.rustore.ru) — для физлиц/ИП/ООО;
2. «Создать приложение» → загрузить AAB, скриншоты (телефон 9:16), описание;
3. Конфиденциальность: приложение **не собирает** персональные данные и не передаёт
   их на сервер (локальная аналитика — только счётчики событий на устройстве);
   это упрощает анкету Data Safety;
4. Для подписки Premium внутри RuStore обязательно использовать RuStore Payments
   (цифровые товары), период/цена: 30 дней / 100 ₽ — как в приложении;
5. Модерация обычно 1–3 дня.

## Чек-лист перед отправкой в RuStore

- [ ] Тренировки/таймеры работают в airplane mode;
- [ ] Кнопка «Назад» не закрывает приложение во время тренировки (обработать в нативной части);
- [ ] Premium-гейтинг протестирован (демо-активация `?th_demo=1`);
- [ ] RuStore Billing подключён и тестовая покупка проходит;
- [ ] Восстановление покупок RuStore работает после переустановки;
- [ ] Иконки адаптивные, splash не искажается на вытянутых экранах.
