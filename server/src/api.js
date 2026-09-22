/* Train Hard backend — REST API (без внешних зависимостей).
 *
 * Безопасность:
 *  • авторизация только серверной сессией (Bearer), пользователь — из сессии;
 *    user_id из тела запроса НИКОГДА не источник истины;
 *  • каждый доступ к объекту проверяет владельца/членство;
 *  • тело — только JSON ≤64KB; идемпотентность POST через Idempotency-Key;
 *  • rate limiting: общий + строгий на /auth и /payments;
 *  • ошибки — безопасные {error}, без stack trace/путей.
 *
 * Правила домена:
 *  • PR вычисляется из успешных подходов;
 *  • Total = Squat+Bench+Deadlift PR, только если все три есть;
 *  • Leaderboard: значение ↓, при равенстве — раньше достигнутое ↑;
 *  • Premium — серверная верификация TON-транзакции.
 */
'use strict';

const {
  json,
  err,
  makeRateLimiter,
  readBody,
  validDate,
  num,
  str
} = require('./util');

const { verifyInitData } = require('./telegram');

const EXERCISES = ['squat', 'bench', 'deadlift'];

const COMPETITION_TYPES = [
  'TOTAL',
  'SQUAT',
  'BENCH',
  'DEADLIFT',
  'PR_PROGRESS'
];

const SESSION_TTL = 30 * 86400000;
const MAX_BODY = 64 * 1024;

function createApp(opts) {
  const store = opts.store;
  const botToken = opts.botToken || '';

  const ton = Object.assign(
    {
      address: '',
      amountNano: 0,
      periodDays: 30,
      fetch: null
    },
    opts.ton || {}
  );

  const corsOrigin =
    (opts.cors && opts.cors.origin) || '*';

  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods':
      'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Authorization,Idempotency-Key,X-Telegram-Init-Data',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };

  const allowReq = makeRateLimiter();

  /* ---------- вспомогательные функции ---------- */

  function clientIp(req) {
    return (
      String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim() ||
      req.socket.remoteAddress ||
      '?'
    );
  }

  async function authUser(req) {
    const h = String(
      req.headers.authorization || ''
    );

    const m = h.match(
      /^Bearer\s+([A-Za-z0-9]{8,128})$/
    );

    if (!m) return null;

    return await store.sessionUser(m[1]);
  }

  async function withIdem(user, key, fn) {
    if (!key) return fn();

    const saved = await store.getIdem(
      user.id,
      key
    );

    if (saved) return saved;

    const res = await fn();

    await store.setIdem(
      user.id,
      key,
      res
    );

    return res;
  }

  function publicUser(u) {
    return {
      id: u.id,
      telegram_id: u.telegram_id,
      username: u.username,
      first_name: u.first_name,
      last_name: u.last_name,
      photo_url: u.photo_url
    };
  }

  /*
   * Лучшие успешные подходы пользователя
   * за указанное временное окно.
   *
   * Результат:
   * {
   *   squat: {
   *     value,
   *     achieved_at,
   *     set_id
   *   }
   * }
   */
  async function bestSets(uid, fromTs, toTs) {
    const sets =
      await store.listSetsByUser(
        uid,
        fromTs,
        toTs
      );

    const best = {};

    for (const s of sets) {
      if (s.successful !== true) continue;

      if (!EXERCISES.includes(s.exercise)) {
        continue;
      }

      const b = best[s.exercise];

      if (
        !b ||
        s.weight > b.value ||
        (
          s.weight === b.value &&
          s.created_at < b.achieved_at
        )
      ) {
        best[s.exercise] = {
          value: s.weight,
          achieved_at: s.created_at,
          set_id: s.id
        };
      }
    }

    return best;
  }

  async function totalOf(uid, fromTs, toTs) {
    const b = await bestSets(
      uid,
      fromTs,
      toTs
    );

    const parts = {
      squat: b.squat || null,
      bench: b.bench || null,
      deadlift: b.deadlift || null
    };

    const total =
      parts.squat &&
      parts.bench &&
      parts.deadlift
        ? parts.squat.value +
          parts.bench.value +
          parts.deadlift.value
        : null;

    return {
      total,
      parts
    };
  }

  /*
   * Таблица лидеров:
   * value desc
   * → achieved_at asc
   * → одинаковое место
   *
   * Например:
   * 1, 1, 3
   */
  function rankRows(rows) {
    rows.sort(
      (a, b) =>
        (b.value - a.value) ||
        (a.achieved_at - b.achieved_at)
    );

    rows.forEach((r, i) => {
      const prev = rows[i - 1];

      const same =
        prev &&
        prev.value === r.value &&
        prev.achieved_at === r.achieved_at;

      r.place = same
        ? prev.place
        : i + 1;
    });

    return rows;
  }

  async function board(
    userIds,
    metric,
    fromTs,
    toTs,
    baselineFromTs,
    baselineToTs
  ) {
    const rows = [];

    for (const uid of userIds) {
      let value = null;
      let achieved_at = 0;

      if (metric === 'TOTAL') {
        const t = await totalOf(
          uid,
          fromTs,
          toTs
        );

        if (t.total != null) {
          value = t.total;

          achieved_at = Math.max(
            t.parts.squat.achieved_at,
            t.parts.bench.achieved_at,
            t.parts.deadlift.achieved_at
          );
        }
      }

      else if (metric === 'PR_PROGRESS') {
        const inWin =
          await totalOf(
            uid,
            fromTs,
            toTs
          );

        const base =
          await totalOf(
            uid,
            baselineFromTs,
            baselineToTs
          );

        if (inWin.total != null) {
          value = Math.max(
            0,
            inWin.total -
              (base.total || 0)
          );

          achieved_at =
            Math.max(
              inWin.parts.squat.achieved_at,
              inWin.parts.bench.achieved_at,
              inWin.parts.deadlift.achieved_at
            );
        }
      }

      else {
        const b =
          await bestSets(
            uid,
            fromTs,
            toTs
          );

        const one =
          b[metric.toLowerCase()];

        if (one) {
          value = one.value;
          achieved_at =
            one.achieved_at;
        }
      }

      if (value != null) {
        rows.push({
          user_id: uid,
          value,
          achieved_at
        });
      }
    }

    return rankRows(rows);
  }

  async function requireMember(gid, user) {
    const g =
      await store.getGroup(gid);

    if (!g) {
      return {
        code: 404,
        body: {
          error: 'not found'
        }
      };
    }

    const m =
      await store.getMember(
        gid,
        user.id
      );

    if (!m) {
      return {
        code: 404,
        body: {
          error: 'not found'
        }
      };
    }

    return {
      group: g,
      member: m
    };
  }

  /* ---------- маршруты ---------- */

  const routes = [];

  const on = (
    method,
    re,
    fn
  ) => {
    routes.push({
      method,
      re,
      fn
    });
  };

  /* ---------- public service health ---------- */

  on(
    'GET',
    /^\\/$/,
    async () => ({
      code: 200,
      body: {
        ok: true,
        service: 'trainhard-api'
      }
    })
  );

  /* ---------- health ---------- */

  on(
    'GET',
    /^\/health$/,
    async () => ({
      code: 200,
      body: {
        ok: true
      }
    })
  );

  /* ---------- авторизация Telegram ---------- */

  on(
    'POST',
    /^\/auth\/telegram$/,
    async (c) => {
      if (!botToken) {
        return {
          code: 503,
          body: {
            error:
              'bot token not configured'
          }
        };
      }

      const v =
        verifyInitData(
          c.body.initData,
          botToken
        );

      if (!v.ok) {
        return {
          code: 401,
          body: {
            error:
              'invalid init data: ' +
              v.reason
          }
        };
      }

      const tu = v.user;

      const user =
        await store.upsertUserByTelegram({
          telegram_id: tu.id,
          username: tu.username,
          first_name: tu.first_name,
          last_name: tu.last_name,
          photo_url: tu.photo_url
        });

      const s =
        await store.createSession(
          user.id,
          SESSION_TTL
        );

      return {
        code: 200,
        body: {
          token: s.token,
          expires_at: s.expires_at,
          user: publicUser(user)
        }
      };
    }
  );

  /* ---------- профиль ---------- */

  on(
    'GET',
    /^\/profile$/,
    async (c) => {
      const ent =
        await store.getEntitlement(
          c.user.id
        );

      return {
        code: 200,
        body: {
          user: publicUser(c.user),
          premium_until:
            ent &&
            ent.until > Date.now()
              ? ent.until
              : null
        }
      };
    }
  );

  on(
    'GET',
    /^\/me$/,
    async (c) => {
      const ent =
        await store.getEntitlement(
          c.user.id
        );

      return {
        code: 200,
        body: {
          user: publicUser(c.user),
          premium_until:
            ent &&
            ent.until > Date.now()
              ? ent.until
              : null
        }
      };
    }
  );

  /* ---------- тренировки ---------- */

  on(
    'POST',
    /^\/workouts$/,
    async (c) => {
      return withIdem(
        c.user,
        c.body.idempotency_key ||
          c.idemKey,
        async () => {
          if (
            !validDate(
              c.body.date
            )
          ) {
            return {
              code: 400,
              body: {
                error:
                  'invalid date'
              }
            };
          }

          const w =
            await store.createWorkout({
              user_id: c.user.id,
              date: c.body.date,
              title:
                str(
                  c.body.title,
                  120
                ) ||
                'Тренировка',
              notes:
                str(
                  c.body.notes,
                  2000
                ) || ''
            });

          return {
            code: 201,
            body: {
              workout: w
            }
          };
        }
      );
    }
  );

  on(
    'GET',
    /^\/workouts$/,
    async (c) => {
      const from =
        validDate(c.q.from)
          ? c.q.from
          : null;

      const to =
        validDate(c.q.to)
          ? c.q.to
          : null;

      return {
        code: 200,
        body: {
          workouts:
            await store.listWorkouts(
              c.user.id,
              from,
              to
            )
        }
      };
    }
  );

  on(
    'PATCH',
    /^\/workouts\/([^/]+)$/,
    async (c) => {
      const w =
        await store.getWorkout(
          c.m[1]
        );

      if (
        !w ||
        w.user_id !== c.user.id
      ) {
        return {
          code: 404,
          body: {
            error: 'not found'
          }
        };
      }

      const patch = {};

      if (
        c.body.date !== undefined
      ) {
        if (
          !validDate(
            c.body.date
          )
        ) {
          return {
            code: 400,
            body: {
              error:
                'invalid date'
            }
          };
        }

        patch.date =
          c.body.date;
      }

      if (
        c.body.title !== undefined
      ) {
        patch.title =
          str(
            c.body.title,
            120
          );
      }

      if (
        c.body.notes !== undefined
      ) {
        patch.notes =
          str(
            c.body.notes,
            2000
          );
      }

      return {
        code: 200,
        body: {
          workout:
            await store.updateWorkout(
              w.id,
              patch
            )
        }
      };
    }
  );

  on(
    'GET',
    /^\/workouts\/([^/]+)$/,
    async (c) => {
      const w =
        await store.getWorkout(
          c.m[1]
        );

      if (
        !w ||
        w.user_id !== c.user.id
      ) {
        return {
          code: 404,
          body: {
            error: 'not found'
          }
        };
      }

      return {
        code: 200,
        body: {
          workout: w
        }
      };
    }
  );

  on(
    'PUT',
    /^\/workouts\/([^/]+)$/,
    async (c) => {
      const w =
        await store.getWorkout(
          c.m[1]
        );

      if (
        !w ||
        w.user_id !== c.user.id
      ) {
        return {
          code: 404,
          body: {
            error: 'not found'
          }
        };
      }

      const patch = {};

      if (
        c.body.date !== undefined
      ) {
        if (
          !validDate(
            c.body.date
          )
        ) {
          return {
            code: 400,
            body: {
              error:
                'invalid date'
            }
          };
        }

        patch.date =
          c.body.date;
      }

      if (
        c.body.title !== undefined
      ) {
        patch.title =
          str(
            c.body.title,
            120
          );
      }

      if (
        c.body.notes !== undefined
      ) {
        patch.notes =
          str(
            c.body.notes,
            2000
          );
      }

      return {
        code: 200,
        body: {
          workout:
            await store.updateWorkout(
              w.id,
              patch
            )
        }
      };
    }
  );

  on(
    'DELETE',
    /^\/workouts\/([^/]+)$/,
    async (c) => {
      const w =
        await store.getWorkout(
          c.m[1]
        );

      if (
        !w ||
        w.user_id !== c.user.id
      ) {
        return {
          code: 404,
          body: {
            error: 'not found'
          }
        };
      }

      await store.deleteWorkout(
        w.id
      );

      return {
        code: 200,
        body: {
          ok: true
        }
      };
    }
  );

  /* ---------- подходы ---------- */

  on(
    'POST',
    /^\/workouts\/([^/]+)\/sets$/,
    async (c) => {
      const w =
        await store.getWorkout(
          c.m[1]
        );

      if (
        !w ||
        w.user_id !== c.user.id
      ) {
        return {
          code: 404,
          body: {
            error: 'not found'
          }
        };
      }

      return withIdem(
        c.user,
        c.body.idempotency_key ||
          c.idemKey,
        async () => {
          const exercise =
            String(
              c.body.exercise || ''
            );

          if (
            !EXERCISES.includes(
              exercise
            )
          ) {
            return {
              code: 400,
              body: {
                error:
                  'invalid exercise'
              }
            };
          }

          const set_number =
            num(
              c.body.set_number,
              1,
              50
            );

          const weight =
            num(
              c.body.weight,
              0.1,
              1000
            );

          const reps =
            num(
              c.body.reps,
              0,
              500
            );

          if (
            set_number == null ||
            weight == null ||
            reps == null
          ) {
            return {
              code: 400,
              body: {
                error:
                  'invalid set data'
              }
            };
          }

          const s =
            await store.createSet({
              workout_id: w.id,
              user_id: c.user.id,
              exercise,
              set_number,
              weight:
                Math.round(
                  weight * 100
                ) / 100,
              reps,
              successful:
                c.body.successful ===
                true
            });

          return {
            code: 201,
            body: {
              set: s
            }
          };
        }
      );
    }
  );

  on(
    'DELETE',
    /^\/sets\/([^/]+)$/,
    async (c) => {
      const s =
        await store.getSet(
          c.m[1]
        );

      if (!s) {
        return {
          code: 404,
          body: {
            error: 'not found'
          }
        };
      }

      const w =
        await store.getWorkout(
          s.workout_id
        );

      if (
        !w ||
        w.user_id !== c.user.id
      ) {
        return {
          code: 404,
          body: {
            error: 'not found'
          }
        };
      }

      await store.deleteSet(
        s.id
      );

      return {
        code: 200,
        body: {
          ok: true
        }
      };
    }
  );

  /* ---------- PR и Total ---------- */

  on(
    'GET',
    /^\/prs$/,
    async (c) => ({
      code: 200,
      body: {
        prs:
          await bestSets(
            c.user.id,
            null,
            null
          )
      }
    })
  );

  on(
    'GET',
    /^\/total$/,
    async (c) => ({
      code: 200,
      body:
        await totalOf(
          c.user.id,
          null,
          null
        )
    })
  );

  /* ---------- группы ---------- */

  on(
    'POST',
    /^\/groups$/,
    async (c) => {
      const name =
        str(
          c.body.name,
          80
        );

      if (
        !name ||
        name.length < 3
      ) {
        return {
          code: 400,
          body: {
            error:
              'name 3-80 chars required'
          }
        };
      }

      const g =
        await store.createGroup({
          name,
          description:
            str(
              c.body.description,
              500
            ) || '',
          owner_id: c.user.id
        });

      return {
        code: 201,
        body: {
          group: g
        }
      };
    }
  );

  on(
    'GET',
    /^\/groups$/,
    async (c) => ({
      code: 200,
      body: {
        groups:
          await store.listGroupsForUser(
            c.user.id
          )
      }
    })
  );

  on(
    'GET',
    /^\/groups\/([^/]+)$/,
    async (c) => {
      const r =
        await requireMember(
          c.m[1],
          c.user
        );

      if (r.code) return r;

      const memberCount =
        (
          await store.listMembers(
            r.group.id
          )
        ).length;

      return {
        code: 200,
        body: {
          group: {
            ...r.group,
            member_count:
              memberCount
          },
          me: r.member
        }
      };
    }
  );

  on(
    'POST',
    /^\/groups\/([^/]+)\/join$/,
    async (c) => {
      const code =
        String(
          c.body.code || ''
        );

      const inv =
        await store.getInvite(
          code
        );

      if (
        !inv ||
        inv.group_id !== c.m[1] ||
        (
          inv.expires_at &&
          inv.expires_at <
            Date.now()
        )
      ) {
        return {
          code: 404,
          body: {
            error:
              'invite not found or expired'
          }
        };
      }

      if (
        !await store.getMember(
          c.m[1],
          c.user.id
        )
      ) {
        if (inv.used_by) {
          return {
            code: 404,
            body: {
              error:
                'invite already used'
            }
          };
        }

        await store.addMember(
          c.m[1],
          c.user.id,
          'MEMBER'
        );

        await store.useInvite(
          inv.code,
          c.user.id
        );
      }

      return {
        code: 200,
        body: {
          group:
            await store.getGroup(
              c.m[1]
            )
        }
      };
    }
  );

  on(
    'GET',
    /^\/groups\/([^/]+)\/members$/,
    async (c) => {
      const r =
        await requireMember(
          c.m[1],
          c.user
        );

      if (r.code) return r;

      const memberRows =
        await store.listMembers(
          c.m[1]
        );

      const members =
        await Promise.all(
          memberRows.map(
            async (m) => ({
              ...m,
              user: publicUser(
                await store.getUser(
                  m.user_id
                ) || {
                  id: m.user_id
                }
              )
            })
          )
        );

      return {
        code: 200,
        body: {
          members
        }
      };
    }
  );

  on(
    'POST',
    /^\/groups\/([^/]+)\/leave$/,
    async (c) => {
      const r =
        await requireMember(
          c.m[1],
          c.user
        );

      if (r.code) return r;

      if (
        r.member.role ===
        'OWNER'
      ) {
        return {
          code: 400,
          body: {
            error:
              'owner cannot leave, delete group instead'
          }
        };
      }

      await store.removeMember(
        c.m[1],
        c.user.id
      );

      return {
        code: 200,
        body: {
          ok: true
        }
      };
    }
  );

  on(
    'DELETE',
    /^\/groups\/([^/]+)$/,
    async (c) => {
      const r =
        await requireMember(
          c.m[1],
          c.user
        );

      if (r.code) return r;

      if (
        r.member.role !==
        'OWNER'
      ) {
        return {
          code: 403,
          body: {
            error:
              'owner only'
          }
        };
      }

      await store.deleteGroup(
        r.group.id
      );

      return {
        code: 200,
        body: {
          ok: true
        }
      };
    }
  );

  on(
    'POST',
    /^\/groups\/([^/]+)\/members\/([^/]+)\/role$/,
    async (c) => {
      const r =
        await requireMember(
          c.m[1],
          c.user
        );

      if (r.code) return r;

      if (
        r.member.role !==
        'OWNER'
      ) {
        return {
          code: 403,
          body: {
            error:
              'owner only'
          }
        };
      }

      const role =
        String(
          c.body.role || ''
        );

      if (
        !['ADMIN', 'MEMBER']
          .includes(role)
      ) {
        return {
          code: 400,
          body: {
            error:
              'role must be ADMIN or MEMBER'
          }
        };
      }

      const target =
        await store.getMember(
          c.m[1],
          c.m[2]
        );

      if (!target) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      if (
        target.role ===
        'OWNER'
      ) {
        return {
          code: 400,
          body: {
            error:
              'cannot change OWNER role'
          }
        };
      }

      await store.updateMemberRole(
        c.m[1],
        c.m[2],
        role
      );

      return {
        code: 200,
        body: {
          ok: true
        }
      };
    }
  );

  /* ---------- инвайты ---------- */

  on(
    'POST',
    /^\/groups\/([^/]+)\/invite$/,
    async (c) => {
      const r =
        await requireMember(
          c.m[1],
          c.user
        );

      if (r.code) return r;

      if (
        !['OWNER', 'ADMIN']
          .includes(
            r.member.role
          )
      ) {
        return {
          code: 403,
          body: {
            error:
              'admin only'
          }
        };
      }

      const inv =
        await store.createInvite({
          group_id: r.group.id,
          expires_at:
            Date.now() +
            86400000,
          created_by:
            c.user.id
        });

      return {
        code: 201,
        body: {
          code: inv.code,
          expires_at:
            inv.expires_at
        }
      };
    }
  );

  on(
    'POST',
    /^\/invites\/([A-Za-z0-9]+)\/join$/,
    async (c) => {
      const inv =
        await store.getInvite(
          c.m[1]
        );

      if (
        !inv ||
        (
          inv.expires_at &&
          inv.expires_at <
            Date.now()
        )
      ) {
        return {
          code: 404,
          body: {
            error:
              'invite not found or expired'
          }
        };
      }

      const g =
        await store.getGroup(
          inv.group_id
        );

      if (!g) {
        return {
          code: 404,
          body: {
            error:
              'invite not found or expired'
          }
        };
      }

      if (
        await store.getMember(
          g.id,
          c.user.id
        )
      ) {
        return {
          code: 409,
          body: {
            error:
              'already a member'
          }
        };
      }

      if (inv.used_by) {
        return {
          code: 404,
          body: {
            error:
              'invite already used'
          }
        };
      }

      await store.addMember(
        g.id,
        c.user.id,
        'MEMBER'
      );

      await store.useInvite(
        inv.code,
        c.user.id
      );

      return {
        code: 200,
        body: {
          group: g
        }
      };
    }
  );

  /* ---------- подгруппы ---------- */

  on(
    'POST',
    /^\/groups\/([^/]+)\/subgroups$/,
    async (c) => {
      const r =
        await requireMember(
          c.m[1],
          c.user
        );

      if (r.code) return r;

      if (
        !['OWNER', 'ADMIN']
          .includes(
            r.member.role
          )
      ) {
        return {
          code: 403,
          body: {
            error:
              'admin only'
          }
        };
      }

      const name =
        str(
          c.body.name,
          60
        );

      if (
        !name ||
        name.length < 2
      ) {
        return {
          code: 400,
          body: {
            error:
              'name 2-60 chars required'
          }
        };
      }

      return {
        code: 201,
        body: {
          subgroup:
            await store.createSubgroup({
              group_id:
                r.group.id,
              name
            })
        }
      };
    }
  );

  on(
    'GET',
    /^\/groups\/([^/]+)\/subgroups$/,
    async (c) => {
      const r =
        await requireMember(
          c.m[1],
          c.user
        );

      if (r.code) return r;

      return {
        code: 200,
        body: {
          subgroups:
            await store.listSubgroups(
              r.group.id
            )
        }
      };
    }
  );

  on(
    'POST',
    /^\/subgroups\/([^/]+)\/join$/,
    async (c) => {
      const sg =
        await store.getSubgroup(
          c.m[1]
        );

      if (!sg) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      const r =
        await requireMember(
          sg.group_id,
          c.user
        );

      if (r.code) return r;

      await store.addSubgroupMember(
        sg.id,
        c.user.id
      );

      return {
        code: 200,
        body: {
          ok: true
        }
      };
    }
  );

  /* ---------- leaderboard ---------- */

  on(
    'GET',
    /^\/groups\/([^/]+)\/leaderboard$/,
    async (c) => {
      const r =
        await requireMember(
          c.m[1],
          c.user
        );

      if (r.code) return r;

      const metric =
        String(
          c.q.metric || 'TOTAL'
        ).toUpperCase();

      if (
        !COMPETITION_TYPES
          .includes(metric)
      ) {
        return {
          code: 400,
          body: {
            error:
              'invalid metric'
          }
        };
      }

      let uids =
        (
          await store.listMembers(
            r.group.id
          )
        ).map(
          (m) => m.user_id
        );

      if (c.q.subgroup_id) {
        const sg =
          await store.getSubgroup(
            c.q.subgroup_id
          );

        if (
          !sg ||
          sg.group_id !==
            r.group.id
        ) {
          return {
            code: 404,
            body: {
              error:
                'not found'
            }
          };
        }

        const members =
          new Set(
            await store.listSubgroupMembers(
              sg.id
            )
          );

        uids =
          uids.filter(
            (u) =>
              members.has(u)
          );
      }

      const rows =
        await board(
          uids,
          metric,
          null,
          null
        );

      return {
        code: 200,
        body: {
          metric,
          rule:
            'value desc → achieved_at asc → same place',
          rows:
            await Promise.all(
              rows.map(
                async (x) => ({
                  ...x,
                  user:
                    publicUser(
                      await store.getUser(
                        x.user_id
                      ) || {
                        id:
                          x.user_id
                      }
                    )
                })
              )
            )
        }
      };
    }
  );

  /* ---------- соревнования ---------- */

  on(
    'POST',
    /^\/groups\/([^/]+)\/competitions$/,
    async (c) => {
      const r =
        await requireMember(
          c.m[1],
          c.user
        );

      if (r.code) return r;

      if (
        !['OWNER', 'ADMIN']
          .includes(
            r.member.role
          )
      ) {
        return {
          code: 403,
          body: {
            error:
              'admin only'
          }
        };
      }

      const name =
        str(
          c.body.name,
          100
        );

      const type =
        String(
          c.body.type || ''
        );

      const start_at =
        num(
          c.body.start_at,
          1e12,
          4e12
        );

      const end_at =
        num(
          c.body.end_at,
          1e12,
          4e12
        );

      if (
        !name ||
        !COMPETITION_TYPES
          .includes(type) ||
        !start_at ||
        !end_at ||
        end_at <= start_at
      ) {
        return {
          code: 400,
          body: {
            error:
              'invalid competition'
          }
        };
      }

      const comp =
        await store.createCompetition({
          group_id:
            r.group.id,
          name,
          type,
          start_at,
          end_at,
          created_by:
            c.user.id,
          description:
            str(
              c.body.description,
              500
            ) || ''
        });

      /*
       * На момент создания соревнования
       * добавляем всех текущих участников группы.
       */
      for (
        const member
        of await store.listMembers(
          r.group.id
        )
      ) {
        await store.addCompetitionMember(
          comp.id,
          member.user_id
        );
      }

      return {
        code: 201,
        body: {
          competition: comp
        }
      };
    }
  );

  on(
    'GET',
    /^\/groups\/([^/]+)\/competitions$/,
    async (c) => {
      const r =
        await requireMember(
          c.m[1],
          c.user
        );

      if (r.code) return r;

      return {
        code: 200,
        body: {
          competitions:
            await store.listCompetitions(
              r.group.id
            )
        }
      };
    }
  );

  on(
    'GET',
    /^\/competitions\/([^/]+)$/,
    async (c) => {
      const comp =
        await store.getCompetition(
          c.m[1]
        );

      if (!comp) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      const r =
        await requireMember(
          comp.group_id,
          c.user
        );

      if (r.code) return r;

      const participantCount =
        (
          await store.listCompetitionMembers(
            comp.id
          )
        ).length;

      return {
        code: 200,
        body: {
          competition: comp,
          participants:
            participantCount
        }
      };
    }
  );

  on(
    'POST',
    /^\/competitions\/([^/]+)\/join$/,
    async (c) => {
      const comp =
        await store.getCompetition(
          c.m[1]
        );

      if (!comp) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      const r =
        await requireMember(
          comp.group_id,
          c.user
        );

      if (r.code) return r;

      if (
        comp.status ===
        'FINISHED'
      ) {
        return {
          code: 409,
          body: {
            error:
              'competition finished'
          }
        };
      }

      await store.addCompetitionMember(
        comp.id,
        c.user.id
      );

      return {
        code: 200,
        body: {
          ok: true
        }
      };
    }
  );

  on(
    'POST',
    /^\/competitions\/([^/]+)\/start$/,
    async (c) => {
      const comp =
        await store.getCompetition(
          c.m[1]
        );

      if (!comp) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      const r =
        await requireMember(
          comp.group_id,
          c.user
        );

      if (r.code) return r;

      if (
        !['OWNER', 'ADMIN']
          .includes(
            r.member.role
          )
      ) {
        return {
          code: 403,
          body: {
            error:
              'admin only'
          }
        };
      }

      if (
        comp.status !==
        'UPCOMING'
      ) {
        return {
          code: 409,
          body: {
            error:
              'status is ' +
              comp.status
          }
        };
      }

      return {
        code: 200,
        body: {
          competition:
            await store.updateCompetition(
              comp.id,
              {
                status:
                  'ACTIVE'
              }
            )
        }
      };
    }
  );

  on(
    'GET',
    /^\/competitions\/([^/]+)\/standings$/,
    async (c) => {
      const comp =
        await store.getCompetition(
          c.m[1]
        );

      if (!comp) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      const r =
        await requireMember(
          comp.group_id,
          c.user
        );

      if (r.code) return r;

      /*
       * В рейтинг попадают именно участники
       * этого соревнования.
       */
      const uids =
        await store.listCompetitionMembers(
          comp.id
        );

      const rows =
        await board(
          uids,
          comp.type,
          comp.start_at,
          comp.end_at,
          null,
          comp.start_at - 1
        );

      return {
        code: 200,
        body: {
          competition: comp,
          rows
        }
      };
    }
  );

  on(
    'POST',
    /^\/competitions\/([^/]+)\/finish$/,
    async (c) => {
      const comp =
        await store.getCompetition(
          c.m[1]
        );

      if (!comp) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      const r =
        await requireMember(
          comp.group_id,
          c.user
        );

      if (r.code) return r;

      if (
        !['OWNER', 'ADMIN']
          .includes(
            r.member.role
          )
      ) {
        return {
          code: 403,
          body: {
            error:
              'admin only'
          }
        };
      }

      if (
        comp.status ===
        'FINISHED'
      ) {
        return {
          code: 409,
          body: {
            error:
              'already finished'
          }
        };
      }

      const uids =
        await store.listCompetitionMembers(
          comp.id
        );

      const rows =
        await board(
          uids,
          comp.type,
          comp.start_at,
          comp.end_at,
          null,
          comp.start_at - 1
        );

      await store.updateCompetition(
        comp.id,
        {
          status:
            'FINISHED',
          winner_id:
            rows[0]
              ? rows[0].user_id
              : null
        }
      );

      return {
        code: 200,
        body: {
          winner:
            rows[0]
              ? rows[0].user_id
              : null,
          rows
        }
      };
    }
  );

  /* ---------- программы ---------- */

  on(
    'POST',
    /^\/programs$/,
    async (c) => {
      const name =
        str(
          c.body.name,
          100
        );

      const level =
        String(
          c.body.level || ''
        );

      const frequency =
        num(
          c.body.frequency,
          2,
          4
        );

      if (
        !name ||
        ![
          'beginner',
          'intermediate',
          'advanced'
        ].includes(level) ||
        !frequency
      ) {
        return {
          code: 400,
          body: {
            error:
              'invalid program'
          }
        };
      }

      if (
        !Array.isArray(
          c.body.weeks
        ) ||
        !c.body.weeks.length ||
        c.body.weeks.length > 60
      ) {
        return {
          code: 400,
          body: {
            error:
              'weeks required (1-60)'
          }
        };
      }

      const p =
        await store.createProgram({
          owner_id:
            c.user.id,
          name,
          level,
          frequency,
          weeks:
            c.body.weeks
        });

      return {
        code: 201,
        body: {
          program: p
        }
      };
    }
  );

  on(
    'GET',
    /^\/programs\/([^/]+)$/,
    async (c) => {
      const p =
        await store.getProgram(
          c.m[1]
        );

      if (!p) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      return {
        code: 200,
        body: {
          program: p
        }
      };
    }
  );

  on(
    'POST',
    /^\/programs\/([^/]+)\/assign$/,
    async (c) => {
      const p =
        await store.getProgram(
          c.m[1]
        );

      if (!p) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      /*
       * Важно:
       * назначать программу может только
       * её владелец.
       */
      if (
        p.owner_id !==
        c.user.id
      ) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      const gid =
        String(
          c.body.group_id || ''
        );

      const g =
        await store.getGroup(
          gid
        );

      if (!g) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      const r =
        await requireMember(
          gid,
          c.user
        );

      if (r.code) return r;

      if (
        !['OWNER', 'ADMIN']
          .includes(
            r.member.role
          )
      ) {
        return {
          code: 403,
          body: {
            error:
              'admin only'
          }
        };
      }

      const a =
        await store.assignProgram({
          program_id:
            p.id,
          group_id: gid,
          assigned_by:
            c.user.id
        });

      return {
        code: 201,
        body: {
          assignment: a
        }
      };
    }
  );

  /*
   * Раскладка %1ПМ → веса
   * с округлением к шагу
   * 1.25 / 2.5 / 5 кг.
   */
  on(
    'GET',
    /^\/programs\/([^/]+)\/schedule$/,
    async (c) => {
      const p =
        await store.getProgram(
          c.m[1]
        );

      if (!p) {
        return {
          code: 404,
          body: {
            error:
              'not found'
          }
        };
      }

      const rm = {
        squat:
          num(
            c.q['1rm_squat'],
            1,
            1000
          ),

        bench:
          num(
            c.q['1rm_bench'],
            1,
            1000
          ),

        deadlift:
          num(
            c.q['1rm_deadlift'],
            1,
            1000
          )
      };

      const step =
        [1.25, 2.5, 5].includes(
          Number(c.q.step)
        )
          ? Number(c.q.step)
          : 2.5;

      if (
        !rm.squat &&
        !rm.bench &&
        !rm.deadlift
      ) {
        return {
          code: 400,
          body: {
            error:
              '1rm_* required'
          }
        };
      }

      const round =
        (w) =>
          Math.round(
            w / step
          ) * step;

      const weeks =
        (p.weeks || []).map(
          (w) => ({
            ...w,

            workouts:
              (w.workouts || [])
                .map(
                  (wo) => ({
                    ...wo,

                    exercises:
                      (
                        wo.exercises ||
                        []
                      ).map(
                        (ex) => {
                          const one =
                            rm[
                              ex.exercise
                            ];

                          const target =
                            (
                              ex.percent &&
                              one
                            )
                              ? round(
                                  one *
                                  ex.percent /
                                  100
                                )
                              : null;

                          return {
                            ...ex,
                            weight_kg:
                              target
                          };
                        }
                      )
                  })
                )
          })
        );

      return {
        code: 200,
        body: {
          step,
          weeks
        }
      };
    }
  );

  /* ---------- Premium: TON ---------- */

  on(
    'POST',
    /^\/payments\/verify$/,
    async (c) => {
      if (
        !ton.address ||
        !ton.amountNano
      ) {
        return {
          code: 503,
          body: {
            error:
              'payments not configured'
          }
        };
      }

      const label =
        String(
          c.body.label || ''
        );

      if (
        !/^[A-Za-z0-9_-]{1,64}$/
          .test(label)
      ) {
        return {
          code: 400,
          body: {
            error:
              'invalid label'
          }
        };
      }

      /*
       * Идемпотентность по label.
       */
      const ent =
        await store.getEntitlement(
          c.user.id
        );

      if (
        ent &&
        ent.label === label &&
        ent.until > Date.now()
      ) {
        return {
          code: 200,
          body: {
            ok: true,
            until:
              ent.until
          }
        };
      }

      const doFetch =
        ton.fetch ||
        (
          typeof fetch ===
          'function'
            ? fetch
            : null
        );

      if (!doFetch) {
        return {
          code: 503,
          body: {
            error:
              'payments not configured'
          }
        };
      }

      let found = false;

      try {
        const r =
          await doFetch(
            'https://toncenter.com/api/v2/getTransactions?address=' +
              encodeURIComponent(
                ton.address
              ) +
              '&limit=50'
          );

        const j =
          await r.json();

        for (
          const tx
          of (
            j &&
            Array.isArray(
              j.result
            )
              ? j.result
              : []
          )
        ) {
          if (
            tx.in === true &&
            String(
              tx.message || ''
            ) === label &&
            Number(tx.value) >=
              ton.amountNano
          ) {
            found = true;
            break;
          }
        }
      }

      catch (e) {
        return {
          code: 502,
          body: {
            error:
              'blockchain api unavailable'
          }
        };
      }

      if (!found) {
        return {
          code: 200,
          body: {
            ok: false
          }
        };
      }

      const until =
        Date.now() +
        ton.periodDays *
          86400000;

      await store.setEntitlement(
        c.user.id,
        {
          until,
          source:
            'ton-verify',
          label
        }
      );

      return {
        code: 200,
        body: {
          ok: true,
          until
        }
      };
    }
  );

  on(
    'GET',
    /^\/premium$/,
    async (c) => {
      const ent =
        await store.getEntitlement(
          c.user.id
        );

      return {
        code: 200,
        body: {
          premium_until:
            ent &&
            ent.until > Date.now()
              ? ent.until
              : null
        }
      };
    }
  );

  /* ---------- синхронизация ---------- */

  on(
    'POST',
    /^\/sync$/,
    async (c) => {
      if (
        !Array.isArray(
          c.body.ops
        ) ||
        c.body.ops.length > 100
      ) {
        return {
          code: 400,
          body: {
            error:
              'ops array (≤100) required'
          }
        };
      }

      const results = [];

      for (
        const op
        of c.body.ops
      ) {
        const opId =
          String(
            (op && op.id) || ''
          );

        if (
          !/^[A-Za-z0-9_-]{1,64}$/
            .test(opId)
        ) {
          results.push({
            op_id: null,
            status: 400,
            body: {
              error:
                'invalid op id'
            }
          });

          continue;
        }

        const saved =
          await store.getIdem(
            c.user.id,
            'sync:' + opId
          );

        if (saved) {
          results.push(saved);
          continue;
        }

        const method =
          String(
            op.method || ''
          ).toUpperCase();

        const path =
          String(
            op.path || ''
          );

        const m =
          method === 'POST'
            ? (
                path.match(
                  /^\/workouts\/([^/]+)\/sets$/
                )
              )
            : method === 'DELETE'
              ? path.match(
                  /^\/(workouts|sets)\/([^/]+)$/
                )
              : method === 'PATCH'
                ? path.match(
                    /^\/workouts\/([^/]+)$/
                  )
                : null;

        let out;

        if (
          method === 'POST' &&
          /^\/workouts$/.test(
            path
          )
        ) {
          out =
            await handleRoute(
              'POST',
              '/workouts',
              {
                ...(op.body || {}),
                idempotency_key:
                  'op:' + opId
              },
              {},
              c.user
            );
        }

        else if (
          method === 'POST' &&
          m
        ) {
          out =
            await handleRoute(
              'POST',
              '/workouts/' +
                m[1] +
                '/sets',
              {
                ...(op.body || {}),
                idempotency_key:
                  'op:' + opId
              },
              {},
              c.user
            );
        }

        else if (
          method === 'DELETE' &&
          m &&
          m[1] === 'workouts'
        ) {
          out =
            await handleRoute(
              'DELETE',
              '/workouts/' +
                m[2],
              {},
              {},
              c.user
            );
        }

        else if (
          method === 'DELETE' &&
          m &&
          m[1] === 'sets'
        ) {
          out =
            await handleRoute(
              'DELETE',
              '/sets/' +
                m[2],
              {},
              {},
              c.user
            );
        }

        else if (
          method === 'PATCH' &&
          m
        ) {
          out =
            await handleRoute(
              'PATCH',
              '/workouts/' +
                m[1],
              op.body || {},
              {},
              c.user
            );
        }

        else {
          out = {
            code: 400,
            body: {
              error:
                'unsupported op'
            }
          };
        }

        const rec = {
          op_id: opId,
          status: out.code,
          body: out.body
        };

        await store.setIdem(
          c.user.id,
          'sync:' + opId,
          rec
        );

        results.push(rec);
      }

      return {
        code: 200,
        body: {
          results
        }
      };
    }
  );

  /* ---------- диспетчер ---------- */

  async function handleRoute(
    method,
    pathname,
    body,
    q,
    user,
    idemKey
  ) {
    for (
      const r
      of routes
    ) {
      if (
        r.method !== method
      ) {
        continue;
      }

      const m =
        pathname.match(
          r.re
        );

      if (!m) {
        continue;
      }

      return r.fn({
        body: body || {},
        q: q || {},
        m,
        user,
        idemKey
      });
    }

    return {
      code: 404,
      body: {
        error:
          'not found'
      }
    };
  }

  /* ---------- HTTP handler ---------- */

  return async function handler(
    req,
    res
  ) {
    try {
      const u =
        new URL(
          req.url,
          'http://x'
        );

      let pathname =
        u.pathname;

      /*
       * /api/* эквивалентно /*
       */
      if (
        pathname === '/api' ||
        pathname.indexOf(
          '/api/'
        ) === 0
      ) {
        pathname =
          pathname.slice(4);
      }

      const ip =
        clientIp(req);

      /*
       * Общий rate limit.
       */
      if (
        !allowReq(
          'ip:' + ip,
          240,
          60000
        )
      ) {
        return err(
          res,
          429,
          'too many requests'
        );
      }

      /*
       * Более строгий limit
       * для авторизации и платежей.
       */
      if (
        /^\/(auth|payments)\//
          .test(pathname) &&
        !allowReq(
          'strict:' + ip,
          10,
          60000
        )
      ) {
        return err(
          res,
          429,
          'too many requests'
        );
      }

      /*
       * CORS preflight.
       */
      if (
        req.method ===
        'OPTIONS'
      ) {
        return json(
          res,
          204,
          {},
          corsHeaders
        );
      }

      let body = {};

      if (
        method_has_body(req)
      ) {
        const ct =
          String(
            req.headers[
              'content-type'
            ] || ''
          );

        if (
          !/application\/json/i
            .test(ct)
        ) {
          return err(
            res,
            415,
            'content-type must be application/json'
          );
        }

        try {
          body =
            await readBody(
              req,
              MAX_BODY
            );
        }

        catch (e) {
          return err(
            res,
            e.code || 400,
            e.message ===
              'too large'
              ? 'body too large'
              : 'invalid json'
          );
        }
      }

      /*
       * Health и Telegram auth
       * доступны без Bearer-сессии.
       */
      if (
        pathname !==
          '/health' &&
        pathname !==
          '/auth/telegram'
      ) {
        const user =
          await authUser(req);

        if (!user) {
          return json(
            res,
            401,
            {
              error:
                'unauthorized'
            },
            corsHeaders
          );
        }

        const q = {};

        for (
          const [
            k,
            v
          ]
          of u.searchParams.entries()
        ) {
          q[k] = v;
        }

        const out =
          await handleRoute(
            req.method,
            pathname,
            body,
            q,
            user,
            req.headers[
              'idempotency-key'
            ]
          );

        return json(
          res,
          out.code,
          out.body,
          corsHeaders
        );
      }

      const out =
        await handleRoute(
          req.method,
          pathname,
          body,
          {},
          null,
          req.headers[
            'idempotency-key'
          ]
        );

      return json(
        res,
        out.code,
        out.body,
        corsHeaders
      );
    }

    catch (e) {
      /*
       * Подробность остаётся
       * только в серверном логе.
       */
      console.error(
        '[api]',
        req.method,
        req.url,
        e.message
      );

      return err(
        res,
        500,
        'internal error'
      );
    }
  };

  function method_has_body(
    req
  ) {
    return [
      'POST',
      'PATCH',
      'PUT'
    ].includes(
      req.method
    );
  }
}

module.exports = {
  createApp
};
