/* Train Hard backend — точка входа.
 *
 * ENV (см. .env.example):
 *   PORT                 — порт (по умолчанию 8787)
 *   BOT_TOKEN            — токен Telegram-бота (обязателен для /auth/telegram)
 *   DATABASE_URL         — PostgreSQL (пусто → MemoryStore, только dev/тесты)
 *   PLATEGA_MERCHANT_ID / PLATEGA_SECRET / PLATEGA_AMOUNT_RUB / PLATEGA_PERIOD_DAYS — Premium-платежи
 *
 * Production: только за HTTPS-прокси (nginx/Caddy), см. docs/SECURITY-HEADERS.md. */
'use strict';
const http = require('http');
const { createApp } = require('./api');
const { MemoryStore, PgStore } = require('./store');
const { createArenaHandler } = require('./arena-middleware');

async function main() {
  const env = process.env;
  const isProd = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const botToken = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || '';
  const corsOrigin = env.CORS_ORIGIN || '';
  if (isProd) {
    const missing = [];
    if (!env.DATABASE_URL) missing.push('DATABASE_URL');
    if (!botToken) missing.push('TELEGRAM_BOT_TOKEN');
    if (!corsOrigin || corsOrigin === '*') missing.push('CORS_ORIGIN');
    if (missing.length) throw new Error('Production configuration missing: ' + missing.join(', '));
  }
  const store = env.DATABASE_URL ? await makePg(env.DATABASE_URL) : new MemoryStore();
  if (!env.DATABASE_URL) console.warn('[trainhard] DATABASE_URL не задан — MemoryStore (только dev/тесты)');
  const app = createApp({
    store,
    botToken,
    cors: { origin: corsOrigin || '*' },
    platega: {
      merchantId: env.PLATEGA_MERCHANT_ID || '',
      secret: env.PLATEGA_SECRET || '',
      amount: Number(env.PLATEGA_AMOUNT_RUB) || 0,
      currency: 'RUB',
      periodDays: Number(env.PLATEGA_PERIOD_DAYS) || 30,
      returnUrl: env.PLATEGA_RETURN_URL || '',
      failedUrl: env.PLATEGA_FAILED_URL || '',
      fetch: (typeof fetch === 'function') ? fetch : null
    }
  });
  const handler = createArenaHandler(app, store, { corsOrigin: corsOrigin || '*' });
  const server = http.createServer(handler);
  const port = Number(env.PORT) || 8787;
  server.listen(port, '0.0.0.0', () => console.log('[trainhard] API on :' + port));
  const shutdown = async () => {
    server.close(async () => {
      if (store && typeof store.close === 'function') await store.close();
      process.exit(0);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

async function makePg(url) {
  let pg;
  try { pg = require('pg'); }
  catch (e) { throw new Error('DATABASE_URL задан, но пакет pg не установлен: npm i pg'); }
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return new PgStore(pool);
}

if (require.main === module) main();

module.exports = { main };
