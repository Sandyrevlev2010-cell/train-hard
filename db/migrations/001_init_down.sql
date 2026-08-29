-- 001_init down: полное удаление схемы Train Hard (обратный порядок зависимостей)
DROP TABLE IF EXISTS competition_members;
DROP TABLE IF EXISTS entitlements;
DROP TABLE IF EXISTS program_assignments;
DROP TABLE IF EXISTS programs;
DROP TABLE IF EXISTS competitions;
DROP TABLE IF EXISTS invites;
DROP TABLE IF EXISTS subgroup_members;
DROP TABLE IF EXISTS subgroups;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS idempotency;
DROP TABLE IF EXISTS workout_sets;
DROP TABLE IF EXISTS workouts;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
