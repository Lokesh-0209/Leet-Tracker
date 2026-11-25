/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SqliteDatabasePort } from './sqliteDatabase.js';

export const INITIAL_SCHEMA_SQL = `
-- Enforce foreign key constraints
PRAGMA foreign_keys = ON;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  leetcode_username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_leetcode_username ON users (leetcode_username COLLATE NOCASE);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

-- Verification challenges for LeetCode profile ownership
CREATE TABLE IF NOT EXISTS verification_challenges (
  id TEXT PRIMARY KEY,
  leetcode_username TEXT NOT NULL COLLATE NOCASE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  consumed_at TEXT,
  purpose TEXT NOT NULL DEFAULT 'registration' CHECK (purpose IN ('registration', 'password_reset')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_challenges_username ON verification_challenges (leetcode_username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_challenges_expires_at ON verification_challenges (expires_at);

-- Problems table with unique constraint on (user_id, platform, slug)
CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  platform TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  url TEXT NOT NULL,
  solved_at TEXT NOT NULL,
  status TEXT NOT NULL,
  enrolled_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_user_platform_slug UNIQUE (user_id, platform, slug)
);

CREATE INDEX IF NOT EXISTS idx_problems_user_id ON problems (user_id);
CREATE INDEX IF NOT EXISTS idx_problems_status ON problems (status);
CREATE INDEX IF NOT EXISTS idx_problems_deleted_at ON problems (deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_problems_platform_slug_null_user ON problems (platform, slug) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_problems_user_platform_slug ON problems (user_id, platform, slug) WHERE user_id IS NOT NULL;

-- Notes table: exactly one Note per Problem
CREATE TABLE IF NOT EXISTS notes (
  problem_id TEXT PRIMARY KEY,
  approaches_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
);

-- Reviews table: stage 1, 2, 3 per Problem
CREATE TABLE IF NOT EXISTS reviews (
  problem_id TEXT NOT NULL,
  stage INTEGER NOT NULL CHECK (stage IN (1, 2, 3)),
  due_date TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (problem_id, stage),
  FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reviews_due_date ON reviews (due_date);
CREATE INDEX IF NOT EXISTS idx_reviews_completed_at ON reviews (completed_at);

-- User Settings table (user-scoped, unconstrained user_id allows legacy '__legacy__' rows)
CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL DEFAULT '__legacy__',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
`;

interface TableInfoRow {
  name: string;
}

interface MasterRow {
  sql: string;
}

export function runMigrations(db: SqliteDatabasePort): void {
  db.exec('PRAGMA foreign_keys = OFF;');

  // Check if problems table exists with old schema (without user_id or with old uq_platform_slug constraint)
  const problemsTable = db
    .prepare<MasterRow>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'problems'")
    .get();

  if (problemsTable) {
    const cols = db.prepare<TableInfoRow>('PRAGMA table_info(problems)').all();
    const hasUserId = cols.some((c) => c.name === 'user_id');
    const hasOldUniqueConstraint = problemsTable.sql.includes('uq_platform_slug') && !problemsTable.sql.includes('uq_user_platform_slug');

    if (!hasUserId || hasOldUniqueConstraint) {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE problems_migration (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            platform TEXT NOT NULL,
            slug TEXT NOT NULL,
            title TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            url TEXT NOT NULL,
            solved_at TEXT NOT NULL,
            status TEXT NOT NULL,
            enrolled_at TEXT,
            deleted_at TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            CONSTRAINT uq_user_platform_slug UNIQUE (user_id, platform, slug)
          );
        `);

        if (hasUserId) {
          db.exec(`
            INSERT INTO problems_migration (id, user_id, platform, slug, title, difficulty, url, solved_at, status, enrolled_at, deleted_at, created_at)
            SELECT id, user_id, platform, slug, title, difficulty, url, solved_at, status, enrolled_at, deleted_at, created_at FROM problems;
          `);
        } else {
          db.exec(`
            INSERT INTO problems_migration (id, user_id, platform, slug, title, difficulty, url, solved_at, status, enrolled_at, deleted_at, created_at)
            SELECT id, NULL, platform, slug, title, difficulty, url, solved_at, status, enrolled_at, deleted_at, created_at FROM problems;
          `);
        }

        db.exec('DROP TABLE problems;');
        db.exec('ALTER TABLE problems_migration RENAME TO problems;');
      });
    }
  }

  // Check if settings table exists with old schema (without user_id column)
  const settingsTable = db
    .prepare<MasterRow>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'settings'")
    .get();

  if (settingsTable) {
    const cols = db.prepare<TableInfoRow>('PRAGMA table_info(settings)').all();
    const hasUserId = cols.some((c) => c.name === 'user_id');

    if (!hasUserId) {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE settings_migration (
            user_id TEXT NOT NULL DEFAULT '__legacy__',
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, key)
          );
        `);

        db.exec(`
          INSERT INTO settings_migration (user_id, key, value, updated_at)
          SELECT '__legacy__', key, value, updated_at FROM settings;
        `);

        db.exec('DROP TABLE settings;');
        db.exec('ALTER TABLE settings_migration RENAME TO settings;');
      });
    }
  }

  // Ensure all base tables and indexes exist
  db.exec(INITIAL_SCHEMA_SQL);
  const challengeColumns = db.prepare<TableInfoRow>('PRAGMA table_info(verification_challenges)').all();
  if (!challengeColumns.some((column) => column.name === 'purpose')) {
    db.exec("ALTER TABLE verification_challenges ADD COLUMN purpose TEXT NOT NULL DEFAULT 'registration'");
  }
  db.exec('PRAGMA foreign_keys = ON;');
}
