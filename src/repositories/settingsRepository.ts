/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SqliteDatabasePort } from '../db/sqliteDatabase.js';
import { ValidationError } from '../domain/errors.js';

export interface SettingsRepository {
  get(key: string, userId?: string): Promise<string | null>;
  set(key: string, value: string, userId?: string): Promise<void>;
  getLeetCodeUsername(userId?: string): Promise<string | null>;
  setLeetCodeUsername(username: string, userId?: string): Promise<void>;
}

function assertValidUserId(userId?: string, operation = 'settings operation'): string {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new ValidationError(`User ID is required for ${operation}.`);
  }
  return userId.trim();
}

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SqliteDatabasePort) {}

  public async get(key: string, userId?: string): Promise<string | null> {
    const validUserId = assertValidUserId(userId, 'retrieving settings');
    const row = this.db
      .prepare<{ value: string }>('SELECT value FROM settings WHERE user_id = ? AND key = ?')
      .get(validUserId, key);
    return row ? row.value : null;
  }

  public async set(key: string, value: string, userId?: string): Promise<void> {
    const validUserId = assertValidUserId(userId, 'saving settings');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO settings (user_id, key, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(validUserId, key, value, now);
  }

  public async getLeetCodeUsername(userId?: string): Promise<string | null> {
    return this.get('leetcode_username', userId);
  }

  public async setLeetCodeUsername(username: string, userId?: string): Promise<void> {
    await this.set('leetcode_username', username, userId);
  }
}
