# -*- coding: utf-8 -*-
"""
Train Hard MVP — сборка.

original.html (+ src/*.js модули) -> app/index.html (+ PWA-файлы, иконки).

Запуск:  python3 build.py
Проверки: патч-анкеры, синтаксис бандла (node --check), запрещённые строки.
"""
import base64
import io
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import patches  # noqa: E402

ORIGINAL = os.path.join(HERE, 'original.html')
APP_DIR = os.path.join(HERE, 'app')
ICONS = os.path.join(APP_DIR, 'icons')

MODULES = [
    ('premium-config', 'src/premium/premium-config.js'),
    ('storage-service', 'src/storage/storage-service.js'),
    ('analytics-service', 'src/analytics/analytics-service.js'),
    ('payment-adapter', 'src/premium/payment-adapter.js'),
    ('premium-manager', 'src/premium/premium-manager.js'),
    ('arena-config', 'src/arena/arena-config.js'),
    ('arena-api', 'src/arena/arena-api.js'),
    ('sync-bridge', 'src/sync/sync-bridge.js'),
    ('arena-ui', 'src/arena/arena-ui.js'),
    ('interval-timer', 'src/timer/interval-timer.js'),
    ('pwa-register', 'src/pwa/pwa-register.js'),
]

HEAD_EXTRA = (
    '<link rel="manifest" href="manifest.webmanifest">\n'
    '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n'
    '<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">'
)


def read(path):
    import os
    if not os.path.exists(path):
        sys.exit('ОШИБКА: отсутствует %s — исходник бандла. Он входит в архив '
                 '(TrainHard-ALL.zip). Без него сборка невозможна: build.py '
                 'патчит оригинальный React-бандл, а не собранный app/index.html.' % path)

    with open(path, encoding='utf-8') as f:
        return f.read()


def build_modules_html():
    parts = []
    for mid, rel in MODULES:
        body = read(os.path.join(HERE, rel))
        parts.append('<script id="th-mvp-%s">\n%s\n</script>' % (mid, body))
    return '\n'.join(parts)


def extract_logo(src):
    """Логотип из window.__thImg.logo (data:webp) -> PIL Image."""
    from PIL import Image
    m = re.search(r'logo:\s*"(data:image/webp;base64,[^"]+)"', src)
    if not m:
        m = re.search(r'logo:\s*"(data:image/[^;"]+;base64,[^"]+)"', src)
    if not m:
        raise RuntimeError('Логотип не найден в theme-assets')
    data_uri = m.group(1)
    b64 = data_uri.split(',', 1)[1]
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw)).convert('RGBA')
    return img


def make_icons():
    from PIL import Image
    src = read(ORIGINAL)
    img = extract_logo(src)
    os.makedirs(ICONS, exist_ok=True)

    def square(size, pad_ratio=0.0):
        canvas = Image.new('RGBA', (size, size), (0, 0, 0, 255))
        inner = int(size * (1 - pad_ratio * 2))
        im = img.copy()
        im.thumbnail((inner, inner), Image.LANCZOS)
        canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
        return canvas

    square(192).save(os.path.join(ICONS, 'icon-192.png'))
    square(512).save(os.path.join(ICONS, 'icon-512.png'))
    square(512, pad_ratio=0.12).save(os.path.join(ICONS, 'maskable-512.png'))
    square(180).save(os.path.join(ICONS, 'apple-touch-icon.png'))
    return img.size


MANIFEST = {
    "name": "Train Hard — тренировки и таймеры",
    "short_name": "Train Hard",
    "description": "Планировщик тренировок: программы, интервальный таймер, локальный прогресс. Работает без интернета.",
    "lang": "ru",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#000000",
    "theme_color": "#000000",
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
    ]
}


def write_manifest():
    import json
    with open(os.path.join(APP_DIR, 'manifest.webmanifest'), 'w', encoding='utf-8') as f:
        json.dump(MANIFEST, f, ensure_ascii=False, indent=2)


BANNED = [
    'api.trainhard.ru',
    # «Я оплатил» убран из запретов: в TON-флоу кнопка «Я оплатил — проверить»
    # запускает проверку транзакции в блокчейне (НЕ самоподтверждение);
    # самоподтверждение по-прежнему запрещено (confirm-paid ниже)
    'confirm-paid',
    'cancel-paid',
    'th_demo',
    'Тестовая активация',
    'mode: `trust`',
    'mode:`trust`',
    'trainhard-arena-system',
    'trainhard-arena-js',
    'thArenaOpen',
    'thArenaRank',
    'Рейтинг · Арена',
    'Войди или создай аккаунт',
    'Платёжный модуль пока не подключён',
    'Сервер и синхронизация',
    'Выйти из аккаунта',
    'trainhard_competitive_groups',
    '__CF$cv$params',
    'Платёжный модуль ещё не подключён',
    'обслуживание нейросети',
    'Вступи в группу',
]

REQUIRED = [
    'getTrustedEntitlement',
    'TRAINHARD_ARENA',
    '__THAPI',
    '__THSync',
    '__THArena',
    'ENTITLEMENT_UNVERIFIED',
    'Я оплатил — проверить',
    'Оплата переводом TON',
    'ton://transfer/',
    'toncenter',
    'Оплата пока недоступна',
    '__THPrem',
    '__THAnalytics',
    '__THTimer',
    'TrainHardStorage',
    'thp-wrap',
    'Интервальный таймер',
    'manifest.webmanifest',
    'trainhard_premium_v1',
    'данные хранятся только на этом устройстве',
    'thStreakFix',
    'Серия обновилась',
]


def verify(out):
    errs = []
    for b in BANNED:
        if b in out:
            errs.append('ЗАПРЕЩЁНО, но найдено: %r' % b)
    for r in REQUIRED:
        if r not in out:
            errs.append('ОЖИДАЛОСЬ, но не найдено: %r' % r)
    # количество fetch в клиентском коде должно остаться только в будущем verifyUrl (payment-adapter)
    # и в service worker файле (его тут нет) — проверим бандл:
    return errs


def syntax_check(out):
    """Вырезаем изменённый основной бандл и проверяем синтаксис через node."""
    m = re.search(r'<script>\n?(var e=Object\.create.*?)</script>', out, re.S)
    if not m:
        m = re.search(r'<script>(window\.__thImg.*?var e=Object\.create.*?)</script>', out, re.S)
    # надёжнее: взять самый большой <script> без id
    best = None
    for mm in re.finditer(r'<script>(.*?)</script>', out, re.S):
        if best is None or len(mm.group(1)) > len(best.group(1)):
            best = mm
    if not best:
        raise RuntimeError('Основной бандл не найден для проверки')
    tmp = os.path.join(HERE, 'tools', '_bundle_check.js')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(best.group(1))
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    if r.returncode != 0:
        return 'node --check FAIL:\n' + r.stderr[:3000]
    os.remove(tmp)
    return 'node --check OK (бандл %d символов)' % len(best.group(1))


def main():
    src = read(ORIGINAL)
    modules_html = build_modules_html()
    out, applied = patches.apply_all(src, modules_html, HEAD_EXTRA)

    os.makedirs(APP_DIR, exist_ok=True)
    size = make_icons()
    write_manifest()

    with open(os.path.join(APP_DIR, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(out)

    print('Патчи применены (%d):' % len(applied))
    for p in applied:
        print('  ✔', p)

    errs = verify(out)
    print('\nПроверки строк:', 'OK' if not errs else 'ОШИБКИ')
    for e in errs:
        print('  ✘', e)
    print('\n' + syntax_check(out))
    print('\nРазмер: %.2f МБ (было %.2f МБ)' % (len(out.encode("utf-8")) / 1e6, len(src.encode("utf-8")) / 1e6))
    print('Иконки из логотипа:', size, '-> icons/ 192,512,maskable,apple')
    print('Готово: app/index.html')
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main())
