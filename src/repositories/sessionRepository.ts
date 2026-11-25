/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DatabasePort } from '../db/sqliteDatabase.js';
import type { Session, User } from '../domain/models.js';

export interface SessionRepository {
  createSession(params: {
    tokenHash: string;
    userId: string;
    expiresAt: string;
  }): Promise<Session>;
  findSessionByTokenHash(
    tokenHash: string,
    nowIso?: string
  ): Promise<{ session: Session; user: User } | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteExpiredSessions(nowIso: string): Promise<void>;
  deleteUserSessions(userId: string): Promise<void>;
}

interface JoinedSessionRow {
  token_hash: string;
  user_id: string;
  expires_at: string;
  session_created_at: string;
  u_id: string;
  u_leetcode_username: string;
  u_created_at: string;
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: DatabasePort) {}

  public async createSession(params: {
    tokenHash: string;
    userId: string;
    expiresAt: string;
  }): Promise<Session> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(params.tokenHash, params.userId, params.expiresAt, now);

    return {
      tokenHash: params.tokenHash,
      userId: params.userId,
      expiresAt: params.expiresAt,
      createdAt: now,
    };
  }

  public async findSessionByTokenHash(
    tokenHash: string,
    nowIso?: string
  ): Promise<{ session: Session; user: User } | null> {
    const query = `
      SELECT
        s.token_hash, s.user_id, s.expires_at, s.created_at as session_created_at,
        u.id as u_id, u.leetcode_username as u_leetcode_username, u.created_at as u_created_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ?
    `;

    const row = await this.db.prepare<JoinedSessionRow>(query).get(tokenHash);
    if (!row) return null;

    const currentTimeMs = nowIso ? new Date(nowIso).getTime() : Date.now();

    // Check expiry
    if (new Date(row.expires_at).getTime() <= currentTimeMs) {
      // Lazily remove expired session
      this.deleteSession(tokenHash).catch(() => {});
      return null;
    }

    return {
      session: {
        tokenHash: row.token_hash,
        userId: row.user_id,
        expiresAt: row.expires_at,
        createdAt: row.session_created_at,
      },
      user: {
        id: row.u_id,
        leetcodeUsername: row.u_leetcode_username,
        createdAt: row.u_created_at,
      },
    };
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  public async deleteExpiredSessions(nowIso: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
  }

  public async deleteUserSessions(userId: string): Promise<void> {
    await this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}
