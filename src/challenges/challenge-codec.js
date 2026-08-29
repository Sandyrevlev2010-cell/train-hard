/* =============================================================
 * Train Hard Challenges — ChallengeCodec
 *
 * Challenge object → компактный объект → JSON → UTF-8 → Base64URL.
 *
 * Base64URL — транспортное кодирование, НЕ шифрование:
 * Challenge Data не является секретом и не содержит паролей,
 * токенов, платёжных данных и персональных данных.
 *
 * Всё, что приходит из URL, — недоверенное: жёсткая валидация
 * полей, значений, длин. Ничего из payload не вставляется в DOM
 * без экранирования (в UI — только textContent/esc).
 * ============================================================= */
(function () {
  'use strict';

  var VERSION = 1;
  var MAX_PAYLOAD_CHARS = 600;        // лимит длины payload в URL
  var MAX_TITLE = 40;                 // лимит названия
  var MAX_WORKOUT_IDS = 12;

  var DURATIONS = [3, 7, 14, 30, 60];          /* пресеты сроков */
  var TARGETS = [3, 4, 5, 7, 10, 14, 30];      /* пресеты целей */
  var MIN_TARGET = 2, MAX_TARGET = 30;         /* «подряд»: любое целое 2–30 */
  var MIN_DURATION = 1, MAX_DURATION = 90;     /* срок: любое целое 1–90 дней */
  /* Пресеты «N тренировок подряд» — все доступны в бесплатном уровне.
     Перерыв между тренировками максимум 1 день; 2 пропущенных дня
     сбрасывают счёт челленджа. */
  var PRESETS = [
    { n: 3, d: 7 },
    { n: 7, d: 14 },
    { n: 14, d: 30 },
    { n: 30, d: 60 }
  ];

  function isValidTarget(n) {
    return isFinite(n) && Math.floor(n) === n && n >= MIN_TARGET && n <= MAX_TARGET;
  }
  function isValidDuration(d) {
    return isFinite(d) && Math.floor(d) === d && d >= MIN_DURATION && d <= MAX_DURATION;
  }
  var FOCUS = ['fullbody', 'upper', 'lower', 'core', 'cardio', 'mobility', 'mixed'];
  var DIFFICULTY = ['easy', 'standard', 'hard'];
  var EXERCISES = { bp: 'bench', sq: 'squat', dl: 'deadlift' };
  var ID_RE = /^TH[A-Z0-9]{4,8}$/;
  var WID_RE = /^[a-z0-9]{1,8}$/;

  /* ---------- UTF-8 / Base64URL ---------- */

  function utf8ToBytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
        } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function bytesToUtf8(b) {
    var s = '';
    for (var i = 0; i < b.length; ) {
      var c = b[i];
      if (c < 0x80) { s += String.fromCharCode(c); i++; }
      else if (c < 0xe0) { s += String.fromCharCode(((c & 31) << 6) | (b[i + 1] & 63)); i += 2; }
      else if (c < 0xf0) { s += String.fromCharCode(((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63)); i += 3; }
      else {
        var cp = ((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63);
        cp -= 0x10000;
        s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
        i += 4;
      }
    }
    return s;
  }

  function b64urlFromBytes(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.slice(i, i + 0x8000));
    }
    var b64;
    try { b64 = btoa(bin); } catch (e) { return null; }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function bytesFromB64url(s) {
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin;
    try { bin = atob(b64); } catch (e) { return null; }
    var out = new Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------- ID ---------- */

  function makeId() {
    var alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без похожих символов
    var rnd = null;
    try {
      rnd = new Uint8Array(5);
      (window.crypto || {}).getRandomValues && window.crypto.getRandomValues(rnd);
    } catch (e) { rnd = null; }
    var id = 'TH';
    for (var i = 0; i < 5; i++) {
      var n = rnd ? rnd[i] : Math.floor(Math.random() * 256);
      id += alphabet[n % alphabet.length];
    }
    return id;
  }

  /* ---------- валидация структуры ---------- */

  function isPlainObject(o) {
    return !!o && typeof o === 'object' && !Array.isArray(o);
  }

  /* Проверяет «полный» challenge-объект (внутренний формат).
     Возвращает {ok:true, challenge} с очищенными полями
     или {ok:false, error}:
       'bad-json' | 'too-large' | 'version' | 'invalid'
       'exercise-unsupported' | 'speech-unknown'          */
  function validate(ch) {
    if (!isPlainObject(ch)) return { ok: false, error: 'invalid' };

    if (typeof ch.v !== 'number') return { ok: false, error: 'invalid' };
    if (ch.v !== VERSION) return { ok: false, error: 'version' };
    if (typeof ch.id !== 'string' || !ID_RE.test(ch.id)) return { ok: false, error: 'invalid' };

    var f = ch.f;
    var out = { v: VERSION, id: ch.id };

    /* название: строка ≤40, чистка управляющих символов */
    var t = typeof ch.t === 'string' ? ch.t.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_TITLE) : '';
    out.t = t;

    /* длительность */
    var d = Number(ch.d);
    if (!isValidDuration(d)) return { ok: false, error: 'invalid' };
    out.d = d;

    /* речь: неизвестный speechId → fallback s1 + пометка (не ошибка) */
    var Speeches = window.__THSpeeches;
    var s = typeof ch.s === 'string' ? ch.s : '';
    var speechUnknown = false;
    if (!Speeches || !Speeches.isKnown(s)) { s = 's1'; speechUnknown = true; }
    out.s = s;

    if (f === 'strength') {
      out.f = 'strength';
      var exe = EXERCISES[ch.e];
      if (!exe) return { ok: false, error: 'exercise-unsupported' };
      out.e = ch.e;
      var w = Number(ch.w);
      if (!isFinite(w) || w < 1 || w > 500) return { ok: false, error: 'invalid' };
      out.w = Math.round(w * 2) / 2;             // шаг 0.5 кг
    } else {
      if (FOCUS.indexOf(f) === -1) return { ok: false, error: 'invalid' };
      out.f = f;
      var n = Number(ch.n);
      if (!isValidTarget(n)) return { ok: false, error: 'invalid' };
      out.n = n;
      var l = typeof ch.l === 'string' && DIFFICULTY.indexOf(ch.l) !== -1 ? ch.l : 'standard';
      out.l = l;
      if (ch.ws !== undefined) {
        if (!Array.isArray(ch.ws) || ch.ws.length > MAX_WORKOUT_IDS) return { ok: false, error: 'invalid' };
        for (var i = 0; i < ch.ws.length; i++) {
          if (typeof ch.ws[i] !== 'string' || !WID_RE.test(ch.ws[i])) return { ok: false, error: 'invalid' };
        }
        out.ws = ch.ws.slice(0, MAX_WORKOUT_IDS);
      }
    }

    return { ok: true, challenge: out, speechUnknown: speechUnknown };
  }

  /* ---------- encode / decode ---------- */

  function encode(ch) {
    var v = validate(ch);
    if (!v.ok) return { ok: false, error: v.error };
    var json;
    try { json = JSON.stringify(v.challenge); } catch (e) { return { ok: false, error: 'invalid' }; }
    var payload = b64urlFromBytes(utf8ToBytes(json));
    if (!payload || payload.length > MAX_PAYLOAD_CHARS) return { ok: false, error: 'too-large' };
    return { ok: true, payload: payload };
  }

  function decode(payload) {
    if (typeof payload !== 'string' || !payload.length) return { ok: false, error: 'invalid' };
    if (payload.length > MAX_PAYLOAD_CHARS) return { ok: false, error: 'too-large' };
    if (!/^[A-Za-z0-9_-]+$/.test(payload)) return { ok: false, error: 'invalid' };
    var bytes = bytesFromB64url(payload);
    if (!bytes) return { ok: false, error: 'invalid' };
    var json;
    try { json = JSON.parse(bytesToUtf8(bytes)); } catch (e) { return { ok: false, error: 'invalid' }; }
    var v = validate(json);
    if (!v.ok) return { ok: false, error: v.error };
    return { ok: true, challenge: v.challenge, speechUnknown: v.speechUnknown };
  }

  /* ---------- self-contained ссылка ---------- */

  function baseUrl() {
    try {
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        return location.origin + location.pathname;
      }
    } catch (e) {}
    return 'https://trainhard.ru/';               // fallback для не-http сред (QR/шаринг)
  }

  function buildUrl(payload) {
    return baseUrl() + '?challenge=' + payload;
  }

  window.__THChallengeCodec = {
    VERSION: VERSION,
    MAX_PAYLOAD_CHARS: MAX_PAYLOAD_CHARS,
    DURATIONS: DURATIONS,
    PRESETS: PRESETS,
    isValidTarget: isValidTarget,
    isValidDuration: isValidDuration,
    TARGETS: TARGETS,
    FOCUS: FOCUS,
    EXERCISES: EXERCISES,
    makeId: makeId,
    encode: encode,
    decode: decode,
    validate: validate,
    buildUrl: buildUrl
  };
})();
