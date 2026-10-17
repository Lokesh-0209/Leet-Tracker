/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PLATFORMS,
  PROBLEM_STATUSES,
  ValidationError,
  type Problem,
} from '../domain/index.js';
import type { ProblemRepository } from '../repositories/problemRepository.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';
import type { ProblemSource } from './problemSource.js';
import { randomUUID } from 'node:crypto';

export interface SyncResult {
  readonly added: number;
  readonly alreadyKnown: number;
  readonly skippedDeleted: number;
}

export class SyncService {
  constructor(
    private readonly repository: ProblemRepository,
    private readonly problemSource: ProblemSource,
    private readonly settingsRepo: SettingsRepository
  ) {}

  /**
   * Synchronizes solved problems from the user's LeetCode profile.
   * Runs in ONE single DB transaction.
   * - Does not overwrite notes, status, or review state of existing problems.
   * - Never resurrects soft-deleted problems (skips them and counts under skippedDeleted).
   * - Deduplicates identical problems within the fetch batch.
   */
  public async sync(usernameOverride?: string): Promise<SyncResult> {
    const username =
      usernameOverride?.trim() || (await this.settingsRepo.getLeetCodeUsername());

    if (!username) {
      throw new ValidationError(
        'No LeetCode username configured. Please enter your username in Settings or provide it to sync.'
      );
    }

    // Fetch solved problems from upstream
    const solvedProblems = await this.problemSource.fetchSolved(username);

    // Save username in settings if provided
    if (usernameOverride) {
      await this.settingsRepo.setLeetCodeUsername(usernameOverride.trim());
    }

    // Run the entire upsert inside ONE database transaction
    return this.repository.runInTransaction(async () => {
      let added = 0;
      let alreadyKnown = 0;
      let skippedDeleted = 0;

      // Track slugs seen in this batch to prevent any intra-batch duplicate insertion
      const processedSlugsInBatch = new Set<string>();

      for (const item of solvedProblems) {
        if (processedSlugsInBatch.has(item.slug)) {
          alreadyKnown++;
          continue;
        }
        processedSlugsInBatch.add(item.slug);

        // Check if problem already exists in database (INCLUDING soft-deleted)
        const existing = await this.repository.findByPlatformAndSlug(item.platform, item.slug);

        if (existing) {
          if (existing.deletedAt !== null) {
            // Soft-deleted problem: NEVER resurrect during sync!
            skippedDeleted++;
          } else {
            // Existing active/inbox/solved problem: NEVER overwrite status, notes, or reviews
            alreadyKnown++;
          }
          continue;
        }

        // New problem: insert into INBOX
        const newProblem: Problem = {
          id: randomUUID(),
          platform: item.platform || PLATFORMS.LEETCODE,
          slug: item.slug,
          title: item.title,
          difficulty: item.difficulty,
          url: item.url,
          solvedAt: item.solvedAt,
          status: PROBLEM_STATUSES.INBOX,
          enrolledAt: null,
          deletedAt: null,
        };

        await this.repository.create(newProblem);
        added++;
      }

      return {
        added,
        alreadyKnown,
        skippedDeleted,
      };
    });
  }
}
