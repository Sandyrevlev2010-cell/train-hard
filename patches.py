# -*- coding: utf-8 -*-
"""
Train Hard MVP — хирургические патчи исходного HTML.

Каждый патч — точная замена с проверкой уникальности анкера.
Если анкер не найден или найден более одного раза — сборка падает
с понятной ошибкой (лучше упасть на сборке, чем молча сломать приложение).
"""

APPLIED = []


def replace_once(src, old, new, tag):
    """Замена ровно одного вхождения old -> new. Строгая проверка."""
    n = src.count(old)
    if n != 1:
        raise AssertionError("[%s] анкер найден %d раз (ожидался 1): %r..." % (tag, n, old[:80]))
    APPLIED.append(tag)
    return src.replace(old, new, 1)


# ----------------------------------------------------------------------------
# Балансный поиск конца JS-выражения.
# Учитывает '...', "...", `...` с вложенными ${ }, // и /* */ комментарии.
# ----------------------------------------------------------------------------

def match_paren(src, open_idx):
    """open_idx указывает на '('. Возвращает индекс сразу после соответствующей ')'."""
    depth = 0
    i = open_idx
    n = len(src)
    stack = []
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        state = stack[-1] if stack else 'code'
        if state == 'lc':
            if c == '\n':
                stack.pop()
            i += 1
            continue
        if state == 'bc':
            if c == '*' and nxt == '/':
                stack.pop()
                i += 2
            else:
                i += 1
            continue
        if state in ('sq', 'dq'):
            if c == '\\':
                i += 2
                continue
            if (state == 'sq' and c == "'") or (state == 'dq' and c == '"'):
                stack.pop()
            i += 1
            continue
        if state == 'tpl':
            if c == '\\':
                i += 2
                continue
            if c == '`':
                stack.pop()
                i += 1
                continue
            if c == '$' and nxt == '{':
                stack.append('code_brace')
                i += 2
                continue
            i += 1
            continue
        # code | code_brace
        if c == '/' and nxt == '/':
            stack.append('lc'); i += 2; continue
        if c == '/' and nxt == '*':
            stack.append('bc'); i += 2; continue
        if c == "'":
            stack.append('sq'); i += 1; continue
        if c == '"':
            stack.append('dq'); i += 1; continue
        if c == '`':
            stack.append('tpl'); i += 1; continue
        if c == '(':
            depth += 1; i += 1; continue
        if c == ')':
            depth -= 1
            i += 1
            if depth == 0:
                return i
            continue
        if c == '}' and stack and stack[-1] == 'code_brace':
            stack.pop()
        i += 1
    raise AssertionError("Не найдена закрывающая скобка от %d" % open_idx)


def call_start_before(src, anchor_idx, call_open):
    """Ближайшее назад начало вызова (например '(0,N.jsxs)(`button`')."""
    start = src.rfind(call_open, 0, anchor_idx)
    if start == -1:
        raise AssertionError("Начало вызова %r перед анкором не найдено" % call_open)
    return start


def span_of_call(src, start, wrapper):
    """start — позиция '(0,N.jsx'/'(0,N.jsxs)'; wrapper — длина обёртки до второй '('. """
    open_idx = start + wrapper          # индекс второй '('
    if src[open_idx] != '(':
        raise AssertionError("На позиции %d ожидалась '('" % open_idx)
    return open_idx, match_paren(src, open_idx)


def remove_call(src, anchor, call_open, wrapper, tag):
    """Удаляет вызов (вместе с одной запятой), содержащий anchor."""
    if src.count(anchor) != 1:
        raise AssertionError("[%s] анкор найден %d раз: %r" % (tag, src.count(anchor), anchor[:50]))
    a = src.find(anchor)
    start = call_start_before(src, a, call_open)
    open_idx, end = span_of_call(src, start, wrapper)
    if not (start < a < end):
        raise AssertionError("[%s] спан не содержит анкор" % tag)
    if src[end] == ',':
        start_del, end_del = start, end + 1
    elif src[start - 1] == ',':
        start_del, end_del = start - 1, end
    else:
        start_del, end_del = start, end
    APPLIED.append(tag)
    return src[:start_del] + src[end_del:]


def replace_call(src, anchor, call_open, wrapper, replacement, tag):
    """Заменяет вызов, содержащий anchor, на replacement."""
    if src.count(anchor) != 1:
        raise AssertionError("[%s] анкор найден %d раз: %r" % (tag, src.count(anchor), anchor[:50]))
    a = src.find(anchor)
    start = call_start_before(src, a, call_open)
    open_idx, end = span_of_call(src, start, wrapper)
    if not (start < a < end):
        raise AssertionError("[%s] спан не содержит анкор" % tag)
    APPLIED.append(tag)
    return src[:start] + replacement + src[end:]


JSX = '(0,N.jsx)'    # 8 символов
JSXS = '(0,N.jsxs)'  # 9 символов


# ----------------------------------------------------------------------------
# Патчи основного React-бандла
# ----------------------------------------------------------------------------

WE_BODY = ("async function we(e,t,n=6e3){if(typeof fetch!=`function`)return null;let r;try{r=Se()+e}"
           "catch{return null}let i=typeof AbortController<`u`?new AbortController:null,"
           "a=setTimeout(()=>{i&&i.abort()},n),o={...(t||{})},s=o.token||``,"
           "c={\"Content-Type\":`application/json`};s&&(delete o.token,c.Authorization=`Bearer ${s}`);"
           "try{return await(await fetch(r,{method:`POST`,headers:c,body:JSON.stringify(o),"
           "signal:i?i.signal:void 0,credentials:`same-origin`})).json()}catch{return null}"
           "finally{clearTimeout(a)}}")

WE_NEW = ("async function we(){/* Train Hard MVP: офлайн-режим, сетевых вызовов нет. "
          "Будущий backend: вернуть POST-клиента здесь. */return null}")

VE_RENDER = ("e===0&&(0,N.jsx)(Ve,{onNext:async(e,t)=>{await n(e,t)},"
             "onLogin:async(e,t)=>{await r(e,t)},error:i}),")

PREMIUM_CTA = (
    "n?null:(0,N.jsxs)(`button`,{onClick:()=>{try{window.__thPay&&window.__thPay()}catch(e){}},"
    "className:`mx-4 mt-4 w-[calc(100%-2rem)] bg-[#121212] rounded-3xl p-4 ring-1 ring-amber-500/25 "
    "hover:ring-amber-500/50 transition shrink-0 flex items-center gap-3 text-left cursor-pointer`,"
    "children:[(0,N.jsx)(`span`,{className:`w-11 h-11 rounded-2xl bg-amber-500/15 ring-1 ring-amber-500/30 "
    "flex items-center justify-center text-amber-400 text-xl leading-none shrink-0`,children:`\u2726`}),"
    "(0,N.jsxs)(`span`,{className:`flex-1 min-w-0`,children:["
    "(0,N.jsx)(`span`,{className:`block text-[10px] font-black uppercase tracking-[0.15em] text-amber-400`,"
    "children:`Premium`}),"
    "(0,N.jsx)(`span`,{className:`block text-sm font-bold`,children:`Old School, AI-сплит и питание с КБЖУ`}),"
    "(0,N.jsx)(`span`,{className:`block text-[10px] text-gray-600`,children:`100 \u20bd / 30 дней · без автосписаний`})"
    "]}),(0,N.jsx)(`span`,{className:`text-2xl font-black text-amber-400 shrink-0`,children:`\u2192`})]})"
)

NT_NEW = ("function Nt(){let{setModal:e}=P();return(0,N.jsx)(Tt,{onClose:()=>e(null),wide:!0,"
          "children:(0,N.jsx)(`div`,{className:`thp-wrap`,ref:function(r){r&&window.__THPrem&&window.__THPrem.mount(r)}})})}")

WHY_OLD_1 = ("Подписка нужна, чтобы TrainHard работал: это оплата серверов, поддержка пользователей, "
             "обслуживание нейросети и зарплата программистам, которые каждый день делают приложение лучше. 😊")
WHY_NEW_1 = ("Подписка открывает дополнительный контент: программы Old School, AI-сплит и питание "
             "с расчётом КБЖУ. Тренировки, таймеры и прогресс — бесплатны и останутся бесплатными.")

SERVER_CARD_PREFIX = ("(0,N.jsxs)(`div`,{className:`mx-4 mt-3 bg-[#121212] rounded-3xl p-5 ring-1 ring-white/5`,"
                      "children:[(0,N.jsxs)(`div`,{className:`flex items-center justify-between mb-2`")


def patch_bundle(src):
    # --- P1: API-клиент -> офлайн-заглушка (0 сетевых вызовов) ---
    src = replace_once(src, WE_BODY, WE_NEW, 'P1 api-offline')

    # --- P2: boot — гостевой профиль вместо обязательного входа ---
    src = replace_once(
        src,
        "let e=Pe();if(!e){i(`onboarding`);return}",
        "let e=Pe();if(!e){Fe(`guest`);n(t=>({...t,login:`guest`}));i(`onboarding`);return}",
        'P2 boot-guest')

    # --- P3: онбординг начинается с выбора цели (экран входа удалён) ---
    src = replace_once(
        src,
        "[r,i]=(0,_.useState)(`boot`),[a,o]=(0,_.useState)(0),",
        "[r,i]=(0,_.useState)(`boot`),[a,o]=(0,_.useState)(1),",
        'P3 onboarding-step1')

    # --- P4: рендер экрана входа удалён; мёртвый код Ve больше не называет экран «входом» ---
    src = replace_once(src, VE_RENDER, "", 'P4 remove-login-screen')
    src = replace_once(src, "title:`Войди или создай аккаунт`", "title:`Train Hard`", 'P4b dead-login-title')

    # --- P5: прогресс-бар онбординга — 3 шага ---
    src = replace_once(src, "children:[1,2,3,4].map(", "children:[1,2,3].map(", 'P5 dots-3')

    # --- P6-P8: перенумерация шагов ---
    src = replace_once(src, "Be,{step:2,title:`Какой результат хочешь получить?`",
                       "Be,{step:1,title:`Какой результат хочешь получить?`", 'P6 step-goal')
    src = replace_once(src, "Be,{step:3,title:`Как тебя зовут?`",
                       "Be,{step:2,title:`Как тебя зовут?`", 'P7 step-profile')
    src = replace_once(src, "Be,{step:4,title:`Выбери программу`",
                       "Be,{step:3,title:`Выбери программу`", 'P8 step-program')

    # --- P9: сброс данных -> снова гостевой профиль ---
    src = replace_once(
        src,
        "Fe(``),De(``);let t=Oe();n(t),i(`onboarding`),o(0)",
        "Fe(`guest`),De(``);let t=Oe();t.login=`guest`,n(t),i(`onboarding`),o(1)",
        'P9 reset-guest')

    # --- P10: загрузка состояния учитывает entitlement PremiumManager ---
    src = replace_once(
        src,
        "function Ae(e){try{let t=localStorage.getItem(ke(e));if(t)return{...Oe(),...JSON.parse(t)}}catch{}return Oe()}",
        "function Ae(e){let n;try{let t=localStorage.getItem(ke(e));n=t?{...Oe(),...JSON.parse(t)}:Oe()}catch{n=Oe()}"
        "try{let t=window.__THPrem?window.__THPrem.until():0;typeof t==`number`&&t>(n.premiumUntil||0)&&(n.premiumUntil=t)}catch{}"
        "return n}",
        'P10 premium-merge')

    # --- P11: экспорт точки обновления состояния для PremiumManager ---
    src = replace_once(
        src,
        "function D(e){n(t=>({...t,...e}))}",
        "function D(e){n(t=>({...t,...e}))}try{window.__THPatch=D}catch(e){}",
        'P11 expose-patch')

    # --- P12: payPremium -> PremiumManager ---
    src = replace_once(
        src,
        "async function xe(){re(`Платёжный модуль пока не подключён`)}",
        "async function xe(){window.__THPrem?window.__THPrem.checkout():re(`Premium-оплата подключается`)}",
        'P12 paypremium-route')

    # --- P13: модалка Premium -> экран PremiumManager ---
    i = src.find("function Nt(){let{setModal:e,isPrem:t,daysLeft:n}=P();")
    if i == -1:
        raise AssertionError('P13: Nt не найдена')
    j = src.find("function Pt(){", i)
    if j == -1:
        raise AssertionError('P13: конец Nt не найден')
    src = src[:i] + NT_NEW + src[j:]
    APPLIED.append('P13 premium-screen')

    # --- P15: карточка «Рейтинг · Арена» -> Premium CTA (сначала: внутри неё thArenaOpen) ---
    src = replace_call(src, 'Рейтинг · Арена', '(0,N.jsxs)(`button`', len(JSXS), PREMIUM_CTA, 'P15 premium-cta')

    # --- P14: плавающая кнопка Arena на главном экране удалена ---
    src = remove_call(src, 'thArenaOpen', '(0,N.jsxs)(`button`', len(JSXS), 'P14 arena-fab')

    # --- P16: меню — интервальный таймер + честный футер ---
    src = replace_once(
        src,
        "{t:`AI-тренер`,fn:()=>h(!0)}",
        "{t:`AI-тренер`,fn:()=>h(!0)},{t:`Интервальный таймер`,fn:()=>{try{window.__THTimer&&window.__THTimer.open()}catch(e){}}}",
        'P16a drawer-interval')
    src = replace_once(src, "Train Hard v2 · React · демо", "Train Hard · MVP 1.0", 'P16b drawer-footer')

    # --- P17: профиль — без аккаунтов и сервера ---
    src = replace_once(src, "children:`Аккаунт и данные`}", "children:`Профиль и данные`}", 'P17a profile-sub')
    src = replace_once(src, "[`@`,e.login,` · `,e.city]", "[e.city]", 'P17b profile-city')
    src = replace_once(src,
                       "Train Hard · демо-версия · данные хранятся локально",
                       "Train Hard MVP · данные хранятся только на этом устройстве",
                       'P17c profile-footer')

    # P17d: карточка «Сервер и синхронизация» (2 уровня: карточка -> шапка с заголовком)
    a = src.find('Сервер и синхронизация')
    if a == -1:
        raise AssertionError('P17d: анкор не найден')
    card_start = src.rfind(SERVER_CARD_PREFIX, 0, a)
    if card_start == -1:
        raise AssertionError('P17d: начало карточки не найдено')
    open_idx = card_start + len(JSXS)
    end = match_paren(src, open_idx)
    if not (card_start < a < end):
        raise AssertionError('P17d: спан не содержит анкор')
    if src[end] != ',':
        raise AssertionError('P17d: после карточки нет запятой')
    src = src[:card_start] + src[end + 1:]
    APPLIED.append('P17d remove-server-card')

    # P17e: кнопка «Выйти из аккаунта»
    src = remove_call(src, 'children:`Выйти из аккаунта`}', '(0,N.jsx)(`button`', len(JSX), 'P17e remove-logout')

    src = replace_once(
        src,
        "e.indexOf(`trainhard_react_`)===0||e===`trainhard_v1_challenges`||e===`trainhard_analytics_v1`"
        "||e===`trainhard_interval_timer_v1`||e===`trainhard_premium_pending_v1`"
        "?localStorage.removeItem(e):void 0",
        'P24 reset-clears-challenges')

    # --- P25: серия сбрасывается после 2 дней без тренировок (правило как у ge()
    #     в бандле), уже при загрузке профиля + флаг для уведомления ---
    src = replace_once(
        src,
        "function Ae(e){let n;try{let t=localStorage.getItem(ke(e));n=t?{...Oe(),...JSON.parse(t)}:Oe()}catch{n=Oe()}"
        "try{let t=window.__THPrem?window.__THPrem.until():0;typeof t==`number`&&t>(n.premiumUntil||0)&&(n.premiumUntil=t)}catch{}"
        "return n}",
        "window.thStreakFix=function(p){try{if(p){"
        "if(typeof p.streak!==`number`||!isFinite(p.streak)||p.streak<0)p.streak=0;else p.streak=Math.floor(p.streak);"
        "if(typeof p.bestStreak!==`number`||!isFinite(p.bestStreak)||p.bestStreak<0)p.bestStreak=0;else p.bestStreak=Math.floor(p.bestStreak);"
        "if(!p.completedDays||typeof p.completedDays!==`object`||Array.isArray(p.completedDays))p.completedDays={};"
        "if(p.records&&typeof p.records!==`object`)p.records={};"
        "if(p.workoutLogs&&!Array.isArray(p.workoutLogs))p.workoutLogs=[];"
        "if(p.trainingPlan&&typeof p.trainingPlan!==`object`)p.trainingPlan=null;}}catch(q){}"
        "try{if(p&&p.streak>0&&p.completedDays){"
        "var ks=Object.keys(p.completedDays).filter(function(k){return/^\\d{4}-\\d{2}-\\d{2}$/.test(k)}).sort();"
        "if(ks.length){var last=ks[ks.length-1];var now=new Date();now.setHours(12,0,0,0);"
        "var gap=(now-new Date(last+'T12:00:00'))/864e5;"
        "if(gap>=2){window.__thStreakResetFrom=p.streak;p.streak=0;}}}}catch(q){}return p};"
        "function Ae(e){let n;try{let t=localStorage.getItem(ke(e));n=t?thStreakFix({...Oe(),...JSON.parse(t)}):Oe()}catch{n=Oe()}"
        "try{let t=window.__THPrem?window.__THPrem.until():0;typeof t==`number`&&t>(n.premiumUntil||0)&&(n.premiumUntil=t)}catch{}"
        "try{window.__thStreakResetFrom&&je(e,n)}catch{}"
        "return n}",
        'P25 streak-reset-2days')

    # --- P26: план подписки «1 TON / 30 дней» вместо «100 ₽» (все тексты бандла) ---
    n_price = src.count('100 ₽')
    if not (6 <= n_price <= 10):
        raise AssertionError('P26: неожиданное число «100 ₽»: %d' % n_price)
    src = src.replace('100 ₽', '1 TON')
    APPLIED.append('P26 ton-price-plan (%d замен)' % n_price)

    # --- P18: честный текст «За что я плачу?» ---
    src = replace_once(src, WHY_OLD_1, WHY_NEW_1, 'P18a why-text')
    src = replace_once(src,
                       "Спасибо, что ты с нами — твоя поддержка помогает TrainHard расти! 💪",
                       "Спасибо за поддержку — она помогает делать TrainHard лучше. 💪",
                       'P18b why-text2')

    # --- P19: серверного режима нет ---
    src = replace_once(src, "isServerMode:()=>!!Ee(),", "isServerMode:()=>!1,", 'P19 never-server')

    # --- P20: чип статуса без логина ---
    src = replace_once(src, "children:n.name||n.login}", "children:n.name||`Спортсмен`}", 'P20 chip-name')

    # --- P21: аналитика — завершение тренировки ---
    src = replace_once(
        src,
        "completeWorkout:M,",
        "completeWorkout:(...thA)=>{try{window.__THAnalytics&&window.__THAnalytics.track(`workout_complete`)}catch{}return M(...thA)},",
        'P21 analytics-complete')
    src = replace_once(
        src,
        "completeWorkout:M,",
        "completeWorkout:(...thA)=>{try{window.__THAnalytics&&window.__THAnalytics.track(`workout_complete`)}catch{}"
        "try{window.__THChallenges&&window.__THChallenges.onWorkoutCompleted(thA[0],thA[1])}catch{}"
        "return M(...thA)},",
        'P21 analytics+challenges-complete')

    # --- P23: Challenges-хук при добавлении рекорда (проходка) ---
    src = replace_once(
        src,
        "addRecord:ye,",
        "addRecord:(...thR)=>{const thRes=ye(...thR);"
        "try{window.__THChallenges&&window.__THChallenges.onRecordAdded(thR[2],thR[3])}catch{}"
        "return thRes},",
        'P23 challenges-record-hook')

    # --- P22: аналитика — открытие тренировки/Premium ---
    src = replace_once(
        src,
        "function p(e,t){e?(u(e),f(t??null)):(u(null),f(null))}",
        "function p(e,t){try{window.__THAnalytics&&e&&(`workout`===e?window.__THAnalytics.track(`workout_open`)"
        ":`pay`===e&&window.__THAnalytics.track(`premium_open`))}catch{}"
        "e?(u(e),f(t??null)):(u(null),f(null))}",
        'P22 analytics-open')

    return src


# ----------------------------------------------------------------------------
# Патчи HTML-обвязки
# ----------------------------------------------------------------------------

def remove_block(src, start_marker, end_marker, tag):
    a = src.find(start_marker)
    if a == -1:
        raise AssertionError("[%s] не найден %r" % (tag, start_marker))
    b = src.find(end_marker, a)
    if b == -1:
        raise AssertionError("[%s] не найден конец %r" % (tag, end_marker))
    APPLIED.append(tag)
    return src[:a] + src[b + len(end_marker):]


CF_MARKER = '<script>(function(){function c(){var b=a.contentDocument'


def patch_html_pre(src):
    """Удаление Arena и мусора — ДО патчей бандла (анкеры должны быть уникальны
    во всём документе)."""
    # H1: Arena CSS
    src = remove_block(src, '<style id="trainhard-arena-system">', '</style>', 'H1 arena-css')

    # H2: статичная разметка Arena (кнопка + модалка) и Arena JS
    marker_btn = '<button class="th-arena-btn" id="thArenaOpen"'
    a = src.find(marker_btn)
    if a == -1:
        raise AssertionError('H2: Arena-разметка не найдена')
    b = src.find('<script id="trainhard-arena-js">', a)
    if b == -1:
        raise AssertionError('H2: Arena-скрипт не найден')
    c = src.find('</script>', b)
    if c == -1:
        raise AssertionError('H2: конец Arena-скрипта не найден')
    src = src[:a] + src[c + len('</script>'):]
    APPLIED.append('H2 arena-html+js')

    # H3: два одинаковых Cloudflare-мусорных скрипта
    count = src.count(CF_MARKER)
    if count != 2:
        raise AssertionError('H3: CF-скриптов найдено %d (ожидалось 2)' % count)
    while CF_MARKER in src:
        a = src.find(CF_MARKER)
        b = src.find('</script>', a)
        src = src[:a] + src[b + len('</script>'):]
    APPLIED.append('H3 cf-junk')

    # H4: хвостовой комментарий Arena
    src = src.replace('\n<!-- Arena system injected: rules/how-it-works wired to dedicated modal. -->', '')
    APPLIED.append('H4 arena-comment')
    return src


def patch_html(src, module_scripts_html, head_extra):
    # H5: PWA-мета в <head>
    src = replace_once(src, '</head>', head_extra + '\n</head>', 'H5 pwa-head')

    # H6: модули MVP сразу после основного React-бандла
    bundle_close = src.find('</script>', src.find('window.__thImg'))   # конец theme-assets
    bundle_open = src.find('<script>', bundle_close)                    # основной бандл
    bundle_end = src.find('</script>', bundle_open)
    src = (src[:bundle_end + len('</script>')] + '\n' + module_scripts_html +
           src[bundle_end + len('</script>'):])
    APPLIED.append('H6 inject-modules')

    # H7: title + description
    src = replace_once(
        src,
        '<title>Train Hard — Планировщик тренировок</title>',
        '<title>Train Hard — тренировки, таймеры и прогресс</title>\n'
        '<meta name="description" content="Train Hard — планировщик тренировок: программы, интервальный '
        'таймер, локальный прогресс и статистика. Работает без интернета.">',
        'H7 title-meta')

    return src


def apply_all(src, module_scripts_html, head_extra):
    global APPLIED
    APPLIED = []
    src = patch_html_pre(src)   # сначала чистим Arena/мусор всего документа
    src = patch_bundle(src)     # затем хирургия бандла
    src = patch_html(src, module_scripts_html, head_extra)
    return src, list(APPLIED)
