# Train Hard MVP — заголовки безопасности для хостинга/CDN

HTML-мета-теги **не заменяют** HTTP-заголовки: `frame-ancestors` в meta игнорируется
браузерами, а `<meta http-equiv="Content-Security-Policy">` не поддерживает report-uri
и применяется хуже. Поэтому CSP и прочие заголовки настраиваются на стороне хостинга.
Файлы приложения статические — настройка один раз при деплое.

## Обязательный набор (минимум)

```
Content-Security-Policy: <см. ниже>
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
```

`X-Frame-Options: DENY` + `frame-ancestors 'none'` закрывают clickjacking. Приложению
встраивание в iframe не нужно.

`camera=(self)` — обязательное разрешение для QR-сканера челленджей (getUserMedia):
видео декодируется локально и никуда не отправляется. Если сканер не планируется,
можно вернуть `camera=()`.

## Content-Security-Policy

### Вариант A — совместимый с текущей single-file сборкой

Приложение сознательно собрано в один самодостаточный HTML (инлайн-скрипты и стили,
base64-ассеты, полный офлайн). Для такой архитектуры в `script-src`/`style-src`
требуется `'unsafe-inline'`. Это учтённый компромисс: **без `'unsafe-eval'`**, без
внешних origin, `object-src 'none'`, `base-uri 'self'`:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self' data:;
  media-src 'self' data: blob:;
  connect-src 'self';
  form-action 'self';
  base-uri 'self';
  object-src 'none';
  frame-ancestors 'none'
```

Примечания:
- `connect-src 'self'` — приложение сетевых запросов не делает. Если включён приём
  платежей (verifyUrl на вашем backend), добавьте его origin явно:
  `connect-src 'self' https://verify.вашдомен.ru`.
- Оплата происходит на странице ЮKassa (переход `window.open`), а не в iframe приложения —
  её CSP не пересекается с нашей.
- `unsafe-eval` **не нужен**: в коде нет `eval`/`new Function` (проверено аудитом,
  см. SECURITY-AUDIT.md).

### Вариант B — строгий (рекомендуется при распиле на файлы в 2.0)

Когда сборка разделится на внешние `.js`/`.css`, замените `'unsafe-inline'` на хэши
или nonce:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'sha256-<hash1>' 'sha256-<hash2>' ...;
  style-src 'self' 'unsafe-inline';      /* Tailwind-классы генерируются, позже тоже на хэши */
  ...
```

Хэши пересчитываются при каждой сборке (`build.py` может их выводить).

## HSTS (только HTTPS-хостинг с сертификатом)

```
Strict-Transport-Security: max-age=15552000; includeSubDomains
```
Включать после того, как домен окончательно на HTTPS (PWA и service worker требуют
HTTPS всё равно).

## Примеры конфигураций

### nginx
```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" always;
add_header X-Frame-Options "DENY" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
```

### Netlify — `netlify.toml`
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(self), microphone=(), geolocation=(), payment=(), usb=()"
    X-Frame-Options = "DENY"
    Cross-Origin-Opener-Policy = "same-origin"
```

### Cloudflare Pages — `_headers`
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=()
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
```

### GitHub Pages
Заголовки настроить нельзя — используйте Cloudflare (прокси перед Pages) или другой
хостинг из списка выше. Без заголовков приложение продолжает работать, но защита
от clickjacking/Sniffing обеспечена не будет.

## RuStore/Android-сборка

Заголовки CSP относятся к web-деплою. В Android-сборке (Capacitor) контент грузится
из `https://localhost` внутри WebView — сохраните `androidScheme: https` и не
включайте `allowMixedContent`.
