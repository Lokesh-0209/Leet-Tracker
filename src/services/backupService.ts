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

export class BackupService {
  constructor(
    private readonly db: SqliteDatabasePort,
    private readonly problemRepository: ProblemRepository,
    private readonly settingsRepository: SettingsRepository,
    private readonly clock: Clock
  ) {}

  /**
   * Exports full application state as a Version 1 BackupData object.
   * Includes settings, all problem aggregates (notes with all approaches, reviews),
   * and soft-deleted rows with their deletedAt timestamps.
   */
  public async exportBackup(): Promise<BackupData> {
    const username = await this.settingsRepository.getLeetCodeUsername();
    const problems = await this.problemRepository.listAggregates({ includeDeleted: true });

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
   * Atomically replaces all current data with the contents of the backup payload.
   * Runs inside ONE transaction: if validation fails or an error occurs during execution,
   * the database state is completely preserved/rolled back.
   */
  public async restoreBackup(payload: unknown): Promise<RestoreResult> {
    const parseResult = BackupDataSchema.safeParse(payload);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; ');
      throw new ValidationError(`Invalid backup data: ${errorDetails}`);
    }

    const backup = parseResult.data as unknown as BackupData;

    this.db.transaction(() => {
      // 1. Wipe current tables cleanly in reverse-dependency order
      this.db.exec('DELETE FROM reviews;');
      this.db.exec('DELETE FROM notes;');
      this.db.exec('DELETE FROM problems;');
      this.db.exec('DELETE FROM settings;');

      // 2. Restore settings
      if (backup.settings.username) {
        const now = this.clock.nowIso();
        this.db
          .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
          .run('leetcode_username', backup.settings.username, now);
      }

      // 3. Prepare statement handles
      const insertProblemStmt = this.db.prepare(
        `INSERT INTO problems (id, platform, slug, title, difficulty, url, solved_at, status, enrolled_at, deleted_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const insertNoteStmt = this.db.prepare(
        `INSERT INTO notes (problem_id, approaches_json, updated_at)
         VALUES (?, ?, ?)`
      );

      const insertReviewStmt = this.db.prepare(
        `INSERT INTO reviews (problem_id, stage, due_date, completed_at)
         VALUES (?, ?, ?, ?)`
      );

      // 4. Insert each problem, note, and review
      for (const item of backup.problems) {
        const p = item.problem;
        insertProblemStmt.run(
          p.id,
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
