-- Train Hard Arena v2
-- Arena stores only the user's latest manually entered S/B/D results.
-- Progress/workouts are intentionally not used by Arena.

CREATE TABLE IF NOT EXISTS arena_stats (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  squat NUMERIC(6,2),
  bench NUMERIC(6,2),
  deadlift NUMERIC(6,2),
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arena_stats_updated
  ON arena_stats(updated_at);

-- Hard database invariant: a user can belong to at most one group.
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_members_one_group_per_user
  ON group_members(user_id);
