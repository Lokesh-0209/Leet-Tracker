/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SqliteDatabasePort } from '../db/sqliteDatabase.js';
import type { ProblemRepository } from '../repositories/problemRepository.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';
import {
  BackupDataSchema,
  ValidationError,
  type BackupData,
  type Clock,
} from '../domain/index.js';

export interface RestoreResult {
  readonly restoredCount: number;
}

function assertValidUserId(userId?: string, operation = 'backup operation'): string {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new ValidationError(`User ID is required for ${operation}.`);
  }
  return userId.trim();
}

export class BackupService {
  constructor(
    private readonly db: SqliteDatabasePort,
    private readonly problemRepository: ProblemRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly clock: Clock
  ) {}

  /**
   * Exports application state as a Version 1 BackupData object.
   * Strictly scoped to the authenticated userId.
   */
  public async exportBackup(userId?: string): Promise<BackupData> {
    const validUserId = assertValidUserId(userId, 'exporting backup');
    const username = await this.settingsRepository.getLeetCodeUsername(validUserId);
    const problems = await this.problemRepository.listAggregates({
      includeDeleted: true,
      userId: validUserId,
    });

    return {
      version: 1,
      exportedAt: this.clock.nowIso(),
      settings: {
        username: username ?? null,
      },
      problems,
    };
  }

  /**
   * Atomically replaces current user's data with the contents of the backup payload.
   * Strictly scoped to the authenticated userId: never deletes or touches other users' data.
   * Runs inside ONE transaction: rolls back completely on any validation or execution error.
   */
  public async restoreBackup(payload: unknown, userId?: string): Promise<RestoreResult> {
    const validUserId = assertValidUserId(userId, 'restoring backup');

    const parseResult = BackupDataSchema.safeParse(payload);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; ');
      throw new ValidationError(`Invalid backup data: ${errorDetails}`);
    }

    const backup = parseResult.data as unknown as BackupData;

    await this.db.transaction(() => {
      // 1. Wipe ONLY this user's data (reviews & notes cascade via foreign keys)
      this.db.prepare('DELETE FROM problems WHERE user_id = ?').run(validUserId);
      this.db.prepare('DELETE FROM settings WHERE user_id = ?').run(validUserId);

      // 2. Restore settings scoped strictly to this user
      if (backup.settings.username) {
        const now = this.clock.nowIso();
        this.db
          .prepare(
            `INSERT INTO settings (user_id, key, value, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          )
          .run(validUserId, 'leetcode_username', backup.settings.username, now);
      }

      // 3. Prepare statement handles
      const insertProblemStmt = this.db.prepare(
        `INSERT INTO problems (id, user_id, platform, slug, title, difficulty, url, solved_at, status, enrolled_at, deleted_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const insertNoteStmt = this.db.prepare(
        `INSERT INTO notes (problem_id, approaches_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(problem_id) DO UPDATE SET
           approaches_json = excluded.approaches_json,
           updated_at = excluded.updated_at`
      );

      const insertReviewStmt = this.db.prepare(
        `INSERT INTO reviews (problem_id, stage, due_date, completed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(problem_id, stage) DO UPDATE SET
           due_date = excluded.due_date,
           completed_at = excluded.completed_at`
      );

      // 4. Insert each problem, note, and review owned strictly by validUserId
      for (const item of backup.problems) {
        const p = item.problem;
        insertProblemStmt.run(
          p.id,
          validUserId,
          p.platform,
          p.slug,
          p.title,
          p.difficulty,
          p.url,
          p.solvedAt,
          p.status,
          p.enrolledAt,
          p.deletedAt,
          p.solvedAt
        );

        if (item.note) {
          insertNoteStmt.run(
            item.note.problemId,
            JSON.stringify(item.note.approaches),
            item.note.updatedAt
          );
        }

        for (const r of item.reviews) {
          insertReviewStmt.run(r.problemId, r.stage, r.dueDate, r.completedAt);
        }
      }
    });

    return {
      restoredCount: backup.problems.length,
    };
  }
}
