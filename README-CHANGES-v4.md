# Train Hard — Arena v4 replacement

Included:
- `src/arena/arena-ui.js` — Arena UI v4: Premium badges, member list, owner-only member management, bottom action placement, dynamic «Группа» button.
- `server/src/arena-middleware.js` — Premium synchronization endpoint and owner-only member deletion endpoint; `arena_stats.premium` support.
- `db/migrations/003_arena_premium.sql` — adds `arena_stats.premium`.
- `app/index.html` — generated frontend with the onboarding crop adjusted to match the supplied second screenshot and Arena v4 embedded.
- `telegram/index.html` — Telegram build with Arena v4 embedded.
- `build_telegram.py` — fixed source path to `app/index.html` so the normal `build.py && build_telegram.py` pipeline works with the repository layout.

Endpoints added:
- `PUT /api/arena/premium` — syncs the local Premium state without changing strength timestamps.
- `DELETE /api/groups/:groupId/members/:userId` — owner-only member removal; owner cannot remove self.

Verification performed:
- `node --check` passed for Arena UI and middleware.
- Custom Arena v4 integration test passed: `ARENA_V4_TESTS_OK`.
- All inline scripts in `app/index.html` passed `node --check`.
- All inline scripts in `telegram/index.html` passed `node --check`.
- Telegram build script completed successfully.
