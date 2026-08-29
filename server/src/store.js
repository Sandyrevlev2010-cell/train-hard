/* Train Hard backend — хранилище.
 *
 * Интерфейс Store (оба адаптера идентичны по контракту):
 *   пользователи/сессии, тренировки/подходы, группы/подгруппы/инвайты,
 *   соревнования, программы/назначения, entitlement Premium, идемпотентность.
 *
 * • MemoryStore — dev/тесты (полностью реализован, используется тестами).
 * • PgStore     — production (PostgreSQL, схема db/migrations/001_init_up.sql, параметризованные
 *                 запросы). Требует npm i pg и DATABASE_URL.
 *                 СКОМПИЛИРОВАНО И ПРОВЕРЕНО ЛИНТОМ, но НЕ прогонялось против
 *                 живого PostgreSQL в этой итерации — см. docs/BACKEND.md.
 */
'use strict';
const crypto = require('crypto');
const { id, now } = require('./util');

/* ---------------- MemoryStore ---------------- */
class MemoryStore {
  constructor() {
    this.users = new Map();
    this.teamsByTelegram = new Map();
    this.sessions = new Map();
    this.workouts = new Map();
    this.sets = new Map();
    this.groups = new Map();
    this.members = new Map();
    this.subgroups = new Map();
    this.subMembers = new Set();
    this.invites = new Map();
    this.competitions = new Map();
    this.compMembers = new Set();
    this.programs = new Map();
    this.assignments = new Map();
    this.entitlements = new Map();
    this.idem = new Map();
  }

  upsertUserByTelegram(u) {
    const ex = this.teamsByTelegram.get(u.telegram_id);

    if (ex) {
      const cur = this.users.get(ex);

      Object.assign(cur, {
        username: u.username ?? cur.username,
        first_name: u.first_name ?? cur.first_name,
        last_name: u.last_name ?? cur.last_name,
        photo_url: u.photo_url ?? cur.photo_url,
        updated_at: now()
      });

      return cur;
    }

    const user = {
      id: id(),
      telegram_id: u.telegram_id,
      username: u.username || null,
      first_name: u.first_name || null,
      last_name: u.last_name || null,
      photo_url: u.photo_url || null,
      created_at: now(),
      updated_at: now()
    };

    this.users.set(user.id, user);
    this.teamsByTelegram.set(u.telegram_id, user.id);

    return user;
  }

  getUser(uid) {
    return this.users.get(uid) || null;
  }

  createSession(uid, ttlMs) {
    const token = crypto.randomBytes(32).toString('hex');
    const th = crypto.createHash('sha256').update(token).digest('hex');

    this.sessions.set(th, {
      user_id: uid,
      expires_at: now() + ttlMs
    });

    return {
      token,
      expires_at: now() + ttlMs
    };
  }

  sessionUser(token) {
    const th = crypto
      .createHash('sha256')
      .update(String(token || ''))
      .digest('hex');

    const s = this.sessions.get(th);

    if (!s || s.expires_at < now()) {
      this.sessions.delete(th);
      return null;
    }

    return this.users.get(s.user_id) || null;
  }

  deleteSession(token) {
    this.sessions.delete(
      crypto
        .createHash('sha256')
        .update(String(token || ''))
        .digest('hex')
    );
  }

  createWorkout(w) {
    const x = {
      id: id(),
      created_at: now(),
      updated_at: now(),
      ...w
    };

    this.workouts.set(x.id, x);
    return x;
  }

  getWorkout(wid) {
    return this.workouts.get(wid) || null;
  }

  updateWorkout(wid, patch) {
    const w = this.workouts.get(wid);

    if (!w) {
      return null;
    }

    if (patch.date !== undefined) {
      w.date = patch.date;
    }

    if (patch.title !== undefined) {
      w.title = patch.title;
    }

    if (patch.notes !== undefined) {
      w.notes = patch.notes;
    }

    w.updated_at = now();

    return w;
  }

  deleteWorkout(wid) {
    for (const [sid, s] of this.sets) {
      if (s.workout_id === wid) {
        this.sets.delete(sid);
      }
    }

    return this.workouts.delete(wid);
  }

  listWorkouts(uid, from, to) {
    return [...this.workouts.values()]
      .filter(
        (w) =>
          w.user_id === uid &&
          (!from || w.date >= from) &&
          (!to || w.date <= to)
      )
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  createSet(s) {
    const x = {
      id: id(),
      created_at: now(),
      ...s
    };

    this.sets.set(x.id, x);

    return x;
  }

  getSet(sid) {
    return this.sets.get(sid) || null;
  }

  deleteSet(sid) {
    return this.sets.delete(sid);
  }

  listSetsByUser(uid, fromTs, toTs) {
    const out = [];

    for (const s of this.sets.values()) {
      const w = this.workouts.get(s.workout_id);

      if (!w || w.user_id !== uid) {
        continue;
      }

      const ts = new Date(w.date + 'T12:00:00Z').getTime();

      if (fromTs != null && ts < fromTs) {
        continue;
      }

      if (toTs != null && ts > toTs) {
        continue;
      }

      out.push({
        ...s,
        date: w.date,
        ts
      });
    }

    return out.sort((a, b) => a.ts - b.ts);
  }

  createGroup(g) {
    const x = {
      id: id(),
      created_at: now(),
      ...g
    };

    this.groups.set(x.id, x);

    this.members.set(
      x.id + ':' + g.owner_id,
      {
        role: 'OWNER',
        joined_at: now()
      }
    );

    return x;
  }

  getGroup(gid) {
    return this.groups.get(gid) || null;
  }

  deleteGroup(gid) {
    this.groups.delete(gid);

    for (const k of [...this.members.keys()]) {
      if (k.startsWith(gid + ':')) {
        this.members.delete(k);
      }
    }

    for (const [id, sg] of this.subgroups) {
      if (sg.group_id === gid) {
        this.subgroups.delete(id);
      }
    }

    for (const [code, inv] of this.invites) {
      if (inv.group_id === gid) {
        this.invites.delete(code);
      }
    }

    for (const [id, c] of this.competitions) {
      if (c.group_id === gid) {
        this.competitions.delete(id);

        for (const k of [...this.compMembers]) {
          if (k.startsWith(id + ':')) {
            this.compMembers.delete(k);
          }
        }
      }
    }

    return true;
  }

  getMember(gid, uid) {
    return this.members.get(gid + ':' + uid) || null;
  }

  addMember(gid, uid, role) {
    this.members.set(
      gid + ':' + uid,
      {
        role,
        joined_at: now()
      }
    );
  }

  removeMember(gid, uid) {
    this.members.delete(gid + ':' + uid);
  }

  updateMemberRole(gid, uid, role) {
    const m = this.members.get(gid + ':' + uid);

    if (m) {
      m.role = role;
    }
  }

  listMembers(gid) {
    const out = [];

    for (const [k, m] of this.members) {
      if (k.startsWith(gid + ':')) {
        out.push({
          user_id: k.split(':')[1],
          ...m
        });
      }
    }

    return out;
  }

  listGroupsForUser(uid) {
    const out = [];

    for (const [k, m] of this.members) {
      if (k.endsWith(':' + uid)) {
        out.push({
          group: this.groups.get(k.split(':')[1]),
          role: m.role
        });
      }
    }

    return out.filter((x) => x.group);
  }

  createSubgroup(sg) {
    const x = {
      id: id(),
      created_at: now(),
      ...sg
    };

    this.subgroups.set(x.id, x);

    return x;
  }

  getSubgroup(sgid) {
    return this.subgroups.get(sgid) || null;
  }

  listSubgroups(gid) {
    return [...this.subgroups.values()]
      .filter((s) => s.group_id === gid);
  }

  addSubgroupMember(sgid, uid) {
    const subgroup = this.subgroups.get(sgid);

    if (!subgroup) {
      const err = new Error('Subgroup not found');
      err.code = 'SUBGROUP_NOT_FOUND';
      throw err;
    }

    if (!this.getMember(subgroup.group_id, uid)) {
      const err = new Error(
        'User must be a member of the group before joining its subgroup'
      );

      err.code = 'NOT_GROUP_MEMBER';

      throw err;
    }

    this.subMembers.add(sgid + ':' + uid);
  }

  isSubgroupMember(sgid, uid) {
    return this.subMembers.has(sgid + ':' + uid);
  }

  listSubgroupMembers(sgid) {
    return [...this.subMembers]
      .filter((k) => k.startsWith(sgid + ':'))
      .map((k) => k.split(':')[1]);
  }

  createInvite(inv) {
    const code = crypto.randomBytes(8).toString('hex');

    this.invites.set(
      code,
      {
        ...inv,
        code
      }
    );

    return this.invites.get(code);
  }

  getInvite(code) {
    return this.invites.get(code) || null;
  }

  useInvite(code, uid) {
    const i = this.invites.get(code);

    if (i) {
      i.used_by = uid;
    }
  }

  createCompetition(c) {
    const x = {
      id: id(),
      status: 'UPCOMING',
      created_at: now(),
      ...c
    };

    this.competitions.set(x.id, x);

    return x;
  }

  addCompetitionMember(cid, uid) {
    const competition = this.competitions.get(cid);

    if (!competition) {
      const err = new Error('Competition not found');
      err.code = 'COMPETITION_NOT_FOUND';
      throw err;
    }

    if (!this.getMember(competition.group_id, uid)) {
      const err = new Error(
        'User must be a member of the group before joining its competition'
      );

      err.code = 'NOT_GROUP_MEMBER';

      throw err;
    }

    this.compMembers.add(cid + ':' + uid);
  }

  listCompetitionMembers(cid) {
    const out = [];

    for (const k of this.compMembers) {
      if (k.startsWith(cid + ':')) {
        out.push(k.slice(cid.length + 1));
      }
    }

    return out;
  }

  getCompetition(cid) {
    return this.competitions.get(cid) || null;
  }

  updateCompetition(cid, patch) {
    const c = this.competitions.get(cid);

    if (c) {
      Object.assign(c, patch);
    }

    return c;
  }

  listCompetitions(gid) {
    return [...this.competitions.values()]
      .filter((c) => c.group_id === gid);
  }

  createProgram(p) {
    const x = {
      id: id(),
      created_at: now(),
      ...p
    };

    this.programs.set(x.id, x);

    return x;
  }

  getProgram(pid) {
    return this.programs.get(pid) || null;
  }

  assignProgram(a) {
    const x = {
      id: id(),
      assigned_at: now(),
      ...a
    };

    this.assignments.set(x.id, x);

    return x;
  }

  listAssignmentsForUser(uid) {
    return [...this.assignments.values()]
      .filter((a) => a.user_id === uid);
  }

  getEntitlement(uid) {
    return this.entitlements.get(uid) || null;
  }

  setEntitlement(uid, e) {
    this.entitlements.set(uid, {
      ...e
    });

    return this.entitlements.get(uid);
  }

  getIdem(uid, key) {
    return this.idem.get(uid + ':' + key) || null;
  }

  setIdem(uid, key, response) {
    this.idem.set(uid + ':' + key, response);
  }
}

/* ---------------- PgStore (production) ----------------
 * Та же сигнатура методов, параметризованный SQL,
 * схема db/migrations/001_init_up.sql.
 */
class PgStore {
  constructor(pool) {
    this.p = pool;
  }

  async close() {
    await this.p.end();
  }

  async q(sql, args) {
    const r = await this.p.query(sql, args);
    return r.rows;
  }

  async upsertUserByTelegram(u) {
    const rows = await this.q(
      `INSERT INTO users
       (id, telegram_id, username, first_name, last_name, photo_url, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (telegram_id)
       DO UPDATE SET
         username=COALESCE(EXCLUDED.username,users.username),
         first_name=COALESCE(EXCLUDED.first_name,users.first_name),
         last_name=COALESCE(EXCLUDED.last_name,users.last_name),
         photo_url=COALESCE(EXCLUDED.photo_url,users.photo_url),
         updated_at=$7
       RETURNING *`,
      [
        id(),
        u.telegram_id,
        u.username || null,
        u.first_name || null,
        u.last_name || null,
        u.photo_url || null,
        now()
      ]
    );

    return rows[0];
  }

  async getUser(uid) {
    return (
      await this.q(
        'SELECT * FROM users WHERE id=$1',
        [uid]
      )
    )[0] || null;
  }

  async createSession(uid, ttlMs) {
    const token = crypto.randomBytes(32).toString('hex');

    const th = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const expires = now() + ttlMs;

    await this.q(
      `INSERT INTO sessions
       (token_hash,user_id,expires_at,created_at)
       VALUES ($1,$2,$3,$4)`,
      [
        th,
        uid,
        expires,
        now()
      ]
    );

    return {
      token,
      expires_at: expires
    };
  }

  async sessionUser(token) {
    const th = crypto
      .createHash('sha256')
      .update(String(token || ''))
      .digest('hex');

    const rows = await this.q(
      `SELECT u.*
       FROM sessions s
       JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1
         AND s.expires_at>$2`,
      [
        th,
        now()
      ]
    );

    return rows[0] || null;
  }

  async deleteSession(token) {
    const th = crypto
      .createHash('sha256')
      .update(String(token || ''))
      .digest('hex');

    await this.q(
      'DELETE FROM sessions WHERE token_hash=$1',
      [th]
    );
  }

  async createWorkout(w) {
    const t = now();
    const wid = id();

    return (
      await this.q(
        `INSERT INTO workouts
         (id,user_id,date,title,notes,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$6)
         RETURNING *`,
        [
          wid,
          w.user_id,
          w.date,
          w.title || 'Тренировка',
          w.notes || '',
          t
        ]
      )
    )[0];
  }

  async getWorkout(wid) {
    return (
      await this.q(
        'SELECT * FROM workouts WHERE id=$1',
        [wid]
      )
    )[0] || null;
  }

  async updateWorkout(wid, patch) {
    return (
      await this.q(
        `UPDATE workouts
         SET date=COALESCE($2,date),
             title=COALESCE($3,title),
             notes=COALESCE($4,notes),
             updated_at=$5
         WHERE id=$1
         RETURNING *`,
        [
          wid,
          patch.date ?? null,
          patch.title ?? null,
          patch.notes ?? null,
          now()
        ]
      )
    )[0] || null;
  }

  async deleteWorkout(wid) {
    await this.q(
      'DELETE FROM workouts WHERE id=$1',
      [wid]
    );

    return true;
  }

  async listWorkouts(uid, from, to) {
    return this.q(
      `SELECT *
       FROM workouts
       WHERE user_id=$1
         AND ($2::text IS NULL OR date>=$2)
         AND ($3::text IS NULL OR date<=$3)
       ORDER BY date ASC`,
      [
        uid,
        from || null,
        to || null
      ]
    );
  }

  async createSet(s) {
    const sid = id();
    const t = now();

    return (
      await this.q(
        `INSERT INTO workout_sets
         (id,workout_id,user_id,exercise,set_number,weight,reps,successful,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING
           id,
           workout_id,
           user_id,
           exercise,
           set_number,
           weight::float8 AS weight,
           reps,
           successful,
           created_at`,
        [
          sid,
          s.workout_id,
          s.user_id,
          s.exercise,
          s.set_number,
          s.weight,
          s.reps,
          s.successful,
          t
        ]
      )
    )[0];
  }

  async getSet(sid) {
    return (
      await this.q(
        `SELECT
           id,
           workout_id,
           user_id,
           exercise,
           set_number,
           weight::float8 AS weight,
           reps,
           successful,
           created_at
         FROM workout_sets
         WHERE id=$1`,
        [sid]
      )
    )[0] || null;
  }

  async deleteSet(sid) {
    await this.q(
      'DELETE FROM workout_sets WHERE id=$1',
      [sid]
    );

    return true;
  }

  async listSetsByUser(uid, fromTs, toTs) {
    return this.q(
      `SELECT
         s.id,
         s.workout_id,
         s.user_id,
         s.exercise,
         s.set_number,
         s.weight::float8 AS weight,
         s.reps,
         s.successful,
         s.created_at,
         w.date,
         (
           EXTRACT(
             EPOCH FROM (
               w.date::date::timestamp AT TIME ZONE 'UTC'
             )
           ) * 1000
         )::bigint AS ts
       FROM workout_sets s
       JOIN workouts w ON w.id=s.workout_id
       WHERE s.user_id=$1
         AND (
           $2::bigint IS NULL
           OR w.date >= TO_CHAR(
             TO_TIMESTAMP(
               $2::double precision / 1000
             ),
             'YYYY-MM-DD'
           )
         )
         AND (
           $3::bigint IS NULL
           OR w.date <= TO_CHAR(
             TO_TIMESTAMP(
               $3::double precision / 1000
             ),
             'YYYY-MM-DD'
           )
         )
       ORDER BY w.date ASC, s.created_at ASC`,
      [
        uid,
        fromTs ?? null,
        toTs ?? null
      ]
    );
  }

  async createGroup(g) {
    const c = await this.p.connect();
    const gid = id();
    const t = now();

    try {
      await c.query('BEGIN');

      const grp = (
        await c.query(
          `INSERT INTO groups
           (id,name,description,owner_id,created_at)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            gid,
            g.name,
            g.description || '',
            g.owner_id,
            t
          ]
        )
      ).rows[0];

      await c.query(
        `INSERT INTO group_members
         (group_id,user_id,role,joined_at)
         VALUES ($1,$2,'OWNER',$3)`,
        [
          gid,
          g.owner_id,
          t
        ]
      );

      await c.query('COMMIT');

      return grp;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  async getGroup(gid) {
    return (
      await this.q(
        'SELECT * FROM groups WHERE id=$1',
        [gid]
      )
    )[0] || null;
  }

  async deleteGroup(gid) {
    await this.q(
      'DELETE FROM groups WHERE id=$1',
      [gid]
    );

    return true;
  }

  async getMember(gid, uid) {
    return (
      await this.q(
        `SELECT *
         FROM group_members
         WHERE group_id=$1
           AND user_id=$2`,
        [
          gid,
          uid
        ]
      )
    )[0] || null;
  }

  async addMember(gid, uid, role) {
    await this.q(
      `INSERT INTO group_members
       (group_id,user_id,role,joined_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (group_id,user_id) DO NOTHING`,
      [
        gid,
        uid,
        role,
        now()
      ]
    );
  }

  async removeMember(gid, uid) {
    await this.q(
      `DELETE FROM group_members
       WHERE group_id=$1
         AND user_id=$2
         AND role<>$3`,
      [
        gid,
        uid,
        'OWNER'
      ]
    );
  }

  async updateMemberRole(gid, uid, role) {
    await this.q(
      `UPDATE group_members
       SET role=$3
       WHERE group_id=$1
         AND user_id=$2`,
      [
        gid,
        uid,
        role
      ]
    );
  }

  async listMembers(gid) {
    return this.q(
      `SELECT user_id,role,joined_at
       FROM group_members
       WHERE group_id=$1`,
      [gid]
    );
  }

  async listGroupsForUser(uid) {
    return this.q(
      `SELECT g.*,m.role
       FROM group_members m
       JOIN groups g ON g.id=m.group_id
       WHERE m.user_id=$1`,
      [uid]
    );
  }

  async createSubgroup(sg) {
    return (
      await this.q(
        `INSERT INTO subgroups
         (id,group_id,name,created_at)
         VALUES ($1,$2,$3,$4)
         RETURNING *`,
        [
          id(),
          sg.group_id,
          sg.name,
          now()
        ]
      )
    )[0];
  }

  async getSubgroup(sgid) {
    return (
      await this.q(
        'SELECT * FROM subgroups WHERE id=$1',
        [sgid]
      )
    )[0] || null;
  }

  async listSubgroups(gid) {
    return this.q(
      'SELECT * FROM subgroups WHERE group_id=$1',
      [gid]
    );
  }

  async addSubgroupMember(sgid, uid) {
    const rows = await this.q(
      `SELECT 1
       FROM subgroups sg
       JOIN group_members gm
         ON gm.group_id=sg.group_id
       WHERE sg.id=$1
         AND gm.user_id=$2
       LIMIT 1`,
      [
        sgid,
        uid
      ]
    );

    if (!rows.length) {
      const err = new Error(
        'User must be a member of the group before joining its subgroup'
      );

      err.code = 'NOT_GROUP_MEMBER';

      throw err;
    }

    await this.q(
      `INSERT INTO subgroup_members
       (subgroup_id,user_id,added_at)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [
        sgid,
        uid,
        now()
      ]
    );
  }

  async isSubgroupMember(sgid, uid) {
    return (
      await this.q(
        `SELECT 1
         FROM subgroup_members
         WHERE subgroup_id=$1
           AND user_id=$2`,
        [
          sgid,
          uid
        ]
      )
    ).length > 0;
  }

  async listSubgroupMembers(sgid) {
    return (
      await this.q(
        `SELECT user_id
         FROM subgroup_members
         WHERE subgroup_id=$1`,
        [sgid]
      )
    ).map((r) => r.user_id);
  }

  async createInvite(inv) {
    const code = crypto.randomBytes(8).toString('hex');
    const t = now();
    const expires =
      inv.expires_at ||
      (t + (inv.ttlMs || 864e5));

    return (
      await this.q(
        `INSERT INTO invites
         (code,group_id,created_by,created_at,expires_at)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [
          code,
          inv.group_id,
          inv.created_by,
          t,
          expires
        ]
      )
    )[0];
  }

  async getInvite(code) {
    return (
      await this.q(
        'SELECT * FROM invites WHERE code=$1',
        [code]
      )
    )[0] || null;
  }

  async useInvite(code, uid) {
    await this.q(
      `UPDATE invites
       SET used_by=$2,
           used_at=$3
       WHERE code=$1
         AND used_by IS NULL`,
      [
        code,
        uid,
        now()
      ]
    );
  }

  async createCompetition(c) {
    const cid = id();
    const t = now();

    return (
      await this.q(
        `INSERT INTO competitions
         (id,group_id,name,type,status,start_at,end_at,created_by,created_at)
         VALUES ($1,$2,$3,$4,'UPCOMING',$5,$6,$7,$8)
         RETURNING *`,
        [
          cid,
          c.group_id,
          c.name,
          c.type,
          c.start_at,
          c.end_at,
          c.created_by,
          t
        ]
      )
    )[0];
  }

  async getCompetition(cid) {
    return (
      await this.q(
        'SELECT * FROM competitions WHERE id=$1',
        [cid]
      )
    )[0] || null;
  }

  async updateCompetition(cid, patch) {
    return (
      await this.q(
        `UPDATE competitions
         SET status=COALESCE($2,status),
             winner_id=COALESCE($3,winner_id)
         WHERE id=$1
         RETURNING *`,
        [
          cid,
          patch.status || null,
          patch.winner_id || null
        ]
      )
    )[0] || null;
  }

  async addCompetitionMember(cid, uid) {
    const rows = await this.q(
      `SELECT 1
       FROM competitions c
       JOIN group_members gm
         ON gm.group_id=c.group_id
       WHERE c.id=$1
         AND gm.user_id=$2
       LIMIT 1`,
      [
        cid,
        uid
      ]
    );

    if (!rows.length) {
      const err = new Error(
        'User must be a member of the group before joining its competition'
      );

      err.code = 'NOT_GROUP_MEMBER';

      throw err;
    }

    await this.q(
      `INSERT INTO competition_members
       (competition_id,user_id,joined_at)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [
        cid,
        uid,
        now()
      ]
    );
  }

  async listCompetitionMembers(cid) {
    return (
      await this.q(
        `SELECT user_id
         FROM competition_members
         WHERE competition_id=$1`,
        [cid]
      )
    ).map((r) => r.user_id);
  }

  async listCompetitions(gid) {
    return this.q(
      `SELECT *
       FROM competitions
       WHERE group_id=$1`,
      [gid]
    );
  }

  async createProgram(p) {
    const pid = id();

    return (
      await this.q(
        `INSERT INTO programs
         (id,owner_id,name,level,frequency,weeks,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          pid,
          p.owner_id,
          p.name,
          p.level,
          p.frequency,
          JSON.stringify(p.weeks),
          now()
        ]
      )
    )[0];
  }

  async getProgram(pid) {
    return (
      await this.q(
        'SELECT * FROM programs WHERE id=$1',
        [pid]
      )
    )[0] || null;
  }

  async assignProgram(a) {
    return (
      await this.q(
        `INSERT INTO program_assignments
         (id,program_id,group_id,assigned_by,assigned_at)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [
          id(),
          a.program_id,
          a.group_id || null,
          a.assigned_by,
          now()
        ]
      )
    )[0];
  }

  async listAssignmentsForUser(uid) {
    return this.q(
      `SELECT a.*
       FROM program_assignments a
       LEFT JOIN group_members m
         ON m.group_id=a.group_id
        AND m.user_id=$1
       WHERE a.group_id IS NULL
          OR m.user_id IS NOT NULL`,
      [uid]
    );
  }

  async getEntitlement(uid) {
    return (
      await this.q(
        'SELECT * FROM entitlements WHERE user_id=$1',
        [uid]
      )
    )[0] || null;
  }

  async setEntitlement(uid, e) {
    return (
      await this.q(
        `INSERT INTO entitlements
         (user_id,until,source,label,updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id)
         DO UPDATE SET
           until=GREATEST(entitlements.until,EXCLUDED.until),
           source=EXCLUDED.source,
           label=EXCLUDED.label,
           updated_at=EXCLUDED.updated_at
         RETURNING *`,
        [
          uid,
          e.until,
          e.source,
          e.label || null,
          now()
        ]
      )
    )[0];
  }

  async getIdem(uid, key) {
    return (
      await this.q(
        `SELECT response
         FROM idempotency
         WHERE user_id=$1
           AND key=$2`,
        [
          uid,
          key
        ]
      )
    )[0]?.response || null;
  }

  async setIdem(uid, key, response) {
    await this.q(
      `INSERT INTO idempotency
       (user_id,key,response,created_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id,key) DO NOTHING`,
      [
        uid,
        key,
        JSON.stringify(response),
        now()
      ]
    );
  }
}

module.exports = {
  MemoryStore,
  PgStore
};
