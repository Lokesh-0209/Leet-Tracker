/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DatabasePort } from './sqliteDatabase.js';

const INITIAL_POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  leetcode_username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_leetcode_username_ci ON users (lower(leetcode_username));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS verification_challenges (
  id TEXT PRIMARY KEY,
  leetcode_username TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  consumed_at TEXT,
  purpose TEXT NOT NULL DEFAULT 'registration' CHECK (purpose IN ('registration', 'password_reset')),
  created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX IF NOT EXISTS idx_challenges_username_ci ON verification_challenges (lower(leetcode_username));
CREATE INDEX IF NOT EXISTS idx_challenges_expires_at ON verification_challenges (expires_at);

CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  url TEXT NOT NULL,
  solved_at TEXT NOT NULL,
  status TEXT NOT NULL,
  enrolled_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  CONSTRAINT uq_user_platform_slug UNIQUE (user_id, platform, slug)
);
CREATE INDEX IF NOT EXISTS idx_problems_user_id ON problems (user_id);
CREATE INDEX IF NOT EXISTS idx_problems_status ON problems (status);
CREATE INDEX IF NOT EXISTS idx_problems_deleted_at ON problems (deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_problems_platform_slug_null_user ON problems (platform, slug) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_problems_user_platform_slug ON problems (user_id, platform, slug) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notes (
  problem_id TEXT PRIMARY KEY REFERENCES problems(id) ON DELETE CASCADE,
  approaches_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL CHECK (stage IN (1, 2, 3)),
  due_date TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (problem_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_reviews_due_date ON reviews (due_date);
CREATE INDEX IF NOT EXISTS idx_reviews_completed_at ON reviews (completed_at);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL DEFAULT '__legacy__',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
`;

export async function runPostgresMigrations(db: DatabasePort): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  `);
  const first = await db.prepare<{ version: number }>(
    'SELECT version FROM app_schema_migrations WHERE version = ?'
  ).get(1);
  if (!first) {
    await db.transaction(async () => {
      await db.exec(INITIAL_POSTGRES_SCHEMA);
      await db.prepare('INSERT INTO app_schema_migrations (version) VALUES (?) ON CONFLICT (version) DO NOTHING').run(1);
    });
  }
  await db.transaction(async () => {
    await db.exec("ALTER TABLE verification_challenges ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'registration'");
    await db.exec("DO $$ BEGIN ALTER TABLE verification_challenges ADD CONSTRAINT verification_challenges_purpose_check CHECK (purpose IN ('registration', 'password_reset')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;");
    await db.prepare('INSERT INTO app_schema_migrations (version) VALUES (?) ON CONFLICT (version) DO NOTHING').run(2);
  });
}
