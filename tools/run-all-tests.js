/* Train Hard — единый запуск всех тестов (frontend jsdom + backend node:test).
 * Выход: сводка по наборам, код 1 если есть провалы. */
const { spawnSync } = require('child_process');
const path = require('path');

const FRONTEND = [
  ['smoke', 'smoke-test.js'],
  ['payments', 'payment-test.js'],
  ['challenges', 'challenge-test.js'],
  ['storage', 'no-storage-test.js'],
  ['security', 'audit-test.js'],
  ['telegram', 'telegram-test.js'],
  ['arena', 'arena-test.js'],
];

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 15 * 60 * 1000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function parseSummary(out) {
  const m = out.match(/Итог:\s*(\d+) ✔\s*\/\s*(\d+) ✘/);
  if (m) return { pass: +m[1], fail: +m[2] };
  const t = out.match(/# (tests|pass|fail)\s+(\d+)/g);
  if (t) {
    const get = (k) => +(t.find((s) => s.startsWith('# ' + k)) || '').split(/\s+/)[2] || 0;
    return { pass: get('pass'), fail: get('fail') };
  }
  return null;
}

(async () => {
  const onlyFrontend = process.argv.includes('--frontend-only');
  const onlyBackend = process.argv.includes('--backend-only');
  const rows = [];
  let bad = 0;
  for (const [name, file] of (onlyBackend ? [] : FRONTEND)) {
    process.stdout.write(`frontend/${name} ... `);
    const r = run('node', [path.join('tools', file)], path.join(__dirname, '..'));
    const s = parseSummary(r.out);
    if (s && s.fail === 0 && r.code === 0) { console.log(`${s.pass} ✔`); rows.push([`frontend/${name}`, s.pass]); }
    else { console.log(`ПРОВАЛ (${s ? s.pass + ' ✔ / ' + s.fail + ' ✘' : 'code ' + r.code})`); rows.push([`frontend/${name}`, s ? `${s.pass}/${s.pass + s.fail}` : 'FAIL']); bad++; }
  }
  if (!onlyFrontend) { process.stdout.write('backend (node --test server/test/*.test.js) ... ');
  const rb = run('node', ['--test', ...require('fs').readdirSync(path.join(__dirname, '..', 'server', 'test')).filter(f => f.endsWith('.test.js')).map(f => path.join('server', 'test', f))], path.join(__dirname, '..'));
  const sb = parseSummary(rb.out);
  if (sb && sb.fail === 0 && rb.code === 0) { console.log(`${sb.pass} ✔`); rows.push(['backend/all', sb.pass]); }
  else { console.log(`ПРОВАЛ (${sb ? sb.pass + ' ✔ / ' + sb.fail + ' ✘' : 'code ' + rb.code})`); rows.push(['backend/all', sb ? `${sb.pass}/${sb.pass + sb.fail}` : 'FAIL']); bad++; } }
  if (onlyBackend) console.log('(только backend)');

  console.log('\n===== СВОДКА =====');
  for (const [n, p] of rows) console.log(`${n.padEnd(22)} ${p}`);
  const total = rows.reduce((a, [, p]) => a + (typeof p === 'number' ? p : 0), 0);
  console.log('ВСЕГО пройдено: ' + total);
  process.exit(bad ? 1 : 0);
})();
