/* Train Hard — npm run dev (§42): API (8787) + статика app/ (8080).
 * API в dev-режиме без DATABASE_URL → MemoryStore. */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

/* мини-статика для app/ (без зависимостей) */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, 'app', p);
  if (!file.startsWith(path.join(ROOT, 'app')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
server.listen(8080, '0.0.0.0', () => console.log('[dev] фронтенд: http://localhost:8080 (app/index.html)'));

const api = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], {
  env: Object.assign({}, process.env, { PORT: '8787' }),
  stdio: 'inherit'
});
api.on('exit', (c) => { server.close(); process.exit(c || 0); });
console.log('[dev] API: http://localhost:8787/api/health (MemoryStore, если нет DATABASE_URL)');
console.log('[dev] NOTE: локально без Telegram initData АРЕНА отключена — это честное поведение.');
