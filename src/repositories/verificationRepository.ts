/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SqliteDatabasePort } from '../db/sqliteDatabase.js';
import type { VerificationChallenge } from '../domain/models.js';

export interface VerificationRepository {
  createChallenge(challenge: {
    id: string;
    leetcodeUsername: string;
    codeHash: string;
    expiresAt: string;
    maxAttempts?: number;
  }): Promise<VerificationChallenge>;
  findActiveChallengeByUsername(
    username: string,
    nowIso: string
  ): Promise<VerificationChallenge | null>;
  findChallengeById(id: string): Promise<VerificationChallenge | null>;
  recordAttempt(id: string): Promise<number>;
  markVerified(id: string, verifiedAt: string): Promise<void>;
  markConsumed(id: string, consumedAt: string): Promise<void>;
  countRecentChallenges(username: string, sinceIso: string): Promise<number>;
}

interface ChallengeDbRow {
  id: string;
  leetcode_username: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  verified_at: string | null;
  consumed_at: string | null;
  created_at: string;
}

function mapRowToChallenge(row: ChallengeDbRow): VerificationChallenge {
  return {
    id: row.id,
    leetcodeUsername: row.leetcode_username,
    codeHash: row.code_hash,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    expiresAt: row.expires_at,
    verifiedAt: row.verified_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}

export class SqliteVerificationRepository implements VerificationRepository {
  constructor(private readonly db: SqliteDatabasePort) {}

  public async createChallenge(challenge: {
    id: string;
    leetcodeUsername: string;
    codeHash: string;
    expiresAt: string;
    maxAttempts?: number;
  }): Promise<VerificationChallenge> {
    const now = new Date().toISOString();
    const maxAttempts = challenge.maxAttempts ?? 5;

    this.db
      .prepare(
        `INSERT INTO verification_challenges (
          id, leetcode_username, code_hash, attempts, max_attempts, expires_at, created_at
        ) VALUES (?, ?, ?, 0, ?, ?, ?)`
      )
      .run(
        challenge.id,
        challenge.leetcodeUsername,
        challenge.codeHash,
        maxAttempts,
        challenge.expiresAt,
        now
      );

    return {
      id: challenge.id,
      leetcodeUsername: challenge.leetcodeUsername,
      codeHash: challenge.codeHash,
      attempts: 0,
      maxAttempts,
      expiresAt: challenge.expiresAt,
      verifiedAt: null,
      consumedAt: null,
      createdAt: now,
    };
  }

  public async findActiveChallengeByUsername(
    username: string,
    nowIso: string
  ): Promise<VerificationChallenge | null> {
    const row = this.db
      .prepare<ChallengeDbRow>(
        `SELECT * FROM verification_challenges
         WHERE leetcode_username = ? COLLATE NOCASE
           AND expires_at > ?
           AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(username.trim(), nowIso);

    return row ? mapRowToChallenge(row) : null;
  }

  public async findChallengeById(id: string): Promise<VerificationChallenge | null> {
    const row = this.db
      .prepare<ChallengeDbRow>('SELECT * FROM verification_challenges WHERE id = ?')
      .get(id);

    return row ? mapRowToChallenge(row) : null;
  }

  public async recordAttempt(id: string): Promise<number> {
    this.db
      .prepare('UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = ?')
      .run(id);

    const row = this.db
      .prepare<{ attempts: number }>('SELECT attempts FROM verification_challenges WHERE id = ?')
      .get(id);

    return row?.attempts ?? 1;
  }

  public async markVerified(id: string, verifiedAt: string): Promise<void> {
    this.db
      .prepare('UPDATE verification_challenges SET verified_at = ? WHERE id = ?')
      .run(verifiedAt, id);
  }

  public async markConsumed(id: string, consumedAt: string): Promise<void> {
    this.db
      .prepare('UPDATE verification_challenges SET consumed_at = ? WHERE id = ?')
      .run(consumedAt, id);
  }

  public async countRecentChallenges(username: string, sinceIso: string): Promise<number> {
    const row = this.db
      .prepare<{ count: number }>(
        `SELECT count(*) as count FROM verification_challenges
         WHERE leetcode_username = ? COLLATE NOCASE
           AND created_at >= ?`
      )
      .get(username.trim(), sinceIso);

    return row ? row.count : 0;
  }
}
