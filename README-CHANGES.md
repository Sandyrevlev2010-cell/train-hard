# Train Hard — Arena v3 / Telegram account auth

## Frontend changes
- Arena without a group shows only two primary actions: **Вступить в группу** and **Создать группу**.
- Joining uses an invitation **link**, not an exposed invite code.
- Telegram Mini App invite links use `startapp=<invite>`; opening the link automatically calls the existing join endpoint.
- After creating/joining a group, the user is immediately asked for Squat / Bench / Deadlift values.
- Arena UI uses the Train Hard black/red/orange visual language.
- Existing group view keeps leaderboard, edit-my-results, invite-link, leave/delete actions.
- Telegram onboarding no longer asks for a login or password. Signed Telegram `initData` is used to bind the local profile key to `tg<telegram_id>`; the existing name/age/goal/program onboarding remains.

## Backend invariant
- `uq_group_members_one_group_per_user` remains a database-level unique index on `group_members(user_id)`.
- Arena stats remain separate from Progress/workouts in `arena_stats`.

## Verification performed
- `node --check` passed for Arena UI/API/config.
- All 29 inline JavaScript blocks in `app/index.html` passed `node --check`.
- Telegram build generated with exactly one Telegram WebApp external script; all 30 inline scripts passed `node --check`.
- Neon production check: unique one-group index exists; current data has 0 cross-group membership pairs.
- Backend health was previously verified live as `{"ok":true}` before these unpushed frontend changes.

## Important
The GitHub integration currently returns HTTP 403 for repository writes. The replacement bundle is therefore prepared locally; the existing live Render deployment has **not** been changed by this turn.
