/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DatabasePort } from '../db/sqliteDatabase.js';
import type { User, UserRecord } from '../domain/models.js';

export interface UserRepository {
  create(params: {
    id: string;
    leetcodeUsername: string;
    passwordHash: string;
    passwordSalt: string;
  }): Promise<User>;
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(id: string): Promise<User | null>;
  updatePassword(userId: string, passwordHash: string, passwordSalt: string): Promise<void>;
  count(): Promise<number>;
  claimLegacyData(userId: string, username: string): Promise<{ problemsClaimed: number; settingsClaimed: number }>;
}

interface UserDbRow {
  id: string;
  leetcode_username: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: DatabasePort) {}

  public async create(params: {
    id: string;
    leetcodeUsername: string;
    passwordHash: string;
    passwordSalt: string;
  }): Promise<User> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO users (id, leetcode_username, password_hash, password_salt, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(params.id, params.leetcodeUsername, params.passwordHash, params.passwordSalt, now);

    return {
      id: params.id,
      leetcodeUsername: params.leetcodeUsername,
      createdAt: now,
    };
  }

  public async findByUsername(username: string): Promise<UserRecord | null> {
    const row = await this.db
      .prepare<UserDbRow>(
        'SELECT * FROM users WHERE lower(leetcode_username) = lower(?)'
      )
      .get(username.trim());

    if (!row) return null;

    return {
      id: row.id,
      leetcodeUsername: row.leetcode_username,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      createdAt: row.created_at,
    };
  }

  public async findById(id: string): Promise<User | null> {
    const row = await this.db
      .prepare<UserDbRow>('SELECT id, leetcode_username, created_at FROM users WHERE id = ?')
      .get(id);

    if (!row) return null;

    return {
      id: row.id,
      leetcodeUsername: row.leetcode_username,
      createdAt: row.created_at,
    };
  }

  public async updatePassword(userId: string, passwordHash: string, passwordSalt: string): Promise<void> {
    const result = await this.db
      .prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
      .run(passwordHash, passwordSalt, userId);
    if (result.changes === 0) throw new Error('Account no longer exists.');
  }

  public async count(): Promise<number> {
    const row = await this.db.prepare<{ count: number }>('SELECT CAST(count(*) AS INTEGER) as count FROM users').get();
    return row ? row.count : 0;
  }

  /**
   * Safe legacy data claiming:
   * If single-user data existed prior to multi-user registration:
   * 1. Any problems where user_id IS NULL are assigned to this user if this is the first registered user
   *    or if the legacy setting 'leetcode_username' matched this username.
   * 2. Any legacy settings with user_id = '__legacy__' are copied over to this user.
   */
  public async claimLegacyData(
    userId: string,
    username: string
  ): Promise<{ problemsClaimed: number; settingsClaimed: number }> {
    return await this.db.transaction(async () => {
      // Check legacy username
      const legacySetting = await this.db
        .prepare<{ value: string }>(
          "SELECT value FROM settings WHERE user_id = '__legacy__' AND key = 'leetcode_username'"
        )
        .get();

      // Only allow claiming if the legacy configured username exists AND matches verified username
      const shouldClaim = Boolean(
        legacySetting &&
        legacySetting.value.trim().toLowerCase() === username.trim().toLowerCase()
      );

      let problemsClaimed = 0;
      let settingsClaimed = 0;

      if (shouldClaim) {
        const updateProblems = await this.db
          .prepare('UPDATE problems SET user_id = ? WHERE user_id IS NULL')
          .run(userId);
        problemsClaimed = updateProblems.changes;

        // Copy legacy settings if not present
        const copySettings = await this.db
          .prepare(
            `INSERT INTO settings (user_id, key, value, updated_at)
             SELECT ?, key, value, updated_at FROM settings WHERE user_id = '__legacy__'
             ON CONFLICT (user_id, key) DO NOTHING`
          )
          .run(userId);
        settingsClaimed = copySettings.changes;

        // Clean up legacy settings row
        await this.db.prepare("DELETE FROM settings WHERE user_id = '__legacy__'").run();
      }

      return { problemsClaimed, settingsClaimed };
    });
  }
}
