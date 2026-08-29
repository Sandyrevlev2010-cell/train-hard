/* Train Hard backend — утилиты: JSON, id, rate limit, body, ошибки. */
'use strict';
const crypto = require('crypto');

function id() { return crypto.randomBytes(12).toString('hex'); }
function now() { return Date.now(); }

function json(res, code, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, extra || {}));
  res.end(body);
}
function err(res, code, msg) { return json(res, code, { error: msg }); }

/* Токен-ведро по ключу (IP+бакет). Без внешних зависимостей. */
function makeRateLimiter() {
  const buckets = new Map();
  return function allow(key, limit, windowMs) {
    const t = now();
    let b = buckets.get(key);
    if (!b || t - b.start > windowMs) { b = { start: t, count: 0 }; buckets.set(key, b); }
    b.count++;
    if (buckets.size > 10000) buckets.clear();      /* память */
    return b.count <= limit;
  };
}

/* Чтение тела: только JSON, ≤ maxBytes. */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(Object.assign(new Error('invalid json'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s) { return typeof s === 'string' && DATE_RE.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')); }
function num(v, min, max) { const n = Number(v); return isFinite(n) && n >= min && n <= max ? n : null; }
function str(v, maxLen) { return typeof v === 'string' ? v.slice(0, maxLen) : undefined; }

module.exports = { id, now, json, err, makeRateLimiter, readBody, validDate, num, str };
