-- Train Hard Arena v4
-- Premium badge + member management support.

ALTER TABLE arena_stats
  ADD COLUMN IF NOT EXISTS premium BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_arena_stats_premium
  ON arena_stats(premium);
