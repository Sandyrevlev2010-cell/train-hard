-- Train Hard — миграции PostgreSQL.
-- Применять: psql "$DATABASE_URL" -f db/migrations/001_init_up.sql
-- Все запросы приложения — только параметризованные (см. server/src/store.js, PgStore).

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  telegram_id  BIGINT NOT NULL UNIQUE,          -- один аккаунт = один Telegram
  username     TEXT,
  first_name   TEXT,
  last_name    TEXT,
  photo_url    TEXT,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,                -- sha256(token): сам токен не храним
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   BIGINT NOT NULL,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS workouts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,                   -- YYYY-MM-DD
  title        TEXT NOT NULL DEFAULT 'Тренировка',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);

CREATE TABLE IF NOT EXISTS workout_sets (
  id           TEXT PRIMARY KEY,
  workout_id   TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- денормализация для PR/лидербордов
  exercise     TEXT NOT NULL CHECK (exercise IN ('squat','bench','deadlift')),
  set_number   INT NOT NULL CHECK (set_number BETWEEN 1 AND 50),
  weight       NUMERIC(6,2) NOT NULL CHECK (weight > 0 AND weight <= 1000),
  reps         INT NOT NULL CHECK (reps BETWEEN 0 AND 500),
  successful   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sets_user_ts ON workout_sets(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sets_workout ON workout_sets(workout_id);

-- Идемпотентность: повтор POST с тем же ключом не создаёт дубль (double-tap, retry, sync)
CREATE TABLE IF NOT EXISTS idempotency (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key      TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS groups (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  owner_id     TEXT NOT NULL REFERENCES users(id),
  created_at   BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER','ADMIN','MEMBER')),
  joined_at BIGINT NOT NULL,
  UNIQUE (group_id, user_id)                    -- одно членство, ролей у одной группы нет
);

CREATE TABLE IF NOT EXISTS subgroups (
  id        TEXT PRIMARY KEY,
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS subgroup_members (
  subgroup_id TEXT NOT NULL REFERENCES subgroups(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at    BIGINT NOT NULL,
  UNIQUE (subgroup_id, user_id)                 -- многократное членство в разных подгруппах разрешено
);

CREATE TABLE IF NOT EXISTS invites (
  code        TEXT PRIMARY KEY,                 -- случайный hex, без персональных данных
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL,
  used_by     TEXT,                           -- telegram_id использовавшего (для одноразовости)
  used_at     BIGINT
);

CREATE TABLE IF NOT EXISTS competitions (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL CHECK (type IN ('TOTAL','SQUAT','BENCH','DEADLIFT','PR_PROGRESS')),
  status     TEXT NOT NULL DEFAULT 'UPCOMING' CHECK (status IN ('UPCOMING','ACTIVE','FINISHED')),
  start_at   BIGINT NOT NULL,
  end_at     BIGINT NOT NULL CHECK (end_at > start_at),
  winner_id  TEXT REFERENCES users(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS programs (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  level      TEXT NOT NULL CHECK (level IN ('beginner','intermediate','advanced')),
  frequency  INT NOT NULL CHECK (frequency BETWEEN 2 AND 4),
  weeks      JSONB NOT NULL,                    -- структура PROGRAM→PHASE→WEEK→WORKOUT→EXERCISE→SET
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS program_assignments (
  id           TEXT PRIMARY KEY,
  program_id   TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  assigned_by  TEXT NOT NULL REFERENCES users(id),
  assigned_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  until     BIGINT NOT NULL,
  source    TEXT NOT NULL,                      -- 'ton-verify' | 'manual'
  label     TEXT,                               -- метка TON-перевода (анти-повтор)
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS competition_members (
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at      BIGINT NOT NULL,
  UNIQUE (competition_id, user_id)
);
