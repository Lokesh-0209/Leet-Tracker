/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SqliteDatabasePort } from '../db/sqliteDatabase.js';

export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  getLeetCodeUsername(): Promise<string | null>;
  setLeetCodeUsername(username: string): Promise<void>;
}

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SqliteDatabasePort) {}

  public async get(key: string): Promise<string | null> {
    const row = this.db
      .prepare<{ value: string }>('SELECT value FROM settings WHERE key = ?')
      .get(key);
    return row ? row.value : null;
  }

  public async set(key: string, value: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, now);
  }

  public async getLeetCodeUsername(): Promise<string | null> {
    return this.get('leetcode_username');
  }

  public async setLeetCodeUsername(username: string): Promise<void> {
    await this.set('leetcode_username', username);
  }
}
