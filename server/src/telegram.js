/* Train Hard backend — проверка Telegram initData (серверная, по спецификации).
 *
 * secret_key = HMAC_SHA256(bot_token, "WebAppData")
 * hash       = HMAC_SHA256(data_check_string, secret_key)
 * data_check_string = отсортированные key=value (без hash), разделённые \n
 *
 * Проверяются: подпись (timingSafeEqual), свежесть auth_date (≤24ч, не из будущего).
 * initData НИКОГДА не принимается на веру от клиента без подписи. */
'use strict';
const crypto = require('crypto');

const MAX_AGE_MS = 24 * 3600 * 1000;
const FUTURE_GRACE_MS = 60 * 1000;

function verifyInitData(initData, botToken) {
  try {
    const params = new URLSearchParams(String(initData || ''));
    const hash = params.get('hash');
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return { ok: false, reason: 'malformed' };

    const pairs = [];
    for (const [k, v] of params.entries()) if (k !== 'hash') pairs.push([k, v]);
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const dataCheckString = pairs.map(([k, v]) => k + '=' + v).join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calc = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    const a = Buffer.from(calc, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad signature' };

    const authDate = Number(params.get('auth_date')) * 1000;
    const now = Date.now();
    if (!isFinite(authDate) || now - authDate > MAX_AGE_MS) return { ok: false, reason: 'expired' };
    if (authDate - now > FUTURE_GRACE_MS) return { ok: false, reason: 'future auth_date' };

    let user = null;
    try { user = JSON.parse(params.get('user') || 'null'); } catch (e) {}
    if (!user || !Number.isInteger(user.id) || user.id <= 0) return { ok: false, reason: 'no user' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, reason: 'malformed' };
  }
}

/* Сборка валидного initData (для тестов и локальной отладки). */
function signInitData(fields, botToken) {
  const params = new URLSearchParams();
  for (const k of Object.keys(fields)) params.append(k, fields[k]);
  const pairs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const dcs = pairs.map(([k, v]) => k + '=' + v).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  params.append('hash', hash);
  return params.toString();
}

module.exports = { verifyInitData, signInitData };
