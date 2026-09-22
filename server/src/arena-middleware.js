/* Train Hard — Arena v2 backend layer.
 *
 * Arena is independent from Progress/workouts.
 * Each user has one current squat/bench/deadlift result stored in PostgreSQL.
 * A user may belong to at most one group (also enforced by a DB unique index).
 * Leaderboard reads all member stats in ONE SQL query for fast Arena loading.
 */
'use strict';

const EXERCISES = ['squat', 'bench', 'deadlift'];
const METRICS = ['TOTAL', 'SQUAT', 'BENCH', 'DEADLIFT'];

function json(res, status, body, origin) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Idempotency-Key,X-Telegram-Init-Data');
  res.setHeader('Vary', 'Origin');
  res.end(JSON.stringify(body == null ? {} : body));
}

function bearer(req) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+([A-Za-z0-9]{8,128})$/);
  return m ? m[1] : '';
}

function validWeight(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1000) return undefined;
  return Math.round(n * 100) / 100;
}

function normalizeStats(body) {
  const raw = body && typeof body === 'object' ? body : {};
  const out = {};
  for (const ex of EXERCISES) {
    const v = raw[ex];
    if (v === null || v === undefined || v === '') {
      out[ex] = null;
      continue;
    }
    const n = validWeight(v);
    if (n === undefined) return null;
    out[ex] = n;
  }
  return out;
}

function totalOf(row) {
  if (row.squat == null || row.bench == null || row.deadlift == null) return null;
  return Number(row.squat) + Number(row.bench) + Number(row.deadlift);
}

function metricValue(row, metric) {
  if (metric === 'TOTAL') return totalOf(row);
  if (metric === 'SQUAT') return row.squat == null ? null : Number(row.squat);
  if (metric === 'BENCH') return row.bench == null ? null : Number(row.bench);
  if (metric === 'DEADLIFT') return row.deadlift == null ? null : Number(row.deadlift);
  return null;
}

function rank(rows) {
  rows.sort((a, b) => (b.value - a.value) || (a.achieved_at - b.achieved_at));
  for (let i = 0; i < rows.length; i++) {
    const prev = rows[i - 1];
    rows[i].place = prev && prev.value === rows[i].value && prev.achieved_at === rows[i].achieved_at
      ? prev.place
      : i + 1;
  }
  return rows;
}

async function ensureArenaStorage(store) {
  if (store.p && typeof store.p.query === 'function') {
    await store.p.query(`
      CREATE TABLE IF NOT EXISTS arena_stats (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        squat NUMERIC(6,2),
        bench NUMERIC(6,2),
        deadlift NUMERIC(6,2),
        updated_at BIGINT NOT NULL
      )
    `);
    await store.p.query('CREATE INDEX IF NOT EXISTS idx_arena_stats_updated ON arena_stats(updated_at)');
    // DB-level invariant: one user -> one group.
    await store.p.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_group_members_one_group_per_user ON group_members(user_id)');
    return;
  }
  if (!store.arenaStats) store.arenaStats = new Map();
}

async function currentUser(store, req) {
  const token = bearer(req);
  if (!token) return null;
  return store.sessionUser(token);
}

async function readStats(store, uid) {
  if (store.p && typeof store.p.query === 'function') {
    const r = await store.p.query(
      `SELECT squat::float8 AS squat,
              bench::float8 AS bench,
              deadlift::float8 AS deadlift,
              updated_at
         FROM arena_stats
        WHERE user_id=$1`,
      [uid]
    );
    return r.rows[0] || { squat: null, bench: null, deadlift: null, updated_at: 0 };
  }
  return store.arenaStats.get(uid) || { squat: null, bench: null, deadlift: null, updated_at: 0 };
}

async function saveStats(store, uid, body) {
  const stats = normalizeStats(body);
  if (!stats) return null;
  const updated = Date.now();

  if (store.p && typeof store.p.query === 'function') {
    const r = await store.p.query(
      `INSERT INTO arena_stats (user_id,squat,bench,deadlift,updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         squat=EXCLUDED.squat,
         bench=EXCLUDED.bench,
         deadlift=EXCLUDED.deadlift,
         updated_at=EXCLUDED.updated_at
       RETURNING squat::float8 AS squat,
                 bench::float8 AS bench,
                 deadlift::float8 AS deadlift,
                 updated_at`,
      [uid, stats.squat, stats.bench, stats.deadlift, updated]
    );
    return r.rows[0];
  }

  if (!store.arenaStats) store.arenaStats = new Map();
  const value = { ...stats, updated_at: updated };
  store.arenaStats.set(uid, value);
  return value;
}

async function getGroupAndMember(store, gid, uid) {
  const group = await store.getGroup(gid);
  if (!group) return null;
  const member = await store.getMember(gid, uid);
  if (!member) return null;
  return { group, member };
}

async function listMemberStats(store, gid) {
  // PostgreSQL: one query for group members + profile + Arena stats.
  if (store.p && typeof store.p.query === 'function') {
    const r = await store.p.query(
      `SELECT gm.user_id,
              u.id,
              u.telegram_id,
              u.username,
              u.first_name,
              u.last_name,
              u.photo_url,
              a.squat::float8 AS squat,
              a.bench::float8 AS bench,
              a.deadlift::float8 AS deadlift,
              COALESCE(a.updated_at,0) AS updated_at
         FROM group_members gm
         JOIN users u ON u.id=gm.user_id
         LEFT JOIN arena_stats a ON a.user_id=gm.user_id
        WHERE gm.group_id=$1`,
      [gid]
    );
    return r.rows;
  }

  const members = await store.listMembers(gid);
  const rows = [];
  for (const m of members) {
    const u = await store.getUser(m.user_id) || { id: m.user_id };
    const s = await readStats(store, m.user_id);
    rows.push({
      user_id: m.user_id,
      id: u.id,
      telegram_id: u.telegram_id,
      username: u.username,
      first_name: u.first_name,
      last_name: u.last_name,
      photo_url: u.photo_url,
      squat: s.squat,
      bench: s.bench,
      deadlift: s.deadlift,
      updated_at: Number(s.updated_at || 0)
    });
  }
  return rows;
}

function makeBoards(rows) {
  const boards = {};
  for (const metric of METRICS) {
    const ranked = [];
    for (const row of rows) {
      const value = metricValue(row, metric);
      if (value == null) continue;
      ranked.push({
        user_id: row.user_id,
        value,
        achieved_at: Number(row.updated_at || 0),
        user: {
          id: row.id,
          telegram_id: row.telegram_id,
          username: row.username,
          first_name: row.first_name,
          last_name: row.last_name,
          photo_url: row.photo_url
        }
      });
    }
    boards[metric] = rank(ranked);
  }
  return boards;
}

function readJson(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > limit) {
        reject(Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { reject(Object.assign(new Error('invalid json'), { code: 'INVALID_JSON' })); }
    });
    req.on('error', reject);
  });
}

function createArenaHandler(app, store, options = {}) {
  const origin = options.corsOrigin || '*';
  const ready = ensureArenaStorage(store).catch(err => {
    console.error('[arena] storage init failed:', err.message);
    throw err;
  });
  const locks = new Map();

  async function withUserLock(uid, fn) {
    const previous = locks.get(uid) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const chain = previous.then(() => current);
    locks.set(uid, chain);
    try {
      await previous;
      return await fn();
    } finally {
      release();
      if (locks.get(uid) === chain) locks.delete(uid);
    }
  }

  return async function arenaHandler(req, res) {
    try {
      await ready;
      const url = new URL(req.url, 'http://trainhard.local');
      const pathname = url.pathname;

      if (req.method === 'OPTIONS') return app(req, res);

      if (pathname === '/api/arena/stats') {
        const user = await currentUser(store, req);
        if (!user) return json(res, 401, { error: 'unauthorized' }, origin);

        if (req.method === 'GET') {
          return json(res, 200, { stats: await readStats(store, user.id) }, origin);
        }
        if (req.method === 'PUT') {
          let body;
          try { body = await readJson(req); }
          catch (e) {
            return json(res, e.code === 'BODY_TOO_LARGE' ? 413 : 400, { error: e.code === 'BODY_TOO_LARGE' ? 'body too large' : 'invalid json' }, origin);
          }
          const stats = await saveStats(store, user.id, body);
          if (!stats) return json(res, 400, { error: 'invalid arena stats' }, origin);
          return json(res, 200, { stats }, origin);
        }
        return json(res, 405, { error: 'method not allowed' }, origin);
      }

      // One group per user. The DB unique index is the final invariant;
      // this lock prevents duplicate attempts within the same server instance.
      if (req.method === 'POST' && (pathname === '/api/groups' || /^\/api\/invites\/[^/]+\/join$/.test(pathname))) {
        const user = await currentUser(store, req);
        if (user) {
          return withUserLock(user.id, async () => {
            const groups = await store.listGroupsForUser(user.id);
            if (Array.isArray(groups) && groups.length) {
              return json(res, 409, { error: 'already a member of a group' }, origin);
            }
            return app(req, res);
          });
        }
      }

      const match = pathname.match(/^\/api\/groups\/([^/]+)\/leaderboard$/);
      if (req.method === 'GET' && match) {
        const gid = decodeURIComponent(match[1]);
        const user = await currentUser(store, req);
        if (!user) return json(res, 401, { error: 'unauthorized' }, origin);

        const gm = await getGroupAndMember(store, gid, user.id);
        if (!gm) return json(res, 404, { error: 'not found' }, origin);

        const metric = String(url.searchParams.get('metric') || 'ALL').toUpperCase();
        if (metric !== 'ALL' && !METRICS.includes(metric)) {
          return json(res, 400, { error: 'invalid metric' }, origin);
        }

        const rows = await listMemberStats(store, gid);
        const boards = makeBoards(rows);
        if (metric === 'ALL') {
          return json(res, 200, {
            metric: 'ALL',
            rule: 'value desc → updated_at asc → same place',
            boards
          }, origin);
        }
        return json(res, 200, {
          metric,
          rule: 'value desc → updated_at asc → same place',
          rows: boards[metric]
        }, origin);
      }

      return app(req, res);
    } catch (e) {
      console.error('[arena] request failed:', e.message);
      if (!res.headersSent) return json(res, 500, { error: 'internal server error' }, origin);
      try { res.end(); } catch {}
    }
  };
}

module.exports = { createArenaHandler, normalizeStats, metricValue, makeBoards };
