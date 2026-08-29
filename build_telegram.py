#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Train Hard — сборка Telegram Mini App.

Берёт готовый app/index.html (основная web-сборка) и создаёт
telegram/index.html, оптимизированный для Telegram Mini App:

  + <script src="https://telegram.org/js/telegram-web-app.js"> (единственный
    внешний скрипт — официальное требование Telegram) в <head>;
  + инлайн telegram-boot.js ДО React-бандла (изоляция аккаунтов по user id);
  + модуль telegram-miniapp.js после остальных модулей (expand/тема/
    BackButton/haptics/deep-link/openLink);
  − service worker (в Telegram WebView SW не нужен и местами недоступен);
  − manifest (Telegram его игнорирует).

Запуск:  python3 build.py  →  python3 build_telegram.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'app', 'index.html')
OUT_DIR = os.path.join(ROOT, 'telegram')
OUT = os.path.join(OUT_DIR, 'index.html')

TG_SCRIPT = ('<script src="https://telegram.org/js/telegram-web-app.js"></script>\n'
             '<script id="th-tg-boot">')

SW_RE = re.compile(r'<script id="th-mvp-pwa-register">.*?</script>\n?', re.S)
MANIFEST_RE = re.compile(r'<link rel="manifest" href="[^"]*">\n?')


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def main():
    html = read(SRC)
    boot = read(os.path.join(ROOT, 'src', 'telegram', 'telegram-boot.js'))
    mini = read(os.path.join(ROOT, 'src', 'telegram', 'telegram-miniapp.js'))

    # 1) убрать SW-регистрацию и manifest (в Telegram не нужны)
    html, n_sw = SW_RE.subn('', html)
    html, n_man = MANIFEST_RE.subn('', html)
    assert n_sw == 1, 'pwa-register не найден (ожидался 1)'
    assert n_man == 1, 'manifest-link не найден (ожидался 1)'

    # 2) telegram-web-app.js + boot до первого инлайн-бандла
    first_script = html.find('<script>')
    assert first_script != -1, 'не найден первый <script>'
    inject = TG_SCRIPT + boot + '</script>\n'
    html = html[:first_script] + inject + html[first_script:]

    # 3) модуль интеграции — в конце, перед </body>
    module = ('<script id="th-tg-miniapp">\n' + mini + '\n</script>\n')
    assert html.count('</body>') == 1
    html = html.replace('</body>', module + '</body>')

    # 4) проверки
    required = [
        'https://telegram.org/js/telegram-web-app.js',
        'th-tg-boot', 'th-tg-miniapp',
        'trainhard_react_session',        # boot: изоляция аккаунтов
        'disableVerticalSwipes', 'BackButton', 'HapticFeedback',
        'start_param', 'openLink', 'openPreview',
    ]
    for r in required:
        assert r in html, 'нет строки: ' + r
    assert 'th-mvp-pwa-register' not in html
    assert 'manifest.webmanifest' not in html
    # внешний скрипт ровно один и только telegram.org
    ext = re.findall(r'<script[^>]+src="(http[^"]+)"', html)
    assert ext == ['https://telegram.org/js/telegram-web-app.js'], ext

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)

    # синтаксис всех инлайн-скриптов — быстрый sanity-check через node
    import subprocess
    js = "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');" \
         "const re=/<script[^>]*>([\\s\\S]*?)<\\/script>/g;let m,i=0;" \
         "while((m=re.exec(s))){if(m[1].trim()){i++;new Function(m[1]);}}" \
         "console.log('inline scripts OK:',i);"
    r = subprocess.run(['node', '-e', js, OUT], capture_output=True, text=True)
    if 'inline scripts OK' not in r.stdout:
        print(r.stdout, r.stderr)
        sys.exit('синтаксическая проверка не прошла')
    print(r.stdout.strip())
    print('Telegram-сборка: %s (%.2f МБ)' % (OUT, len(html) / 1048576))
    print('Убрано: SW-регистрация, manifest. Добавлено: telegram-web-app.js + boot + miniapp.')


if __name__ == '__main__':
    main()
