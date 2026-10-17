/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SqliteDatabasePort } from './sqliteDatabase.js';

export const INITIAL_SCHEMA_SQL = `
-- Enforce foreign key constraints
PRAGMA foreign_keys = ON;

-- Problems table with unique constraint on (platform, slug)
CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY,
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
  CONSTRAINT uq_platform_slug UNIQUE (platform, slug)
);

CREATE INDEX IF NOT EXISTS idx_problems_status ON problems (status);
CREATE INDEX IF NOT EXISTS idx_problems_deleted_at ON problems (deleted_at);

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

-- User Settings table (e.g. leetcode_username)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function runMigrations(db: SqliteDatabasePort): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(INITIAL_SCHEMA_SQL);
}
